/*
 * Rebuilds src/photo-prints.json: fingerprints of every first-party photo, so
 * the Community Garage can refuse uploads of the game's own photos. Run it
 * after adding or changing photos in cars.json, from a computer that can
 * reach Wikimedia:  node scripts/photo-prints.js
 */
const path = require('path');
const { createPhotoPrints, SHIPPED } = require('../src/photo-prints');
const cars = require('../src/cars.json');

(async () => {
  const prints = createPhotoPrints({ cars });
  const before = prints.missing().length;
  if (!before) return console.log(`${path.relative(process.cwd(), SHIPPED)} is up to date (${prints.size} photos).`);
  console.log(`Fingerprinting ${before} photos...`);
  const r = await prints.fill({ save: SHIPPED });
  console.log(`Done: ${r.done} added${r.failed ? `, ${r.failed} failed (run it again)` : ''}. ${prints.size} photos in ${path.relative(process.cwd(), SHIPPED)}.`);
  if (r.failed) process.exitCode = 1;
})();
