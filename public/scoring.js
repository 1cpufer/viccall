/*
 * VicCall answer recognition and scoring. Server-authoritative; UMD so it can
 * also load in a browser.
 *
 * Every car is worth 10 points.
 *   Car rounds:  Make 2, Model 5, Year 3.
 *   Kit rounds:  Tuner 6, Make 2, Model 2.
 *
 * How an answer is understood
 * ---------------------------
 * The whole database is indexed into vehicle identities (make + model + trim),
 * each with verified names: the canonical name, curated aliases and chassis
 * codes. An answer such as "918", "GT3 RS", "Porsche 918 Spyder" or
 * "Skyline R34" is resolved against that index, the way an enthusiast would
 * read it:
 *
 *   - Words that identify a car (918, Skyline, R34, GT3, SVJ) may be left out
 *     as long as what's left still points to exactly one vehicle.
 *     "918" is the 918 Spyder; "SVJ" is the Aventador SVJ.
 *   - Qualifying words (trims, designations, generation marks: RS, Competition,
 *     Nismo, Type R, Mk4) can't be left out, because they separate real cars:
 *     "GT3" is not a GT3 RS, "M4" is not an M4 Competition.
 *   - Designations alone (Spyder, RS, Nismo, Quadrifoglio) never identify a
 *     car. They earn a small hint credit when they are part of the right name.
 *   - When an answer fits several vehicles ("Supra": Mk4 or Mk5; "Skyline":
 *     R32, R33 or R34) it earns partial credit and the feedback says which.
 *   - Naming two cars at once ("Civic Integra") earns nothing for the model.
 *   - Words the database doesn't know are ignored. They can't help a guess:
 *     a car outside the database is never the answer.
 *   - The make is credited when stated, or when the model alone implies it
 *     ("918" means Porsche).
 *
 * Two rule sets, same recognition:
 *   casual       forgives one typo in words of 6+ letters; year credit within 5.
 *   competitive  no typos; year credit within 2.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VCScore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = 10;
  const POINTS = {
    car: { make: 2, model: 5, modelPartial: 3, modelHint: 1, year: 3 },
    kit: { kit: 6, make: 2, model: 2, modelPartial: 1, modelHint: 0 },
  };
  const RULES = {
    casual: { typos: true, yearTiers: [[0, 3], [2, 2], [5, 1]] },
    competitive: { typos: false, yearTiers: [[0, 3], [2, 1]] },
  };
  const rulesFor = name => RULES[name] || RULES.casual;

  // ---------------------------------------------------------------- normalising

  // Lowercase, strip accents, drop joining punctuation so "GT-R" == "GTR", "RX-7" == "RX7".
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[★'’.\-]/g, '')
      .replace(/&/g, ' and ');
  }
  const compact = s => norm(s).replace(/[^a-z0-9]/g, '');
  const rawTokens = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

  const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  // Harmless spelling differences. Generation marks all become genN: Mk4 = MkIV = Mark 4 = IV.
  function canon(t) {
    if (t === 'spider') return 'spyder';
    if (t === 'cabrio') return 'cabriolet';
    if (t === 'comp') return 'competition';
    let m = /^(?:mk|mark)(\d{1,2})$/.exec(t);
    if (m) return `gen${Number(m[1])}`;
    m = /^(?:mk|mark)([ivx]{1,4})$/.exec(t);
    if (m && ROMAN[m[1]]) return `gen${ROMAN[m[1]]}`;
    if (ROMAN[t]) return `gen${ROMAN[t]}`;
    return t;
  }
  function tokens(s) {
    const raw = rawTokens(s);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      let t = raw[i];
      if ((t === 'mk' || t === 'mark') && i + 1 < raw.length && (/^\d{1,2}$/.test(raw[i + 1]) || ROMAN[raw[i + 1]])) t += raw[++i];
      out.push(canon(t));
    }
    return out;
  }
  const isMarker = t => /^gen\d+$/.test(t);
  const isCode = t => /[a-z]/.test(t) && /\d/.test(t) && !isMarker(t); // R34, E30, AE86, G82
  const hasDigit = t => /\d/.test(t);

  // Designations: describe a car without identifying it. They never count as
  // identifying on their own, and can't be dropped from a name that has them.
  const GENERIC = new Set([
    'spyder', 'coupe', 'convertible', 'cabriolet', 'roadster', 'targa', 'sedan', 'saloon', 'wagon', 'estate', 'avant',
    'touring', 'hatch', 'hatchback', 'fastback', 'hardtop', 'shooting', 'brake',
    'gt', 'gts', 'gti', 'rs', 'r', 's', 'sport', 'sports', 'turbo', 'competition', 'performance', 'nismo', 'amg', 'gr',
    'type', 'spec', 'quadrifoglio', 'qv', 'black', 'series', 'class',
    'edition', 'special', 'limited', 'base', 'plus', 'the', 'a', 'model', 'car', 'new', 'old', 'si', 'srt', 'ss', 'hf',
    'vr', 'v6', 'v8', 'v10', 'v12', 'awd', 'quattro', 'twin', 'facelift', 'and', 'classic',
  ]);
  const NOISE = new Set(['the', 'a', 'and', 'car', 'model', 'new', 'old']);

  // Names players actually type for makes. Keys and values are compared after compact().
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

  // ---------------------------------------------------------------- the index

  const fullModel = car => [car.model, car.variant].filter(Boolean).join(' ');
  const yearSpan = car => {
    const [lo, hi] = Array.isArray(car.yearRange) ? car.yearRange : [car.year, car.year];
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };
  // One vehicle = make + model + trim + generation. A stock car and the same car
  // under a body kit share an identity; an E46 M3 and a G80 M3 don't.
  const identityKey = car => `${compact(car.make)}|${compact(fullModel(car))}|${compact(car.generation || '')}`;
  const makeKeysOf = car => [compact(car.make), ...(MAKE_ALIASES[compact(car.make)] || []), ...(car.makeAliases || []).map(compact)];

  // A name may contain the make ("Nissan Z", "Mustang Shelby GT500" for a Ford
  // also badged Shelby). Make words aren't part of the model.
  function stripOwnMake(ts, car) {
    const keys = new Set(makeKeysOf(car));
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      let n = 0;
      for (let k = Math.min(3, ts.length - i); k >= 1 && !n; k--) {
        const span = ts.slice(i, i + k);
        if (keys.has(span.join('')) && !span.every(t => GENERIC.has(t))) n = k;
      }
      if (n) i += n - 1; else out.push(ts[i]);
    }
    return out.length ? out : ts;
  }

  // Exact names (identify this vehicle) and family names (the model without its trim).
  // Each exact name lists the words that can't be left out: designations,
  // generation marks and the trim. Other words may be dropped if what's left is
  // still unique ("918" for the 918 Spyder, "SVJ" for the Aventador SVJ).
  const qualWords = ts => ts.filter(t => GENERIC.has(t) || isMarker(t));
  function namesOf(car) {
    const exact = [], family = [];
    const base = [car.model, ...(car.modelAliases || [])].filter(Boolean).map(m => stripOwnMake(tokens(m), car));
    // Generation codes ("E46", "992", "S15", "Mk4") can be added to any model name, or stand alone.
    const gens = [car.generation, ...(car.generationAliases || [])].filter(Boolean).map(g => stripOwnMake(tokens(g), car));
    const join = (a, b) => [...a, ...b.filter(x => !a.includes(x))];
    const models = [...base];
    for (const g of gens) {
      for (const m of base) if (!g.every(x => m.includes(x))) models.push(join(m, g), join(g, m));
      if (g.some(t => !GENERIC.has(t) && !isMarker(t))) models.push(g);
    }
    if (car.variant) {
      const variants = [car.variant, ...(car.variantAliases || [])].map(v => stripOwnMake(tokens(v), car));
      const vt = variants[0];
      const modelIdent = new Set(models.flat().filter(t => !GENERIC.has(t) && !isMarker(t)));
      for (const mt of models) {
        if (vt.every(v => mt.includes(v))) { exact.push({ t: mt, req: new Set([...qualWords(mt), ...vt]) }); continue; }
        family.push(mt);
        for (const v of variants) exact.push({ t: join(mt, v), req: new Set([...qualWords(mt), ...v]) });
      }
      // A trim alias that already names the model ("Nismo GT-R") stands on its own.
      for (const v of variants.slice(1)) {
        if (v.some(x => modelIdent.has(x))) exact.push({ t: v, req: new Set([...qualWords(v), ...v.filter(x => !modelIdent.has(x))]) });
      }
    } else {
      models.forEach(mt => exact.push({ t: mt, req: new Set(qualWords(mt)) }));
    }
    return { exact, family };
  }

  const indexCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  /*
   * Build the vehicle index from the car list. Entries with the same make and
   * full model (a stock car and the same car under a body kit) are one identity.
   */
  function buildIndex(cars) {
    if (indexCache && indexCache.has(cars)) return indexCache.get(cars);
    const ids = new Map();
    const makes = new Map(); // compact make or alias -> Set(canonical compact make)
    for (const car of cars) {
      const key = identityKey(car);
      let id = ids.get(key);
      if (!id) {
        id = { key, make: car.make, makeKey: compact(car.make), model: fullModel(car), variant: car.variant || null, generation: car.generation || null, exact: [], family: [], lo: Infinity, hi: -Infinity, cars: [] };
        ids.set(key, id);
      }
      const n = namesOf(car);
      id.exact.push(...n.exact);
      id.family.push(...n.family);
      const [lo, hi] = Array.isArray(car.yearRange) ? car.yearRange : [car.year, car.year];
      id.lo = Math.min(id.lo, lo);
      id.hi = Math.max(id.hi, hi);
      id.cars.push(car.id);
      for (const mk of makeKeysOf(car)) {
        if (!makes.has(mk)) makes.set(mk, new Set());
        makes.get(mk).add(compact(car.make));
      }
    }
    const vocab = new Set();
    const byToken = new Map();
    for (const id of ids.values()) {
      const dedupe = (list, key) => [...new Map(list.map(x => [key(x), x])).values()];
      id.exact = dedupe(id.exact, n => `${n.t.join(' ')}|${[...n.req].sort().join(' ')}`);
      id.family = dedupe(id.family, t => t.join(' '));
      id.tokens = new Set([...id.exact.map(n => n.t), ...id.family].flat());
      id.ident = new Set([...id.tokens].filter(t => !GENERIC.has(t) && !isMarker(t)));
      id.markers = new Set([...id.tokens].filter(isMarker));
      for (const t of id.tokens) {
        vocab.add(t);
        if (!byToken.has(t)) byToken.set(t, new Set());
        byToken.get(t).add(id);
      }
    }
    const index = { ids, makes, vocab, byToken, vocabList: [...vocab] };
    if (indexCache) indexCache.set(cars, index);
    return index;
  }

  // ---------------------------------------------------------------- reading an answer

  const known = (index, t) => index.vocab.has(t) || GENERIC.has(t);

  // Join split words ("GT 3", "R 34", "LP 770-4") and split joined ones ("918Spyder", "TypeR").
  function reshape(ts, index) {
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      let merged = false;
      for (let n = 3; n >= 2 && !merged; n--) {
        if (i + n > ts.length) continue;
        const joined = ts.slice(i, i + n).join('');
        if (index.vocab.has(joined) && !ts.slice(i, i + n).every(t => index.vocab.has(t) && !GENERIC.has(t))) {
          out.push(joined); i += n - 1; merged = true;
        }
      }
      if (merged) continue;
      const t = ts[i];
      if (!known(index, t) && !index.makes.has(t) && t.length > 3) {
        let split = null;
        for (let k = 1; k < t.length && !split; k++) {
          const a = canon(t.slice(0, k)), b = canon(t.slice(k));
          if (known(index, a) && known(index, b) && (a.length > 1 || b.length > 1)) split = [a, b];
        }
        if (split) { out.push(...split); continue; }
      }
      out.push(t);
    }
    return out;
  }

  // Casual rules: map a one-typo word onto the single known word it matches.
  function fixTypos(ts, index, rules) {
    if (!rules.typos) return ts;
    return ts.map(t => {
      if (known(index, t) || index.makes.has(t)) return t;
      const hits = index.vocabList.filter(v => same(t, v, rules));
      return hits.length === 1 ? hits[0] : t;
    });
  }

  /*
   * Split an answer into the makes it states and the model words left over.
   * Make spans may be one to three words ("Alfa Romeo", "Aston Martin").
   * A word that is both a make and part of a model name (Shelby, AMG) stays a
   * model word; it only counts as a stated make when it is the right make.
   */
  // mode 'make': every make word is a make. mode 'model': make words that are
  // also model words ("Alpine" in "Renault Alpine A110", "Hummer" in "Hummer EV")
  // stay model words. understand() tries both and keeps the better reading.
  function readAnswer(text, index, rules, mode = 'make') {
    let ts = fixTypos(reshape(tokens(text), index), index, rules);
    const makeSpans = [];
    const used = new Array(ts.length).fill(false);
    for (let i = 0; i < ts.length; i++) {
      for (let n = Math.min(3, ts.length - i); n >= 1; n--) {
        const span = ts.slice(i, i + n);
        let key = span.join('');
        if (!index.makes.has(key) && rules.typos && n === 1 && !known(index, key)) {
          const near = [...index.makes.keys()].filter(k => same(key, k, rules));
          if (near.length === 1) key = near[0];
        }
        if (index.makes.has(key)) {
          const canModel = span.every(t => index.vocab.has(t));
          const soft = mode === 'model' && canModel;
          makeSpans.push({ key, makes: index.makes.get(key), soft, canModel, at: i, n });
          if (!soft) for (let k = i; k < i + n; k++) used[k] = true;
          i += n - 1;
          break;
        }
      }
    }
    const model = ts.filter((t, i) => !used[i]);
    const ident = model.filter(t => index.vocab.has(t) && !GENERIC.has(t) && !isMarker(t));
    const markers = model.filter(isMarker);
    const unknown = model.filter(t => !known(index, t) && !isMarker(t) && !NOISE.has(t));
    return { all: ts, model, ident: [...new Set(ident)], markers, unknown, makeSpans };
  }

  // ---------------------------------------------------------------- resolving

  // Does an exact name fit the answer? Every identifying word in the answer must
  // belong to the name, and the name's required words must all be there. Short
  // numbers and single letters ("10", "Z") can't identify a car on their own.
  const isWeak = t => /^\d{1,2}$/.test(t) || t.length === 1;
  function fits(name, ans, opts = {}) {
    const words = new Set(ans.all);
    const nameIdent = name.t.filter(t => !GENERIC.has(t) && !isMarker(t));
    if (!ans.ident.every(t => nameIdent.includes(t))) return null;
    if (![...name.req].every(t => words.has(t))) return null;
    if (!ans.ident.some(t => !isWeak(t)) && !opts.makeStated) return null;
    if (!ans.ident.length && nameIdent.length) return null;
    return {
      complete: nameIdent.every(t => ans.ident.includes(t)),
      cover: name.t.filter(t => words.has(t)).length,
    };
  }

  function bestFit(id, ans, opts) {
    let best = null;
    for (const name of id.exact) {
      const f = fits(name, ans, opts);
      if (f && (!best || f.cover > best.cover || (f.cover === best.cover && f.complete && !best.complete))) best = f;
    }
    return best;
  }

  const sameFamily = (a, b) => [...a.ident].some(t => b.ident.has(t));
  // "M3 (E46)", "Z" -> "Nissan Z", optionally with years.
  const label = (id, withYears) => {
    const name = id.model.length <= 2 ? `${id.make} ${id.model}` : id.model;
    const extra = [id.generation, withYears && !id.generation ? (id.lo === id.hi ? id.lo : `${id.lo}–${id.hi}`) : null].filter(Boolean);
    return extra.length ? `${name} (${extra.join(', ')})` : name;
  };
  const labelVs = (id, target, withYears) => (id.makeKey === target.makeKey ? label(id, withYears) : `${id.make} ${label(id, withYears)}`);
  const missedTrim = id => `Right model, missed the ${tokens(id.variant).every(isMarker) ? 'generation' : 'trim'}: ${id.variant}`;
  const listOf = items => (items.length <= 2 ? items.join(' or ') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

  /*
   * Resolve an answer against the target vehicle.
   * Returns { level: 'full'|'partial'|'hint'|null, why, note, impliedMake }
   *   why: exact | ambiguous | sibling | variant | incomplete | generation | hint | different | hedge | wrong
   */
  function resolve(car, ans, index, rules, makeStated) {
    const target = index.ids.get(identityKey(car)) || buildIndex([car]).ids.get(identityKey(car));
    const T = label(target);
    // A stated make narrows things down: "Pontiac GTO" isn't the Mitsubishi GTO.
    const stated = new Set(ans.makeSpans.filter(s => !s.soft).flatMap(s => [...s.makes]));
    const byMake = list => {
      if (!stated.size) return list;
      const kept = list.filter(x => stated.has((x.id || x).makeKey));
      return kept.length ? kept : list;
    };
    let cands = [];
    for (const id of index.ids.values()) {
      if (id.makeKey !== target.makeKey && !ans.ident.length) continue; // designation-only answers need the right make
      const f = bestFit(id, ans, { makeStated: makeStated && id.makeKey === target.makeKey });
      if (f) cands.push({ id, ...f });
    }
    cands = byMake(cands);
    // Which vehicles could the identifying words belong to at all?
    const holders = byMake(ans.ident.length ? [...index.ids.values()].filter(id => ans.ident.every(t => id.ident.has(t))) : []);
    const makesOf = list => [...new Set(list.map(x => (x.id || x).makeKey))];
    const implied = ms => (ms.length ? ms : null);

    // A generation mark or chassis code that isn't this car's caps the answer at partial.
    const wrongGen = ans.markers.some(m => !target.markers.has(m)) || ans.unknown.some(isCode);

    if (cands.length) {
      const top = Math.max(...cands.map(c => c.cover));
      let tier = cands.filter(c => c.cover === top);
      const complete = tier.filter(c => c.complete);
      if (complete.length === 1) tier = complete;
      const hasTarget = tier.some(c => c.id === target);
      const impliedMake = implied(makesOf(tier.length ? tier : cands));
      if (tier.length === 1 && hasTarget) {
        if (wrongGen) return { level: 'partial', why: 'generation', note: `Right family, wrong generation: it's the ${T}`, impliedMake };
        // A trim that belongs to a sibling ("911 Turbo S" words inside a GT3 RS answer) is a hedge on the trim.
        const sibTrim = [...index.ids.values()].some(id => id !== target && id.variant && sameFamily(id, target) &&
          tokens(id.variant).every(t => ans.all.includes(t)) && !tokens(id.variant).every(t => target.tokens.has(t)));
        if (sibTrim) return { level: 'partial', why: 'sibling', note: `Right model, wrong trim: it's the ${T}`, impliedMake };
        return { level: 'full', why: 'exact', note: T, impliedMake };
      }
      if (hasTarget) {
        const others = tier.filter(c => c.id !== target).map(c => c.id);
        return { level: 'partial', why: 'ambiguous', note: `That could be the ${listOf([target, ...others].map(id => labelVs(id, target, true)))}. This is the ${label(target, true)}`, impliedMake };
      }
      const ref = tier.length === 1 ? tier[0].id : null;
      if (tier.some(c => sameFamily(c.id, target))) {
        const variantOnly = ref && !ref.variant && !wrongGen && target.variant && target.family.some(n => n.every(t => ref.tokens.has(t)));
        const note = variantOnly ? missedTrim(target)
          : ref ? `${wrongGen ? 'Right family, wrong generation' : 'Close'}: that's the ${labelVs(ref, target, ref.model === target.model)}. This is the ${T}`
          : `Close: that could be the ${listOf(tier.map(c => labelVs(c.id, target, true)))}. This is the ${T}`;
        return { level: 'partial', why: variantOnly ? 'variant' : wrongGen ? 'generation' : 'sibling', note, impliedMake };
      }
      // Several generations of one other model ("911" for a 918): name the model once.
      const models = [...new Set(tier.map(c => labelVs({ ...c.id, generation: null }, target)))];
      if (ref || models.length === 1) return { level: null, why: 'different', note: `That's the ${ref ? labelVs(ref, target) : models[0]}, a different car. It's the ${T}`, impliedMake };
      return { level: null, why: 'different', note: `It's the ${T}`, impliedMake };
    }

    // Nothing fits as a full name. Is it the right car with words missing?
    if (ans.ident.length) {
      if (!holders.length) {
        return { level: null, why: 'hedge', note: `That names more than one car. It's the ${T}`, impliedMake: implied(makesOf([...new Set(ans.ident.flatMap(t => [...(index.byToken.get(t) || [])]))]) ) };
      }
      const impliedMake = implied(makesOf(holders));
      if (ans.ident.every(t => target.ident.has(t))) {
        if (wrongGen) return { level: 'partial', why: 'generation', note: `Right family, wrong generation: it's the ${T}`, impliedMake };
        const variantWords = target.variant ? tokens(target.variant) : [];
        const missingTrim = variantWords.length && !variantWords.every(t => ans.all.includes(t));
        const weakOnly = ans.ident.every(isWeak);
        const note = missingTrim ? missedTrim(target)
          : weakOnly ? `${ans.ident.join(' ').toUpperCase()} on its own is too short to pin down. It's the ${T}`
          : `Close: say the full name, the ${T}`;
        return { level: 'partial', why: missingTrim ? 'variant' : 'incomplete', note, impliedMake };
      }
      const fam = holders.filter(id => sameFamily(id, target));
      if (fam.length) return { level: 'partial', why: 'sibling', note: `Close: that's the ${labelVs(fam[0], target)}. This is the ${T}`, impliedMake };
      return { level: null, why: 'different', note: `That's the ${labelVs(holders[0], target)}, a different car. It's the ${T}`, impliedMake };
    }

    // Generic-only model name with the make stated: "Mercedes AMG GT" for an AMG GT Black Series.
    if (makeStated && target.variant && target.family.some(n => n.length && n.every(t => ans.all.includes(t)))) {
      return { level: 'partial', why: 'variant', note: missedTrim(target), impliedMake: null };
    }
    // Designations only ("Spyder", "Porsche Spyder"): right word, wrong level of detail.
    const quals = ans.model.filter(t => GENERIC.has(t) && !NOISE.has(t));
    if (quals.length && quals.some(t => target.tokens.has(t))) {
      const word = quals.find(t => target.tokens.has(t));
      const shown = word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1);
      return { level: 'hint', why: 'hint', note: `${shown} is part of it, but on its own it could be many cars. It's the ${T}`, impliedMake: null };
    }
    return { level: null, why: 'wrong', note: `It's the ${T}`, impliedMake: null };
  }

  // ---------------------------------------------------------------- scoring

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
  const str = v => String(v == null ? '' : v).trim();

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
    const gt = rawTokens(guess);
    if (!gt.length || !car.kit) return false;
    const names = [car.kit, ...(car.kitAliases || [])];
    if (names.some(n => same(gt.join(''), compact(n), rules))) return true;
    // "Liberty Walk Huracan": the tuner name plus a few words about the car.
    return names.some(n => {
      const at = rawTokens(n);
      return at.length && at.every(a => gt.some(g => same(g, a, rules))) && gt.length - at.length <= 3;
    });
  }
  // The tuner typed into the car box: return the text without it, or null.
  function takeKit(text, car, rules) {
    const gt = rawTokens(text);
    for (const n of [car.kit, ...(car.kitAliases || [])].filter(Boolean)) {
      const at = rawTokens(n);
      for (let i = 0; i + at.length <= gt.length; i++) {
        if (at.every((a, k) => same(gt[i + k], a, rules))) return [...gt.slice(0, i), ...gt.slice(i + at.length)].join(' ');
      }
    }
    return null;
  }

  // Make: stated (any make word in the answer) or implied by the model.
  function scoreMake(car, ans, res, rules, pts, index) {
    const targetKeys = makeKeysOf(car);
    const isTarget = k => targetKeys.some(t => same(k, t, rules));
    const hard = ans.makeSpans.filter(s => !s.soft);
    const soft = ans.makeSpans.filter(s => s.soft);
    if (hard.length) {
      const right = hard.some(s => isTarget(s.key) || s.makes.has(compact(car.make)));
      const wrong = hard.some(s => !(isTarget(s.key) || s.makes.has(compact(car.make))));
      if (right && !wrong) return { label: 'Make', verdict: 'hit', pts, max: pts, note: car.make };
      return { label: 'Make', verdict: 'miss', pts: 0, max: pts, note: right ? `Name one make. It's ${car.make}` : `It's ${car.make}` };
    }
    if (soft.some(s => isTarget(s.key) || s.makes.has(compact(car.make)))) return { label: 'Make', verdict: 'hit', pts, max: pts, note: car.make };
    // Implied by the model: every car the answer could mean has this make (Datsun counts as Nissan).
    const own = compact(car.make);
    const compatible = mk => mk === own || (index.makes.get(own) || new Set()).has(mk) || (index.makes.get(mk) || new Set()).has(own);
    if (res.impliedMake && res.impliedMake.length && res.impliedMake.every(compatible)) return { label: 'Make', verdict: 'hit', pts, max: pts, note: `${car.make}, from the model` };
    return { label: 'Make', verdict: 'miss', pts: 0, max: pts, note: `It's ${car.make}` };
  }

  function scoreModel(res, P) {
    const max = P.model;
    if (res.level === 'full') return { label: 'Model', verdict: 'hit', pts: max, max, note: res.note };
    if (res.level === 'partial') return { label: 'Model', verdict: 'close', pts: P.modelPartial, max, note: res.note };
    if (res.level === 'hint' && P.modelHint) return { label: 'Model', verdict: 'close', pts: P.modelHint, max, note: res.note };
    return { label: 'Model', verdict: 'miss', pts: 0, max, note: res.note };
  }

  /*
   * Understand an answer without scoring it (used by tests and feedback).
   * text: everything the player typed about the car ("Porsche 918 Spyder").
   */
  function understand(car, text, opts = {}) {
    const rules = rulesFor(opts.ruleset);
    const index = opts.index || buildIndex([car]);
    const targetKeys = makeKeysOf(car);
    const read = mode => {
      const ans = readAnswer(text, index, rules, mode);
      const makeStated = ans.makeSpans.some(s => targetKeys.some(t => same(s.key, t, rules)) || s.makes.has(compact(car.make)));
      return { ans, res: resolve(car, ans, index, rules, makeStated) };
    };
    const asMake = read('make');
    if (!asMake.ans.makeSpans.some(s => s.canModel)) return asMake;
    const asModel = read('model');
    const rank = r => ({ full: 3, partial: 2, hint: 1 }[r.level] || 0);
    return rank(asModel.res) > rank(asMake.res) ? asModel : asMake;
  }

  /*
   * Score one round.
   *   guess: { car, year, kit }  (or the older { make, model, year, kit })
   *   opts:  { ruleset: 'casual'|'competitive', kind: 'car'|'kit', index }
   * Returns { pts, max, res: [{ label, verdict, pts, max, note }], identified, perfect }.
   * Blank answers are listed as skipped so the reveal can show what was missed.
   */
  function scoreRound(car, guess, opts = {}) {
    const g = guess || {};
    const rules = rulesFor(opts.ruleset);
    const index = opts.index || buildIndex([car]);
    const kind = opts.kind || (car.kit && opts.mode === 'kit' ? 'kit' : 'car');
    const P = POINTS[kind];
    const out = [];
    const skip = (label, max, note) => out.push({ label, verdict: 'skip', pts: 0, max, note });
    let text = str(g.car) || [str(g.make), str(g.model)].filter(Boolean).join(' ');
    let yearText = str(g.year);

    if (kind === 'kit') {
      let kitText = str(g.kit);
      if (!kitText && text) { const rest = takeKit(text, car, rules); if (rest !== null) { kitText = car.kit; text = rest; } }
      else if (text) { const rest = takeKit(text, car, rules); if (rest !== null) text = rest; }
      if (kitText) {
        const hit = matchKit(kitText, car, rules);
        out.push({ label: 'Tuner', verdict: hit ? 'hit' : 'miss', pts: hit ? P.kit : 0, max: P.kit, note: hit ? car.kit : `It's ${car.kit}` });
      } else skip('Tuner', P.kit, `It's ${car.kit}`);
    }

    // A year typed into the car box ("1999 Skyline R34") counts when the year box is empty.
    if (!yearText && kind === 'car' && text) {
      const words = rawTokens(text);
      const y = words.find(w => /^(19|20)\d{2}$/.test(w) && !index.vocab.has(w));
      if (y) { yearText = y; text = words.filter(w => w !== y).join(' '); }
    }

    if (text) {
      const { ans, res } = understand(car, text, { ruleset: opts.ruleset, index });
      const nothing = !ans.ident.length && !ans.markers.length && !ans.model.some(t => GENERIC.has(t));
      out.push(scoreMake(car, ans, res, rules, P.make, index));
      if (nothing && ans.makeSpans.length) skip('Model', P.model, `It's the ${fullModel(car)}`);
      else out.push(scoreModel(res, P));
    } else {
      skip('Make', P.make, car.make);
      skip('Model', P.model, fullModel(car));
    }

    if (kind === 'car') {
      if (yearText) out.push(scoreYear(car, yearText, rules)); else skip('Year', P.year, yearSpan(car));
    }
    const pts = out.reduce((s, r) => s + r.pts, 0);
    const hit = l => out.some(r => r.label === l && r.verdict === 'hit');
    const identified = kind === 'kit' ? hit('Tuner') : hit('Make') && hit('Model');
    return { pts, max: MAX, res: out, identified, perfect: pts === MAX };
  }

  // An answer that earns full credit for this car: the full name with its
  // generation, or the first verified name that pins it down.
  function bestAnswer(car, index) {
    index = index || buildIndex([car]);
    const id = index.ids.get(identityKey(car));
    const tries = [[car.make, fullModel(car), car.generation].filter(Boolean).join(' '), ...(id ? id.exact.map(n => `${car.make} ${n.t.join(' ')}`) : [])];
    return tries.find(t => understand(car, t, { ruleset: 'competitive', index }).res.level === 'full') || tries[0];
  }

  // Older helpers kept for callers that score a single box.
  function matchMake(guess, car, rules = RULES.casual) {
    const index = buildIndex([car]);
    const ans = readAnswer(guess, index, rules);
    const keys = makeKeysOf(car);
    return ans.makeSpans.some(s => keys.some(k => same(s.key, k, rules)));
  }
  function matchModel(guess, car, rules = RULES.casual, index) {
    const { res } = understand(car, guess, { ruleset: rules === RULES.competitive ? 'competitive' : 'casual', index });
    return { level: res.level === 'hint' ? null : res.level, why: res.why };
  }

  return {
    MAX, POINTS, RULES, GENERIC,
    scoreRound, understand, buildIndex, bestAnswer, matchMake, matchModel, matchKit,
    parseYear, compact, tokens, fullModel, yearSpan, identityKey, label,
  };
});
