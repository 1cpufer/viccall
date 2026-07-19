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
const MODES = ['worldwide', 'japan', 'germany', 'usa', 'france', 'italy', 'uk', 'niche', 'supercar', 'timeattack'];
const MAX_PER_MODE = 100;
const CARS = JSON.parse(fs.readFileSync(path.join(__dirname, 'cars.json'), 'utf8'));

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, '[]');

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

attachParty(io, CARS, MODES);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
