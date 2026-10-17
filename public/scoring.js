/*
 * VicCall answer scoring. One source of truth shared by the browser (solo play)
 * and the server (party play, leaderboard sessions). UMD so both can load it.
 *
 * Points: make 1, model 2 (1 for a "close" partial), year 2 exact / 1 within 5.
 * Kit Check: 5 for the right tuner, 0 otherwise.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VCScore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POINTS = { make: 1, model: 2, modelClose: 1, yearExact: 2, yearNear: 1, kit: 5 };
  const MAX_PER_CAR = POINTS.make + POINTS.model + POINTS.yearExact; // 5
  const YEAR_NEAR = 5;

  // Lowercase, strip accents, drop joining punctuation so "GT-R" == "GTR", "RX-7" == "RX7".
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[★'’.\-]/g, '')
      .replace(/&/g, ' and ');
  }
  function compact(s) { return norm(s).replace(/[^a-z0-9]/g, ''); }
  function tokens(s) { return norm(s).split(/[^a-z0-9]+/).filter(Boolean); }
  const hasDigit = t => /\d/.test(t);
  const isCode = t => /[a-z]/.test(t) && /\d/.test(t); // R34, E30, AE86, C8, MX5

  // Common names players actually type. Keys and values are compared after compact().
  const MAKE_ALIASES = {
    'volkswagen': ['vw', 'volks', 'vdub'],
    'chevrolet': ['chevy', 'chev'],
    'mercedesbenz': ['mercedes', 'benz', 'merc', 'mb', 'mercedesamg', 'amg'],
    'bmw': ['bimmer', 'beemer', 'bayerischemotorenwerke'],
    'alfaromeo': ['alfa'],
    'astonmartin': ['aston', 'am'],
    'lamborghini': ['lambo'],
    'rollsroyce': ['rolls', 'rr'],
    'landrover': ['lr'],
    'austinhealey': ['healey', 'austin'],
    'detomaso': ['tomaso'],
    'mini': ['austin', 'morris', 'austinmini', 'morrismini', 'bmc'],
    'dsautomobiles': ['ds', 'citroen'],
    'datsun': ['nissan'],
    'autozam': ['mazda'],
    'shelby': ['ac', 'acshelby'],
    'hummer': ['amgeneral'],
    'gmc': ['hummer'],
    'oldsmobile': ['olds'],
    'pontiac': [],
    'cadillac': ['caddy', 'caddi'],
    'mitsubishi': ['mitsu', 'mitsi'],
    'porsche': [],
    'ferrari': [],
    'mclaren': [],
    'chrysler': [],
    'plymouth': [],
    'jaguar': ['jag'],
    'lancia': [],
    'citroen': [],
    'renault': [],
    'peugeot': [],
    'hennessey': ['hennessy', 'hennesseyperformance'],
    'ssc': ['sscnorthamerica', 'shelbysupercars'],
    'trabant': [],
    'maybach': ['mercedesmaybach'],
    'smart': [],
    'subaru': ['subie', 'scooby'],
    'toyota': ['yota'],
  };

  function levenshtein(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        cur.push(v);
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // Typo tolerance: never on anything containing digits (911 must not match 912).
  function allowedTypos(answer) {
    if (hasDigit(answer)) return 0;
    if (answer.length >= 9) return 2;
    if (answer.length >= 5) return 1;
    return 0;
  }
  function fuzzyEq(guess, answer) {
    if (guess === answer) return true;
    const cap = allowedTypos(answer);
    // Real typos almost never change the first letter, and requiring it stops
    // near-namesakes like "G-Class"/"E-Class" from matching each other.
    return cap > 0 && !hasDigit(guess) && guess[0] === answer[0] && levenshtein(guess, answer, cap) <= cap;
  }

  // Words too generic to earn "close" credit on their own.
  const GENERIC = new Set(['series', 'class', 'type', 'coupe', 'spider', 'spyder', 'sport', 'sports', 'gt', 's', 'r', 'the', 'model', 'turbo', 'ss', 'v8', 'convertible', 'roadster', 'sedan', 'car']);

  const TRIM = new Set(['rs', 'gts', 'gti', 'hf', 'srt', 'amg', 'base', 'gl', 'gls', 'lx', 'ex', 'si', 'vr', 'v6', 'v10', 'v12', 'awd', 'quattro', 'twin', 'gen', 'generation', 'mark', 'mk', 'facelift', 'edition', 'special', 'limited', 'hatch', 'hatchback', 'wagon', 'estate', 'avant', 'targa', 'cabriolet', 'cabrio', 'hardtop', 'fastback', 'nismo', 'spec', 'evo']);
  function isTrimWord(t) {
    return GENERIC.has(t) || TRIM.has(t) || isCode(t) || /^(mk|mark)?[ivx]{1,4}$/.test(t) || /^\d{1,2}$/.test(t);
  }

  function makeVariants(car) {
    const key = compact(car.make);
    return [key, ...(MAKE_ALIASES[key] || []), ...(car.makeAliases || [])].map(compact);
  }

  function matchMake(guess, car) {
    const g = compact(guess);
    if (!g) return false;
    const variants = makeVariants(car);
    if (variants.some(v => fuzzyEq(g, v))) return true;
    // "Toyota Supra" typed in the make box: accept if it starts with the make.
    const gt = tokens(guess);
    for (let n = 1; n < gt.length; n++) {
      const head = gt.slice(0, n).join('');
      if (variants.some(v => fuzzyEq(head, v))) return true;
    }
    return false;
  }

  // Strip any leading make words a player put in the model field ("Nissan Skyline").
  function stripMake(guessTokens, car) {
    const variants = makeVariants(car);
    for (let n = Math.min(3, guessTokens.length - 1); n >= 1; n--) {
      const head = guessTokens.slice(0, n).join('');
      if (variants.some(v => fuzzyEq(head, v))) return guessTokens.slice(n);
    }
    return guessTokens;
  }

  function tokenIn(t, list) { return list.some(a => fuzzyEq(t, a)); }

  // Compare one guess against one accepted model name. Returns 'full' | 'close' | null.
  function compareModel(gt, name) {
    const at = tokens(name);
    if (!at.length || !gt.length) return null;
    if (gt.join('') === at.join('')) return 'full';
    if (fuzzyEq(gt.join(''), at.join(''))) return 'full';

    const allAnswerInGuess = at.every(a => tokenIn(a, gt));
    const extras = gt.filter(g => !tokenIn(g, at));
    // Guess covers the whole name plus up to two trim/generation words ("Supra MK4",
    // "911 Turbo"). Extras must be trim-like so "Supra 911" can't hedge two cars.
    if (allAnswerInGuess && extras.length <= 2 && extras.every(isTrimWord)) return 'full';

    const allGuessInAnswer = gt.every(g => tokenIn(g, at));
    if (allGuessInAnswer) {
      // A chassis/generation code is the car's identity: "R34", "E30", "AE86", "C8".
      const codes = at.filter(isCode);
      if (codes.length && codes.every(c => gt.includes(c))) return 'full';
    }
    // Right family, wrong or missing trim/generation ("Skyline" for "Skyline GT-R R34",
    // "Skyline R32" for an R34). Generic words like "Series" or "GT" alone don't count.
    const shared = gt.filter(g => !GENERIC.has(g) && tokenIn(g, at));
    if (shared.length) return 'close';
    return null;
  }

  function matchModel(guess, car) {
    const raw = tokens(guess);
    if (!raw.length) return null;
    // Try both as typed and with a leading make removed: "Hummer EV" is a GMC model
    // whose name starts with a make alias, while "Nissan Skyline" needs stripping.
    const stripped = stripMake(raw, car);
    const candidates = stripped.length && stripped.length !== raw.length ? [raw, stripped] : [raw];
    const names = [car.model, ...(car.modelAliases || [])];
    // A generation code that belongs to a different car ("Corvette C8" for a C3)
    // caps the answer at "close" even if the rest of the name matches.
    const carCodes = new Set(names.flatMap(n => tokens(n).filter(isCode)));
    const wrongCode = carCodes.size > 0 && raw.some(t => isCode(t) && !carCodes.has(t));
    let best = null;
    for (const gt of candidates) {
      for (const n of names) {
        const r = compareModel(gt, n);
        if (r === 'full' && !wrongCode) return 'full';
        if (r) best = 'close';
      }
    }
    return best;
  }

  // "1994", "94", "'94" -> 1994. Two-digit years pivot on the current year.
  function parseYear(raw, now) {
    const s = String(raw == null ? '' : raw).trim().replace(/^['’]/, '');
    if (!/^\d{2}$|^\d{4}$/.test(s)) return NaN;
    let y = parseInt(s, 10);
    if (s.length === 2) {
      const pivot = ((now || new Date()).getFullYear() % 100) + 1;
      y += y <= pivot ? 2000 : 1900;
    }
    return y;
  }

  function scoreGuess(car, makeGuess, modelGuess, yearGuess) {
    const res = [];
    let pts = 0;
    const mg = String(makeGuess == null ? '' : makeGuess).trim();
    const mo = String(modelGuess == null ? '' : modelGuess).trim();
    const yr = String(yearGuess == null ? '' : yearGuess).trim();

    if (mg) {
      const hit = matchMake(mg, car);
      const p = hit ? POINTS.make : 0;
      pts += p;
      res.push({ label: 'Make', detail: car.make, verdict: hit ? 'hit' : 'miss', pts: p });
    }
    if (mo) {
      const m = matchModel(mo, car);
      const p = m === 'full' ? POINTS.model : m === 'close' ? POINTS.modelClose : 0;
      pts += p;
      res.push({ label: 'Model', detail: car.model, verdict: m === 'full' ? 'hit' : m === 'close' ? 'close' : 'miss', pts: p });
    }
    if (yr) {
      const yg = parseYear(yr);
      let p = 0, verdict = 'miss', detail = String(car.year);
      // Long production runs carry a yearRange: any year inside it is exact.
      const [lo, hi] = Array.isArray(car.yearRange) ? car.yearRange : [car.year, car.year];
      if (lo !== hi) detail = `${lo}–${hi}`;
      if (!isNaN(yg)) {
        const df = yg < lo ? lo - yg : yg > hi ? yg - hi : 0;
        if (df === 0) { p = POINTS.yearExact; verdict = 'hit'; }
        else if (df <= YEAR_NEAR) { p = POINTS.yearNear; verdict = 'close'; detail = `${detail} (off by ${df})`; }
        else detail = `${detail} (off by ${df})`;
      } else detail = `${detail} (not a year)`;
      pts += p;
      res.push({ label: 'Year', detail, verdict, pts: p });
    }
    return { pts, res, max: MAX_PER_CAR };
  }

  function matchKit(guess, car) {
    let gt = tokens(guess);
    if (!gt.length || !car.kit) return false;
    const names = [car.kit, ...(car.kitAliases || [])];
    const g = gt.join('');
    if (names.some(n => fuzzyEq(g, compact(n)))) return true;
    // "Liberty Walk Huracan" — kit name followed by extra words.
    return names.some(n => {
      const at = tokens(n);
      return at.length && at.every(a => tokenIn(a, gt)) && gt.length - at.length <= 3;
    });
  }

  function scoreKit(car, kitGuess) {
    const kg = String(kitGuess == null ? '' : kitGuess).trim();
    if (!kg) return { pts: 0, res: [{ label: 'Kit', detail: car.kit, verdict: 'miss', pts: 0 }], max: POINTS.kit };
    const hit = matchKit(kg, car);
    const p = hit ? POINTS.kit : 0;
    return { pts: p, res: [{ label: 'Kit', detail: car.kit, verdict: hit ? 'hit' : 'miss', pts: p }], max: POINTS.kit };
  }

  // Score whichever shape of guess matches the mode.
  function scoreRound(car, mode, guess) {
    const g = guess || {};
    return mode === 'kit' ? scoreKit(car, g.kit) : scoreGuess(car, g.make, g.model, g.year);
  }

  function maxForMode(mode) { return mode === 'kit' ? POINTS.kit : MAX_PER_CAR; }

  return { POINTS, MAX_PER_CAR, scoreGuess, scoreKit, scoreRound, maxForMode, matchMake, matchModel, matchKit, parseYear, compact, tokens };
});
