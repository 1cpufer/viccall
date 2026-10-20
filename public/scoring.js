/*
 * VicCall answer scoring. One source of truth shared by the browser and the
 * server (solo sessions, party rooms, leaderboards). UMD so both can load it.
 *
 * Every car is worth 10 points.
 *   Car rounds:  Make 2 · Model 5 (3 if the model is right but the trim or
 *                generation is missing/wrong) · Year 3 (partial credit for near
 *                misses, see RULES).
 *   Kit rounds:  Tuner 6 · Make 2 · Model 2 (1 if the trim is missing).
 *
 * Two rulesets:
 *   casual       Forgives one-letter typos in long words and gives year credit
 *                within 5 years. Used by Free Play.
 *   competitive  Exact names only (aliases, codes, accents and punctuation are
 *                still fine) and year credit only within 2 years.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VCScore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = 10;
  const POINTS = {
    car: { make: 2, model: 5, modelPartial: 3, year: 3 },
    kit: { kit: 6, make: 2, model: 2, modelPartial: 1 },
  };
  const RULES = {
    casual: { typos: true, yearTiers: [[0, 3], [2, 2], [5, 1]] },
    competitive: { typos: false, yearTiers: [[0, 3], [2, 1]] },
  };
  const rulesFor = name => RULES[name] || RULES.casual;

  // Lowercase, strip accents, drop joining punctuation so "GT-R" == "GTR", "RX-7" == "RX7".
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[★'’.\-]/g, '')
      .replace(/&/g, ' and ');
  }
  const compact = s => norm(s).replace(/[^a-z0-9]/g, '');
  const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
  const hasDigit = t => /\d/.test(t);
  const isCode = t => /[a-z]/.test(t) && /\d/.test(t); // R34, E30, AE86, C8, G82

  // Names players actually type. Keys and values are compared after compact().
  const MAKE_ALIASES = {
    volkswagen: ['vw', 'volks', 'vdub'],
    chevrolet: ['chevy'],
    mercedesbenz: ['mercedes', 'benz', 'merc', 'mb', 'mercedesamg', 'amg'],
    bmw: ['bimmer', 'beemer'],
    alfaromeo: ['alfa'],
    astonmartin: ['aston'],
    lamborghini: ['lambo'],
    rollsroyce: ['rolls', 'rr'],
    landrover: ['lr'],
    austinhealey: ['healey', 'austin'],
    detomaso: ['tomaso'],
    mini: ['austin', 'morris', 'bmc'],
    dsautomobiles: ['ds', 'citroen'],
    datsun: ['nissan'],
    autozam: ['mazda'],
    shelby: ['ac'],
    hummer: ['amgeneral'],
    gmc: ['hummer'],
    oldsmobile: ['olds'],
    cadillac: ['caddy'],
    jaguar: ['jag'],
    hennessey: ['hennessy'],
    maybach: ['mercedesmaybach'],
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

  // Equality, plus (casual only) one typo in a word of 6+ letters with the same
  // first letter. Never on anything containing digits: 911 must not match 912.
  function same(guess, answer, rules) {
    if (guess === answer) return true;
    if (!rules.typos || hasDigit(answer) || hasDigit(guess) || answer.length < 6) return false;
    return guess[0] === answer[0] && levenshtein(guess, answer, 1) <= 1;
  }
  const tokenIn = (t, list, rules) => list.some(a => same(t, a, rules));

  // Words too generic to earn credit on their own.
  const GENERIC = new Set(['series', 'class', 'type', 'coupe', 'spider', 'spyder', 'sport', 'sports', 'gt', 's', 'r', 'the', 'model', 'turbo', 'ss', 'v8', 'convertible', 'roadster', 'sedan', 'car', 'new', 'old']);
  // Trim / body words that may follow a correct model without making it wrong.
  const TRIM = new Set(['rs', 'gts', 'gti', 'hf', 'srt', 'amg', 'base', 'si', 'vr', 'v6', 'v10', 'v12', 'awd', 'quattro', 'twin', 'gen', 'generation', 'mark', 'mk', 'facelift', 'edition', 'special', 'limited', 'hatch', 'hatchback', 'wagon', 'estate', 'avant', 'targa', 'cabriolet', 'cabrio', 'hardtop', 'fastback', 'nismo', 'spec', 'evo', 'competition', 'performance', 'plus']);
  const isTrimLike = t => GENERIC.has(t) || TRIM.has(t) || isCode(t) || /^(mk|mark)?[ivx]{1,4}$/.test(t) || /^\d{1,2}$/.test(t);
  // A token specific enough that sharing it shows real recognition.
  const isSignificant = t => !GENERIC.has(t) && !TRIM.has(t) && (t.length >= 3 || isCode(t) || /^\d{2,}$/.test(t));

  function makeVariants(car) {
    const key = compact(car.make);
    return [key, ...(MAKE_ALIASES[key] || []), ...(car.makeAliases || [])].map(compact);
  }

  function matchMake(guess, car, rules = RULES.casual) {
    const g = compact(guess);
    if (!g) return false;
    const variants = makeVariants(car);
    if (variants.some(v => same(g, v, rules))) return true;
    // "Toyota Supra" typed in the make box: the leading words must be the make.
    const gt = tokens(guess);
    for (let n = 1; n < gt.length; n++) {
      const head = gt.slice(0, n).join('');
      if (variants.some(v => same(head, v, rules))) return true;
    }
    return false;
  }

  // Strip leading make words a player put in the model box ("Nissan Skyline").
  function stripMake(gt, car, rules) {
    const variants = makeVariants(car);
    for (let n = Math.min(3, gt.length - 1); n >= 1; n--) {
      const head = gt.slice(0, n).join('');
      if (variants.some(v => same(head, v, rules))) return gt.slice(n);
    }
    return gt;
  }

  // Compare guess tokens with one accepted name: 'full' | 'partial' | null.
  function compareName(gt, name, rules) {
    const at = tokens(name);
    if (!at.length || !gt.length) return null;
    if (gt.join('') === at.join('') || (rules.typos && same(gt.join(''), at.join(''), rules))) return 'full';
    const inAnswer = g => tokenIn(g, at, rules);
    const extras = gt.filter(g => !inAnswer(g));
    // Whole name present plus up to two trim words: "Supra MK4", "911 Turbo".
    if (at.every(a => tokenIn(a, gt, rules)) && extras.length <= 2 && extras.every(isTrimLike)) return 'full';
    // A chassis code alone identifies the car: "R34", "E30", "AE86".
    const codes = at.filter(isCode);
    if (!extras.length && codes.length && codes.every(c => gt.includes(c))) return 'full';
    // Right family, missing or wrong trim: shares a specific word, and anything
    // else typed is trim-like. "Skyline Supra Civic" can't fish for credit.
    if (gt.some(g => inAnswer(g) && isSignificant(g)) && extras.every(isTrimLike)) return 'partial';
    return null;
  }

  function variantHit(gt, car, rules) {
    const names = [car.variant, ...(car.variantAliases || [])].filter(Boolean);
    return names.some(n => { const vt = tokens(n); return vt.length && vt.every(v => tokenIn(v, gt, rules)); });
  }

  /*
   * Model match. Returns { level: 'full' | 'partial' | null, why }.
   * Cars may split a name into model + variant ("M4" + "Competition"): the
   * model earns partial credit, model + variant earns full credit.
   */
  function matchModel(guess, car, rules = RULES.casual) {
    const raw = tokens(guess);
    if (!raw.length) return { level: null, why: 'wrong' };
    const stripped = stripMake(raw, car, rules);
    const candidates = stripped.length && stripped.length !== raw.length ? [raw, stripped] : [raw];
    const names = [car.model, ...(car.modelAliases || [])];
    const variantTokens = new Set([car.variant, ...(car.variantAliases || [])].filter(Boolean).flatMap(tokens));
    const carCodes = new Set([...names, car.variant, ...(car.variantAliases || [])].filter(Boolean).flatMap(n => tokens(n).filter(isCode)));
    // A code from another car ("Corvette C8" for a C3) caps the answer at partial.
    const wrongCode = raw.some(t => isCode(t) && !carCodes.has(t));

    let best = null;
    for (const gt of candidates) {
      const base = gt.filter(t => !variantTokens.has(t));
      for (const n of names) {
        const r = compareName(base.length ? base : gt, n, rules);
        if (!r) continue;
        if (r === 'full' && !wrongCode) {
          if (!car.variant || variantHit(gt, car, rules)) return { level: 'full', why: 'exact' };
          best = { level: 'partial', why: 'variant' };
        } else if (!best) best = { level: 'partial', why: wrongCode ? 'generation' : 'family' };
      }
    }
    return best || { level: null, why: 'wrong' };
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

  const fullModel = car => [car.model, car.variant].filter(Boolean).join(' ');
  const yearSpan = car => {
    const [lo, hi] = Array.isArray(car.yearRange) ? car.yearRange : [car.year, car.year];
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };
  const str = v => String(v == null ? '' : v).trim();

  function scoreMake(car, guess, rules, pts) {
    const hit = matchMake(guess, car, rules);
    return { label: 'Make', verdict: hit ? 'hit' : 'miss', pts: hit ? pts : 0, max: pts, note: hit ? car.make : `It's ${car.make}` };
  }

  function scoreModel(car, guess, rules, full, part) {
    const m = matchModel(guess, car, rules);
    const name = fullModel(car);
    if (m.level === 'full') return { label: 'Model', verdict: 'hit', pts: full, max: full, note: name };
    if (m.level === 'partial') {
      const note = m.why === 'variant' ? `Right model, missed the ${car.variantKind || 'trim'}: ${car.variant}`
        : m.why === 'generation' ? `Right family, wrong generation: ${name}`
        : `Close: it's the ${name}`;
      return { label: 'Model', verdict: 'close', pts: part, max: full, note };
    }
    return { label: 'Model', verdict: 'miss', pts: 0, max: full, note: `It's the ${name}` };
  }

  function scoreYear(car, guess, rules) {
    const yg = parseYear(guess);
    const [lo, hi] = Array.isArray(car.yearRange) ? car.yearRange : [car.year, car.year];
    const span = yearSpan(car);
    const max = POINTS.car.year;
    if (isNaN(yg)) return { label: 'Year', verdict: 'miss', pts: 0, max, note: `Not a year. It's ${span}` };
    const off = yg < lo ? lo - yg : yg > hi ? yg - hi : 0;
    const tier = rules.yearTiers.find(([within]) => off <= within);
    const pts = tier ? tier[1] : 0;
    if (off === 0) return { label: 'Year', verdict: 'hit', pts, max, note: span };
    return { label: 'Year', verdict: pts ? 'close' : 'miss', pts, max, note: `Off by ${off} (${span})` };
  }

  function matchKit(guess, car, rules = RULES.casual) {
    const gt = tokens(guess);
    if (!gt.length || !car.kit) return false;
    const names = [car.kit, ...(car.kitAliases || [])];
    if (names.some(n => same(gt.join(''), compact(n), rules))) return true;
    // "Liberty Walk Huracan": the tuner name plus a few words about the car.
    return names.some(n => {
      const at = tokens(n);
      return at.length && at.every(a => tokenIn(a, gt, rules)) && gt.length - at.length <= 3;
    });
  }

  /*
   * Score one round. guess: { make, model, year, kit }.
   * opts.ruleset: 'casual' | 'competitive'. opts.kind: 'car' | 'kit'.
   * Returns { pts, max, res: [{ label, verdict, pts, max, note }], identified, perfect }.
   * Blank boxes are listed as skipped so the reveal can show what was missed.
   */
  function scoreRound(car, guess, opts = {}) {
    const g = guess || {};
    const rules = rulesFor(opts.ruleset);
    const kind = opts.kind || (car.kit && opts.mode === 'kit' ? 'kit' : 'car');
    const res = [];
    const skip = (label, max, note) => res.push({ label, verdict: 'skip', pts: 0, max, note });

    if (kind === 'kit') {
      const P = POINTS.kit;
      const kg = str(g.kit);
      if (kg) {
        const hit = matchKit(kg, car, rules);
        res.push({ label: 'Tuner', verdict: hit ? 'hit' : 'miss', pts: hit ? P.kit : 0, max: P.kit, note: hit ? car.kit : `It's ${car.kit}` });
      } else skip('Tuner', P.kit, `It's ${car.kit}`);
      if (str(g.make)) res.push(scoreMake(car, str(g.make), rules, P.make)); else skip('Make', P.make, car.make);
      if (str(g.model)) res.push(scoreModel(car, str(g.model), rules, P.model, P.modelPartial)); else skip('Model', P.model, fullModel(car));
    } else {
      const P = POINTS.car;
      if (str(g.make)) res.push(scoreMake(car, str(g.make), rules, P.make)); else skip('Make', P.make, car.make);
      if (str(g.model)) res.push(scoreModel(car, str(g.model), rules, P.model, P.modelPartial)); else skip('Model', P.model, fullModel(car));
      if (str(g.year)) res.push(scoreYear(car, str(g.year), rules)); else skip('Year', P.year, yearSpan(car));
    }
    const pts = res.reduce((s, r) => s + r.pts, 0);
    const hit = l => res.some(r => r.label === l && r.verdict === 'hit');
    const identified = kind === 'kit' ? hit('Tuner') : hit('Make') && hit('Model');
    return { pts, max: MAX, res, identified, perfect: pts === MAX };
  }

  return { MAX, POINTS, RULES, scoreRound, matchMake, matchModel, matchKit, parseYear, compact, tokens, fullModel, yearSpan };
});
