const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const { attachParty, sanitizeName } = require('./party');
const Modes = require('./modes');
const Pools = require('./pools');
const { createImageProxy } = require('./images');
const { openDb } = require('./db');
const { createMailer } = require('./mailer');
const { createAuth } = require('./auth');
const { createGarage } = require('./garage');
const { createCommonsProvenance } = require('./provenance');
const { createPhotoPrints } = require('./photo-prints');
const { createScoresBackup, tidy } = require('./scores-backup');
const { createStats } = require('./stats');
const { startKeepAwake } = require('./keep-awake');
const VCScore = require('../public/scoring.js');

const MAX_PER_BOARD = 100;
const MAX_REPORTS = 500;
const MAX_SESSIONS = 5000;
const SESSION_TTL_MS = 2 * 60 * 60_000;
const CLOCK_SLACK_MS = 3_000; // network + render allowance on timed rounds

// Content Security Policy. Everything the pages load is first-party except the
// Wikimedia photos (and blob: previews of Garage uploads); there are no inline
// scripts or style attributes, so no 'unsafe-inline' anywhere. The baseline is
// enforced; the full policy is report-only until CSP_ENFORCE=1 (README).
const CSP_BASELINE = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const CSP_FULL = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' https://upload.wikimedia.org blob:",
  "font-src 'self'", "connect-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'",
  "frame-ancestors 'none'", "form-action 'self'", 'report-uri /api/csp-report', 'report-to csp',
].join('; ');
// Nothing here uses these; deny them so an injected frame or script can't either.
const PERMISSIONS_POLICY = 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';
const BOARD_RE = /^(ranked:[a-z]+|daily:\d{4}-\d{2}-\d{2}|endless)$/;

