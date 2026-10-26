/*
 * Pace Car: one bot that plays each leaderboard once, like a decent player,
 * so new boards aren't empty and real players have a score to beat.
 *
 * It's always marked as a bot (`bot: true`, shown with a "bot" tag), never
 * passed off as a person. It plays the real cars for that board, its answers
 * are scored by the real scorer, and it doesn't count in the play counter.
 *
 * How it answers: for each car, by chance weighted by how hard the car is,
 * it names it exactly, gets only the make, or has no idea; it usually gets the
 * year close when it knows the car. Each car takes it 8 to 30 seconds.
 */
const Modes = require('./modes');
const VCScore = require('../public/scoring.js');

const NAME = 'Pace Car';
// Chance of naming the car exactly, by difficulty (1 easy, 3 hard), and of getting only the make.
const EXACT = { 1: 0.78, 2: 0.55, 3: 0.32 };
const MAKE_ONLY = 0.2;

// mulberry32: a small seeded generator, so tests can replay a game.
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

function answerFor(car, kind, index, rand) {
  const p = EXACT[car.difficulty] ?? 0.5;
  const r = rand();
  const knows = r < p;
  const knowsMake = r < p + MAKE_ONLY;
  if (kind === 'kit') {
    return { kit: knows ? car.kit : '', car: knows ? VCScore.bestAnswer(car, index) : knowsMake ? car.make : '' };
  }
  const y = rand();
  const off = 1 + Math.floor(rand() * 3);
  const year = knows
    ? (y < 0.45 ? car.year : y < 0.85 ? car.year + (rand() < 0.5 ? -off : off) : null)
    : (knowsMake && y < 0.4 ? car.year + (rand() < 0.5 ? -off * 2 : off * 2) : null);
  return { car: knows ? VCScore.bestAnswer(car, index) : knowsMake ? car.make : '', year: year ? String(year) : '' };
}

/*
 * Play one game: { kind: 'daily' | 'ranked' | 'endless', playlist? }.
 * Returns what a finished session would post: { board, score, maxScore, cars, rounds, bestStreak, timeMs }.
 */
function play(CARS, index, req, rand = Math.random) {
  const plan = Modes.planGame(CARS, req);
  if (!plan || plan.error || !plan.board) return null;
  const seen = new Set();
  let score = 0, cars = 0, streak = 0, bestStreak = 0, strikes = 0, timeMs = 0, rounds = 0;
  for (let i = 0; plan.rounds ? i < plan.rounds : strikes < plan.lives && i < Modes.ENDLESS_CAP; i++) {
    const car = plan.kind === 'endless' ? Modes.nextEndless(plan, seen, streak, rand) : plan.queue[i];
    if (!car) break;
    seen.add(car.id);
    const r = VCScore.scoreRound(car, answerFor(car, plan.roundKind, index, rand), { ruleset: plan.ruleset, kind: plan.roundKind, index });
    score += r.pts;
    rounds += 1;
    timeMs += 8000 + Math.floor(rand() * 22000);
    if (r.identified) { cars += 1; streak += 1; bestStreak = Math.max(bestStreak, streak); } else { streak = 0; if (plan.kind === 'endless') strikes += 1; }
  }
  return { board: plan.board, score, maxScore: (plan.rounds || rounds) * VCScore.MAX, cars, rounds, bestStreak, timeMs };
}

// Every board the Pace Car should be on today.
function jobs() {
  return [
    { kind: 'daily', board: `daily:${Modes.utcDateKey()}` },
    ...Object.keys(Modes.PLAYLISTS).map(p => ({ kind: 'ranked', playlist: p, board: `ranked:${p}` })),
    { kind: 'endless', board: 'endless' },
  ];
}

module.exports = { play, jobs, answerFor, rng, NAME, EXACT };
