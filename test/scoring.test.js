const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/scoring.js');
const CARS = require('../src/cars.json');

const car = (make, model, year) => {
  const c = CARS.find(x => x.make === make && x.model === model && (year == null || x.year === year));
  if (!c) throw new Error(`fixture missing: ${make} ${model} ${year}`);
  return c;
};
const casual = { ruleset: 'casual' };
const comp = { ruleset: 'competitive' };
const modelLevel = (g, c, r = S.RULES.casual) => S.matchModel(g, c, r).level;

const supra = car('Toyota', 'Supra', 1994);
const r34 = car('Nissan', 'Skyline GT-R R34');
const golf = car('Volkswagen', 'Golf GTI');
const benz = car('Mercedes-Benz', '190E');
const p911 = car('Porsche', '911', 1974);
const miata = car('Mazda', 'Miata MX-5');
const lambo = CARS.find(c => c.make === 'Lamborghini' && c.kit === 'Liberty Walk');
const rwb = CARS.find(c => c.kit === 'RWB');
const citroen = car('Citroën', 'DS');
// A synthetic model + variant car, so these tests don't depend on dataset edits.
const m4 = { make: 'BMW', model: 'M4', variant: 'Competition', variantAliases: ['Comp'], modelAliases: ['G82'], year: 2021, yearRange: [2021, 2025] };

test('every car is worth 10 and a perfect answer gets all of it', () => {
  const r = S.scoreRound(supra, { make: 'Toyota', model: 'Supra', year: '1994' }, comp);
  assert.equal(r.pts, 10);
  assert.equal(r.max, 10);
  assert.ok(r.perfect && r.identified);
});

test('make aliases, casing and accents', () => {
  assert.ok(S.matchMake('vw', golf));
  assert.ok(S.matchMake('VOLKSWAGEN', golf));
  assert.ok(S.matchMake('Mercedes', benz));
  assert.ok(S.matchMake('mercedes benz', benz));
  assert.ok(S.matchMake('Citroen', citroen));
  assert.ok(!S.matchMake('Toyota', golf));
  assert.ok(S.matchMake('Toyota Supra', supra), 'make box with the model in it');
});

test('typos: one letter forgiven in casual on long words, never in competitive', () => {
  assert.ok(S.matchMake('Lamborgini', lambo, S.RULES.casual));
  assert.ok(!S.matchMake('Lamborgini', lambo, S.RULES.competitive));
  assert.ok(S.matchMake('Toyta', supra, S.RULES.casual), 'one typo in a 6-letter word, casual');
  assert.ok(!S.matchMake('Toyta', supra, S.RULES.competitive));
  const civic = car('Honda', 'Civic Type R', 1997);
  assert.ok(!S.matchMake('Hondo', civic, S.RULES.casual), 'words under 6 letters need exact spelling');
  assert.equal(modelLevel('912', p911), null, 'numbers are never fuzzy');
  assert.equal(modelLevel('Supro', supra), null);
});

test('no credit for sharing a letter or two', () => {
  for (const g of ['S', 'GT', 'R', 'Series', 'Sup', 'RS', 'Type R']) {
    assert.equal(modelLevel(g, supra), null, g);
  }
  assert.equal(modelLevel('Series', car('BMW', '3 Series E30')), null);
});

test('punctuation, spacing, chassis codes and aliases', () => {
  assert.equal(modelLevel('Skyline GTR R34', r34), 'full');
  assert.equal(modelLevel('skyline gt-r r-34', r34), 'full');
  assert.equal(modelLevel('R34', r34), 'full');
  assert.equal(modelLevel('MX5', miata), 'full');
  assert.equal(modelLevel('Miata', miata), 'full');
  assert.equal(modelLevel('GTI', golf), 'full');
  assert.equal(modelLevel('Supra MK4', supra), 'full');
  assert.equal(modelLevel('Nissan Skyline R34', r34), 'full', 'make in the model box');
});

test('model + variant: base model is partial, both is full', () => {
  assert.equal(modelLevel('M4', m4), 'partial');
  assert.equal(S.matchModel('M4', m4).why, 'variant');
  assert.equal(modelLevel('M4 Competition', m4), 'full');
  assert.equal(modelLevel('M4 Comp', m4), 'full');
  assert.equal(modelLevel('BMW M4 Competition', m4), 'full');
  assert.equal(modelLevel('G82 Competition', m4), 'full');
  assert.equal(modelLevel('M3', m4), null, 'a different model gets nothing');
  assert.equal(modelLevel('M3 Competition', m4), null);
  const r = S.scoreRound(m4, { make: 'BMW', model: 'M4', year: '2022' }, comp);
  assert.equal(r.pts, 2 + 3 + 3);
  assert.match(r.res[1].note, /missed the trim: Competition/);
});

test('a different generation marker is partial: Evo X for an Evo VIII', () => {
  const evo8 = car('Mitsubishi', 'Lancer Evolution', 2003);
  assert.equal(modelLevel('Lancer Evolution X', evo8, S.RULES.competitive), 'partial');
  assert.equal(modelLevel('Evo VIII', evo8, S.RULES.competitive), 'full');
});

test('right family, wrong generation is partial with a clear note', () => {
  assert.equal(modelLevel('Skyline', r34), 'partial');
  const m = S.matchModel('Skyline R32', r34);
  assert.equal(m.level, 'partial');
  assert.equal(m.why, 'generation');
});

test('hedging several models in one answer earns nothing extra', () => {
  assert.equal(modelLevel('Supra 911', supra), null);
  assert.equal(modelLevel('Supra 911', p911), null);
  assert.equal(modelLevel('Skyline Supra Civic', r34), null);
  assert.notEqual(modelLevel('M4 M3', m4), 'full');
});