function createApp(opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
  const CARS = opts.cars || JSON.parse(fs.readFileSync(path.join(__dirname, 'cars.json'), 'utf8'));
  const ADMIN_TOKEN = opts.adminToken !== undefined ? opts.adminToken : process.env.ADMIN_TOKEN || '';
  const SCORES_FILE = path.join(dataDir, 'scores.json');
  const REPORTS_FILE = path.join(dataDir, 'reports.json');
  const images = createImageProxy({ fetch: opts.fetchImage });
  // Every answer is read against the whole database, so "918" or "SVJ" can be
  // recognised and "Supra" can be flagged as ambiguous. This server's own copy:
  // vehicles moderators add (Garage) are put into it in place.
  const VEHICLES = { ...VCScore.buildIndex(CARS) };

  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, '[]');
  if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, '[]');

  // Leaderboards survive restarts when a GitHub token is set (see scores-backup.js).
  // Daily play totals for the owner (no information about players). Saved with the leaderboards.
  let backupRef = null;
  const stats = createStats({ file: path.join(dataDir, 'stats.json'), tz: opts.statsTz, onChange: () => backupRef && backupRef.markDirty() });
  const backup = opts.scoresBackup || createScoresBackup({
    extras: [{ name: 'viccall-stats.json', snapshot: stats.snapshot, restore: stats.restore }],
    file: SCORES_FILE, token: opts.scoresToken !== undefined ? opts.scoresToken : process.env.SCORES_GITHUB_TOKEN,
    gistId: process.env.SCORES_GIST_ID, fetch: opts.fetchGithub, log: opts.log !== false,
  });
  backupRef = backup;
  if (backup.enabled) backup.restore();

  const readJson = f => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  // Write to a temp file then rename, so a crash mid-write can't corrupt the leaderboard.
  const writeJson = (f, v) => { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f); };
  const clip = (v, max) => String(v == null ? '' : v).slice(0, max);
  const hashKey = k => (typeof k === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(k) ? crypto.createHash('sha256').update(k).digest('base64url').slice(0, 16) : null);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 16 * 1024, pingTimeout: 20000 });

  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // set when running behind a reverse proxy
  // Security headers on every response (Render's edge adds none). See README, "Security headers".
  const cspEnforced = (opts.cspEnforce !== undefined ? opts.cspEnforce : process.env.CSP_ENFORCE === '1');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'DENY');
    res.set('Permissions-Policy', PERMISSIONS_POLICY);
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set('Reporting-Endpoints', 'csp="/api/csp-report"');
    if (cspEnforced) res.set('Content-Security-Policy', CSP_FULL);
    else {
      res.set('Content-Security-Policy', CSP_BASELINE);
      res.set('Content-Security-Policy-Report-Only', CSP_FULL);
    }
    // Only over https (req.secure needs TRUST_PROXY behind Render's proxy).
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(compression());
  // Browsers never compress request bodies; refusing them (415) also keeps the
  // decompression path out of reach (body-parser GHSA-27r3-jxmh-p828).
  app.use(express.json({ limit: '16kb', inflate: false }));
  // Link previews need an absolute og:image URL, so fill in this server's origin.
  const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  app.get(['/', '/index.html'], (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`.replace(/[^\w:/.\-\[\]]/g, '');
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(INDEX.replace('content="/og-card.png"', `content="${origin}/og-card.png"`));
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, file) {
      // Songs are cached for a week: replace a song under a new file name.
      if (/\.(woff2|svg|png|mp3|m4a|ogg)$/.test(file)) res.set('Cache-Control', 'public, max-age=604800');
      else res.set('Cache-Control', 'no-cache');
    },
  }));

  // Tiny per-IP rate limiter for write endpoints.
  const hits = new Map();
  function limit(max, windowMs) {
    return (req, res, next) => {
      const key = `${req.route ? req.route.path : req.path}|${req.ip}`;
      const now = Date.now();
      const h = hits.get(key);
      if (!h || now - h.t > windowMs) { hits.set(key, { t: now, n: 1 }); return next(); }
      if (++h.n > max) return res.status(429).json({ error: 'Too many requests' });
      next();
    };
  }
  const hitSweep = setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 10 * 60_000) hits.delete(k); }, 60_000);
  hitSweep.unref();

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // ---- Accounts and Community Garage ----
  // Off unless GARAGE_ENABLED=1: accounts and photos need a persistent disk,
  // and the free hosting plan wipes its disk on every deploy.
  const garageOn = opts.garage !== undefined ? !!opts.garage : process.env.GARAGE_ENABLED === '1';
  let gdb = null, auth = null, garage = null, prints = null;
  if (garageOn) {
    // Fingerprints of the game's own photos, so uploads of them are caught.
    prints = opts.photoPrints !== undefined ? opts.photoPrints : createPhotoPrints({ cars: CARS, dataDir, log: opts.log !== false });
    gdb = opts.db || openDb(dataDir);
    const mailer = opts.mailer || createMailer();
    auth = createAuth({
      db: gdb, mailer, limit, fetch: opts.fetchAuth, providers: opts.providers,
      publicUrl: opts.publicUrl, adminEmails: opts.adminEmails, secureCookies: opts.secureCookies,
    });
    app.use('/api/auth', auth.router);
    garage = createGarage({ db: gdb, auth, dataDir, limit, cars: CARS, index: VEHICLES, VCScore, prints });
  }
  // Author and licence of each first-party photo, as stated on Wikimedia Commons.
  const provenance = createCommonsProvenance({ cars: CARS, dataDir, fetch: opts.fetchCommons, db: gdb, log: opts.log !== false });
  if (garage) {
    const admin = auth.requireUser({ role: 'admin' });
    app.post('/api/garage/admin/provenance/refresh', auth.csrf, admin, limit(6, 60 * 60_000), async (req, res) => {
      try { res.json(await provenance.refresh({ keyOf: VCScore.identityKey })); } catch (e) { res.status(502).json({ error: e.message }); }
    });
    app.get('/api/garage/admin/provenance/review', admin, (req, res) => res.json({ photos: provenance.needsReview() }));
    app.use('/api/garage', garage.router);
  }

  // What the menus need: playlists, filter options, pool sizes. Never answers.
  app.get('/api/meta', (req, res) => {
    const live = Modes.live(CARS);
    const now = new Date();
    // ?seen= is the last day this browser visited ('none' the first time); only the totals are kept.
    const statsDay = req.query.seen !== undefined ? stats.visit(String(req.query.seen).slice(0, 10)) : stats.today();
    res.json({
      statsDay,
      ...Modes.catalog(CARS),
      maxPerCar: VCScore.MAX,
      cars: live.length,
      kits: live.filter(c => c.kit).length,
      makes: [...new Set(live.map(c => c.make))].sort((a, b) => a.localeCompare(b)),
      // The daily runs on the server's UTC day; `now` lets the browser count down on the server's clock.
      daily: { date: Modes.utcDateKey(now), nextAt: Modes.nextDailyAt(now) },
      now: now.getTime(),
      garage: garageOn,
      community: garage ? garage.counts() : null,
    });
  });

  // Free Play: how many cars a filter combination matches (for the live count in the menu).
  app.get('/api/pool', (req, res) => {
    const f = Modes.cleanFilters(req.query);
    res.json({ size: Modes.live(CARS).filter(Modes.freePlayFilter(f)).length, filters: f });
  });

  app.get('/api/img/:token', limit(400, 60_000), (req, res) => images.handle(req, res));

  // ---- Solo sessions: the server holds the answers, runs the clock and keeps score. ----
  const sessions = new Map();
  function pruneSessions() {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.created > SESSION_TTL_MS) sessions.delete(id);
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }
  const modeOf = plan => (plan.kind === 'ranked' ? `ranked:${plan.key}` : plan.kind);
  const getSession = b => sessions.get(clip(b && b.sessionId, 64));
  const ranked = s => !!s.plan.board && !s.unranked;
  const finished = s => (s.plan.rounds ? s.idx >= s.plan.rounds : s.over);

  // Best-effort daily lock: one ranked attempt per browser per day.
  const dailyAlreadyPosted = (board, player) => player && readJson(SCORES_FILE).some(e => e.board === board && e.player === player);

  app.post('/api/solo/start', limit(120, 60_000), (req, res) => {
    const b = req.body || {};
    // Community photos: cleared for this player (signed in or not) and these rules.
    const user = auth ? auth.currentUser(req) : null;
    const userId = user && user.status === 'active' ? user.id : null;
    const ctx = { competitive: b.kind !== 'free', participants: [userId] };
    const extra = garage && b.kind !== 'daily' ? Pools.eligible(garage.roundItems(), ctx) : [];
    const plan = Modes.planGame(CARS, { kind: b.kind, playlist: b.playlist, filters: b.filters }, { extra });
    if (!plan) return res.status(400).json({ error: 'Unknown game mode' });
    if (plan.error) return res.status(400).json({ error: plan.error });
    pruneSessions();
    const player = hashKey(b.player);
    const s = {
      id: crypto.randomUUID(), plan, queue: plan.queue.slice(), idx: 0, player,
      openIdx: -1, openedAt: 0, servedAt: 0, photoOk: false, img: null, freeSkips: 0,
      score: 0, cars: 0, streak: 0, bestStreak: 0, strikes: 0, timeMs: 0, over: false,
      results: [], created: Date.now(), saved: false, ctx: { competitive: plan.ruleset === 'competitive', participants: [userId] }, swaps: 0,
      unranked: plan.kind === 'daily' && dailyAlreadyPosted(plan.board, player),
    };
    if (plan.kind === 'endless') s.queue.push(Modes.nextEndless(plan, new Set(), 0));
    sessions.set(s.id, s);
    stats.started(modeOf(plan));
    if (plan.board && s.queue[0]) images.warm(s.queue[0].img);
    res.json({
      sessionId: s.id, kind: plan.kind, key: plan.key, title: plan.title, board: ranked(s) ? plan.board : null,
      ruleset: plan.ruleset, roundKind: plan.roundKind, clockMs: plan.clockMs, rounds: plan.rounds, lives: plan.lives,
      poolSize: plan.poolSize, maxPerCar: VCScore.MAX, filters: plan.filters || null, date: plan.date || null,
      alreadyPlayed: s.unranked,
    });
  });

  // Open a round: hands out the photo and starts the clock (from when the photo is first served).
  app.post('/api/solo/round', limit(600, 60_000), (req, res) => {
    const b = req.body || {};
    const s = getSession(b);
    if (!s) return res.status(404).json({ error: 'Session expired' });
    if (finished(s)) return res.status(409).json({ error: 'Game over' });
    if (b.idx !== s.idx) return res.status(409).json({ error: 'Wrong round' });
    if (s.openIdx !== s.idx) {
      // Last check before a community photo is shown: still approved, and still
      // allowed for this player. If not, a first-party photo takes its place.
      let car = s.queue[s.idx];
      if (car.community && !(garage && Pools.communityAllowed(garage.itemState(car.imageId), s.ctx).ok)) {
        car = Pools.replacement(s.queue, s.plan.fallback);
        if (!car) return res.status(503).json({ error: 'No photo is available for this round.' }); // fail closed
        s.queue[s.idx] = car;
        s.swaps += 1;
      }
      s.openIdx = s.idx;
      s.openedAt = Date.now();
      s.servedAt = 0;
      s.photoOk = false;
      if (s.plan.board || car.community) {
        const idx = s.idx;
        const onServe = ok => { if (s.openIdx === idx && !s.servedAt) { s.servedAt = Date.now(); s.photoOk = ok; } };
        s.img = car.community
          ? images.issueLocal(() => garage.roundPhoto(car.imageId, s.ctx), s.plan.board ? onServe : null)
          : images.issue(car.img, onServe);
        if (!s.plan.board) s.servedAt = s.openedAt;
      } else {
        s.img = car.img;
        s.servedAt = s.openedAt;
      }
    }
    const next = !s.plan.board && s.queue[s.idx + 1];
    res.json({ idx: s.idx, img: s.img, next: next && !next.community ? next.img : null, clockMs: s.plan.clockMs });
  });

  app.post('/api/solo/guess', limit(600, 60_000), (req, res) => {
    const b = req.body || {};
    const s = getSession(b);
    if (!s) return res.status(404).json({ error: 'Session expired' });
    if (finished(s) || b.idx !== s.idx || s.openIdx !== s.idx) return res.status(409).json({ error: 'Round already answered' });
    const car = s.queue[s.idx];
    // A photo that never loaded isn't the player's fault. Ranked games get two
    // free skips, and only when the server couldn't deliver the photo itself.
    const photoSkip = !!b.photoFailed && (!s.plan.board || (!s.photoOk && s.freeSkips < 2));
    if (photoSkip && s.plan.board) s.freeSkips += 1;
    const guess = photoSkip ? {} : { car: clip(b.car, 100), make: clip(b.make, 60), model: clip(b.model, 60), year: clip(b.year, 8), kit: clip(b.kit, 60) };
    let result = VCScore.scoreRound(car, guess, { ruleset: s.plan.ruleset, kind: s.plan.roundKind, index: VEHICLES });

    const now = Date.now();
    const elapsed = now - (s.servedAt || s.openedAt);
    const late = s.plan.clockMs > 0 && elapsed > s.plan.clockMs + CLOCK_SLACK_MS;
    const timedOut = !!b.timedOut || late;
    if (late) result = { ...result, pts: 0, identified: false, perfect: false, res: result.res.map(r => ({ ...r, pts: 0 })) };

    s.score += result.pts;
    s.timeMs += s.plan.clockMs > 0 ? Math.min(elapsed, s.plan.clockMs) : elapsed;
    if (photoSkip) { /* no streak change, no strike */ } else if (result.identified) { s.cars += 1; s.streak += 1; s.bestStreak = Math.max(s.bestStreak, s.streak); } else { s.streak = 0; }
    if (s.plan.kind === 'endless' && !result.identified && !photoSkip) s.strikes += 1;
    s.results.push({ carId: car.id, pts: result.pts });
    s.idx += 1;

    if (s.plan.kind === 'endless') {
      if (s.strikes >= s.plan.lives || s.idx >= Modes.ENDLESS_CAP) s.over = true;
      else s.queue.push(Modes.nextEndless(s.plan, new Set(s.queue.map(c => c.id)), s.streak));
    }
    const done = finished(s);
    stats.round();
    if (done) stats.finished(modeOf(s.plan));
    if (!done && s.plan.board) images.warm(s.queue[s.idx].img);

    res.json({
      pts: result.pts, res: result.res, identified: result.identified, perfect: result.perfect,
      late, timedOut, skipped: photoSkip, score: s.score, cars: s.cars, timeMs: s.timeMs, streak: s.streak, bestStreak: s.bestStreak,
      strikes: s.strikes, lives: s.plan.lives, idx: s.idx, done,
      answer: {
        id: car.id, make: car.make, model: car.model, variant: car.variant || null, generation: car.generation || null, year: car.year,
        yearRange: car.yearRange || null, kit: car.kit || null, hint: car.hint, credit: car.credit || null, photo: car.photo || null,
        attribution: car.community ? null : provenance.attributionFor(car),
      },
    });
  });

  // ---- Leaderboards: one per ranked playlist, one per daily challenge, one for endless. ----
  const sortBoard = (a, b) => b.score - a.score || (a.timeMs || 0) - (b.timeMs || 0) || a.ts - b.ts;

  app.post('/api/scores', limit(40, 60_000), (req, res) => {
    const b = req.body || {};
    const s = getSession(b);
    if (!s) return res.status(400).json({ error: 'Play a full game to post a score' });
    if (!s.plan.board) return res.status(400).json({ error: 'Free Play games are not ranked' });
    if (!finished(s)) return res.status(400).json({ error: 'Game not finished' });
    if (s.unranked) return res.status(409).json({ error: "You've already posted today's Daily Challenge" });
    if (s.saved) return res.status(409).json({ error: 'Score already saved' });
    const board = s.plan.board;
    if (board.startsWith('daily:') && dailyAlreadyPosted(board, s.player)) return res.status(409).json({ error: "You've already posted today's Daily Challenge" });
    s.saved = true;
    stats.posted();

    const maxScore = s.plan.rounds ? s.plan.rounds * VCScore.MAX : s.idx * VCScore.MAX;
    const entry = {
      id: crypto.randomUUID(), name: sanitizeName(b.name), board, score: s.score, maxScore,
      cars: s.cars, rounds: s.idx, bestStreak: s.bestStreak, timeMs: s.timeMs, player: s.player, ts: Date.now(),
    };
    const scores = readJson(SCORES_FILE);
    scores.push(entry);
    const forBoard = scores.filter(x => x.board === board).sort(sortBoard);
    const rank = forBoard.findIndex(x => x.id === entry.id) + 1;
    // Top 100 per board; Daily Challenge boards are kept for 30 days.
    writeJson(SCORES_FILE, tidy(scores));
    backup.markDirty();
    res.json({ rank: rank <= MAX_PER_BOARD ? rank : null, total: Math.min(forBoard.length, MAX_PER_BOARD) });
  });

  app.get('/api/leaderboard', (req, res) => {
    const board = BOARD_RE.test(String(req.query.board || '')) ? req.query.board : 'ranked:world';
    const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    res.json(readJson(SCORES_FILE)
      .filter(s => s.board === board)
      .sort(sortBoard)
      .slice(0, lim)
      .map(({ name, score, maxScore, cars, rounds, bestStreak, timeMs, ts }) => ({ name, score, maxScore, cars, rounds, bestStreak, timeMs, ts })));
  });

  // ---- Bug / crash reports ----
  app.post('/api/report', limit(15, 60_000), (req, res) => {
    const body = req.body || {};
    const type = body.type === 'crash' ? 'crash' : body.type === 'bug' ? 'bug' : null;
    if (!type) return res.status(400).json({ error: 'invalid type' });
    const car = body.car && typeof body.car === 'object'
      ? { id: clip(body.car.id, 80), make: clip(body.car.make, 60), model: clip(body.car.model, 60), year: clip(body.car.year, 8), kit: clip(body.car.kit, 60) }
      : null;
    const reports = readJson(REPORTS_FILE);
    reports.push({
      id: crypto.randomUUID(), type, mode: clip(body.mode, 40).replace(/[^\w:-]/g, '') || 'unknown', car,
      message: clip(body.message, 500), stack: clip(body.stack, 2000), note: clip(body.note, 500),
      userAgent: clip(body.userAgent, 300), ts: Date.now(),
    });
    if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS);
    writeJson(REPORTS_FILE, reports);
    res.json({ ok: true });
  });

  // Owner-only endpoints: ADMIN_TOKEN in the x-admin-token header (or ?token=),
  // or, without ADMIN_TOKEN set, a request from the server machine itself.
  const ownerOk = req => {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.get('x-forwarded-for');
    const token = String(req.get('x-admin-token') || req.query.token || '');
    return ADMIN_TOKEN
      ? token.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN))
      : local;
  };

  // Reports contain user agents and stack traces: owner-only.
  app.get('/api/reports', (req, res) => {
    if (!ownerOk(req)) return res.status(404).json({ error: 'not found' });
    res.json(readJson(REPORTS_FILE).slice().reverse());
  });

  // Play counter (daily totals, nothing about who played): owner-only. The page is /stats.html.
  app.get('/api/stats', limit(60, 60_000), (req, res) => {
    if (!ownerOk(req)) return res.status(404).json({ error: 'not found' });
    res.set('Cache-Control', 'no-store');
    res.json(stats.summary(Math.min(120, Math.max(1, parseInt(req.query.days, 10) || 30))));
  });

  // ---- CSP violation reports ----
  // Browsers post what the policy blocked (or would block, while report-only).
  // Kept with the bug reports as type 'csp', one entry per directive, blocked
  // resource and page a day, with a count. Addresses keep no query string.
  const cspBody = express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb', inflate: false });
  const urlPart = u => {
    const s = clip(u, 300);
    if (!/^https?:/i.test(s)) return s.replace(/[?#].*$/, '');
    try { const x = new URL(s); return x.origin + x.pathname; } catch { return ''; }
  };
  app.post('/api/csp-report', limit(60, 60_000), cspBody, (req, res) => {
    const raw = req.body;
    const list = Array.isArray(raw) ? raw.filter(r => r && r.type === 'csp-violation').map(r => r.body || {})
      : raw && typeof raw['csp-report'] === 'object' ? [raw['csp-report']] : [];
    if (list.length) {
      const reports = readJson(REPORTS_FILE);
      const now = Date.now();
      for (const r of list.slice(0, 20)) {
        const v = {
          directive: clip(r.effectiveDirective || r['effective-directive'] || r['violated-directive'], 60),
          blocked: urlPart(r.blockedURL || r['blocked-uri']),
          page: urlPart(r.documentURL || r['document-uri']).replace(/^https?:\/\/[^/]+/, '') || '/',
          source: urlPart(r.sourceFile || r['source-file']), line: Number(r.lineNumber || r['line-number']) || null,
          sample: clip(r.sample || r['script-sample'], 80), disposition: clip(r.disposition, 10),
        };
        const same = reports.find(x => x.type === 'csp' && now - x.ts < 24 * 60 * 60_000 && x.directive === v.directive && x.blocked === v.blocked && x.page === v.page);
        if (same) { same.count = (same.count || 1) + 1; same.lastTs = now; } else reports.push({ id: crypto.randomUUID(), type: 'csp', ...v, count: 1, userAgent: clip(req.get('user-agent'), 300), ts: now });
      }
      if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS);
      writeJson(REPORTS_FILE, reports);
    }
    res.status(204).end();
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  // Errors answer in plain JSON whatever NODE_ENV says: Express's own error page
  // shows the stack trace and the server's file paths outside production.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error('[server]', err);
    if (res.headersSent) return;
    res.status(status).json({ error: { 413: 'Request too large', 415: 'Unsupported request encoding' }[status] || (status >= 500 ? 'Something went wrong' : 'Bad request') });
  });

  // Party players are identified from the session cookie on their socket, so
  // competitive rooms can keep each player's own photos out.
  const identify = auth ? socket => {
    const headers = socket.request.headers || {};
    const u = auth.currentUser({ get: h => headers[String(h).toLowerCase()] });
    return u && u.status === 'active' ? u.id : null;
  } : null;
  const community = garage ? { items: () => garage.roundItems(), state: id => garage.itemState(id), photo: (id, ctx) => garage.roundPhoto(id, ctx) } : null;
  const track = (event, n) => {
    if (event === 'room') stats.partyRoom();
    else if (event === 'game') { stats.partyGame(n); }
    else if (event === 'finished') stats.partyFinished();
  };
  const party = attachParty(io, CARS, { ...opts.party, images, index: VEHICLES, community, identify, attributionFor: provenance.attributionFor, track });

  return {
    app, server, io, sessions, party, images, db: gdb, auth, garage, provenance, backup, stats, prints, index: VEHICLES,
    close() { clearInterval(hitSweep); images.close(); party.close(); io.close(); server.close(); if (garage) garage.close(); backup.close(); stats.close(); if (gdb && !opts.db) gdb.close(); },
  };
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const { server, provenance, images, backup, prints } = createApp();
  server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

  // Free hosting sleeps after 15 idle minutes and the restart wipes data/.
  // RENDER_EXTERNAL_URL is set by Render; KEEP_AWAKE=0 turns this off.
  if (process.env.KEEP_AWAKE !== '0') startKeepAwake({ url: process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL });

  // Check once that ranked photos can be fetched through the proxy (otherwise
  // they fall back to direct Wikimedia links, which can give the car away).
  setTimeout(async () => {
    const car = require('./cars.json').find(c => !c.excluded);
    const t = Date.now();
    try {
      const { buf, type } = await images.load(car.img);
      console.log(`[img] photo proxy works: ${type}, ${Math.round(buf.length / 1024)} KB in ${Date.now() - t} ms`);
    } catch (e) {
      console.warn(`[img] photo proxy can't fetch from Wikimedia (${e.message}); ranked photos will use direct links`);
    }
  }, 5_000).unref();

  // Deploys and restarts send SIGTERM: save the leaderboards first.
  process.on('SIGTERM', async () => {
    try { stats.flush(); } catch {}
    try { if (backup.enabled) { await Promise.race([backup.flush(), new Promise(r => setTimeout(r, 20_000))]); console.log('[scores] saved before shutdown'); } } catch {}
    process.exit(0);
  });
  // Photo credits: ask Commons for authors and licences when the saved copy is
  // missing or a week old (a few requests, in the background).
  if (process.env.COMMONS_META !== '0') {
    const refresh = () => { if (provenance.stale()) provenance.refresh({ keyOf: VCScore.identityKey }).catch(e => console.warn('[provenance]', e.message)); };
    setTimeout(refresh, 10_000).unref();
    setInterval(refresh, 24 * 60 * 60_000).unref();
  }
  // Garage on: fingerprint any game photo that src/photo-prints.json doesn't cover yet.
  if (prints && prints.missing().length) setTimeout(() => prints.fill().catch(e => console.warn('[prints]', e.message)), 30_000).unref();
}

module.exports = { createApp };
