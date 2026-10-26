/*
 * Leaderboards that survive restarts on hosting without a persistent disk.
 *
 * The server keeps working from data/scores.json as before. With a GitHub
 * token (SCORES_GITHUB_TOKEN, allowed to edit gists only), it also keeps a
 * copy in a private gist: restored when the server starts, saved shortly
 * after each new score and when the server shuts down.
 *
 * Nothing is saved until the restore has succeeded, so a GitHub outage at
 * start-up can never overwrite the saved leaderboards with an empty file.
 */
const fs = require('fs');

const API = 'https://api.github.com';
const FILE = 'viccall-scores.json';
const DESCRIPTION = 'VicCall leaderboards (kept by the game server, don’t edit)';
const MAX_PER_BOARD = 100;
const DAILY_KEEP_DAYS = 30;

const sortBoard = (a, b) => b.score - a.score || (a.timeMs || 0) - (b.timeMs || 0) || a.ts - b.ts;

/*
 * Tidy a scores list: one copy of each entry, the top 100 per board, and
 * Daily Challenge boards from the last 30 days only.
 */
function tidy(entries, now = Date.now()) {
  const cutoff = new Date(now - DAILY_KEEP_DAYS * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const byId = new Map();
  for (const e of entries) if (e && e.id && typeof e.board === 'string') byId.set(e.id, e);
  const boards = new Map();
  for (const e of byId.values()) {
    if (e.board.startsWith('daily:') && e.board.slice(6) < cutoff) continue;
    if (!boards.has(e.board)) boards.set(e.board, []);
    boards.get(e.board).push(e);
  }
  return [...boards.values()].flatMap(list => list.sort(sortBoard).slice(0, MAX_PER_BOARD));
}

/*
 * extras: other small files kept in the same gist, each
 *   { name, snapshot: () => string, restore: (savedText | null) => void }
 * (the play counter uses this).
 */
function createScoresBackup({ file, token, gistId: pinned, fetch: fetcher = (u, i) => fetch(u, i), log = true, saveDelayMs = 15_000, retryMs = 60_000, extras = [] } = {}) {
  const enabled = !!token;
  let gistId = pinned || null;
  let ready = false;
  let dirty = false;
  let saveTimer = null;
  let retryTimer = null;
  let saving = null;
  const say = (...a) => { if (log) console.log('[scores]', ...a); };
  const warn = (...a) => { if (log) console.warn('[scores]', ...a); };

  async function gh(method, path, body) {
    const res = await fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'VicCall-server', ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${res.status}`);
    return res.json();
  }

  const readLocal = () => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const writeLocal = v => { const tmp = `${file}.${process.pid}.bak.tmp`; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, file); };

  // Find the gist by its description (so only the token needs configuring).
  async function findGist() {
    for (let page = 1; page <= 10; page++) {
      const list = await gh('GET', `/gists?per_page=100&page=${page}`);
      const hit = list.find(g => g.description === DESCRIPTION && g.files && g.files[FILE]);
      if (hit) return hit.id;
      if (list.length < 100) return null;
    }
    return null;
  }

  async function fileText(f) {
    if (!f) return null;
    if (!f.truncated || !f.raw_url) return f.content;
    const res = await fetcher(f.raw_url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'VicCall-server' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub raw: ${res.status}`);
    return res.text();
  }
  // Returns the saved scores, and the saved text of each extra file.
  async function readGist() {
    const g = await gh('GET', `/gists/${gistId}`);
    const files = g.files || {};
    const v = JSON.parse((await fileText(files[FILE])) || '[]');
    const extra = {};
    for (const e of extras) extra[e.name] = await fileText(files[e.name]);
    return { scores: Array.isArray(v) ? v : [], extra };
  }

  // Merge what's saved with anything posted since this server started.
  async function restore() {
    if (!enabled) return { restored: 0 };
    try {
      if (!gistId) gistId = await findGist();
      const got = gistId ? await readGist() : { scores: [], extra: {} };
      const saved = got.scores;
      for (const e of extras) { try { e.restore(got.extra[e.name] || null); } catch (err) { warn(`couldn’t restore ${e.name}: ${err.message}`); } }
      const merged = tidy([...saved, ...readLocal()]);
      writeLocal(merged);
      ready = true;
      say(gistId ? `restored ${saved.length} scores from GitHub` : 'no saved leaderboards on GitHub yet; they’ll be saved from now on');
      if (readLocal().length !== saved.length || !gistId) markDirty();
      return { restored: saved.length };
    } catch (e) {
      warn(`couldn’t restore from GitHub (${e.message}); trying again in a minute, not saving until then`);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(restore, retryMs);
      if (retryTimer.unref) retryTimer.unref();
      return { error: e.message };
    }
  }

  async function save() {
    if (!enabled || !ready || !dirty) return false;
    if (saving) return saving;
    dirty = false;
    saving = (async () => {
      try {
        const files = { [FILE]: { content: JSON.stringify(tidy(readLocal())) } };
        for (const e of extras) files[e.name] = { content: e.snapshot() };
        if (gistId) await gh('PATCH', `/gists/${gistId}`, { files });
        else gistId = (await gh('POST', '/gists', { description: DESCRIPTION, public: false, files })).id;
        return true;
      } catch (e) {
        dirty = true;
        warn(`couldn’t save to GitHub (${e.message}); will retry`);
        schedule(retryMs);
        return false;
      } finally { saving = null; }
    })();
    return saving;
  }

  function schedule(ms) {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, ms);
    if (saveTimer.unref) saveTimer.unref();
  }
  function markDirty() {
    if (!enabled) return;
    dirty = true;
    schedule(saveDelayMs);
  }
  // Save now (on shutdown). Resolves once the save finished or failed.
  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saving) await saving;
    return save();
  }

  return {
    enabled, restore, markDirty, flush,
    get ready() { return ready; }, get gistId() { return gistId; },
    close() { clearTimeout(saveTimer); clearTimeout(retryTimer); },
  };
}

module.exports = { createScoresBackup, tidy, sortBoard, MAX_PER_BOARD, DAILY_KEEP_DAYS, DESCRIPTION, FILE };
