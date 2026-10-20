// Party edge cases against a fast-timer server. Starts its own server on port 3200.
// Usage: node e2e/party.e2e.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../src/server.js');
// Car photos come from Wikimedia; tests swap in a local image so they run offline.
const PH = fs.readFileSync(path.join(__dirname, 'fixtures', 'stand-in-car.jpg'));
const out = [];
const check = (c, m) => out.push(`${c ? 'PASS' : 'FAIL'} ${m}`);

(async () => {
  const app = createApp({
    dataDir: path.join(require('os').tmpdir(), 'viccall-e2e-data'),
    party: { roundMs: 4000, competitiveMs: 3000, awayMs: 1000, graceMs: 3000 },
    fetchImage: async () => new Response(PH, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
  });
  await new Promise(r => app.server.listen(3200, r));
  const base = 'http://localhost:3200';
  const browser = await chromium.launch();
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/upload\.wikimedia\.org/, r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: PH }));
    const page = await ctx.newPage();
    page.on('pageerror', e => out.push('pageerror ' + e.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    return { ctx, page };
  };
  try {
    const A = await mk(), B = await mk(), C = await mk();
    await A.page.click('.side-mode [data-action="party-open"][data-focus="pcName"]');
    await A.page.fill('#pcName', 'Host');
    await A.page.selectOption('#pcPlaylist', 'kits');
    await A.page.click('#pCreate button[type=submit]');
    await A.page.waitForSelector('#s-lobby:not([hidden])');
    const code = (await A.page.textContent('#lobbyCode')).trim();
    for (const [P, n] of [[B, 'Bea'], [C, 'Cal']]) {
      await P.page.click('.side-mode [data-action="party-open"][data-focus="pjCode"]');
      await P.page.fill('#pjName', n);
      await P.page.fill('#pjCode', code.toLowerCase());
      await P.page.click('#pJoin button[type=submit]');
      await P.page.waitForSelector('#s-lobby:not([hidden])');
    }
    check((await A.page.textContent('#lobbyStart')).includes('3 drivers'), 'lobby counts 3 drivers');
    await A.page.click('#lobbyStart');
    await B.page.waitForSelector('#pgKit:visible');
    check(await B.page.locator('#pgKitModel').isVisible(), 'kit party shows tuner, make and model fields');

    // Nobody answers -> server timer reveals (round 3 s? roundMs 4 s for kit)
    const t0 = Date.now();
    await B.page.waitForSelector('#pgReveal:not([hidden])', { timeout: 8000 });
    check(Date.now() - t0 > 2500, `timer reveal after ${Date.now() - t0} ms`);
    check((await B.page.textContent('#pgVerdict')).includes('No answer'), 'unanswered player sees "No answer"');
    check(await B.page.locator('#pgClockNum').isHidden(), 'clock hidden at reveal');

    // Host closes tab during reveal -> someone else gets Next
    await A.ctx.close();
    await B.page.waitForTimeout(500);
    const bNext = await B.page.locator('#pgNext').isVisible();
    const cNext = await C.page.locator('#pgNext').isVisible();
    check(bNext !== cNext, `exactly one new host gets Next (B:${bNext} C:${cNext})`);
    const H = bNext ? B : C, G = bNext ? C : B;
    check((await G.page.textContent('#pgWaitHost')).includes(bNext ? 'Bea' : 'Cal'), 'guest told who the new host is');

    // Typed answer is auto-sent just before time runs out
    await H.page.click('#pgNext');
    await G.page.waitForSelector('#pgForm:not([hidden])');
    await G.page.fill('#pgKit', 'Liberty Walk');
    await G.page.waitForSelector('#pgReveal:not([hidden])', { timeout: 8000 });
    const chips = await G.page.textContent('#pgChips');
    check(/Tuner/.test(chips), `typed-but-unsent answer was auto-submitted (${chips.replace(/\s+/g, ' ').trim()})`);

    // Play through to final quickly
    for (let i = 2; i < 10; i++) {
      await H.page.click('#pgNext');
      await H.page.waitForSelector('#pgForm:not([hidden])');
      await H.page.fill('#pgKit', 'x'); await H.page.keyboard.press('Enter');
      // Guest gets one right, so the rematch has a score to reset.
      const room = app.party.rooms.get(code);
      await G.page.fill('#pgKit', i === 2 ? room.queue[room.curIdx].kit : 'y'); await G.page.keyboard.press('Enter');
      await H.page.waitForSelector('#pgReveal:not([hidden])');
    }
    await H.page.click('#pgNext');
    await G.page.waitForSelector('#s-pfinal:not([hidden])');
    // Guest refreshes on the final screen -> still on final
    await G.page.reload({ waitUntil: 'networkidle' });
    await G.page.waitForSelector('#s-pfinal:not([hidden])', { timeout: 5000 });
    check(true, 'refresh on final screen resumes final standings');
    // Host plays again -> both get round 1
    await H.page.click('#pfAgain');
    await G.page.waitForSelector('#s-pgame:not([hidden])');
    check((await G.page.textContent('#pgCount')).includes('Car 1 of 10'), 'play again restarts at car 1');
    await G.page.waitForTimeout(700); // let any score count-up animation finish before reading
    const gScore = (await G.page.textContent('#pgScore')).trim();
    const gState = await G.page.evaluate(() => { const s = window.VicCall.state().party; return { idx: s.round && s.round.idx, state: s.state, me: (s.players.find(p => p.id === s.youId) || {}).score }; });
    check(gScore === '0', `scores reset for the new game (shown ${gScore}, state ${JSON.stringify(gState)})`);
    // Leave button mid-game asks first.
    await G.page.click('#s-pgame .back');
    await G.page.waitForSelector('#dlgQuit[open]');
    await G.page.click('#dlgQuit button[value="stay"]');
    check(await G.page.locator('#s-pgame').isVisible(), 'leave button asks before leaving a party game');
    // Guest uses browser back -> leaves party; host sees 1 player
    await G.page.goBack();
    await G.page.waitForSelector('#s-party:not([hidden]), #s-home:not([hidden])');
    await H.page.waitForFunction(() => document.querySelectorAll('#pgStandings li').length === 1, null, { timeout: 4000 });
    check(true, 'browser back leaves the party and host roster updates');
    await B.ctx.close(); await C.ctx.close();
  } catch (e) {
    out.push('SCRIPT ' + e.message.split('\n')[0]);
  }
  await browser.close();
  app.close();
  fs.rmSync(path.join(require('os').tmpdir(), 'viccall-e2e-data'), { recursive: true, force: true });
  console.log(out.join('\n'));
  process.exit(0);
})();
