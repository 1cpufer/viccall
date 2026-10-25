/*
 * Game modes: which cars a game draws from, in what order, under which rules.
 *
 *   Free Play   No account, no leaderboard. Pick any mix of era / region /
 *               type / difficulty, optional timer, casual (forgiving) rules.
 *   Competitive Fixed playlists, strict rules, a clock on every car, streaks,
 *               a leaderboard per playlist. Cars get harder as the game goes.
 *   Daily       The same ten cars for everyone each UTC day. Strict rules,
 *               one ranked attempt per player per day.
 *   Endless     Keep going until you miss three cars. Strict rules.
 */

const Pools = require('./pools');

const ROUNDS = 10;
const RANKED_CLOCK_MS = 45_000;
const EUROPE = new Set(['germany', 'italy', 'uk', 'france', 'sweden', 'croatia']);

const era = c => (c.year >= 2010 ? 'modern' : c.year >= 1990 ? 'nineties' : 'classic');

// Competitive playlists (also offered in party rooms).
const PLAYLISTS = {
  world: { title: 'Worldwide', desc: 'Every era, every country.', filter: c => !c.kit },
  modern: { title: 'Modern Cars', desc: 'Built since 2010. What you see at meets today.', filter: c => !c.kit && era(c) === 'modern' },
  classic: { title: 'Classic Icons', desc: 'Before 1990. The posters on the wall.', filter: c => !c.kit && era(c) === 'classic' && c.difficulty <= 2 },
  jdm: { title: 'JDM Challenge', desc: 'Japan only, from kei cars to the GT-R.', filter: c => !c.kit && c.region === 'japan' },
  euro: { title: 'European Performance', desc: 'Germany, Italy, Britain, France and beyond.', filter: c => !c.kit && EUROPE.has(c.region) },
  super: { title: 'Supercar Challenge', desc: 'Exotics and hypercars only.', filter: c => !c.kit && c.supercar },
  kits: { title: 'Body Kit ID', desc: 'Name the tuner, then the car underneath.', filter: c => !!c.kit, kind: 'kit' },
};

// Free Play filter vocabulary. Values are validated against these lists.
const FILTERS = {
  era: ['any', 'modern', 'nineties', 'classic'],
  region: ['any', 'japan', 'germany', 'italy', 'uk', 'usa', 'france', 'europe'],
  type: ['any', 'supercar', 'kit'],
  difficulty: ['any', '1', '2', '3'],
  timer: ['0', '60', '30', '15'],
};
const DEFAULT_FILTERS = { era: 'any', region: 'any', type: 'any', difficulty: 'any', timer: '0' };

function cleanFilters(raw) {
  const f = { ...DEFAULT_FILTERS };
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const k of Object.keys(FILTERS)) {
    const v = String(src[k] == null ? f[k] : src[k]);
    if (FILTERS[k].includes(v)) f[k] = v; // whitelist only
  }
  return f;
}

function freePlayFilter(f) {
  return c => {
    if (f.type === 'kit' ? !c.kit : c.kit) return false;
    if (f.type === 'supercar' && !c.supercar) return false;
    if (f.era !== 'any' && era(c) !== f.era) return false;
    if (f.region === 'europe' ? !EUROPE.has(c.region) : f.region !== 'any' && c.region !== f.region) return false;
    if (f.difficulty !== 'any' && String(c.difficulty) !== f.difficulty) return false;
    return true;
  };
}

// Small seeded PRNG (mulberry32) so the daily challenge is the same everywhere.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashString = s => [...s].reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261);

function shuffle(a, rand = Math.random) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

const live = CARS => CARS.filter(c => !c.excluded);

// n cars, no repeats unless the pool is smaller than n (then no back-to-back repeats).
function pick(pool, n, rand = Math.random) {
  const out = [];
  if (!pool.length) return out;
  while (out.length < n) {
    const batch = shuffle(pool, rand);
    if (out.length && batch.length > 1 && batch[0] === out[out.length - 1]) batch.push(batch.shift());
    out.push(...batch);
  }
  return out.slice(0, n);
}

// Competitive order: easier cars first so a game builds, without being predictable.
function ramp(cars, rand = Math.random) {
  return cars
    .map((c, i) => ({ c, k: (c.difficulty || 2) + rand() * 1.2 + i * 0.001 }))
    .sort((a, b) => a.k - b.k)
    .map(x => x.c);
}

// Daily mix: 3 easy, 4 medium, 3 hard, from all non-kit cars, seeded by date.
function dailyQueue(CARS, dateKey) {
  const rand = rng(hashString(`viccall-daily-${dateKey}`));
  const pool = live(CARS).filter(c => !c.kit);
  const tier = d => pool.filter(c => c.difficulty === d);
  const chosen = [...pick(tier(1), 3, rand), ...pick(tier(2), 4, rand), ...pick(tier(3), 3, rand)];
  // A short tier (small car lists) is topped up from the rest of the pool.
  if (chosen.length < ROUNDS) chosen.push(...pick(pool.filter(c => !chosen.includes(c)), ROUNDS - chosen.length, rand));
  return ramp(chosen, rand);
}

