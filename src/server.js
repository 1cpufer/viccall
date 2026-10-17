const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const { attachParty, buildQueue, poolFor, sanitizeName, TOTAL } = require('./party');
const VCScore = require('../public/scoring.js');

const MODES = ['worldwide', 'japan', 'germany', 'usa', 'france', 'italy', 'uk', 'niche', 'supercar', 'timeattack', 'kit'];
const MAX_PER_MODE = 100;
const MAX_REPORTS = 500;
const MAX_SESSIONS = 5000;
const SESSION_TTL_MS = 2 * 60 * 60_000;
const TIME_ATTACK_MS = 30_000;
const TIME_ATTACK_SLACK_MS = 4_000; // network + render allowance

function createApp(opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
  const CARS = opts.cars || JSON.parse(fs.readFileSync(path.join(__dirname, 'cars.json'), 'utf8'));
  const ADMIN_TOKEN = opts.adminToken !== undefined ? opts.adminToken : process.env.ADMIN_TOKEN || '';
  const SCORES_FILE = path.join(dataDir, 'scores.json');
  const REPORTS_FILE = path.join(dataDir, 'reports.json');

  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, '[]');
  if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, '[]');

  const readJson = f => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  // Write to a temp file then rename, so a crash mid-write can't corrupt the leaderboard.
  const writeJson = (f, v) => { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f); };
  const clip = (v, max) => String(v == null ? '' : v).slice(0, max);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 16 * 1024, pingTimeout: 20000 });

  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // set when running behind a reverse proxy
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, file) {
      if (/\.(woff2|svg)$/.test(file)) res.set('Cache-Control', 'public, max-age=604800');
      else res.set('Cache-Control', 'no-cache');
    },
  }));

  // Tiny per-IP rate limiter for write endpoints.
  const hits = new Map();
  function limit(max, windowMs) {
    return (req, res, next) => {
      const key = `${req.path}|${req.ip}`;
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

  // Pool sizes per mode, for the UI. Answers are never sent before a guess.
  app.get('/api/meta', (req, res) => {
    res.json({
      total: TOTAL,
      modes: Object.fromEntries(MODES.map(m => [m, poolFor(CARS, m).length])),
      makes: [...new Set(CARS.map(c => c.make))].sort((a, b) => a.localeCompare(b)),
    });
  });

  // ---- Solo sessions: the server holds the answers and keeps score. ----
  const sessions = new Map();
  function pruneSessions() {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.created > SESSION_TTL_MS) sessions.delete(id);
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }

  app.post('/api/solo/start', limit(150, 60_000), (req, res) => {
    const mode = MODES.includes(req.body && req.body.mode) ? req.body.mode : null;
    if (!mode) return res.status(400).json({ error: 'invalid mode' });
    pruneSessions();
    const id = crypto.randomUUID();
    const queue = buildQueue(CARS, mode);
    const now = Date.now();
    sessions.set(id, { id, mode, queue, idx: 0, score: 0, results: [], created: now, roundStart: now, saved: false });
    res.json({ sessionId: id, mode, total: TOTAL, maxPerCar: VCScore.maxForMode(mode), timeLimitMs: mode === 'timeattack' ? TIME_ATTACK_MS : 0, images: queue.map(c => c.img) });
  });

  // Client tells the server the round is on screen, so Time Attack can be checked.
  app.post('/api/solo/shown', (req, res) => {
    const s = sessions.get(clip(req.body && req.body.sessionId, 64));
    if (!s) return res.status(404).json({ error: 'session expired' });
    if (req.body.idx === s.idx) s.roundStart = Date.now();
    res.json({ ok: true });
  });

  app.post('/api/solo/guess', limit(600, 60_000), (req, res) => {
    const b = req.body || {};
    const s = sessions.get(clip(b.sessionId, 64));
    if (!s) return res.status(404).json({ error: 'session expired' });
    if (b.idx !== s.idx || s.idx >= TOTAL) return res.status(409).json({ error: 'round already answered' });
    const car = s.queue[s.idx];
    const guess = { make: clip(b.make, 60), model: clip(b.model, 60), year: clip(b.year, 8), kit: clip(b.kit, 60) };
    let result = VCScore.scoreRound(car, s.mode, guess);
    const late = s.mode === 'timeattack' && Date.now() - s.roundStart > TIME_ATTACK_MS + TIME_ATTACK_SLACK_MS;
    if (late) result = { ...result, pts: 0, res: result.res.map(r => ({ ...r, pts: 0 })), late: true };
    s.score += result.pts;
    s.results.push({ carId: car.id, pts: result.pts });
    s.idx += 1;
    s.roundStart = Date.now();
    res.json({
      pts: result.pts, res: result.res, late: !!result.late, score: s.score, idx: s.idx, done: s.idx >= TOTAL,
      answer: { id: car.id, make: car.make, model: car.model, year: car.year, kit: car.kit || null, hint: car.hint },
    });
  });

  // ---- Leaderboard ----
  app.post('/api/scores', limit(40, 60_000), (req, res) => {
    const b = req.body || {};
    const s = sessions.get(clip(b.sessionId, 64));
    if (!s) return res.status(400).json({ error: 'Play a full game to post a score' });
    if (s.idx < TOTAL) return res.status(400).json({ error: 'Game not finished' });
    if (s.saved) return res.status(409).json({ error: 'Score already saved' });
    s.saved = true;

    const entry = { id: crypto.randomUUID(), name: sanitizeName(b.name), mode: s.mode, score: s.score, maxScore: TOTAL * VCScore.maxForMode(s.mode), ts: Date.now() };
    const scores = readJson(SCORES_FILE);
    scores.push(entry);
    const forMode = scores.filter(x => x.mode === s.mode).sort((a, c) => c.score - a.score || a.ts - c.ts);
    const rank = forMode.findIndex(x => x.id === entry.id) + 1;
    if (forMode.length > MAX_PER_MODE) {
      const keep = new Set(forMode.slice(0, MAX_PER_MODE).map(x => x.id));
      writeJson(SCORES_FILE, scores.filter(x => x.mode !== s.mode || keep.has(x.id)));
    } else writeJson(SCORES_FILE, scores);
    res.json({ rank, total: Math.min(forMode.length, MAX_PER_MODE) });
  });

  app.get('/api/leaderboard', (req, res) => {
    const mode = MODES.includes(req.query.mode) ? req.query.mode : 'worldwide';
    const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    res.json(readJson(SCORES_FILE)
      .filter(s => s.mode === mode)
      .sort((a, b) => b.score - a.score || a.ts - b.ts)
      .slice(0, lim)
      .map(({ name, score, maxScore, ts }) => ({ name, score, maxScore, ts })));
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
      id: crypto.randomUUID(), type, mode: MODES.includes(body.mode) ? body.mode : 'unknown', car,
      message: clip(body.message, 500), stack: clip(body.stack, 2000), note: clip(body.note, 500),
      userAgent: clip(body.userAgent, 300), ts: Date.now(),
    });
    if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS);
    writeJson(REPORTS_FILE, reports);
    res.json({ ok: true });
  });

  // Reports contain user agents and stack traces: owner-only.
  // Set ADMIN_TOKEN and call /api/reports?token=..., or read it from the same machine.
  app.get('/api/reports', (req, res) => {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.get('x-forwarded-for');
    const token = String(req.get('x-admin-token') || req.query.token || '');
    const ok = ADMIN_TOKEN
      ? token.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN))
      : local;
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json(readJson(REPORTS_FILE).slice().reverse());
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  const party = attachParty(io, CARS, MODES, opts.party);

  return {
    app, server, io, sessions,
    close() { clearInterval(hitSweep); party.close(); io.close(); server.close(); },
  };
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const { server } = createApp();
  server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

module.exports = { createApp, MODES };
