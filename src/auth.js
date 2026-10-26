/*
 * Accounts for the Community Garage. Playing never needs one.
 *
 * Sign-in methods:
 *   - Email and password (scrypt hashes). Email is verified by a link; a
 *     password reset is also by link. Both need a mail service (mailer.js).
 *   - Google and Discord (OAuth 2 authorisation code flow with a random state;
 *     PKCE for Google). Each switches on when its client ID and secret are set.
 *
 * Sessions are random tokens in an HttpOnly, SameSite=Lax cookie; only a hash
 * is stored. State-changing requests must carry the X-VicCall header, which a
 * cross-site form can't add, as CSRF protection.
 *
 * Age: the birth date is checked once (13+ for an account, 18+ to upload) and
 * thrown away. Only "18 or over" is stored.
 */
const crypto = require('crypto');
const express = require('express');

const COOKIE = 'vc_session';
const SESSION_MS = 30 * 24 * 60 * 60_000;
const TOKEN_MS = { verify: 48 * 60 * 60_000, reset: 60 * 60_000 };
const OAUTH_STATE_MS = 10 * 60_000;
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'viccall', 'staff', 'support', 'system', 'anonymous', 'community photographer']);

const PROVIDERS = {
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    pkce: true,
    profile: p => ({ subject: String(p.sub), email: p.email || null, emailVerified: !!p.email_verified, name: p.name || p.given_name || '' }),
  },
  discord: {
    name: 'Discord',
    authUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    pkce: false,
    profile: p => ({ subject: String(p.id), email: p.email || null, emailVerified: !!p.verified, name: p.global_name || p.username || '' }),
  },
};