const utcDateKey = (d = new Date()) => d.toISOString().slice(0, 10);
// When the next Daily Challenge starts: the coming midnight UTC, the same instant everywhere.
const nextDailyAt = (d = new Date()) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
const endlessPools = new WeakMap(); // shared per car list, so sessions don't each copy it
const ENDLESS_CAP = 250;            // a run this long ends on its own

/*
 * Resolve a game request into a plan. Returns null if the request is invalid.
 * plan: { kind, key, title, board, ruleset, roundKind, clockMs, rounds, lives, pool, queue, fallback }
 *   board: leaderboard key or null. rounds: number or null (endless).
 *   fallback: the first-party cars for this game, used to replace a community
 *   photo that can no longer be shown.
 * opts.extra: community photos already cleared for this player and ruleset.
 * The Daily Challenge never uses them: it must be the same for everyone.
 */
function planGame(CARS, req, opts = {}) {
  const r = req && typeof req === 'object' ? req : {};
  const all = live(CARS);
  const extra = Array.isArray(opts.extra) ? opts.extra : [];
  if (r.kind === 'free') {
    const f = cleanFilters(r.filters);
    const base = all.filter(freePlayFilter(f));
    if (!base.length) return { error: 'No cars match those filters. Try widening one.' };
    const pool = base.concat(extra.filter(freePlayFilter(f)));
    const roundKind = f.type === 'kit' ? 'kit' : 'car';
    return { kind: 'free', key: 'free', title: 'Free Play', board: null, ruleset: 'casual', roundKind, clockMs: Number(f.timer) * 1000, rounds: ROUNDS, lives: null, filters: f, queue: Pools.dedupe(pick(pool, ROUNDS), base), poolSize: pool.length, fallback: base };
  }
  if (r.kind === 'ranked') {
    if (typeof r.playlist !== 'string' || !Object.prototype.hasOwnProperty.call(PLAYLISTS, r.playlist)) return null;
    const p = PLAYLISTS[r.playlist];
    const base = all.filter(p.filter);
    if (!base.length) return { error: 'This playlist has no cars yet.' };
    const pool = base.concat(extra.filter(p.filter));
    return { kind: 'ranked', key: r.playlist, title: p.title, board: `ranked:${r.playlist}`, ruleset: 'competitive', roundKind: p.kind || 'car', clockMs: RANKED_CLOCK_MS, rounds: ROUNDS, lives: null, queue: ramp(Pools.dedupe(pick(pool, ROUNDS), base)), poolSize: pool.length, fallback: base };
  }
  if (r.kind === 'daily') {
    const date = utcDateKey();
    return { kind: 'daily', key: date, title: `Daily Challenge`, date, board: `daily:${date}`, ruleset: 'competitive', roundKind: 'car', clockMs: RANKED_CLOCK_MS, rounds: ROUNDS, lives: null, queue: dailyQueue(CARS, date), poolSize: ROUNDS, fallback: all.filter(c => !c.kit) };
  }
  if (r.kind === 'endless') {
    if (!endlessPools.has(CARS)) endlessPools.set(CARS, all.filter(c => !c.kit));
    const base = endlessPools.get(CARS);
    const pool = extra.length ? base.concat(extra.filter(c => !c.kit)) : base;
    return { kind: 'endless', key: 'endless', title: 'Endless', board: 'endless', ruleset: 'competitive', roundKind: 'car', clockMs: RANKED_CLOCK_MS, rounds: null, lives: 3, queue: [], pool, poolSize: pool.length, fallback: base };
  }
  return null;
}

// Next car for an endless run: unseen, getting harder as the streak grows.
function nextEndless(plan, seen, streak, rand = Math.random) {
  const target = streak >= 8 ? 3 : streak >= 3 ? 2 : 1;
  const unseen = plan.pool.filter(c => !seen.has(c.id));
  const source = unseen.length ? unseen : plan.pool;
  const near = source.filter(c => Math.abs((c.difficulty || 2) - target) <= (rand() < 0.25 ? 1 : 0));
  const from = near.length ? near : source;
  return from[Math.floor(rand() * from.length)];
}

function catalog(CARS) {
  const all = live(CARS);
  return {
    rounds: ROUNDS,
    clockMs: RANKED_CLOCK_MS,
    playlists: Object.entries(PLAYLISTS).map(([id, p]) => ({ id, title: p.title, desc: p.desc, kind: p.kind || 'car', size: all.filter(p.filter).length })),
    filters: FILTERS,
    eras: { modern: all.filter(c => era(c) === 'modern').length, nineties: all.filter(c => era(c) === 'nineties').length, classic: all.filter(c => era(c) === 'classic').length },
  };
}

module.exports = { ROUNDS, RANKED_CLOCK_MS, ENDLESS_CAP, PLAYLISTS, FILTERS, DEFAULT_FILTERS, cleanFilters, freePlayFilter, planGame, nextEndless, dailyQueue, catalog, utcDateKey, nextDailyAt, era, pick, ramp, shuffle, live };
