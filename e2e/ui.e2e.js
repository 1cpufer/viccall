// End-to-end UI run with screenshots.
// Usage: npm start (in another terminal), then: node e2e/ui.e2e.js http://localhost:3000 e2e/shots run
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [, , base = 'http://localhost:3100', outDir = './shots', tag = 'run', repo = path.join(__dirname, '..')] = process.argv;
// Car photos come from Wikimedia; tests swap in a local image so they run offline.
const PH = fs.readFileSync(path.join(__dirname, 'fixtures', 'stand-in-car.jpg'));
const CARS = JSON.parse(fs.readFileSync(path.join(repo, 'src/cars.json'), 'utf8'));
const carFor = (raw, kit) => {
  for (const img of [String(raw), String(raw).replace('/960px-', '/1280px-')]) {
    const c = CARS.find(x => x.img === img && (!kit || x.kit)) || CARS.find(x => x.img === img);
    if (c) return c;
  }
};
const HAS_1280 = new Set(CARS.filter(c => c.img.includes('/1280px-')).map(c => c.img.replace('/1280px-', '/960px-')));

const S = require(path.join(repo, 'public/scoring.js'));
const errors = [];
const imgReqs = [];
const checks = [];
const check = (cond, msg) => { checks.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };

async function newPage(browser, vp) {
  const size = vp === 'mob' ? { width: 390, height: 844 } : { width: 1280, height: 860 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: vp === 'mob' ? 2 : 1, hasTouch: vp === 'mob', isMobile: vp === 'mob' });
  // Half the 960px thumbnails "don't exist" so the client must fall back to the 1280px original.
  await ctx.route(/upload\.wikimedia\.org/, r => {
    const u = r.request().url();
    imgReqs.push(u);
    if (HAS_1280.has(u)) return r.fulfill({ status: 404, body: 'nope' });
    r.fulfill({ status: 200, contentType: 'image/jpeg', body: PH });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${vp}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(`[${vp}] console: ${m.text()}`); });
  return { ctx, page };
}
const shot = (page, vp, name, full = true) => page.screenshot({ path: path.join(outDir, `${tag}-${vp}-${name}.png`), fullPage: full });
const visible = (page, sel) => page.locator(sel).isVisible();

async function currentImg(page, id) {
  await page.waitForFunction(i => { const el = document.getElementById(i); return el && el.classList.contains('is-loaded'); }, id, { timeout: 5000 });
  return page.$eval('#' + id, el => el.getAttribute('src'));
}

async function solo(browser, vp) {
  const { ctx, page } = await newPage(browser, vp);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await shot(page, vp, '01-home', false);
  // swipe/drag the deck to the next card
  const box = await page.locator('#deckViewport').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.7 - i * 0.05), box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(500);
  check((await page.textContent('#playBtn')).includes('Pick a region'), `${vp}: drag moves deck to Regional`);
  await shot(page, vp, '02-home-dragged', false);
  await page.click('#playBtn');
  await page.waitForTimeout(300);
  await shot(page, vp, '03-regional');
  await page.click('[data-mode="japan"]');
  let expected = 0;
  for (let i = 0; i < 10; i++) {
    const src = await currentImg(page, 'gImg');
    const car = carFor(src);
    if (i === 0) await shot(page, vp, '04-game', false);
    if (i % 3 === 0) { await page.fill('#gMake', car.make); await page.fill('#gModel', car.model); await page.fill('#gYear', String(car.year)); expected += 5; }
    else if (i % 3 === 1) { await page.fill('#gMake', car.make); await page.fill('#gYear', String(car.year - 3)); expected += S.scoreGuess(car, car.make, '', String(car.year - 3)).pts; }
    else { await page.fill('#gModel', 'Definitely Wrong'); }
    await page.keyboard.press('Enter');
    await page.waitForSelector('#gReveal:not([hidden])');
    if (i === 0) { await page.waitForTimeout(700); await shot(page, vp, '05-reveal-hit', false); }
    if (i === 1) { await page.waitForTimeout(700); await shot(page, vp, '06-reveal-partial', false); }
    if (i === 2) { await page.waitForTimeout(700); await shot(page, vp, '07-reveal-miss', false); }
    await page.click('#gNext');
  }
  await page.waitForSelector('#gResults:not([hidden])');
  await page.waitForTimeout(600);
  const score = +(await page.textContent('#rScore'));
  check(score === expected, `${vp}: solo score adds up (${score} = ${expected})`);
  await page.fill('#rName', 'E2E ' + vp);
  await page.click('#rSaveBtn');
  await page.waitForSelector('#rSaved:not([hidden])');
  check(/Saved/.test(await page.textContent('#rSaved')), `${vp}: score saved`);
  await shot(page, vp, '08-results');
  if (vp === 'desk') {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.click('[data-action="share"]');
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(/^VicCall Japan: \d+\/50\n[🟨⬜🟥]{10}/u.test(clip), `share text copied (${JSON.stringify(clip.slice(0, 40))})`);
  }
  await page.click('[data-action="home"]');
  await page.click('[data-to="leaderboard"]');
  await page.click('.tab[data-mode="japan"]');
  await page.waitForSelector('#lbList li .who');
  check(await page.locator('#lbList li.is-you').count() === 1, `${vp}: own leaderboard row highlighted`);
  await shot(page, vp, '09-leaderboard');
  // browser back returns home
  await page.goBack();
  await page.waitForTimeout(300);
  check(await visible(page, '#s-home'), `${vp}: back button returns home`);
  // time attack shows a clock; kit shows kit field
  await page.evaluate(() => window.VicCall.startSolo('timeattack'));
  await currentImg(page, 'gImg');
  check(await visible(page, '#gClock'), `${vp}: time attack clock visible`);
  await page.waitForTimeout(1200);
  await shot(page, vp, '10-timeattack', false);
  await page.evaluate(() => window.VicCall.startSolo('kit'));
  const ksrc = await currentImg(page, 'gImg');
  check(await visible(page, '#gKit') && !(await visible(page, '#gMake')), `${vp}: kit mode shows tuner field only`);
  await page.fill('#gKit', carFor(ksrc, true).kit);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#gReveal:not([hidden])');
  await page.waitForTimeout(600);
  check((await page.textContent('#gChips')).includes('+5'), `${vp}: kit answer scores 5`);
  await shot(page, vp, '11-kit-reveal', false);
  // empty submit shows inline message
  await page.click('#gNext');
  await currentImg(page, 'gImg');
  await page.click('#gSubmit');
  check((await page.textContent('#gMsg')).length > 0, `${vp}: empty guess shows a message`);
  await ctx.close();
}

