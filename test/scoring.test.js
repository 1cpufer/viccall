const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/scoring.js');
const CARS = require('../src/cars.json');

const IDX = S.buildIndex(CARS);
const LIVE = CARS.filter(c => !c.excluded);
const byId = id => {
  const c = CARS.find(x => x.id === id);
  if (!c) throw new Error(`fixture missing: ${id}`);
  return c;
};
const casual = { ruleset: 'casual', index: IDX };
const comp = { ruleset: 'competitive', index: IDX };
const read = (car, text, o = comp) => S.understand(car, text, o).res;
const level = (car, text, o = comp) => read(car, text, o).level;
const score = (car, text, o = comp) => {
  const r = S.scoreRound(car, { car: text }, o);
  const get = l => r.res.find(x => x.label === l);
  return { make: get('Make').pts, model: get('Model').pts, note: get('Model').note, makeNote: get('Make').note, r };
};
// The one canonical name that is genuinely shared: the 1961 and 2017 Alpine A110.
const SHARED_CANONICAL = new Set(['alpine-a110-2019']);
const canonical = c => [c.make, S.fullModel(c), c.generation].filter(Boolean).join(' ');

const p918 = byId('porsche-918-spyder-2013');
const gt3rs = byId('porsche-911-gt3-rs-2023');
const svj = byId('lamborghini-aventador-svj-2019');
const r35 = byId('nissan-gt-r-2009');
const nismo = byId('nissan-gt-r-nismo-2022');
const r34 = byId('nissan-skyline-gt-r-r34-1999');
const a80 = byId('toyota-supra-1994');
const a90 = byId('toyota-gr-supra-2020');
const m4 = byId('bmw-m4-competition-2021');

test('the 918 Spyder table: shorter can be just as right', () => {
  const rows = [
    ['Porsche 918 Spyder', 2, 5],
    ['918 Spyder', 2, 5],     // make implied by the model
    ['Porsche 918', 2, 5],
    ['918', 2, 5],
    ['918 Spider', 2, 5],     // spelling
    ['918Spyder', 2, 5],      // spacing
    ['Spyder', 0, 1],         // right designation, doesn't identify anything
    ['Porsche Spyder', 2, 1],
    ['Porsche 911 Spyder', 2, 0], // a different Porsche
  ];
  for (const [text, make, model] of rows) {
    const s = score(p918, text);
    assert.deepEqual([s.make, s.model], [make, model], `${text}: ${s.makeNote} / ${s.note}`);
  }
  assert.match(score(p918, 'Porsche 911 Spyder').note, /911.*different car/);
  assert.match(score(p918, 'Spyder').note, /could be many cars/);
});

test('enthusiast shorthand is full credit when it pins down one car', () => {
  for (const t of ['GT3 RS', 'Porsche GT3 RS', '911 GT3 RS', '992 GT3 RS', 'GT3RS', 'GT 3 RS']) assert.equal(level(gt3rs, t), 'full', t);
  for (const t of ['SVJ', 'Aventador SVJ', 'Lambo SVJ', 'LP770-4', 'SV Jota']) assert.equal(level(svj, t), 'full', t);
  for (const t of ['R35', 'GT-R', 'Nissan GTR', 'GT R']) assert.equal(level(r35, t), 'full', t);
  for (const t of ['R34', 'Skyline R34', 'GT-R R34', 'skyline gt-r r-34', 'Nissan Skyline GT-R R34']) assert.equal(level(r34, t), 'full', t);
  for (const t of ['Supra Mk4', 'Supra MKIV', 'A80', 'Toyota Supra A80']) assert.equal(level(a80, t), 'full', t);
  for (const t of ['GR Supra', 'A90', 'Supra Mk5']) assert.equal(level(a90, t), 'full', t);
  assert.equal(score(gt3rs, 'GT3 RS').make, 2, 'make implied');
});

test('qualifiers cannot be dropped: a trim separates real cars', () => {
  assert.equal(level(gt3rs, 'GT3'), 'partial');
  assert.match(read(gt3rs, 'GT3').note, /missed the trim: GT3 RS/);
  assert.equal(level(gt3rs, '911'), 'partial');
  assert.equal(level(m4, 'M4'), 'partial');
  assert.match(read(m4, 'M4').note, /missed the trim: Competition/);
  for (const t of ['M4 Competition', 'M4 Comp', 'BMW M4 Competition', 'G82 Competition']) assert.equal(level(m4, t), 'full', t);
  assert.equal(level(nismo, 'R35'), 'partial');
  assert.match(read(nismo, 'R35').note, /missed the trim: Nismo/);
  assert.equal(level(svj, 'Aventador'), 'partial');
  const civic = byId('honda-civic-type-r-2017');
  assert.equal(level(civic, 'Civic'), 'partial', 'Civic is not a Civic Type R');
});

