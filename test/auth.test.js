const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, agent } = require('./helpers');
const { createMailer } = require('../src/mailer');
const { ageFrom } = require('../src/auth');

const iso = years => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const ADULT = iso(25), TEEN = iso(15), CHILD = iso(10);
const signup = (a, over = {}) => a.req('POST', '/api/auth/signup', { email: 'ferd@example.com', password: 'correct horse battery', displayName: 'Ferd', birthDate: ADULT, acceptTerms: true, ...over });
const linkFrom = mail => /\?(verify|reset)=([\w-]+)/.exec(mail.text)[2];

async function garage(opts = {}) {
  const mailer = createMailer({ apiKey: '', log: false });
  const srv = await startServer({ garage: true, mailer, publicUrl: 'http://vc.test', adminEmails: 'boss@example.com', ...opts });
  return { srv, mailer };
}

test('age is whole years from a real date', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  assert.equal(ageFrom('2008-10-20', now), 18);
  assert.equal(ageFrom('2008-10-21', now), 17);
  assert.equal(ageFrom('2026-02-30', now), null, 'not a real date');
  assert.equal(ageFrom('2030-01-01', now), null, 'in the future');
  assert.equal(ageFrom('banana', now), null);
});

test('accounts are off unless the Garage is enabled', async () => {
  const srv = await startServer();
  try {
    assert.equal((await srv.api('GET', '/api/auth/me')).status, 404);
    assert.equal((await srv.api('GET', '/api/meta')).body.garage, false);
  } finally { await srv.stop(); }
});

test('sign-up: validation, under-13 refused with nothing kept, adult flag from birth date', async () => {
  const { srv, mailer } = await garage();
  try {
    const a = agent(srv);
    assert.equal((await signup(a, { email: 'nope' })).body.field, 'email');
    assert.equal((await signup(a, { password: 'short' })).body.field, 'password');
    assert.equal((await signup(a, { password: 'aaaaaaaaaaaa' })).body.field, 'password');
    assert.equal((await signup(a, { displayName: 'x' })).body.field, 'displayName');
    assert.equal((await signup(a, { displayName: 'Admin' })).body.field, 'displayName', 'reserved');
    assert.equal((await signup(a, { acceptTerms: false })).body.field, 'acceptTerms');
    const child = await signup(a, { birthDate: CHILD });
    assert.equal(child.status, 403);
    assert.equal(srv.db.get('SELECT COUNT(*) AS n FROM users').n, 0, 'nothing stored for under-13s');
    const ok = await signup(a);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.adult, true);
    assert.equal(ok.body.user.emailVerified, false);
    assert.match(a.cookie, /^vc_session=/);
    const row = srv.db.get('SELECT * FROM users');
    assert.ok(!Object.keys(row).some(k => /birth|dob/.test(k)), 'no birth date column');
    assert.match(row.password_hash, /^scrypt\$/);
    assert.equal((await a.req('GET', '/api/auth/me')).body.user.displayName, 'Ferd');
    assert.equal(mailer.outbox.length, 1, 'verification email queued');
    const teen = await signup(agent(srv), { email: 'teen@example.com', displayName: 'Teen', birthDate: TEEN });
    assert.equal(teen.body.user.adult, false);
    assert.equal((await signup(agent(srv), { displayName: 'Other' })).status, 409, 'email taken');
    assert.equal((await signup(agent(srv), { email: 'x@example.com', displayName: 'ferd' })).status, 409, 'display names are case-insensitive');
  } finally { await srv.stop(); }
});

test('state-changing requests need the X-VicCall header', async () => {
  const { srv } = await garage();
  try {
    const r = await agent(srv).req('POST', '/api/auth/signup', { email: 'a@b.co' }, { 'x-viccall': '' });
    assert.equal(r.status, 403);
  } finally { await srv.stop(); }
});

