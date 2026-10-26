/*
 * Play counter: daily totals of visits and games, for the owner.
 *
 * Nothing about who played is stored. A browser tells the server the last
 * day it visited (a date, nothing else), which is enough to count new and
 * returning visitors. Days run on STATS_TZ (default America/Chicago).
 *
 * Totals live in data/stats.json and, with a GitHub token, in the same
 * private gist as the leaderboards, so they survive restarts.
 */
const fs = require('fs');

const KEEP_DAYS = 120;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayKey(date, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); } catch { return date.toISOString().slice(0, 10); }
}

// Larger of each counter: merging a restored copy never counts anything twice.
function mergeMax(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object') out[k] = mergeMax(out[k] && typeof out[k] === 'object' ? out[k] : {}, v);
    else if (typeof v === 'number') out[k] = Math.max(typeof out[k] === 'number' ? out[k] : 0, v);
  }
  return out;
}

function createStats({ file, tz = process.env.STATS_TZ || 'America/Chicago', now = () => new Date(), onChange = () => {}, writeDelayMs = 10_000 } = {}) {
  let data = { days: {} };
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (saved && saved.days) data = saved; } catch {}
  let timer = null;

  const today = () => dayKey(now(), tz);
  const prune = () => {
    const keys = Object.keys(data.days).sort();
    while (keys.length > KEEP_DAYS) delete data.days[keys.shift()];
  };
  function write() {
    clearTimeout(timer);
    timer = null;
    prune();
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch (e) { console.warn('[stats] couldn’t write:', e.message); }
  }
  function changed() {
    onChange();
    if (!timer) { timer = setTimeout(write, writeDelayMs); if (timer.unref) timer.unref(); }
  }
  function bump(path, n = 1) {
    const d = data.days[today()] || (data.days[today()] = {});
    let o = d;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]] || (o[path[i]] = {});
    o[path[path.length - 1]] = (o[path[path.length - 1]] || 0) + n;
    changed();
  }

  return {
    today,
    // seen: the last day this browser visited ('none' the first time). Returns today's key for the browser to keep.
    visit(seen) {
      const t = today();
      if (seen === 'none') { bump(['visits']); bump(['visitors']); bump(['newVisitors']); }
      else if (DAY_RE.test(String(seen || ''))) {
        bump(['visits']);
        if (seen !== t) { bump(['visitors']); bump(['returning']); }
      }
      return t;
    },
    started: mode => bump(['started', mode]),
    finished: mode => bump(['finished', mode]),
    round: () => bump(['rounds']),
    posted: () => bump(['scoresPosted']),
    partyRoom: () => bump(['partyRooms']),
    partyGame: players => { bump(['partyGames']); bump(['partyPlayers'], players); },
    partyFinished: () => bump(['partyFinished']),

    summary(days = 30) {
      const keys = Object.keys(data.days).sort().reverse().slice(0, days);
      const sum = obj => (obj ? Object.values(obj).reduce((a, b) => a + b, 0) : 0);
      const row = k => {
        const d = data.days[k] || {};
        return {
          day: k, visits: d.visits || 0, visitors: d.visitors || 0, newVisitors: d.newVisitors || 0, returning: d.returning || 0,
          started: sum(d.started), finished: sum(d.finished), rounds: d.rounds || 0, scoresPosted: d.scoresPosted || 0,
          partyRooms: d.partyRooms || 0, partyGames: d.partyGames || 0, partyPlayers: d.partyPlayers || 0,
          byMode: { started: d.started || {}, finished: d.finished || {} },
        };
      };
      const rows = keys.map(row);
      const total = list => list.reduce((t, r) => {
        for (const k of Object.keys(r)) if (typeof r[k] === 'number') t[k] = (t[k] || 0) + r[k];
        return t;
      }, {});
      const modes = {};
      for (const r of rows.slice(0, 7)) for (const [m, n] of Object.entries(r.byMode.started)) modes[m] = (modes[m] || 0) + n;
      return { tz, today: today(), days: rows, last7: total(rows.slice(0, 7)), last30: total(rows), modes7: modes };
    },

    // For the GitHub backup.
    snapshot: () => JSON.stringify(data),
    restore(text) {
      if (!text) return;
      try { const saved = JSON.parse(text); if (saved && saved.days) { data = { days: mergeMax(saved.days, data.days) }; write(); } } catch {}
    },
    flush: write,
    close() { clearTimeout(timer); },
  };
}

module.exports = { createStats, mergeMax, dayKey };