const b64url = buf => buf.toString('base64url');
const randomToken = (n = 32) => b64url(crypto.randomBytes(n));
const sha256 = s => crypto.createHash('sha256').update(s).digest('base64url');
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// ---------------------------------------------------------------- passwords
// OWASP's scrypt minimum, in the form that needs only 16 MB per hash (N=2^14,
// r=8, p=5 matches N=2^17, p=1). Each stored hash carries its own parameters,
// and older ones are upgraded at the next successful sign-in.
const SCRYPT = { N: 16384, r: 8, p: 5, keylen: 64 };
const needsRehash = stored => {
  const [kind, N, r, p] = String(stored || '').split('$');
  return kind !== 'scrypt' || +N !== SCRYPT.N || +r !== SCRYPT.r || +p !== SCRYPT.p;
};
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64url(salt)}$${b64url(key)}`);
    });
  });
}
function checkPassword(password, stored) {
  return new Promise(resolve => {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const [, N, r, p, salt, hash] = parts;
    const expected = Buffer.from(hash, 'base64url');
    crypto.scrypt(password, Buffer.from(salt, 'base64url'), expected.length, { N: +N, r: +r, p: +p }, (err, key) => {
      resolve(!err && key.length === expected.length && crypto.timingSafeEqual(key, expected));
    });
  });
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters for your password.';
  if (pw.length > 200) return 'That password is too long.';
  if (/^(.)\1+$/.test(pw)) return 'Pick a password that isn’t one character repeated.';
  return null;
}

// ---------------------------------------------------------------- profile rules
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
function displayNameProblem(name) {
  if (typeof name !== 'string') return 'Choose a display name.';
  const n = name.trim();
  if (n.length < 3 || n.length > 20) return 'Display names are 3 to 20 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/.test(n)) return 'Use letters, numbers, spaces, dots, dashes or underscores, starting with a letter or number.';
  if (RESERVED.has(n.toLowerCase())) return 'That name is reserved.';
  return null;
}
// Whole years between a YYYY-MM-DD birth date and today (UTC).
function ageFrom(birthDate, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || ''));
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (dt > now || y < 1900) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() < mo - 1 || (now.getUTCMonth() === mo - 1 && now.getUTCDate() < d)) age -= 1;
  return age;
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i <= 0) return;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed: ignore that cookie */ }
  });
  return out;
}

function createAuth(opts) {
  const { db, mailer } = opts;
  const fetcher = opts.fetch || ((u, i) => fetch(u, i));
  const env = opts.env || process.env;
  const adminEmails = new Set(String(opts.adminEmails != null ? opts.adminEmails : env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  const providers = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const cfg = (opts.providers && opts.providers[id]) || { clientId: env[`${id.toUpperCase()}_CLIENT_ID`], clientSecret: env[`${id.toUpperCase()}_CLIENT_SECRET`] };
    if (cfg.clientId && cfg.clientSecret) providers[id] = { ...p, ...cfg };
  }
  const limit = opts.limit || (() => (req, res, next) => next());
  const now = () => Date.now();
  // A real hash to check against when the account doesn't exist, so timing doesn't tell.
  const dummyHash = hashPassword(randomToken());

  const baseUrl = req => (opts.publicUrl || env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const secure = req => (opts.secureCookies != null ? opts.secureCookies : baseUrl(req).startsWith('https://'));

  function setSessionCookie(req, res, token, maxAgeMs) {
    const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    if (secure(req)) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function startSession(req, res, userId) {
    const token = randomToken();
    const t = now();
    db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      sha256(token), userId, t, t + SESSION_MS, t, str(req.get('user-agent'), 200));
    setSessionCookie(req, res, token, SESSION_MS);
    maybePromote(userId);
  }

  // Admins are named in ADMIN_EMAILS; promotion only for a verified address.
  function maybePromote(userId) {
    const u = db.get('SELECT email, email_verified, role FROM users WHERE id = ?', userId);
    if (u && u.email && u.email_verified && adminEmails.has(u.email.toLowerCase()) && u.role !== 'admin') {
      db.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', 'admin', now(), userId);
      db.audit(userId, 'role.promote', 'user', userId, { role: 'admin', via: 'ADMIN_EMAILS' });
    }
  }

  function currentUser(req) {
    if (req._vcUser !== undefined) return req._vcUser;
    const token = parseCookies(req.get('cookie'))[COOKIE];
    let user = null;
    if (token) {
      const s = db.get('SELECT user_id, expires_at, last_seen FROM sessions WHERE token_hash = ?', sha256(token));
      if (s && s.expires_at > now()) {
        user = db.get("SELECT * FROM users WHERE id = ? AND status != 'closed'", s.user_id) || null;
        if (user && now() - s.last_seen > 60_000) db.run('UPDATE sessions SET last_seen = ? WHERE token_hash = ?', now(), sha256(token));
      }
    }
    req._vcUser = user;
    return user;
  }

  const publicUser = u => u && {
    id: u.id, displayName: u.display_name, email: u.email, emailVerified: !!u.email_verified, adult: !!u.adult,
    role: u.role, status: u.status, profileComplete: !!u.profile_complete, hasPassword: !!u.password_hash, ageChecked: !!u.age_checked_at,
    creditAnonymous: !!u.credit_anonymous, notifyEmail: !!u.notify_email,
    providers: db.all('SELECT provider FROM identities WHERE user_id = ?', u.id).map(r => r.provider),
  };

  // Middleware: CSRF header on anything that changes state.
  function csrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-viccall') !== '1') return res.status(403).json({ error: 'Missing request header' });
    next();
  }
  function requireUser(rules = {}) {
    return (req, res, next) => {
      const u = currentUser(req);
      if (!u) return res.status(401).json({ error: 'Sign in first' });
      if (u.status !== 'active') return res.status(403).json({ error: 'This account is suspended' });
      if (rules.complete && !u.profile_complete) return res.status(403).json({ error: 'Finish setting up your account first', code: 'profile' });
      if (rules.verified && !u.email_verified) return res.status(403).json({ error: 'Verify your email address first', code: 'verify' });
      if (rules.adult && !u.adult) return res.status(403).json({ error: 'You need to be 18 or over to submit photos', code: 'age' });
      if (rules.role && !(u.role === 'admin' || (rules.role === 'moderator' && u.role === 'moderator'))) return res.status(403).json({ error: 'Not allowed' });
      req.user = u;
      next();
    };
  }

  async function sendToken(user, kind, req) {
    if (!user.email) return;
    const token = randomToken();
    const t = now();
    db.run('INSERT INTO email_tokens (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', sha256(token), user.id, kind, t, t + TOKEN_MS[kind]);
    const link = `${baseUrl(req)}/?${kind}=${token}`;
    const subject = kind === 'verify' ? 'Confirm your VicCall email' : 'Reset your VicCall password';
    const text = kind === 'verify'
      ? `Confirm this email address for your VicCall account by opening this link:\n\n${link}\n\nThe link works for 48 hours. If you didn't sign up, ignore this email.`
      : `Someone asked to reset the password for your VicCall account. To choose a new one, open this link:\n\n${link}\n\nThe link works for one hour. If you didn't ask, ignore this email and your password stays the same.`;
    try { await mailer.send({ to: user.email, subject, text }); } catch (e) { console.error('[mail] failed:', e.message); }
  }
  function useToken(token, kind) {
    const row = db.get('SELECT * FROM email_tokens WHERE token_hash = ? AND kind = ?', sha256(str(token, 200)), kind);
    if (!row || row.used_at || row.expires_at < now()) return null;
    db.run('UPDATE email_tokens SET used_at = ? WHERE token_hash = ?', now(), row.token_hash);
    return row;
  }

  const router = express.Router();
  router.use(csrf);

  router.get('/me', (req, res) => {
    const u = currentUser(req);
    res.json({
      user: publicUser(u),
      methods: { email: true, google: !!providers.google, discord: !!providers.discord, mail: mailer.enabled },
    });
  });

  router.post('/signup', limit(30, 60 * 60_000), async (req, res) => {
    const b = req.body || {};
    const email = str(b.email, 254).trim().toLowerCase();
    const displayName = str(b.displayName, 40).trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.', field: 'email' });
    const pwErr = passwordProblem(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });
    const nameErr = displayNameProblem(displayName);
    if (nameErr) return res.status(400).json({ error: nameErr, field: 'displayName' });
    const age = ageFrom(b.birthDate);
    if (age === null) return res.status(400).json({ error: 'Enter your date of birth.', field: 'birthDate' });
    // Under 13: refuse and keep nothing.
    if (age < 13) return res.status(403).json({ error: 'You need to be 13 or older to create an account. You can still play without one.', field: 'birthDate' });
    if (b.acceptTerms !== true) return res.status(400).json({ error: 'Accept the terms to create an account.', field: 'acceptTerms' });
    if (db.get('SELECT 1 FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'There’s already an account with that email. Sign in instead.', field: 'email' });
    if (db.get('SELECT 1 FROM users WHERE display_name = ?', displayName)) return res.status(409).json({ error: 'That display name is taken.', field: 'displayName' });
    const id = crypto.randomUUID();
    const t = now();
    db.run(`INSERT INTO users (id, email, email_verified, password_hash, display_name, adult, age_checked_at, profile_complete, created_at, updated_at)
            VALUES (?, ?, 0, ?, ?, ?, ?, 1, ?, ?)`, id, email, await hashPassword(b.password), displayName, age >= 18 ? 1 : 0, t, t, t);
    db.audit(id, 'user.signup', 'user', id, { method: 'email' });
    const user = db.get('SELECT * FROM users WHERE id = ?', id);
    await sendToken(user, 'verify', req);
    startSession(req, res, id);
    res.status(201).json({ user: publicUser(db.get('SELECT * FROM users WHERE id = ?', id)), mailSent: mailer.enabled });
  });

  router.post('/login', limit(20, 15 * 60_000), async (req, res) => {
    const b = req.body || {};
    const email = str(b.email, 254).trim().toLowerCase();
    const u = email && db.get("SELECT * FROM users WHERE email = ? AND status != 'closed'", email);
    // Same answer and similar timing whether or not the account exists.
    const ok = await checkPassword(str(b.password, 200), u && u.password_hash ? u.password_hash : await dummyHash);
    if (!u || !u.password_hash || !ok) return res.status(401).json({ error: 'That email and password don’t match an account.' });
    if (u.status === 'suspended') return res.status(403).json({ error: 'This account is suspended.' });
    if (needsRehash(u.password_hash)) db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(str(b.password, 200)), u.id);
    startSession(req, res, u.id);
    res.json({ user: publicUser(db.get('SELECT * FROM users WHERE id = ?', u.id)) });
  });

  router.post('/logout', (req, res) => {
    const token = parseCookies(req.get('cookie'))[COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  router.post('/verify', limit(30, 15 * 60_000), (req, res) => {
    const row = useToken((req.body || {}).token, 'verify');
    if (!row) return res.status(400).json({ error: 'That link has expired or was already used.' });
    db.run('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?', now(), row.user_id);
    db.audit(row.user_id, 'user.verify_email', 'user', row.user_id);
    maybePromote(row.user_id);
    res.json({ ok: true });
  });

  router.post('/resend-verification', limit(5, 60 * 60_000), requireUser(), async (req, res) => {
    if (req.user.email_verified) return res.json({ ok: true, already: true });
    await sendToken(req.user, 'verify', req);
    res.json({ ok: true, mailSent: mailer.enabled });
  });

  router.post('/forgot', limit(5, 60 * 60_000), async (req, res) => {
    const email = str((req.body || {}).email, 254).trim().toLowerCase();
    const u = email && db.get("SELECT * FROM users WHERE email = ? AND status = 'active'", email);
    if (u) await sendToken(u, 'reset', req);
    // Never reveal whether an account exists.
    res.json({ ok: true, mailSent: mailer.enabled });
  });

  router.post('/reset', limit(10, 15 * 60_000), async (req, res) => {
    const b = req.body || {};
    const pwErr = passwordProblem(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });
    const row = useToken(b.token, 'reset');
    if (!row) return res.status(400).json({ error: 'That link has expired or was already used.' });
    // A reset link proves the email address, so it also verifies it. Other sessions are signed out.
    db.run('UPDATE users SET password_hash = ?, email_verified = 1, updated_at = ? WHERE id = ?', await hashPassword(b.password), now(), row.user_id);
    db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
    db.audit(row.user_id, 'user.reset_password', 'user', row.user_id);
    startSession(req, res, row.user_id);
    res.json({ ok: true });
  });

  // Finish an account made through Google or Discord, or update profile basics.
  router.post('/profile', requireUser(), (req, res) => {
    const b = req.body || {};
    const u = req.user;
    const sets = [], vals = [];
    if (b.displayName !== undefined) {
      const name = str(b.displayName, 40).trim();
      const err = displayNameProblem(name);
      if (err) return res.status(400).json({ error: err, field: 'displayName' });
      const taken = db.get('SELECT id FROM users WHERE display_name = ? AND id != ?', name, u.id);
      if (taken) return res.status(409).json({ error: 'That display name is taken.', field: 'displayName' });
      sets.push('display_name = ?'); vals.push(name);
    }
    if (b.birthDate !== undefined) {
      // Asked once: changing it later would let anyone re-enter a different date.
      if (u.adult || u.age_checked_at) return res.status(400).json({ error: 'Your date of birth is already set.', field: 'birthDate' });
      const age = ageFrom(b.birthDate);
      if (age === null) return res.status(400).json({ error: 'Enter your date of birth.', field: 'birthDate' });
      if (age < 13) {
        // Under 13 can't have an account: close it and keep nothing personal.
        closeAccount(u.id, 'under13');
        setSessionCookie(req, res, '', 0);
        return res.status(403).json({ error: 'You need to be 13 or older to have an account. You can still play without one.', closed: true });
      }
      sets.push('adult = ?', 'age_checked_at = ?'); vals.push(age >= 18 ? 1 : 0, now());
    }
    if (b.creditAnonymous !== undefined) { sets.push('credit_anonymous = ?'); vals.push(b.creditAnonymous ? 1 : 0); }
    if (b.notifyEmail !== undefined) { sets.push('notify_email = ?'); vals.push(b.notifyEmail ? 1 : 0); }
    if (!u.profile_complete) {
      if (b.acceptTerms !== true) return res.status(400).json({ error: 'Accept the terms to finish setting up.', field: 'acceptTerms' });
      const nameSet = b.displayName !== undefined || u.display_name;
      const ageSet = b.birthDate !== undefined || u.age_checked_at;
      if (!nameSet || !ageSet) return res.status(400).json({ error: 'Add a display name and your date of birth.' });
      sets.push('profile_complete = 1');
    }
    if (sets.length) {
      sets.push('updated_at = ?'); vals.push(now());
      db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, u.id);
      db.audit(u.id, 'user.profile', 'user', u.id, { fields: Object.keys(b).filter(k => k !== 'birthDate' && k !== 'acceptTerms') });
    }
    res.json({ user: publicUser(db.get('SELECT * FROM users WHERE id = ?', u.id)) });
  });

  // Close an account: personal details go, photos are removed by the Garage hook.
  const closeHooks = [];
  function closeAccount(userId, why) {
    db.tx(() => {
      db.run(`UPDATE users SET status = 'closed', email = NULL, password_hash = NULL, display_name = NULL, bio = NULL, links = NULL,
              email_verified = 0, updated_at = ? WHERE id = ?`, now(), userId);
      db.run('DELETE FROM identities WHERE user_id = ?', userId);
      db.run('DELETE FROM sessions WHERE user_id = ?', userId);
      db.run('DELETE FROM email_tokens WHERE user_id = ?', userId);
      db.audit(userId, 'user.close', 'user', userId, { why });
    });
    closeHooks.forEach(fn => { try { fn(userId); } catch (e) { console.error('[auth] close hook failed:', e); } });
  }
  router.post('/close', requireUser(), (req, res) => {
    if ((req.body || {}).confirm !== 'close') return res.status(400).json({ error: 'Type “close” to confirm.' });
    closeAccount(req.user.id, 'requested');
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- OAuth
  router.get('/oauth/:provider/start', limit(30, 15 * 60_000), (req, res) => {
    const p = providers[req.params.provider];
    if (!p) return res.status(404).json({ error: 'That sign-in method isn’t set up' });
    const state = randomToken(24);
    const verifier = randomToken(48);
    const returnTo = /^\/[A-Za-z0-9/_?=&#.-]*$/.test(String(req.query.return || '')) && !String(req.query.return).startsWith('//') ? String(req.query.return) : '/';
    db.run('DELETE FROM oauth_states WHERE created_at < ?', now() - OAUTH_STATE_MS);
    db.run('INSERT INTO oauth_states (state, provider, verifier, return_to, created_at) VALUES (?, ?, ?, ?, ?)', state, req.params.provider, verifier, returnTo, now());
    const q = new URLSearchParams({
      client_id: p.clientId, redirect_uri: `${baseUrl(req)}/api/auth/oauth/${req.params.provider}/callback`,
      response_type: 'code', scope: p.scope, state, prompt: req.params.provider === 'discord' ? 'consent' : 'select_account',
    });
    if (p.pkce) { q.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest())); q.set('code_challenge_method', 'S256'); }
    res.redirect(302, `${p.authUrl}?${q}`);
  });

  router.get('/oauth/:provider/callback', limit(30, 15 * 60_000), async (req, res) => {
    const id = req.params.provider;
    const p = providers[id];
    const fail = msg => res.redirect(302, `/?signin_error=${encodeURIComponent(msg)}`);
    if (!p) return fail('That sign-in method isn’t set up.');
    if (req.query.error) return fail('Sign-in was cancelled.');
    const st = db.get('SELECT * FROM oauth_states WHERE state = ? AND provider = ?', str(req.query.state, 100), id);
    if (!st || st.created_at < now() - OAUTH_STATE_MS) return fail('That sign-in attempt expired. Try again.');
    db.run('DELETE FROM oauth_states WHERE state = ?', st.state);
    let profile;
    try {
      const body = new URLSearchParams({
        client_id: p.clientId, client_secret: p.clientSecret, grant_type: 'authorization_code',
        code: str(req.query.code, 2000), redirect_uri: `${baseUrl(req)}/api/auth/oauth/${id}/callback`,
      });
      if (p.pkce) body.set('code_verifier', st.verifier);
      const tok = await fetcher(p.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
      if (!tok.ok) throw new Error(`token ${tok.status}`);
      const { access_token: accessToken } = await tok.json();
      if (!accessToken) throw new Error('no access token');
      const info = await fetcher(p.userUrl, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) });
      if (!info.ok) throw new Error(`userinfo ${info.status}`);
      profile = p.profile(await info.json());
      if (!profile.subject) throw new Error('no subject');
    } catch (e) {
      console.error(`[auth] ${id} sign-in failed:`, e.message);
      return fail(`Couldn’t sign you in with ${p.name}. Try again.`);
    }
    const email = profile.email && profile.emailVerified ? profile.email.toLowerCase() : null;
    let userId = (db.get('SELECT user_id FROM identities WHERE provider = ? AND subject = ?', id, profile.subject) || {}).user_id;
    if (userId) {
      const u = db.get('SELECT status FROM users WHERE id = ?', userId);
      if (!u || u.status === 'closed') { db.run('DELETE FROM identities WHERE provider = ? AND subject = ?', id, profile.subject); userId = null; }
      else if (u.status === 'suspended') return fail('This account is suspended.');
    }
    if (!userId && email) {
      const existing = db.get("SELECT id, email_verified FROM users WHERE email = ? AND status != 'closed'", email);
      if (existing && !existing.email_verified) {
        // An unverified password account could belong to anyone; don't hand it over.
        return fail('An account with this email exists but isn’t verified yet. Sign in with your password, or reset it from the sign-in screen.');
      }
      if (existing) {
        userId = existing.id;
        db.run('INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)', id, profile.subject, userId, email, now());
        db.audit(userId, 'user.link', 'user', userId, { provider: id });
      }
    }
    if (!userId) {
      userId = crypto.randomUUID();
      const t = now();
      db.tx(() => {
        db.run(`INSERT INTO users (id, email, email_verified, display_name, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)`,
          userId, email, email ? 1 : 0, t, t);
        db.run('INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)', id, profile.subject, userId, email, t);
        db.audit(userId, 'user.signup', 'user', userId, { method: id });
      });
    }
    startSession(req, res, userId);
    const u = db.get('SELECT profile_complete FROM users WHERE id = ?', userId);
    const sep = st.return_to.includes('?') ? '&' : '?';
    res.redirect(302, u.profile_complete ? st.return_to : `${st.return_to}${sep}finish=1&suggest=${encodeURIComponent((profile.name || '').slice(0, 20))}`);
  });

  return { router, currentUser, requireUser, publicUser, closeAccount, onClose: fn => closeHooks.push(fn), providers, csrf, baseUrl, mailer };
}

module.exports = { createAuth, hashPassword, checkPassword, needsRehash, parseCookies, ageFrom, displayNameProblem, passwordProblem, PROVIDERS, COOKIE, SCRYPT };
