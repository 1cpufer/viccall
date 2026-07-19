const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const { attachParty } = require('./party');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const MODES = ['worldwide', 'japan', 'germany', 'usa', 'france', 'italy', 'uk', 'niche', 'supercar', 'timeattack', 'kit'];
const MAX_PER_MODE = 100;
const MAX_REPORTS = 500;
const CARS = JSON.parse(fs.readFileSync(path.join(__dirname, 'cars.json'), 'utf8'));

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, '[]');
if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, '[]');

function readScores() {
  try {
    return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeScores(scores) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(scores));
}

function readReports() {
  try {
    return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeReports(reports) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports));
}

function clip(v, max) {
  return String(v == null ? '' : v).slice(0, max);
}

function sanitizeName(raw) {
  const cleaned = String(raw || '').replace(/[^\w \-'.]/g, '').trim().slice(0, 20);
  return cleaned || 'Anonymous';
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/cars', (req, res) => {
  res.json(CARS);
});

app.post('/api/scores', (req, res) => {
  const { name, mode, score, maxScore } = req.body || {};
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'invalid mode' });
  if (!Number.isInteger(score) || score < 0 || score > 1000) return res.status(400).json({ error: 'invalid score' });
  if (!Number.isInteger(maxScore) || maxScore < score || maxScore > 1000) return res.status(400).json({ error: 'invalid maxScore' });

  const entry = {
    id: crypto.randomUUID(),
    name: sanitizeName(name),
    mode,
    score,
    maxScore,
    ts: Date.now(),
  };

  const scores = readScores();
  scores.push(entry);

  const forMode = scores.filter(s => s.mode === mode).sort((a, b) => b.score - a.score || a.ts - b.ts);
  const rank = forMode.findIndex(s => s.id === entry.id) + 1;

  if (forMode.length > MAX_PER_MODE) {
    const keepIds = new Set(forMode.slice(0, MAX_PER_MODE).map(s => s.id));
    const pruned = scores.filter(s => s.mode !== mode || keepIds.has(s.id));
    writeScores(pruned);
  } else {
    writeScores(scores);
  }

  res.json({ rank, total: forMode.length });
});

app.get('/api/leaderboard', (req, res) => {
  const mode = MODES.includes(req.query.mode) ? req.query.mode : 'worldwide';
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const scores = readScores()
    .filter(s => s.mode === mode)
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .slice(0, limit)
    .map(({ name, score, maxScore, ts }) => ({ name, score, maxScore, ts }));
  res.json(scores);
});

app.post('/api/report', (req, res) => {
  const body = req.body || {};
  const type = body.type === 'crash' ? 'crash' : body.type === 'bug' ? 'bug' : null;
  if (!type) return res.status(400).json({ error: 'invalid type' });

  const entry = {
    id: crypto.randomUUID(),
    type,
    mode: MODES.includes(body.mode) ? body.mode : 'unknown',
    car: body.car && typeof body.car === 'object'
      ? { make: clip(body.car.make, 60), model: clip(body.car.model, 60), year: clip(body.car.year, 8), kit: clip(body.car.kit, 60) }
      : null,
    message: clip(body.message, 500),
    stack: clip(body.stack, 2000),
    note: clip(body.note, 500),
    userAgent: clip(body.userAgent, 300),
    ts: Date.now(),
  };

  const reports = readReports();
  reports.push(entry);
  if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS);
  writeReports(reports);

  res.json({ ok: true });
});

app.get('/api/reports', (req, res) => {
  res.json(readReports().slice().reverse());
});

attachParty(io, CARS, MODES);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
