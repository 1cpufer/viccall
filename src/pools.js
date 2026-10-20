/*
 * Which community photos a game may use.
 *
 *   eligible = approved photos for this ruleset
 *              - photos any participant contributed (including copies of them)
 *
 * Competitive games (ranked, endless, competitive parties) only use photos a
 * moderator marked competitive, that aren't flagged or disputed, and only when
 * every participant is signed in: an anonymous player could be the person who
 * took the photo, so their games use first-party photos only.
 *
 * Casual games use any approved photo except the player's own.
 *
 * These checks run when a game is planned and again when each round opens,
 * so a removal, a new flag or a change of player takes effect mid-game. A
 * photo that fails is replaced with a first-party photo, never shown.
 */
const VCScore = require('../public/scoring.js');

const PLAYABLE = ['casual', 'competitive'];

/*
 * item: { community: true, moderation, eligibility, takedown, flagged, contributors: [userId] }
 * ctx:  { competitive: bool, participants: [userId | null] }
 * Returns { ok: true } or { ok: false, why }.
 */
function communityAllowed(item, ctx) {
  if (item == null) return { ok: false, why: 'no record' }; // a photo that can't be looked up is never shown
  if (!item.community) return { ok: true };
  if (item.moderation !== 'approved' || item.takedown !== 'none' || !PLAYABLE.includes(item.eligibility)) return { ok: false, why: 'not live' };
  const participants = Array.isArray(ctx.participants) ? ctx.participants : [];
  const contributors = new Set(item.contributors || []);
  if (ctx.competitive) {
    if (item.eligibility !== 'competitive' || item.flagged) return { ok: false, why: 'not competitive' };
    if (!participants.length || participants.some(p => !p)) return { ok: false, why: 'anonymous participant' };
  }
  if (participants.some(p => p && contributors.has(p))) return { ok: false, why: 'participant contributed' };
  return { ok: true };
}

const eligible = (items, ctx) => items.filter(it => communityAllowed(it, ctx).ok);

const keyOf = c => c.vkey || VCScore.identityKey(c);

// A first-party car for this game that isn't already in it (or any, if all are used).
function replacement(queue, fallback, rand = Math.random) {
  const used = new Set(queue.filter(Boolean).map(c => c.id));
  const usedKeys = new Set(queue.filter(Boolean).map(keyOf));
  const fresh = fallback.filter(c => !used.has(c.id) && !usedKeys.has(keyOf(c)));
  const from = fresh.length ? fresh : fallback.filter(c => !used.has(c.id));
  const list = from.length ? from : fallback;
  return list.length ? list[Math.floor(rand() * list.length)] : null;
}

// A community photo of a car that's already in the game is swapped for a first-party one.
function dedupe(queue, fallback, rand = Math.random) {
  const out = [];
  const seen = new Set();
  for (const c of queue) {
    let car = c;
    if (car.community && seen.has(keyOf(car))) car = replacement([...out, ...queue], fallback, rand) || car;
    seen.add(keyOf(car));
    out.push(car);
  }
  return out;
}

// Game difficulty tiers are 1-3; moderators rate community photos 1-5.
const tierOf = d => (d >= 4 ? 3 : d === 3 ? 2 : 1);

module.exports = { communityAllowed, eligible, replacement, dedupe, tierOf, PLAYABLE };