async function partyFlow(browser) {
  const a = await newPage(browser, 'desk');
  const b = await newPage(browser, 'mob');
  await a.page.goto(base, { waitUntil: 'networkidle' });
  await a.page.click('[data-to="party"]');
  await a.page.waitForTimeout(250);
  await shot(a.page, 'desk', '20-party');
  await a.page.fill('#pcName', 'Ferd');
  await a.page.selectOption('#pcMode', 'germany');
  await a.page.click('#pCreate button[type=submit]');
  await a.page.waitForSelector('#s-lobby:not([hidden])');
  const code = (await a.page.textContent('#lobbyCode')).trim();
  check(/^[A-Z0-9]{5}$/.test(code), `party code shown (${code})`);
  // guest joins via invite link
  await b.page.goto(`${base}/?join=${code}`, { waitUntil: 'networkidle' });
  check((await b.page.inputValue('#pjCode')) === code, 'invite link prefills code');
  await b.page.fill('#pjName', 'Ayo');
  await b.page.click('#pJoin button[type=submit]');
  await b.page.waitForSelector('#s-lobby:not([hidden])');
  await a.page.waitForFunction(() => document.querySelectorAll('#lobbyPlayers li').length === 2);
  await shot(a.page, 'desk', '21-lobby-host');
  await shot(b.page, 'mob', '22-lobby-guest');
  await a.page.click('#lobbyStart');
  await a.page.waitForSelector('#s-pgame:not([hidden])');
  await b.page.waitForSelector('#s-pgame:not([hidden])');
  const src = await currentImg(a.page, 'pgImg');
  const car = carFor(src);
  await a.page.fill('#pgMake', car.make); await a.page.fill('#pgModel', car.model); await a.page.fill('#pgYear', String(car.year));
  await a.page.keyboard.press('Enter');
  await a.page.waitForSelector('#pgLocked:not([hidden])');
  await shot(a.page, 'desk', '23-party-locked', false);
  // guest refreshes mid-round and resumes
  await b.page.reload({ waitUntil: 'networkidle' });
  await b.page.waitForSelector('#s-pgame:not([hidden])', { timeout: 5000 });
  check(true, 'guest resumes after refresh');
  await b.page.fill('#pgMake', 'Nope');
  await b.page.keyboard.press('Enter');
  await a.page.waitForSelector('#pgReveal:not([hidden])');
  await b.page.waitForSelector('#pgReveal:not([hidden])');
  await a.page.waitForTimeout(700);
  check((await a.page.textContent('#pgChips')).includes('+2'), 'host sees own breakdown');
  check(await visible(a.page, '#pgNext') && !(await visible(b.page, '#pgNext')), 'only host has Next');
  await shot(a.page, 'desk', '24-party-reveal-host');
  await shot(b.page, 'mob', '25-party-reveal-guest');
  for (let i = 1; i < 10; i++) {
    await a.page.click('#pgNext');
    await a.page.waitForSelector('#pgForm:not([hidden])');
    await a.page.fill('#pgMake', 'x');
    await a.page.keyboard.press('Enter');
    await b.page.waitForSelector('#pgForm:not([hidden])');
    await b.page.fill('#pgMake', 'y');
    await b.page.keyboard.press('Enter');
    await a.page.waitForSelector('#pgReveal:not([hidden])');
  }
  await a.page.click('#pgNext');
  await a.page.waitForSelector('#s-pfinal:not([hidden])');
  await b.page.waitForSelector('#s-pfinal:not([hidden])');
  check(/Ferd wins with 5 points/.test(await a.page.textContent('#pfWinner')), 'final winner line');
  await shot(a.page, 'desk', '26-party-final');
  await shot(b.page, 'mob', '27-party-final-guest');
  // host leaves → guest becomes host
  await a.page.click('#s-pfinal [data-action="party-leave"]');
  await b.page.waitForSelector('#pfAgain:not([hidden])');
  check(true, 'host handoff to guest after leave');
  await a.ctx.close(); await b.ctx.close();
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    await solo(browser, 'desk');
    await solo(browser, 'mob');
    await partyFlow(browser);
  } catch (e) {
    errors.push('SCRIPT: ' + e.message.split('\n')[0]);
  }
  await browser.close();
  check(imgReqs.some(u => u.includes('/960px-')) && imgReqs.some(u => u.includes('/1280px-')), `photos use 960px with 1280px fallback (${imgReqs.length} requests)`);
  console.log(checks.join('\n'));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
})();