test('years: competitive is tighter than casual', () => {
  assert.equal(S.parseYear('94'), 1994);
  assert.equal(S.parseYear("'05"), 2005);
  assert.ok(Number.isNaN(S.parseYear('199')));
  const y = (g, o) => S.scoreRound(supra, { year: g }, o).res.find(r => r.label === 'Year').pts;
  assert.equal(y('1994', comp), 3);
  assert.equal(y('94', comp), 3);
  assert.equal(y('1996', casual), 2);
  assert.equal(y('1996', comp), 1);
  assert.equal(y('1998', casual), 1);
  assert.equal(y('1998', comp), 0);
  assert.equal(y('abcd', casual), 0);
});

test('yearRange: any year in the production run is exact', () => {
  assert.deepEqual(p911.yearRange, [1974, 1989]);
  const y = g => S.scoreRound(p911, { year: g }, comp).res.find(r => r.label === 'Year');
  assert.equal(y('1988').pts, 3);
  assert.equal(y('1990').pts, 1);
  assert.match(y('1960').note, /Off by 14 \(1974–1989\)/);
});

test('blank boxes are listed as skipped with the right answer', () => {
  const r = S.scoreRound(supra, { make: 'Toyota' }, casual);
  assert.deepEqual(r.res.map(x => x.verdict), ['hit', 'skip', 'skip']);
  assert.equal(r.res[1].note, 'Supra');
  assert.equal(r.pts, 2);
  assert.equal(S.scoreRound(supra, null, casual).pts, 0);
  assert.equal(S.scoreRound(supra, { make: 123, model: undefined }, casual).pts, 0);
});

test('kit rounds: tuner 6, make 2, model 2', () => {
  const k = (g, o = casual) => S.scoreRound(lambo, g, { ...o, kind: 'kit' });
  assert.equal(k({ kit: 'Liberty Walk', make: 'Lamborghini', model: 'Huracan' }).pts, 10);
  assert.equal(k({ kit: 'LB Works' }).pts, 6);
  assert.equal(k({ kit: 'lb★works' }).pts, 6);
  assert.equal(k({ kit: 'liberty walk huracan' }).pts, 6);
  assert.equal(k({ kit: 'Libery Walk' }).pts, 6, 'typo forgiven in casual');
  assert.equal(k({ kit: 'Libery Walk' }, comp).pts, 0, 'but not in competitive');
  assert.equal(k({ kit: 'Rocket Bunny' }).pts, 0);
  assert.equal(S.scoreRound(rwb, { kit: 'Rauh Welt' }, { kind: 'kit' }).pts, 0, 'partial tuner name is not enough');
  assert.equal(S.scoreRound(rwb, { kit: 'Rauh-Welt Begriff' }, { kind: 'kit' }).pts, 6);
  assert.ok(k({ kit: 'Liberty Walk' }).identified);
});

test('every car in the dataset scores 10 on its own answer, in both rulesets', () => {
  for (const c of CARS) {
    for (const o of [casual, comp]) {
      const kind = c.kit ? 'kit' : 'car';
      const r = S.scoreRound(c, { kit: c.kit, make: c.make, model: S.fullModel(c), year: String(c.year) }, { ...o, kind });
      assert.equal(r.pts, 10, `${c.id} (${o.ruleset}): ${JSON.stringify(r.res)}`);
    }
    for (const a of c.modelAliases || []) {
      const lvl = modelLevel(c.variant ? `${a} ${c.variant}` : a, c, S.RULES.competitive);
      assert.equal(lvl, 'full', `${c.id} alias ${a}`);
    }
  }
});

test('no car gets full model credit for another car of the same make', () => {
  const plain = CARS.filter(c => !c.kit && !c.excluded);
  const bad = [];
  for (const a of plain) for (const b of plain) {
    if (a === b || a.make !== b.make) continue;
    const g = S.fullModel(a);
    if (S.fullModel(a).toLowerCase() === S.fullModel(b).toLowerCase()) continue;
    if (modelLevel(g, b, S.RULES.competitive) === 'full') bad.push(`${g} -> ${b.id}`);
  }
  // Same model line across generations or trims: the model name is right, and the
  // year box is what tells generations apart.
  const allowed = new Set([
    'Supra -> toyota-gr-supra-2020', 'Golf GTI -> volkswagen-golf-1983', 'Impreza WRX STI -> subaru-wrx-sti-2015',
    'Miata MX-5 -> mazda-mx-5-miata-2016', 'G-Class -> mercedes-benz-g-63-2019', 'V8 Vantage -> aston-martin-vantage-2019',
    'Corvette Stingray -> chevrolet-corvette-1963', 'GT-R Nismo -> nissan-gt-r-2009', 'WRX STI -> subaru-impreza-wrx-sti-1999',
    'MX-5 Miata -> mazda-miata-mx-5-1990', '911 Turbo S -> porsche-911-1974', 'Golf R -> volkswagen-golf-1983',
    'Vantage -> aston-martin-v8-vantage-1977',
  ]);
  const unexpected = bad.filter(x => !allowed.has(x));
  assert.deepEqual(unexpected, []);
});

test('excluded cars carry a reason and are never served', () => {
  const { poolFor } = require('../src/party');
  const excluded = CARS.filter(c => c.excluded);
  for (const c of excluded) assert.ok(typeof c.excluded === 'string' && c.excluded.length > 10);
  for (const m of ['worldwide', 'japan', 'germany', 'usa', 'france', 'italy', 'uk', 'niche', 'supercar', 'timeattack', 'kit']) {
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
  }
});