test('login, logout, verification and password reset', async () => {
  const { srv, mailer } = await garage();
  try {
    const a = agent(srv);
    await signup(a);
    await a.req('POST', '/api/auth/logout');
    assert.equal((await a.req('GET', '/api/auth/me')).body.user, null);
    const bad = await a.req('POST', '/api/auth/login', { email: 'ferd@example.com', password: 'wrong password!' });
    const none = await a.req('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'wrong password!' });
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.body, none.body, 'same answer whether or not the account exists');
    assert.equal((await a.req('POST', '/api/auth/login', { email: 'FERD@example.com', password: 'correct horse battery' })).status, 200);

    const token = linkFrom(mailer.outbox[0]);
    assert.equal((await a.req('POST', '/api/auth/verify', { token })).status, 200);
    assert.equal((await a.req('POST', '/api/auth/verify', { token })).status, 400, 'links work once');
    assert.equal((await a.req('GET', '/api/auth/me')).body.user.emailVerified, true);

    const other = agent(srv);
    await other.req('POST', '/api/auth/login', { email: 'ferd@example.com', password: 'correct horse battery' });
    assert.equal((await a.req('POST', '/api/auth/forgot', { email: 'nobody@example.com' })).status, 200, 'no hint about unknown emails');
    await a.req('POST', '/api/auth/forgot', { email: 'ferd@example.com' });
    const reset = linkFrom(mailer.outbox[mailer.outbox.length - 1]);
    assert.equal((await a.req('POST', '/api/auth/reset', { token: reset, password: 'short' })).status, 400);
    assert.equal((await a.req('POST', '/api/auth/reset', { token: reset, password: 'a brand new password' })).status, 200);
    assert.equal((await other.req('GET', '/api/auth/me')).body.user, null, 'other sessions signed out');
    assert.equal((await agent(srv).req('POST', '/api/auth/login', { email: 'ferd@example.com', password: 'a brand new password' })).status, 200);
    // Expired tokens are refused.
    await a.req('POST', '/api/auth/forgot', { email: 'ferd@example.com' });
    srv.db.run("UPDATE email_tokens SET expires_at = 1 WHERE kind = 'reset' AND used_at IS NULL");
    assert.equal((await a.req('POST', '/api/auth/reset', { token: linkFrom(mailer.outbox[mailer.outbox.length - 1]), password: 'another new password' })).status, 400);
  } finally { await srv.stop(); }
});

test('admins come from ADMIN_EMAILS, and only once the address is verified', async () => {
  const { srv, mailer } = await garage();
  try {
    const a = agent(srv);
    await signup(a, { email: 'boss@example.com', displayName: 'Boss' });
    assert.equal((await a.req('GET', '/api/auth/me')).body.user.role, 'user');
    await a.req('POST', '/api/auth/verify', { token: linkFrom(mailer.outbox[0]) });
    assert.equal((await a.req('GET', '/api/auth/me')).body.user.role, 'admin');
    assert.ok(srv.db.get("SELECT 1 FROM audit_log WHERE action = 'role.promote'"));
  } finally { await srv.stop(); }
});

test('suspended accounts cannot sign in; closing an account removes personal details', async () => {
  const { srv } = await garage();
  try {
    const a = agent(srv);
    await signup(a);
    assert.equal((await a.req('POST', '/api/auth/close', { confirm: 'nope' })).status, 400);
    assert.equal((await a.req('POST', '/api/auth/close', { confirm: 'close' })).status, 200);
    const row = srv.db.get('SELECT * FROM users');
    assert.equal(row.status, 'closed');
    assert.equal(row.email, null);
    assert.equal(row.display_name, null);
    assert.equal((await a.req('GET', '/api/auth/me')).body.user, null);
    const b = agent(srv);
    await signup(b, { email: 'sus@example.com', displayName: 'Sus' });
    srv.db.run("UPDATE users SET status = 'suspended' WHERE email = 'sus@example.com'");
    assert.equal((await agent(srv).req('POST', '/api/auth/login', { email: 'sus@example.com', password: 'correct horse battery' })).status, 403);
  } finally { await srv.stop(); }
});

