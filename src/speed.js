/*
 * Fastest correct answer on each car today, for the solo reveal
 * ("Answered in 4.2 s · fastest today 2.1 s").
 *
 * Times only: no names and nothing about the player is kept. It lives in
 * memory and clears when the day changes (days follow STATS_TZ, like the play
 * counter), so a restart clears it too. Scoring doesn't use it.
 */
const { dayKey } = require('./stats');

// Faster than this isn't a person reading a photo and typing; shown, not kept as a record.
const MIN_RECORD_MS = 1000;

function createSpeed({ tz = process.env.STATS_TZ || 'America/Chicago', now = () => new Date() } = {}) {
  let day = null;
  const best = new Map(); // car id -> ms

  function roll() {
    const d = dayKey(now(), tz);
    if (d !== day) { day = d; best.clear(); }
  }

  /*
   * One answer: ms from the photo appearing to locking in, and whether the car was named.
   * Returns { ms, best, isBest, first }: best is today's fastest correct time on this car
   * (including this answer), isBest whether this answer is it, first whether nobody had
   * named this car yet today.
   */
  function answer(carId, ms, correct) {
    roll();
    const prev = best.has(carId) ? best.get(carId) : null;
    let isBest = false;
    if (correct && ms >= MIN_RECORD_MS && (prev == null || ms <= prev)) {
      best.set(carId, ms);
      isBest = true;
    }
    return { ms, best: best.has(carId) ? best.get(carId) : null, isBest, first: isBest && prev == null };
  }

  return {
    answer,
    fastest(carId) { roll(); return best.has(carId) ? best.get(carId) : null; },
    get size() { return best.size; },
  };
}

module.exports = { createSpeed, MIN_RECORD_MS };
