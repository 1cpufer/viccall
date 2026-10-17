const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/scoring.js');
const CARS = require('../src/cars.json');

const car = (make, model, year) => {
  const c = CARS.find(x => x.make === make && x.model === model && (year == null || x.year === year));
  if (!c) throw new Error(`fixture missing: ${make} ${model} ${year}`);
  return c;
};

const supra = car('Toyota', 'Supra', 1994);
const r34 = car('Nissan', 'Skyline GT-R R34');
const golf = car('Volkswagen', 'Golf GTI');
const benz = car('Mercedes-Benz', '190E');
const porsche74 = car('Porsche', '911', 1974);
const miata = car('Mazda', 'Miata MX-5');
const lambo = CARS.find(c => c.make === 'Lamborghini' && c.kit === 'Liberty Walk');
const rwb = CARS.find(c => c.kit === 'RWB');
const citroen = car('Citroën', 'DS');

test('exact answer scores the maximum', () => {
  const r = S.scoreGuess(supra, 'Toyota', 'Supra', '1994');
  assert.equal(r.pts, 5);
  assert.deepEqual(r.res.map(x => x.verdict), ['hit', 'hit', 'hit']);
});

test('make aliases and casing', () => {
  assert.ok(S.matchMake('vw', golf));
  assert.ok(S.matchMake('VOLKSWAGEN', golf));
  assert.ok(S.matchMake('Mercedes', benz));
  assert.ok(S.matchMake('mercedes benz', benz));
  assert.ok(S.matchMake('Citroen', citroen), 'accents are optional');
  assert.ok(!S.matchMake('Toyota', golf));
});

test('make typed with the model still counts', () => {
  assert.ok(S.matchMake('Toyota Supra', supra));
});

test('single-letter typo tolerance on long words, never on numbers', () => {
  assert.ok(S.matchMake('Toyta', supra));
  assert.ok(S.matchMake('Lamborgini', lambo));
  assert.equal(S.matchModel('912', porsche74), null);
  assert.equal(S.matchModel('911', porsche74), 'full');
});

test('model punctuation and spacing are ignored', () => {
  assert.equal(S.matchModel('Skyline GTR R34', r34), 'full');
  assert.equal(S.matchModel('skyline gt-r r-34', r34), 'full');
  assert.equal(S.matchModel('MX5', miata), 'full');
});

test('generation codes alone are full credit', () => {
  assert.equal(S.matchModel('R34', r34), 'full');
  assert.equal(S.matchModel('R34 GTR', r34), 'full');
});

test('model aliases from the dataset', () => {
  assert.equal(S.matchModel('Miata', miata), 'full');
  assert.equal(S.matchModel('GTI', golf), 'full');
  assert.equal(S.matchModel('A80', supra), 'full');
});

test('trim/generation extras still count as full', () => {
  assert.equal(S.matchModel('Supra MK4', supra), 'full');
  assert.equal(S.matchModel('Supra Turbo', supra), 'full');
});

test('make in the model box is stripped', () => {
  assert.equal(S.matchModel('Nissan Skyline R34', r34), 'full');
  assert.equal(S.matchModel('Toyota Supra', supra), 'full');
});

test('right family, wrong trim is close (1 pt)', () => {
  assert.equal(S.matchModel('Skyline', r34), 'close');
  assert.equal(S.matchModel('Skyline R32', r34), 'close');
  const r = S.scoreGuess(r34, '', 'Skyline', '');
  assert.equal(r.pts, 1);
});

test('generic words alone earn nothing', () => {
  const e30 = car('BMW', '3 Series E30');
  assert.equal(S.matchModel('Series', e30), null);
  assert.equal(S.matchModel('GT', car('Toyota', 'Celica GT-Four')), null);
});

test('cannot hedge two models in one answer', () => {
  assert.notEqual(S.matchModel('Supra 911', supra), 'full');
  assert.notEqual(S.matchModel('Supra 911', porsche74), 'full');
});

test('wrong model scores zero', () => {
  assert.equal(S.matchModel('Civic', supra), null);
  assert.equal(S.matchModel('Camry', car('Chevrolet', 'Camaro', 1969)), null);
});

test('years: exact, near, far, two-digit', () => {
  assert.equal(S.parseYear('94'), 1994);
  assert.equal(S.parseYear("'05"), 2005);
  assert.equal(S.parseYear('1994'), 1994);
  assert.ok(Number.isNaN(S.parseYear('199')));
  assert.ok(Number.isNaN(S.parseYear('abcd')));
  assert.equal(S.scoreGuess(supra, '', '', '94').pts, 2);
  assert.equal(S.scoreGuess(supra, '', '', '1990').pts, 1);
  assert.equal(S.scoreGuess(supra, '', '', '1980').pts, 0);
});

test('kit scoring with aliases and extra words', () => {
  assert.equal(S.scoreKit(lambo, 'Liberty Walk').pts, 5);
  assert.equal(S.scoreKit(lambo, 'LB Works').pts, 5);
  assert.equal(S.scoreKit(lambo, 'lb★works').pts, 5);
  assert.equal(S.scoreKit(lambo, 'liberty walk huracan').pts, 5);
  assert.equal(S.scoreKit(lambo, 'Libery Walk').pts, 5, 'typo');
  assert.equal(S.scoreKit(lambo, 'Rocket Bunny').pts, 0);
  assert.equal(S.scoreKit(rwb, 'Rauh Welt').pts, 0, 'partial tuner name is not enough');
  assert.equal(S.scoreKit(rwb, 'Rauh-Welt Begriff').pts, 5);
  assert.equal(S.scoreKit(lambo, '').pts, 0);
});

test('scoreRound dispatches by mode and handles missing input', () => {
  assert.equal(S.scoreRound(lambo, 'kit', { kit: 'LB' }).pts, 0);
  assert.equal(S.scoreRound(supra, 'worldwide', {}).pts, 0);
  assert.equal(S.scoreRound(supra, 'worldwide', null).pts, 0);
  assert.equal(S.scoreRound(supra, 'worldwide', { make: 123, model: undefined, year: null }).pts, 0);
  assert.equal(S.maxForMode('kit'), 5);
  assert.equal(S.maxForMode('japan'), 5);
});

test('every car in the dataset scores max on its own answer', () => {
  for (const c of CARS) {
    const r = c.kit ? S.scoreKit(c, c.kit) : S.scoreGuess(c, c.make, c.model, String(c.year));
    assert.equal(r.pts, r.max, `${c.make} ${c.model} ${c.year}`);
    for (const a of c.modelAliases || []) assert.equal(S.matchModel(a, c), 'full', `${c.model} alias ${a}`);
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
  }
});
