// Browser run of accounts and the Community Garage. Starts its own server on port 3400
// with the Garage switched on and a small car list, so community photos come up often.
// Usage: node e2e/garage.e2e.js [screenshotDir]      (AXE=/path/to/axe.min.js also runs axe-core)
//
// Covers: sign-up with date of birth, the email link, the licence, a photo upload with
// declarations, the moderator queue with a blur box and approval, the credit after a round,
// the public profile, reports from the game (privacy, then copyright), fixing and upholding
// them, the contributor's counter-notice and reinstatement, and the phone layout.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/server.js');
const { createMailer } = require('../src/mailer.js');
const VCScore = require('../public/scoring.js');

const outDir = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(outDir, { recursive: true });
const PH = fs.readFileSync(path.join(__dirname, 'fixtures', 'stand-in-car.jpg'));
const AXE = process.env.AXE ? fs.readFileSync(process.env.AXE, 'utf8') : null;
const ALL = require('../src/cars.json');
const FIRST_PARTY = ['toyota-supra-1994', 'mazda-rx-7-1993', 'nissan-gt-r-2009', 'honda-nsx-1991', 'bmw-m3-2000', 'porsche-911-1974',
  'volkswagen-golf-gti-1983', 'ford-mustang-1969', 'chevrolet-corvette-1963', 'dodge-charger-1970'];
const CARS = [...FIRST_PARTY.map(id => ALL.find(c => c.id === id)), { ...ALL.find(c => c.id === 'lamborghini-countach-1978'), excluded: true }];

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viccall-garage-'));
const mailer = createMailer({ apiKey: '', log: false });
const base = 'http://localhost:3400';
const app = createApp({
  dataDir, cars: CARS, garage: true, mailer, publicUrl: base, adminEmails: 'boss@example.com', log: false,
  fetchImage: async () => new Response(PH, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
});

const errors = [];
const checks = [];
const check = (cond, msg) => { checks.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(outDir, `garage-${name}.png`), fullPage: full });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function photoFile() {
  let s = 99;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grid = Buffer.alloc(16 * 10 * 3).map(() => rnd() * 255);
  const base = await sharp(grid, { raw: { width: 16, height: 10, channels: 3 } }).resize(1600, 1000, { kernel: 'cubic' }).raw().toBuffer();
  for (let i = 0; i < base.length; i++) base[i] = Math.max(0, Math.min(255, base[i] + (rnd() - 0.5) * 30));
  const file = path.join(dataDir, 'countach.jpg');
  fs.writeFileSync(file, await sharp(base, { raw: { width: 1600, height: 1000, channels: 3 } }).jpeg({ quality: 90 }).withExif({ IFD0: { Make: 'TestCam' } }).toBuffer());
  return file;
}

async function newPage(browser, mobile = false) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
    : { viewport: { width: 1440, height: 900 } });
  await ctx.route(/upload\.wikimedia\.org/, r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: PH }));
  const page = await ctx.newPage();
  const tag = mobile ? 'mob' : 'desk';
  page.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/status of (40[0-9]|429)/.test(m.text())) errors.push(`[${tag}] console: ${m.text()}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tower-row');
  return { ctx, page };
}
const toast = async (page, re) => {
  try { await page.waitForFunction(r => new RegExp(r).test(document.getElementById('toast').textContent), re.source, { timeout: 5000 }); return true; } catch { return false; }
};
async function axe(page, label) {
  if (!AXE) return;
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(x => `${x.impact} ${x.id} (${x.nodes.length}) e.g. ${x.nodes[0].target.join(' ')}`));
  check(v.length === 0, `axe: ${label}${v.length ? `: ${v.join('; ')}` : ''}`);
}
const verifyLink = email => { const m = mailer.outbox.filter(x => x.to === email).pop(); return m && /(http\S+\?verify=[\w-]+)/.exec(m.text)[1]; };
const adultDob = () => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 30); return d.toISOString().slice(0, 10); };

async function signUp(page, { email, name }) {
  await page.click('#signinBtn');
  await page.waitForSelector('#dlgGarage[open]');
  await page.click('[data-g="view"][data-view="signup"]');
  await page.fill('[data-g-form="signup"] [name=email]', email);
  await page.fill('[data-g-form="signup"] [name=password]', 'correct horse battery');
  await page.fill('[data-g-form="signup"] [name=displayName]', name);
  await page.fill('[data-g-form="signup"] [name=birthDate]', adultDob());
  await page.check('[data-g-form="signup"] [name=acceptTerms]');
  await page.click('[data-g-form="signup"] [type=submit]');
  await page.waitForSelector('#acctWrap:not([hidden])');
}
async function signIn(page, email) {
  await page.click('#signinBtn');
  await page.waitForSelector('[data-g-form="signin"]');
  await page.fill('[data-g-form="signin"] [name=email]', email);
  await page.fill('[data-g-form="signin"] [name=password]', 'correct horse battery');
  await page.click('[data-g-form="signin"] [type=submit]');
  await page.waitForSelector('#acctWrap:not([hidden])');
}
async function menu(page, selector) {
  await page.click('#acctBtn');
  await page.click(`#m-acct ${selector}`);
}
// Play Free Play until a round shows the community photo; leave the reveal open.
async function findCommunityRound(page) {
  for (let g = 0; g < 8; g++) {
    await page.evaluate(() => window.VicCall.startSolo({ kind: 'free', filters: {} }));
    for (let i = 0; i < 10; i++) {
      await page.waitForSelector('#gImg.is-loaded', { timeout: 8000 });
      await page.fill('#gCar', 'Toyota');
      await page.click('#gSubmit');
      await page.waitForSelector('#gReveal:not([hidden])');
      const credit = await page.textContent('#gCredit');
      if (/Community Garage/.test(credit)) return credit;
      if (i < 9) await page.click('#gNext'); else break;
    }
  }
  return null;
}

