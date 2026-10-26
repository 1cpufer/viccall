// Browser end-to-end run with screenshots. Starts its own server on port 3300.
// Usage: node e2e/ui.e2e.js [screenshotDir]
//
// Photos: the server's photo proxy gets a stub upstream (a local stand-in image),
// and direct Wikimedia requests from the browser are answered with the same image,
// so the run works offline. Correct answers are read from the server's session state.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/server.js');
const { bestAnswer, buildIndex } = require('../public/scoring.js');
const IDX = buildIndex(require('../src/cars.json'));

const outDir = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(outDir, { recursive: true });
const PH = fs.readFileSync(path.join(__dirname, 'fixtures', 'stand-in-car.jpg'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viccall-ui-'));
const upstream = [];
const app = createApp({
  dataDir,
  fetchImage: async url => { upstream.push(url); return new Response(PH, { status: 200, headers: { 'content-type': 'image/jpeg' } }); },
});
const base = 'http://localhost:3300';

const errors = [];
const checks = [];
const check = (cond, msg) => { checks.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };
const browserImgs = [];

async function newPage(browser, vp, { thumb404 = false } = {}) {
  const ctx = await browser.newContext(vp === 'mob'
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
    : { viewport: { width: 1440, height: 900 } });
  await ctx.route(/upload\.wikimedia\.org/, r => {
    const u = r.request().url();
    browserImgs.push(u);
    // Optionally pretend thumbnails don't exist, so the client must fall back to the original file.
    if (thumb404 && u.includes('/thumb/')) return r.fulfill({ status: 404, body: 'nope' });
    r.fulfill({ status: 200, contentType: 'image/jpeg', body: PH });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${vp}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(`[${vp}] console: ${m.text()}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tower-row');
  return { ctx, page };
}
const shot = (page, vp, name, full = false) => page.screenshot({ path: path.join(outDir, `${vp}-${name}.png`), fullPage: full });
const loaded = page => page.waitForSelector('#gImg.is-loaded', { timeout: 6000 });
const revealed = page => page.waitForSelector('#gReveal:not([hidden])', { timeout: 6000 });

async function currentCar(page) {
  const sid = await page.evaluate(() => window.VicCall.state().solo.sessionId);
  const s = app.sessions.get(sid);
  return s.queue[s.idx];
}
async function answer(page, car, { kit = false, wrong = false, enter = true } = {}) {
  if (kit) {
    await page.fill('#gKit', wrong ? 'Nope' : car.kit);
    await page.fill('#gKitCar', wrong ? '' : bestAnswer(car, IDX));
  } else {
    await page.fill('#gCar', wrong ? 'Nope' : bestAnswer(car, IDX));
    await page.fill('#gYear', wrong ? '' : String(car.year));
  }
  if (enter) await page.keyboard.press('Enter'); else await page.click('#gSubmit');
  await revealed(page);
}

async function home(page) {
  await page.click('.brand').catch(() => {});
  if (!(await page.locator('#s-home').isVisible())) await page.evaluate(() => window.VicCall.show('home'));
  await page.waitForSelector('#s-home:not([hidden])');
}

async function desktop(browser) {
  const vp = 'desk';
  const { ctx, page } = await newPage(browser, vp);
  await shot(page, vp, '01-home', true);
  check((await page.locator('.tower-row').count()) === 7, `${vp}: seven ranked playlists listed`);
  check(/^\d{1,2}[A-Z]{3}$/.test((await page.textContent('#dailyPlate')).replace(/\s+/g, '')), `${vp}: daily plate shows the date`);
  await page.waitForFunction(() => /cars match/.test(document.getElementById('builderCount').textContent));
  check(true, `${vp}: free play shows a live car count`);
  check(await page.locator('#navToggle').isHidden(), `${vp}: no hamburger on desktop`);

  // Nav dropdowns: hover and keyboard.
  await page.hover('#mb-solo');
  await page.waitForSelector('#m-solo:not([hidden])');
  check(true, `${vp}: Singleplayer menu opens on hover`);
  await shot(page, vp, '02-menu');
  await page.mouse.move(700, 800);
  await page.waitForSelector('#m-solo', { state: 'hidden' });
  await page.focus('#mb-party');
  await page.keyboard.press('ArrowDown');
  check(await page.evaluate(() => document.activeElement.closest('#m-party') !== null), `${vp}: ArrowDown opens Party menu and focuses first item`);
  await page.keyboard.press('Escape');
  check(await page.locator('#m-party').isHidden(), `${vp}: Escape closes the menu`);

  // ---- Free Play: Japan + since 2010, count updates, direct photos, casual typo forgiveness.
  await page.click('label:has(input[name="f-region"][value="japan"])');
  await page.click('label:has(input[name="f-era"][value="modern"])');
  await page.waitForTimeout(400);
  const countText = await page.textContent('#builderCount');
  check(/\d+/.test(countText) && !/^277/.test(countText.trim()), `${vp}: filter changes the count (${countText.trim()})`);
  await page.click('#builderStart');
  await loaded(page);
  const freeSrc = await page.getAttribute('#gImg', 'src');
  check(freeSrc.startsWith('https://upload.wikimedia.org/'), `${vp}: free play uses direct photo URLs`);
  check((await page.textContent('#gRules')).includes('Typos forgiven'), `${vp}: free play rules line`);
  let car = await currentCar(page);
  check(car.region === 'japan' && car.year >= 2010, `${vp}: free play respects filters (${car.make} ${car.model} ${car.year})`);
  // Empty guess -> message, no submit.
  await page.click('#gSubmit');
  check((await page.textContent('#gMsg')).includes('Type the car'), `${vp}: empty guess asks for an answer`);
  await shot(page, vp, '03-round');
  await answer(page, car);
  check((await page.textContent('#gVerdict')).includes('Spot on'), `${vp}: perfect answer says Spot on`);
  check((await page.textContent('#gScore')).trim() === '10' || (await page.waitForFunction(() => document.getElementById('gScore').textContent.trim() === '10').then(() => true)), `${vp}: score shows 10`);
  check(await page.locator('#gCredit a').isVisible(), `${vp}: photo credit links to Commons after the reveal`);
  check(await page.locator('#gClockNum').isHidden(), `${vp}: no clock in free play without a timer`);
  check(/^Answered in [\d.:]+s?/.test((await page.textContent('#gSpeed')).trim()) && await page.isVisible('#gSpeed'), `${vp}: the reveal says how fast (${(await page.textContent('#gSpeed')).trim()})`);
  await shot(page, vp, '04-reveal');
  // Enter moves on.
  await page.keyboard.press('Enter');
  await loaded(page);
  car = await currentCar(page);
  await answer(page, { ...car, make: car.make }, { enter: false });
  await page.keyboard.press('Enter');
  await loaded(page);
  // Make only -> partial verdict.
  car = await currentCar(page);
  await page.fill('#gCar', car.make);
  await page.keyboard.press('Enter');
  await revealed(page);
  check(/Partly right|Not this time|Close/.test(await page.textContent('#gVerdict')), `${vp}: make-only answer is partial (${(await page.textContent('#gVerdict')).trim()})`);
  check((await page.textContent('#gChips')).includes('Left blank'), `${vp}: blank fields are called out`);
  check(await page.isVisible('#gSpeed'), `${vp}: a partial answer still shows its time`);

  // ---- Recognition through the real UI: the shortest unique name earns full model credit.
  await page.keyboard.press('Enter');
  await loaded(page);
  car = await currentCar(page);
  const id = IDX.ids.get(require('../public/scoring.js').identityKey(car));
  const short = id.exact.map(n => n.t.join(' ')).sort((a, b) => a.length - b.length)
    .find(t => require('../public/scoring.js').understand(car, t, { ruleset: 'casual', index: IDX }).res.level === 'full');
  if (short) {
    await page.fill('#gCar', short);
    await page.keyboard.press('Enter');
    await revealed(page);
    const chips = await page.textContent('#gChips');
    check(/Model\s*\+5/.test(chips) && /Make\s*\+2/.test(chips), `${vp}: shorthand "${short}" for ${car.make} ${car.model} earns make and model (${chips.replace(/\s+/g, ' ').trim()})`);
  }

  // ---- Leave mid-game with Escape -> confirm dialog.
  await page.keyboard.press('Enter');
  await loaded(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#dlgQuit[open]');
  check(true, `${vp}: Escape mid-game asks before leaving`);
  await page.click('#dlgQuit button[value="stay"]');
  check(await page.locator('#s-game').isVisible(), `${vp}: Keep playing stays in the game`);
  await page.click('#s-game .back');
  await page.click('#dlgQuit button[value="leave"]');
  await page.waitForSelector('#s-home:not([hidden])');
  check(true, `${vp}: Leave returns to the menu`);

  // ---- Free play clock: 15 s, let it run out.
  await page.click('label:has(input[name="f-timer"][value="15"])');
  await page.waitForTimeout(200);
  await page.click('#builderStart');
  await loaded(page);
  check(await page.locator('#gClockNum').isVisible(), `${vp}: timer shows when chosen`);
  await page.fill('#gCar', 'Toyota');
  await page.waitForSelector('#gReveal:not([hidden])', { timeout: 20000 });
  const v = (await page.textContent('#gVerdict')).trim();
  check(!/Too late/.test(v), `${vp}: typed answer is sent when the clock runs out (${v})`);
  await page.evaluate(() => window.VicCall.show('home'));
  await page.click('label:has(input[name="f-timer"][value="0"])');
  await page.click('label:has(input[name="f-region"][value="any"])');
  await page.click('label:has(input[name="f-era"][value="any"])');

  // ---- Ranked JDM: opaque photo URLs, perfect game, post score, leaderboard, personal best.
  await home(page);
  await page.click('[data-playlist="jdm"]');
  await loaded(page);
  const rankedSrc = await page.getAttribute('#gImg', 'src');
  check(/^\/api\/img\/[\w-]+$/.test(rankedSrc), `${vp}: ranked photo URL is opaque (${rankedSrc.slice(0, 20)}…)`);
  check(await page.locator('#gClockNum').isVisible() && Number(await page.textContent('#gClockNum')) <= 45, `${vp}: ranked shows the 45 s clock`);
  for (let i = 0; i < 10; i++) {
    if (i) { await page.keyboard.press('Enter'); await loaded(page); }
    car = await currentCar(page);
    check(car.region === 'japan', `${vp}: JDM car ${i + 1} is Japanese`);
    await answer(page, car);
  }
  check((await page.textContent('#gStreak')).trim() === '10', `${vp}: streak counts to 10`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#gResults:not([hidden])');
  await page.waitForFunction(() => document.getElementById('rScore').textContent.trim() === '100', null, { timeout: 4000 });
  check(true, `${vp}: perfect ranked game = 100`);
  await shot(page, vp, '05-results', true);
  await page.fill('#rName', 'Ferd');
  await page.click('#rSaveBtn');
  await page.waitForSelector('#rSaved:not([hidden])');
  check((await page.textContent('#rSaved')).includes('#1'), `${vp}: posted at #1 (${(await page.textContent('#rSaved')).trim()})`);
  await page.click('.bar-tools ~ *, [data-action="home"]').catch(() => {});
  await home(page);
  check((await page.textContent('[data-playlist="jdm"] .tower-num--best')).trim() === '100', `${vp}: home shows the personal best`);
  await page.click('.nav-btn[data-to="leaderboard"]');
  await page.click('.tab[data-board="ranked:jdm"]');
  await page.waitForSelector('#lbList li:not(.board-empty)');
  check((await page.textContent('#lbList')).includes('Ferd'), `${vp}: leaderboard lists the score`);
  await shot(page, vp, '06-leaderboard');

  // ---- Kit playlist: three answer boxes, full answer = 10.
  await home(page);
  await page.click('[data-playlist="kits"]');
  await loaded(page);
  check(await page.locator('#gKit').isVisible() && await page.locator('#gKitCar').isVisible(), `${vp}: kit rounds ask for the tuner and the car`);
  car = await currentCar(page);
  await answer(page, car, { kit: true });
  check((await page.textContent('#gChips')).includes('Tuner'), `${vp}: kit reveal scores the tuner`);
  await page.waitForFunction(() => document.getElementById('gScore').textContent.trim() === '10', null, { timeout: 3000 }).then(() => check(true, `${vp}: full kit answer = 10`), () => check(false, `${vp}: full kit answer = 10`));

  // ---- Daily: play (wrong answers), post, home shows result, second run is practice.
  await page.keyboard.press('Escape');
  await page.click('#dlgQuit button[value="leave"]');
  await page.waitForSelector('#s-home:not([hidden])');
  await page.click('#dailyActions [data-action="daily"]');
  await loaded(page);
  check((await page.textContent('#gTitle')).startsWith('Daily Challenge'), `${vp}: daily title`);
  for (let i = 0; i < 10; i++) {
    if (i) { await page.keyboard.press('Enter'); await loaded(page); }
    car = await currentCar(page);
    await answer(page, car, { wrong: i % 2 === 1 });
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('#gResults:not([hidden])');
  await page.fill('#rName', 'Ferd');
  await page.click('#rSaveBtn');
  await page.waitForSelector('#rSaved:not([hidden])');
  await home(page);
  check(await page.locator('.daily-done').isVisible(), `${vp}: home shows today's result after the daily`);
  check(/#1 on the board/.test(await page.textContent('#dailyMeta')), `${vp}: home shows today's rank`);
  await shot(page, vp, '07-home-daily-done');
  await page.click('#dailyActions [data-action="daily"]');
  await loaded(page);
  check((await page.textContent('#gTitle')).includes('practice'), `${vp}: second daily run is practice`);

  // ---- Endless: lives, three misses ends the run.
  await page.keyboard.press('Escape');
  await page.click('#dlgQuit button[value="leave"]');
  await page.click('.side-mode [data-action="endless"]');
  await loaded(page);
  check((await page.locator('.life').count()) === 3, `${vp}: endless shows three lives`);
  for (let i = 0; i < 3; i++) {
    if (i) { await page.keyboard.press('Enter'); await loaded(page); }
    car = await currentCar(page);
    await answer(page, car, { wrong: true });
  }
  check((await page.locator('.life.is-lost').count()) === 3, `${vp}: three misses empties the lives`);
  check((await page.textContent('#gNext')).includes('See results'), `${vp}: run ends after three misses`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#gResults:not([hidden])');
  check((await page.textContent('#rLabel')).includes('3 cars'), `${vp}: endless results count cars`);

  // ---- Sound settings persist; M toggles mute.
  await home(page);
  await page.click('.bar-tools [data-action="sound-settings"]');
  await page.waitForSelector('#dlgSound[open]');
  await page.click('label:has(input[name="sndTheme"][value="nightrun"])');
  await page.fill('#sndMusic', '30');
  await page.dispatchEvent('#sndMusic', 'input');
  await shot(page, vp, '08-sound');
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  check((await page.getAttribute('.bar-tools [data-action="mute"]', 'aria-pressed')) === 'true', `${vp}: M mutes`);
  await page.reload({ waitUntil: 'networkidle' });
  const snd = await page.evaluate(() => window.VCAudio.get());
  check(snd.theme === 'nightrun' && snd.music === 30 && snd.muted === true, `${vp}: sound settings persist (${JSON.stringify(snd)})`);
  await page.keyboard.press('m');

  // ---- Scoring page.
  await page.click('.nav-btn[data-to="scoring"]');
  check((await page.textContent('#s-scoring')).includes('Every car is worth 10 points'), `${vp}: scoring page`);
  await shot(page, vp, '09-scoring', true);

  // ---- Back button from a game returns to the menu.
  await home(page);
  await page.click('[data-playlist="world"]');
  await loaded(page);
  await page.goBack();
  await page.waitForSelector('#s-home:not([hidden])');
  check(true, `${vp}: browser back leaves the game`);

  // ---- Report a car.
  await page.click('[data-playlist="world"]');
  await loaded(page);
  await page.fill('#gCar', 'x');
  await page.keyboard.press('Enter');
  await revealed(page);
  await page.click('#gReport summary');
  await page.fill('#gReportNote', 'test report');
  await page.click('[data-action="report"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Report sent'));
  check(true, `${vp}: report sends`);
  await ctx.close();
}

async function mobile(browser) {
  const vp = 'mob';
  const { ctx, page } = await newPage(browser, vp, { thumb404: true });
  await shot(page, vp, '01-home', true);
  check(await page.locator('#navToggle').isVisible(), `${vp}: hamburger menu on phones`);
  await page.click('#navToggle');
  await page.waitForSelector('#nav.is-open');
  await page.click('#mb-solo');
  await shot(page, vp, '02-menu');
  await page.click('#m-solo [data-anchor="free"]');
  await page.waitForTimeout(500);
  check(!(await page.locator('#nav').evaluate(n => n.classList.contains('is-open'))), `${vp}: menu closes after choosing`);
  await page.click('#builderStart');
  await loaded(page);
  const src = await page.getAttribute('#gImg', 'src');
  check(!src.includes('/thumb/'), `${vp}: missing thumbnail falls back to the original file`);
  check(await page.locator('#gPips').isVisible(), `${vp}: progress pips visible on phones`);
  await shot(page, vp, '03-round');
  const car = await currentCar(page);
  await answer(page, car, { enter: false });
  await shot(page, vp, '04-reveal', true);
  check((await page.textContent('#gVerdict')).includes('Spot on'), `${vp}: perfect answer on mobile`);
  await ctx.close();
}

async function partyFlow(browser) {
  const A = await newPage(browser, 'desk');
  const B = await newPage(browser, 'mob');
  await A.page.click('.side-mode [data-action="party-open"][data-focus="pcName"]');
  await A.page.fill('#pcName', 'Host');
  await A.page.selectOption('#pcPlaylist', 'super');
  await A.page.click('label:has(input[name="pcRules"][value="competitive"])');
  await A.page.click('#pCreate button[type=submit]');
  await A.page.waitForSelector('#s-lobby:not([hidden])');
  const code = (await A.page.textContent('#lobbyCode')).trim();
  check(await A.page.locator('#lobbySettings').isVisible(), 'party: host sees lobby settings');
  // Guest joins with an invite link.
  await B.page.goto(`${base}/?join=${code}`, { waitUntil: 'networkidle' });
  await B.page.fill('#pjName', 'Guest');
  await B.page.click('#pJoin button[type=submit]');
  await B.page.waitForSelector('#s-lobby:not([hidden])');
  check(await B.page.locator('#lobbySettings').isHidden(), 'party: guest cannot change settings');
  check((await B.page.textContent('#lobbyMode')).includes('Supercar Challenge, competitive'), `party: guest sees the playlist and rules (${(await B.page.textContent('#lobbyMode')).trim()})`);
  await A.page.selectOption('#lsPlaylist', 'jdm');
  await B.page.waitForFunction(() => document.getElementById('lobbyMode').textContent.includes('JDM'));
  check(true, 'party: playlist change reaches the guest');
  await A.page.click('#lobbyStart');
  await B.page.waitForSelector('#pgImg.is-loaded');
  const img = await B.page.getAttribute('#pgImg', 'src');
  check(/^\/api\/img\//.test(img), 'party: photo URL is opaque');
  const room = app.party.rooms.get(code);
  const car = room.queue[room.curIdx];
  check(car.region === 'japan', 'party: JDM playlist used');
  await A.page.fill('#pgCar', bestAnswer(car, IDX));
  await A.page.fill('#pgYear', String(car.year));
  await A.page.keyboard.press('Enter');
  await B.page.fill('#pgCar', 'Nope');
  await B.page.keyboard.press('Enter');
  await A.page.waitForSelector('#pgReveal:not([hidden])');
  await B.page.waitForSelector('#pgReveal:not([hidden])');
  check((await A.page.textContent('#pgVerdict')).includes('Spot on'), 'party: host verdict');
  check(await B.page.locator('#pgCredit a').isVisible(), 'party: photo credit after reveal');
  check(await A.page.isVisible('#pgPodium') && (await A.page.$$('#pgPodiumList li')).length === 1, 'party: podium shows the one correct answer');
  check(/Host\s*you/.test(await A.page.textContent('#pgPodiumList')) && /^Host\b/.test((await B.page.textContent('#pgPodiumList .podium-who')).trim()), 'party: podium names who was quickest, marked "you" for them');
  check((await B.page.textContent('#pgSpeed')).includes('You locked in at'), 'party: each player sees their own time');
  await A.page.screenshot({ path: path.join(outDir, 'party-desk-reveal.png') });
  await B.page.screenshot({ path: path.join(outDir, 'party-mob-reveal.png'), fullPage: true });
  // Refresh mid-game resumes.
  await B.page.reload({ waitUntil: 'networkidle' });
  await B.page.waitForSelector('#s-pgame:not([hidden])', { timeout: 5000 });
  check(true, 'party: guest refresh resumes the game');
  check(await B.page.waitForSelector('#pgPodium:not([hidden])', { timeout: 3000 }).then(() => true, () => false) && (await B.page.textContent('#pgSpeed')).includes('You locked in at'), 'party: after a refresh the podium and your time are still there');
  for (let i = 1; i < 10; i++) {
    await A.page.keyboard.press('Enter');
    await A.page.waitForSelector('#pgForm:not([hidden])');
    await A.page.fill('#pgCar', 'x'); await A.page.keyboard.press('Enter');
    await B.page.waitForSelector('#pgForm:not([hidden])');
    await B.page.fill('#pgCar', 'y'); await B.page.keyboard.press('Enter');
    await A.page.waitForSelector('#pgReveal:not([hidden])');
  }
  await A.page.keyboard.press('Enter');
  await B.page.waitForSelector('#s-pfinal:not([hidden])');
  check((await B.page.textContent('#pfWinner')).includes('Host wins'), `party: final standings (${(await B.page.textContent('#pfWinner')).trim()})`);
  await A.page.screenshot({ path: path.join(outDir, 'party-desk-final.png') });
  await A.ctx.close(); await B.ctx.close();
}

(async () => {
  await new Promise(r => app.server.listen(3300, r));
  const browser = await chromium.launch();
  for (const [name, fn] of [['desktop', desktop], ['mobile', mobile], ['party', partyFlow]]) {
    try { await fn(browser); } catch (e) { checks.push(`FAIL ${name} script: ${e.message.split('\n')[0]}`); }
  }
  await browser.close();
  app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  check(upstream.length > 0 && upstream.every(u => u.startsWith('https://upload.wikimedia.org/')), `server fetched ${upstream.length} proxied photos from Wikimedia URLs`);
  console.log(checks.join('\n'));
  console.log(errors.length ? `\n${errors.length} page errors:\n${errors.join('\n')}` : '\nno page errors');
  console.log(`\n${checks.filter(c => c.startsWith('PASS')).length} passed, ${checks.filter(c => c.startsWith('FAIL')).length} failed`);
  process.exit(checks.some(c => c.startsWith('FAIL')) || errors.length ? 1 : 0);
})();