// A stand-in for Google's and Discord's servers.
function fakeProviders(people) {
  const calls = [];
  const fetchAuth = async (url, init = {}) => {
    calls.push({ url, init });
    const json = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/oauth2\.googleapis\.com\/token|discord\.com\/api\/oauth2\/token/.test(url)) {
      const code = new URLSearchParams(String(init.body)).get('code');
      if (!people[code]) return new Response('bad code', { status: 400 });
      return json({ access_token: `at-${code}` });
    }
    const who = String((init.headers || {}).Authorization || '').replace('Bearer at-', '');
    if (/openidconnect/.test(url)) return json(people[who]);
    if (/discord\.com\/api\/users/.test(url)) return json(people[who]);
    return new Response('?', { status: 404 });
  };
  return { fetchAuth, calls };
}

async function oauth(a, provider, code) {
  const start = await a.req('GET', `/api/auth/oauth/${provider}/start?return=/`);
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('location'));
  const state = loc.searchParams.get('state');
  return { loc, done: await a.req('GET', `/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`), state };
}

test('Google and Discord sign-in: new accounts, linking, finishing the profile', async () => {
  const people = {
    g1: { sub: 'google-1', email: 'gina@example.com', email_verified: true, name: 'Gina' },
    d1: { id: 'discord-1', email: 'dee@example.com', verified: true, username: 'dee' },
    g2: { sub: 'google-2', email: 'ferd@example.com', email_verified: true, name: 'Ferd G' },
  };
  const { fetchAuth, calls } = fakeProviders(people);
  const providers = { google: { clientId: 'gid', clientSecret: 'gsec' }, discord: { clientId: 'did', clientSecret: 'dsec' } };
  const { srv, mailer } = await garage({ fetchAuth, providers });
  try {
    const me = await agent(srv).req('GET', '/api/auth/me');
    assert.deepEqual(me.body.methods, { email: true, google: true, discord: true, mail: false });

    const a = agent(srv);
    const g = await oauth(a, 'google', 'g1');
    assert.equal(g.loc.origin + g.loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(g.loc.searchParams.get('redirect_uri'), 'http://vc.test/api/auth/oauth/google/callback');
    assert.ok(g.loc.searchParams.get('code_challenge'), 'PKCE for Google');
    assert.match(g.done.headers.get('location'), /finish=1/, 'new accounts finish setting up');
    let user = (await a.req('GET', '/api/auth/me')).body.user;
    assert.equal(user.profileComplete, false);
    assert.equal(user.emailVerified, true, 'Google verified the address');
    assert.deepEqual(user.providers, ['google']);
    const tokenCall = calls.find(c => /oauth2\.googleapis\.com\/token/.test(c.url));
    assert.ok(new URLSearchParams(String(tokenCall.init.body)).get('code_verifier'));

    assert.equal((await a.req('POST', '/api/auth/profile', { displayName: 'Gina', birthDate: ADULT })).status, 400, 'terms needed');
    const done = await a.req('POST', '/api/auth/profile', { displayName: 'Gina', birthDate: ADULT, acceptTerms: true });
    assert.equal(done.body.user.profileComplete, true);
    assert.equal(done.body.user.adult, true);

    // The state can't be replayed.
    assert.match((await a.req('GET', `/api/auth/oauth/google/callback?code=g1&state=${g.state}`)).headers.get('location'), /signin_error/);
    // Signing in again finds the same account.
    const again = agent(srv);
    await oauth(again, 'google', 'g1');
    assert.equal((await again.req('GET', '/api/auth/me')).body.user.id, user.id);

    // Discord works the same way.
    const d = agent(srv);
    await oauth(d, 'discord', 'd1');
    assert.deepEqual((await d.req('GET', '/api/auth/me')).body.user.providers, ['discord']);

    // A verified email account gets Google linked; an unverified one is protected.
    const f = agent(srv);
    await signup(f);
    const gf = agent(srv);
    const blocked = await oauth(gf, 'google', 'g2');
    assert.match(blocked.done.headers.get('location'), /signin_error=.*verified/);
    await f.req('POST', '/api/auth/verify', { token: linkFrom(mailer.outbox.find(m => m.to === 'ferd@example.com')) });
    const linked = await oauth(gf, 'google', 'g2');
    assert.doesNotMatch(linked.done.headers.get('location'), /finish|error/);
    const fu = (await gf.req('GET', '/api/auth/me')).body.user;
    assert.equal(fu.displayName, 'Ferd');
    assert.deepEqual(fu.providers, ['google']);
    assert.equal(fu.hasPassword, true);

    // Not configured -> not offered.
    assert.equal((await agent(srv).req('GET', '/api/auth/oauth/apple/start')).status, 404);
  } finally { await srv.stop(); }
});

test('an under-13 birth date while finishing sign-up closes the account', async () => {
  const people = { k: { sub: 'kid-1', email: 'kid@example.com', email_verified: true, name: 'Kid' } };
  const { fetchAuth } = fakeProviders(people);
  const { srv } = await garage({ fetchAuth, providers: { google: { clientId: 'x', clientSecret: 'y' } } });
  try {
    const a = agent(srv);
    await oauth(a, 'google', 'k');
    const r = await a.req('POST', '/api/auth/profile', { displayName: 'Kiddo', birthDate: CHILD, acceptTerms: true });
    assert.equal(r.status, 403);
    assert.equal(r.body.closed, true);
    const row = srv.db.get('SELECT * FROM users');
    assert.equal(row.status, 'closed');
    assert.equal(row.email, null);
    assert.equal(srv.db.get('SELECT COUNT(*) AS n FROM identities').n, 0);
  } finally { await srv.stop(); }
});

test('the date of birth is asked once: a teen account can’t re-enter a different date', async () => {
  const { srv } = await garage();
  try {
    const a = agent(srv);
    assert.equal((await signup(a, { birthDate: TEEN })).status, 201);
    const me = (await a.req('GET', '/api/auth/me')).body.user;
    assert.equal(me.adult, false);
    assert.equal(me.ageChecked, true);
    const again = await a.req('POST', '/api/auth/profile', { birthDate: ADULT });
    assert.equal(again.status, 400);
    assert.equal(again.body.field, 'birthDate');
    assert.equal((await a.req('GET', '/api/auth/me')).body.user.adult, false);
  } finally { await srv.stop(); }
});

test('passwords: stored at the current scrypt cost; older hashes still sign in and are upgraded', async () => {
  const { SCRYPT, needsRehash } = require('../src/auth');
  const crypto = require('crypto');
  const { srv } = await garage();
  try {
    const a = agent(srv);
    assert.equal((await signup(a)).status, 201);
    const stored = () => srv.db.get('SELECT password_hash FROM users WHERE email = ?', 'ferd@example.com').password_hash;
    assert.ok(stored().startsWith(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$`));
    assert.equal(needsRehash(stored()), false);
    // A hash made with the old, cheaper parameters (p=1).
    const salt = crypto.randomBytes(16);
    const old = `scrypt$16384$8$1$${salt.toString('base64url')}$${crypto.scryptSync('correct horse battery', salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64url')}`;
    srv.db.run('UPDATE users SET password_hash = ? WHERE email = ?', old, 'ferd@example.com');
    assert.equal(needsRehash(old), true);
    const b = agent(srv);
    assert.equal((await b.req('POST', '/api/auth/login', { email: 'ferd@example.com', password: 'wrong password here' })).status, 401);
    assert.equal(stored(), old, 'a failed sign-in changes nothing');
    assert.equal((await b.req('POST', '/api/auth/login', { email: 'ferd@example.com', password: 'correct horse battery' })).status, 200);
    assert.ok(stored().startsWith(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$`), 'upgraded at sign-in');
    assert.equal((await agent(srv).req('POST', '/api/auth/login', { email: 'ferd@example.com', password: 'correct horse battery' })).status, 200);
  } finally { await srv.stop(); }
});

test('a malformed session cookie counts as signed out, never as an error', async () => {
  const { parseCookies } = require('../src/auth');
  assert.deepEqual(parseCookies('vc_session=%E0%A4%A; other=ok'), { other: 'ok' });
  const { srv } = await garage();
  try {
    const bad = { cookie: 'vc_session=%E0%A4%A', 'x-viccall': '1', 'content-type': 'application/json' };
    const me = await fetch(`${srv.base}/api/auth/me`, { headers: bad });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user, null);
    const start = await fetch(`${srv.base}/api/solo/start`, { method: 'POST', headers: bad, body: JSON.stringify({ kind: 'free' }) });
    assert.equal(start.status, 200, 'games still start');
  } finally { await srv.stop(); }
});