test('ambiguous answers earn partial credit and say what they could be', () => {
  for (const c of [a80, a90]) {
    const r = read(c, 'Supra');
    assert.equal(r.level, 'partial');
    assert.equal(r.why, 'ambiguous');
    assert.match(r.note, /Supra \(A80\).*GR Supra \(A90\)|GR Supra \(A90\).*Supra \(A80\)/);
  }
  assert.equal(read(r34, 'Skyline').why, 'ambiguous');
  assert.equal(read(r34, 'Skyline GT-R').why, 'ambiguous');
  // "GT-R" on its own is the R35's full name, so for an R34 it points at the wrong generation.
  const g = read(r34, 'GT-R');
  assert.equal(g.level, 'partial');
  assert.match(g.note, /that's the GT-R.*This is the Skyline GT-R R34/);
  assert.equal(level(byId('bmw-m3-2000'), 'M3'), 'partial', 'E46 or G80?');
  assert.equal(level(byId('bmw-m3-2000'), 'E46 M3'), 'full');
  assert.equal(score(r34, 'Skyline').make, 2, 'every Skyline is a Nissan, so the make is implied');
});

test('a sibling trim or generation is partial, a different model is nothing', () => {
  const s = read(gt3rs, '911 Turbo S');
  assert.equal(s.level, 'partial');
  assert.match(s.note, /Turbo S.*This is the 911 GT3 RS/);
  assert.equal(read(gt3rs, '911 GT3 RS Turbo S').level, 'partial', 'stuffing a second trim is not exact');
  assert.equal(read(r35, 'GT-R Nismo').level, 'partial');
  assert.equal(read(r34, 'R33').level, 'partial');
  assert.equal(level(byId('bmw-m3-2000'), 'G80'), 'partial');
  assert.equal(level(gt3rs, 'Cayman GT4 RS'), null);
  assert.equal(level(svj, 'Huracan'), null);
  const evo = byId('mitsubishi-lancer-evolution-x-2008');
  const ix = read(evo, 'Lancer Evolution IX');
  assert.equal(ix.level, 'partial');
  assert.match(ix.note, /IX.*This is the Lancer Evolution \(X\)/);
  assert.equal(level(evo, 'Evo X'), 'full');
  assert.equal(level(evo, 'Evo VIII'), 'partial', 'a generation that isn\'t in the game is still the wrong one');
  assert.equal(level(evo, 'Lancer Evolution'), 'partial', 'which generation?');
});

test('naming several cars at once earns nothing for the model', () => {
  assert.equal(read(a80, 'Supra 911').why, 'hedge');
  assert.equal(level(r34, 'Skyline Supra Civic'), null);
  assert.equal(level(m4, 'M4 M3'), null);
  assert.equal(level(p918, '918 959'), null);
});

test('no credit for generic words, fragments or shared letters', () => {
  for (const g of ['S', 'GT', 'R', 'Sup', 'RS', 'Type R', 'Turbo', 'Coupe']) {
    const s = score(a80, g);
    assert.equal(s.model + s.make, 0, `${g}: ${s.note}`);
  }
  // Generic words that are part of the right name earn the 1-point hint at most.
  assert.ok(score(byId('bmw-3-series-e30-1982'), 'Series').model <= 1);
  assert.equal(level(byId('porsche-911-1974'), '912'), null, 'numbers are never fuzzy');
  assert.equal(level(a80, 'Supro', casual), null, 'five-letter words need exact spelling');
});

test('typos: casual forgives one slip in a long word, competitive never does', () => {
  const lambo = byId('lamborghini-huracan-2015');
  assert.equal(score(lambo, 'Lamborgini Huracan', casual).make, 2);
  assert.equal(score(lambo, 'Lamborgini Huracan', comp).make, 2, 'the model still implies the make');
  assert.equal(score(lambo, 'Lamborgini', comp).make, 0);
  assert.equal(level(byId('lamborghini-countach-1978'), 'Countash', casual), 'full');
  assert.equal(level(byId('lamborghini-countach-1978'), 'Countash', comp), null);
});

test('the same recognition in both rule sets for correctly spelled answers', () => {
  for (const [c, t] of [[p918, '918'], [gt3rs, 'GT3'], [a80, 'Supra'], [r34, 'GT-R'], [p918, 'Spyder'], [m4, 'M4 M3']]) {
    assert.deepEqual(read(c, t, casual), read(c, t, comp), t);
  }
});

test('one answer box: make, model and year can all be typed together', () => {
  const r = S.scoreRound(r34, { car: '1999 Nissan Skyline R34' }, comp);
  assert.equal(r.pts, 10);
  assert.ok(r.perfect && r.identified);
  const old = S.scoreRound(r34, { make: 'Nissan', model: 'Skyline R34', year: '1999' }, comp);
  assert.equal(old.pts, 10, 'separate make/model fields still work');
  const wrongMake = S.scoreRound(p918, { car: 'Ferrari 918' }, comp);
  assert.deepEqual(wrongMake.res.slice(0, 2).map(x => x.pts), [0, 5], 'a wrong make costs the make points only');
  const shelby = S.scoreRound(byId('ford-mustang-shelby-gt350-2016'), { car: 'Shelby GT350' }, comp);
  assert.deepEqual(shelby.res.slice(0, 2).map(x => x.pts), [2, 5], 'Shelby counts as the Ford make for the GT350');
  const range = S.scoreRound(byId('range-rover-classic-1970'), { car: 'Range Rover Classic' }, comp);
  assert.equal(range.res[1].pts, 5, 'Range Rover is a model, not a make');
});

test('a stated make settles names shared across makes', () => {
  const gto = byId(CARS.find(c => c.make === 'Pontiac' && /GTO/.test(c.model)).id);
  assert.equal(level(gto, 'Pontiac GTO'), 'full');
  assert.equal(level(gto, 'GTO'), 'partial');
  const rs6 = byId('audi-rs6-2021');
  assert.equal(level(rs6, 'Audi C8'), 'full');
});

test('years: competitive is tighter than casual', () => {
  assert.equal(S.parseYear('94'), 1994);
  assert.equal(S.parseYear("'05"), 2005);
  assert.ok(Number.isNaN(S.parseYear('199')));
  const y = (g, o) => S.scoreRound(a80, { year: g }, o).res.find(r => r.label === 'Year').pts;
  assert.equal(y('1994', comp), 3);
  assert.equal(y('94', comp), 3);
  assert.equal(y('1996', casual), 2);
  assert.equal(y('1996', comp), 1);
  assert.equal(y('1998', casual), 1);
  assert.equal(y('1998', comp), 0);
  assert.equal(y('abcd', casual), 0);
});

test('yearRange: any year in the production run is exact', () => {
  const p911 = byId('porsche-911-1974');
  assert.deepEqual(p911.yearRange, [1974, 1989]);
  const y = g => S.scoreRound(p911, { year: g }, comp).res.find(r => r.label === 'Year');
  assert.equal(y('1988').pts, 3);
  assert.equal(y('1990').pts, 1);
  assert.match(y('1960').note, /Off by 14 \(1974–1989\)/);
});

test('blank answers are listed as skipped with the right answer', () => {
  const r = S.scoreRound(a80, { car: 'Toyota' }, casual);
  assert.deepEqual(r.res.map(x => x.verdict), ['hit', 'skip', 'skip']);
  assert.match(r.res[1].note, /Supra/);
  assert.equal(r.pts, 2);
  assert.equal(S.scoreRound(a80, null, casual).pts, 0);
  assert.equal(S.scoreRound(a80, { make: 123, model: undefined }, casual).pts, 0);
});

test('kit rounds: tuner 6, make 2, model 2; the tuner can go in the car box', () => {
  const lb = byId('lamborghini-huracan-2016-liberty-walk');
  const k = (g, o = casual) => S.scoreRound(lb, g, { ...o, kind: 'kit' });
  assert.equal(k({ kit: 'Liberty Walk', car: 'Lamborghini Huracan' }).pts, 10);
  assert.equal(k({ kit: 'Liberty Walk', make: 'Lamborghini', model: 'Huracan' }).pts, 10);
  assert.equal(k({ car: 'Liberty Walk Huracan' }).pts, 10, 'tuner typed in the car box');
  assert.equal(k({ kit: 'LB Works' }).pts, 6);
  assert.equal(k({ kit: 'lb★works' }).pts, 6);
  assert.equal(k({ kit: 'Libery Walk' }).pts, 6, 'typo forgiven in casual');
  assert.equal(k({ kit: 'Libery Walk' }, comp).pts, 0, 'but not in competitive');
  assert.equal(k({ kit: 'Rocket Bunny' }).pts, 0);
  const rwb = CARS.find(c => c.kit === 'RWB');
  assert.equal(S.scoreRound(rwb, { kit: 'Rauh Welt' }, { kind: 'kit', index: IDX }).pts, 0, 'partial tuner name is not enough');
  assert.equal(S.scoreRound(rwb, { kit: 'Rauh-Welt Begriff' }, { kind: 'kit', index: IDX }).pts, 6);
});

test('every car in play can be named for full credit, in both rule sets', () => {
  for (const c of LIVE) {
    const id = IDX.ids.get(S.identityKey(c));
    const answers = [canonical(c), ...id.exact.map(n => `${c.make} ${n.t.join(' ')}`)];
    const best = SHARED_CANONICAL.has(c.id) ? answers.find(a => level(c, a) === 'full') : canonical(c);
    assert.ok(best, `${c.id} has an answer worth full credit`);
    for (const o of [casual, comp]) {
      const kind = c.kit ? 'kit' : 'car';
      const r = S.scoreRound(c, { kit: c.kit, car: best, year: String(c.year) }, { ...o, kind });
      assert.equal(r.pts, 10, `${c.id} "${best}" (${o.ruleset}): ${JSON.stringify(r.res)}`);
    }
  }
});

test('every alias is either exact or a reviewed ambiguity, never another car', () => {
  for (const c of LIVE) {
    const names = [...(c.modelAliases || []), ...[c.generation, ...(c.generationAliases || [])].filter(Boolean).map(g => `${c.model} ${g}`)];
    for (const a of names) {
      const text = c.variant ? `${c.make} ${a} ${c.variant}` : `${c.make} ${a}`;
      const r = read(c, text);
      assert.ok(r.level === 'full' || r.why === 'ambiguous', `${c.id} alias "${a}": ${r.why} ${r.note}`);
    }
  }
});

test('no car gets full model credit for another car of the same make', () => {
  const bad = [];
  for (const a of LIVE) for (const b of LIVE) {
    if (a === b || a.make !== b.make || S.identityKey(a) === S.identityKey(b)) continue;
    if (level(b, canonical(a)) === 'full') bad.push(`${canonical(a)} -> ${b.id}`);
  }
  assert.deepEqual(bad, []);
});

test('excluded cars carry a reason and are never served', () => {
  const { poolFor } = require('../src/party');
  const excluded = CARS.filter(c => c.excluded);
  for (const c of excluded) assert.ok(typeof c.excluded === 'string' && c.excluded.length > 10);
  for (const m of ['world', 'modern', 'classic', 'jdm', 'euro', 'super', 'kits']) {
    assert.ok(poolFor(CARS, m).every(c => !c.excluded), m);
  }
});

test('dataset integrity', () => {
  const ids = new Set();
  for (const c of CARS) {
    assert.ok(c.id && !ids.has(c.id), `unique id ${c.id}`);
    ids.add(c.id);
    for (const k of ['make', 'model', 'region', 'img', 'hint']) assert.ok(typeof c[k] === 'string' && c[k], `${c.id}.${k}`);
    assert.ok(Number.isInteger(c.year) && c.year > 1880 && c.year <= new Date().getFullYear() + 1, `${c.id}.year`);
    assert.match(c.img, /^https:\/\//);
    // Wikimedia paths embed md5(filename): a typo in a hand-entered URL breaks the photo.
    const m = /\/commons\/(?:thumb\/)?([0-9a-f])\/([0-9a-f]{2})\/([^/]+)/.exec(c.img);
    assert.ok(m, `${c.id}: Wikimedia Commons URL`);
    const hash = require('crypto').createHash('md5').update(decodeURIComponent(m[3])).digest('hex');
    assert.equal(`${m[1]}/${m[2]}`, `${hash[0]}/${hash.slice(0, 2)}`, `${c.id}: hash path matches file name`);
    assert.ok([1, 2, 3].includes(c.difficulty), `${c.id}.difficulty`);
    assert.ok(typeof c.credit === 'string' && c.credit.length > 4, `${c.id}.credit`);
    if (c.yearRange) {
      assert.ok(Array.isArray(c.yearRange) && c.yearRange.length === 2 && c.yearRange[0] <= c.year && c.year <= c.yearRange[1], `${c.id}.yearRange`);
    }
    for (const k of ['modelAliases', 'variantAliases', 'generationAliases', 'makeAliases']) {
      if (c[k] != null) assert.ok(Array.isArray(c[k]) && c[k].every(x => typeof x === 'string' && x.trim()), `${c.id}.${k}`);
    }
  }
});