(async () => {
  await new Promise(r => app.server.listen(3400, r));
  const browser = await chromium.launch();
  const file = await photoFile();
  try {
    // ---------------------------------------------------------- contributor signs up
    const { ctx: annCtx, page: ann } = await newPage(browser);
    check(await ann.isVisible('#navGarage'), 'Community Garage in the nav when switched on');
    check(await ann.isVisible('#signinBtn'), 'Sign in button in the bar');
    await ann.click('#navGarage');
    await ann.waitForSelector('#s-garage:not([hidden]) .garage-intro');
    check(/Playing never needs an account/.test(await ann.textContent('#garageBody')), 'Garage intro says playing needs no account');
    await shot(ann, 'intro');
    await axe(ann, 'garage intro');

    await ann.click('#signinBtn');
    await ann.waitForSelector('#dlgGarage[open] [data-g-form="signin"]');
    await axe(ann, 'sign-in dialog');
    await ann.click('[data-g="view"][data-view="signup"]');
    await ann.fill('[data-g-form="signup"] [name=email]', 'ann@example.com');
    await ann.fill('[data-g-form="signup"] [name=password]', 'short');
    await ann.click('[data-g-form="signup"] [type=submit]');
    check(/terms/i.test(await ann.textContent('[data-g-form="signup"] .form-msg')), 'sign-up asks for the terms first');
    await ann.check('[data-g-form="signup"] [name=acceptTerms]');
    await ann.click('[data-g-form="signup"] [type=submit]');
    await ann.waitForFunction(() => /10 characters/.test(document.querySelector('[data-g-form="signup"] .form-msg').textContent));
    check(true, 'sign-up shows the server’s password rule');
    await shot(ann, 'signup');
    await ann.click('#dlgGarage [data-g="close"]');
    await signUp(ann, { email: 'ann@example.com', name: 'Ann' });
    check((await ann.textContent('#acctName')) === 'Ann', 'account menu shows the display name');
    await ann.waitForSelector('.banner');
    const banners = await ann.textContent('#garageBody');
    check(/Confirm your email/.test(banners) && /contributor licence/.test(banners), 'banners: confirm email, read the licence');

    // Email link (as if opened from the inbox).
    await ann.goto(verifyLink('ann@example.com'), { waitUntil: 'networkidle' });
    check(await toast(ann, /Email confirmed/), 'email link confirms the address');
    await ann.click('#navGarage');
    await ann.waitForSelector('[data-g="licence"]');
    await ann.click('[data-g="licence"]');
    await ann.waitForSelector('[data-g-form="licence"]');
    check(await ann.isVisible('a[href="/contributor-licence.html"]'), 'licence dialog links the full licence');
    await ann.click('[data-g-form="licence"] [type=submit]');
    check(/Tick the box/.test(await ann.textContent('[data-g-form="licence"] .form-msg')), 'licence must be ticked');
    await ann.check('[data-g-form="licence"] [name=accept]');
    await ann.click('[data-g-form="licence"] [type=submit]');
    await ann.waitForSelector('#gsForm');
    check(true, 'after the licence, the photo form opens');

    // ---------------------------------------------------------- submit a photo
    await ann.setInputFiles('#gsFile', file);
    await ann.waitForSelector('#gsPreview:not([hidden])');
    await ann.fill('#gsForm [name=make]', 'Lamborghini');
    await ann.fill('#gsForm [name=model]', 'Countach');
    await ann.fill('#gsForm [name=year]', '1978');
    await ann.fill('#gsForm [name=location]', 'Goodwood');
    await ann.check('#gsForm [name=showLocation]');
    await ann.click('#gsSubmit');
    check(/Confirm every statement/.test(await ann.textContent('#gsForm .form-msg')), 'every declaration is required');
    for (const box of await ann.$$('#gsForm .decl input[type=checkbox]')) await box.check();
    await shot(ann, 'submit-form', true);
    await axe(ann, 'submit form');
    await ann.click('#gsSubmit');
    await ann.waitForSelector('.subs .sub');
    check(/Pending review/.test(await ann.textContent('.subs')), 'submission shows Pending review');
    await ann.waitForFunction(() => { const i = document.querySelector('.subs img'); return i && i.complete && i.naturalWidth > 0; });
    check(true, 'contributor sees their pending photo');
    await shot(ann, 'my-photos');
    const sub = app.db.get('SELECT * FROM submissions ORDER BY created_at DESC LIMIT 1');
    check(sub.status === 'pending' && sub.make === 'Lamborghini' && sub.show_location === 1, 'server has the submission with its details');
    const imageId = sub.image_id;
    check((await (await fetch(`${base}/api/garage/photos/${imageId}/small`)).status) === 404, 'pending photo is not public');

    // ---------------------------------------------------------- moderator approves with a blur
    const { ctx: bossCtx, page: boss } = await newPage(browser);
    await signUp(boss, { email: 'boss@example.com', name: 'Boss' });
    await boss.goto(verifyLink('boss@example.com'), { waitUntil: 'networkidle' });
    await boss.waitForSelector('#acctWrap:not([hidden])');
    await menu(boss, '[data-to="mod"]');
    await boss.waitForSelector('.mod-item');
    check((await boss.$$('.mod-item')).length === 1, 'moderation queue lists the pending photo');
    await boss.click('.mod-item');
    await boss.waitForSelector('.review .blur-stage img');
    await boss.waitForFunction(() => document.querySelector('.review .blur-stage img').naturalWidth > 0);
    check(/Lamborghini Countach/.test(await boss.textContent('.vopts')), 'vehicle suggestion offered');
    check(await boss.isChecked('.vopts input[type=radio]'), 'exact match pre-selected');
    const layer = await (await boss.$('.blur-layer')).boundingBox();
    await boss.mouse.move(layer.x + layer.width * 0.4, layer.y + layer.height * 0.7);
    await boss.mouse.down();
    await boss.mouse.move(layer.x + layer.width * 0.6, layer.y + layer.height * 0.8, { steps: 5 });
    await boss.mouse.up();
    check((await boss.$$('.blur-box')).length === 1, 'dragging draws a blur box');
    await shot(boss, 'review');
    await axe(boss, 'moderation review');
    await boss.click('[data-g-form="decide"] button[value="approve"]');
    check(await toast(boss, /Approved/), 'approve');
    const img = app.db.get('SELECT * FROM images WHERE id = ?', imageId);
    const blur = JSON.parse(img.restrictions).blur;
    check(img.moderation === 'approved' && img.vehicle_key === VCScore.identityKey(CARS.find(c => c.id === 'lamborghini-countach-1978')), 'image approved with the vehicle');
    check(blur.length === 1 && Math.abs(blur[0].x - 0.4) < 0.02 && Math.abs(blur[0].w - 0.2) < 0.02, `blur box saved where it was drawn (${JSON.stringify(blur)})`);

    // ---------------------------------------------------------- an anonymous player meets the photo
    const { ctx: anonCtx, page: anon } = await newPage(browser);
    const credit = await findCommunityRound(anon);
    check(credit && /Photo: Ann, VicCall Community Garage/.test(credit), `credit after the round names the photographer (${credit})`);
    check(await anon.isVisible('#gCredit a[href="/?profile=Ann"]'), 'credit links to the profile');
    await shot(anon, 'credit');
    // Report: privacy.
    await anon.click('#gReport summary');
    check(await anon.isVisible('#gReportKind'), 'report asks what’s wrong when the Garage is on');
    await anon.selectOption('#gReportKind', 'privacy');
    await anon.fill('#gReportNote', 'The number plate is readable');
    await anon.click('[data-action="report"]');
    check(await toast(anon, /moderator will look/), 'privacy report sent');
    check(app.db.get('SELECT takedown FROM images WHERE id = ?', imageId).takedown === 'disputed', 'privacy report takes the photo out of play');

    // Profile page, opened as the credit link would.
    const { ctx: profCtx, page: prof } = await newPage(browser);
    await prof.goto(`${base}/?profile=Ann`, { waitUntil: 'networkidle' });
    await prof.waitForSelector('#s-profile:not([hidden]) #profile-title');
    check(/no public profile/.test(await prof.textContent('#profileBody')), 'profile hidden while the only photo is disputed');
    await profCtx.close();

    // Moderator fixes it with another blur.
    await boss.click('[data-g="mod-tab"][data-tab="reports"]');
    await boss.waitForSelector('.report-card');
    check(/Privacy/.test(await boss.textContent('.report-card')), 'report reaches the moderator');
    await boss.click('.report-card details.fix summary');
    await boss.waitForFunction(() => document.querySelector('.report-card .blur-stage img').naturalWidth > 0);
    check((await boss.$$('.report-card .blur-box')).length === 1, 'existing blur shown');
    await boss.click('.report-card [data-blur-add]');
    await boss.fill('.report-card [name=note]', 'Plate blurred');
    await boss.click('.report-card button[value="fix"]');
    check(await toast(boss, /Fixed/), 'fix the photo');
    const fixed = app.db.get('SELECT takedown, restrictions FROM images WHERE id = ?', imageId);
    check(fixed.takedown === 'none' && JSON.parse(fixed.restrictions).blur.length === 2, 'back in play with two blur boxes');

    const { ctx: prof2Ctx, page: prof2 } = await newPage(browser);
    await prof2.goto(`${base}/?profile=Ann`, { waitUntil: 'networkidle' });
    await prof2.waitForSelector('.gallery img');
    const ptext = await prof2.textContent('#profileBody');
    check(/Ann/.test(ptext) && /Lamborghini Countach/.test(ptext) && /Goodwood/.test(ptext) && /First photo/.test(ptext), 'public profile: photo, place shown by choice, badge');
    await shot(prof2, 'profile');
    await axe(prof2, 'profile');
    await prof2Ctx.close();

    // ---------------------------------------------------------- copyright complaint, upheld, counter-notice, reinstated
    await anon.click('#gNext').catch(() => {});
    const credit2 = await findCommunityRound(anon);
    check(!!credit2, 'photo comes up again after the fix');
    await anon.click('#gReport summary');
    await anon.selectOption('#gReportKind', 'copyright');
    await anon.click('[data-action="report"]');
    await anon.waitForSelector('[data-g-form="copyright"]');
    await axe(anon, 'copyright dialog');
    await anon.fill('[data-g-form="copyright"] [name=name]', 'Pat Owner');
    await anon.fill('[data-g-form="copyright"] [name=email]', 'pat@example.com');
    await anon.fill('[data-g-form="copyright"] [name=work]', 'Published at example.com/countach');
    await anon.check('[data-g-form="copyright"] [name=goodFaith]');
    await anon.check('[data-g-form="copyright"] [name=accurate]');
    await anon.fill('[data-g-form="copyright"] [name=signature]', 'Pat Owner');
    await anon.click('[data-g-form="copyright"] [type=submit]');
    check(await toast(anon, /Complaint sent/), 'copyright complaint sent');
    await boss.click('[data-g="mod-tab"][data-tab="reports"]');
    await boss.waitForSelector('.report-card');
    check(/pat@example.com/.test(await boss.textContent('.report-card')), 'moderator sees the notice details');
    await boss.fill('.report-card [name=note]', 'Complainant showed the original');
    await boss.click('.report-card button[value="uphold"]');
    check(await toast(boss, /Removed/), 'uphold the complaint');
    check(app.db.get('SELECT moderation FROM images WHERE id = ?', imageId).moderation === 'removed', 'photo removed');

    await ann.reload({ waitUntil: 'networkidle' });
    await ann.click('#navGarage');
    await ann.click('[data-g="tab"][data-tab="mine"]');
    await ann.waitForSelector('[data-g="counter"]');
    check(/Removed/.test(await ann.textContent('.subs')) && /counter-notice/.test(await ann.textContent('.subs')), 'contributor sees why it was removed');
    await ann.click('[data-g="counter"]');
    await ann.fill('[data-g-form="counter"] [name=name]', 'Ann Example');
    await ann.fill('[data-g-form="counter"] [name=contact]', '1 Road, Town; ann@example.com');
    await ann.fill('[data-g-form="counter"] [name=statement]', 'I took this photo at Goodwood myself; the complaint is mistaken.');
    await ann.check('[data-g-form="counter"] [name=consent]');
    await ann.click('[data-g-form="counter"] [type=submit]');
    check(await toast(ann, /Counter-notice sent/), 'counter-notice sent');

    await boss.click('[data-g="mod-tab"][data-tab="notices"]');
    await boss.waitForSelector('[data-g="reinstate"]');
    await boss.click('[data-g="notice"][data-status="forwarded"]');
    await toast(boss, /Saved/);
    await boss.waitForSelector('[data-g="reinstate"]');
    await boss.click('[data-g="reinstate"]');
    await boss.fill('[data-g-form="reinstate"] [name=reason]', 'No court action within 14 business days');
    await boss.click('[data-g-form="reinstate"] [type=submit]');
    check(await toast(boss, /back, in casual modes/), 'photo reinstated');
    check(app.db.get('SELECT eligibility FROM images WHERE id = ?', imageId).eligibility === 'casual', 'reinstated as casual-only');
    await boss.click('[data-g="mod-tab"][data-tab="history"]');
    await boss.waitForSelector('.audit li');
    check(/image.reinstate/.test(await boss.textContent('.audit')), 'history lists the actions');
    await shot(boss, 'history');

    // ---------------------------------------------------------- account settings and sign out
    await menu(ann, '[data-g="account"]');
    await ann.waitForSelector('[data-g-form="account"]');
    await axe(ann, 'account dialog');
    await ann.check('[data-g-form="account"] [name=creditAnonymous]');
    await ann.click('[data-g-form="account"] [type=submit]');
    check(await toast(ann, /Saved/), 'credit as Community photographer');
    check(app.db.get(`SELECT credit_anonymous FROM users WHERE email = 'ann@example.com'`).credit_anonymous === 1, 'anonymous credit saved');
    await menu(ann, '[data-g="signout"]');
    check(await toast(ann, /Signed out/), 'sign out');
    check(await ann.isVisible('#signinBtn'), 'signed out: Sign in button back');
    await signIn(ann, 'ann@example.com');
    check((await ann.textContent('#acctName')) === 'Ann', 'sign in with email and password');
    await annCtx.close();
    await bossCtx.close();
    await anonCtx.close();

    // ---------------------------------------------------------- phone
    const { ctx: mobCtx, page: mob } = await newPage(browser, true);
    check(await mob.isVisible('#signinBtn'), 'phone: Sign in visible in the bar');
    await signIn(mob, 'ann@example.com');
    await mob.click('#acctBtn');
    await mob.waitForSelector('#m-acct:not([hidden])');
    const pop = await (await mob.$('#m-acct')).boundingBox();
    check(pop && pop.x >= 0 && pop.x + pop.width <= 390, 'phone: account menu fits the screen');
    await shot(mob, 'mob-menu');
    await mob.click('#m-acct [data-to="garage"]');
    await mob.waitForSelector('#gsForm');
    await shot(mob, 'mob-submit', true);
    await axe(mob, 'phone submit form');
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check(!overflow, 'phone: no sideways scrolling on the Garage');
    await mobCtx.close();
  } catch (e) {
    errors.push(`script: ${e.stack}`);
  } finally {
    await browser.close();
    app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(checks.join('\n'));
  console.log(`\n${checks.filter(c => c.startsWith('PASS')).length}/${checks.length} checks passed; page errors: ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
  process.exit(checks.some(c => c.startsWith('FAIL')) || errors.length ? 1 : 0);
})();
