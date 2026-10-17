/* VicCall client. Vanilla JS, no build step. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- basics
  const $ = id => document.getElementById(id);
  const TOTAL = 10;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');

  const MODE_NAME = {
    worldwide: 'Worldwide', japan: 'Japan', germany: 'Germany', usa: 'USA', france: 'France', italy: 'Italy', uk: 'UK',
    niche: 'Niche', supercar: 'Supercars', timeattack: 'Time Attack', kit: 'Kit Check',
  };
  const DECK = [
    { mode: 'worldwide', name: 'Worldwide', desc: 'Any car, any country, any decade.', facts: c => [[c.worldwide, 'cars'], [TOTAL, 'rounds']] },
    { mode: 'regional', name: 'Regional', desc: 'Pick one country and learn its cars inside out.', facts: () => [[6, 'regions'], [TOTAL, 'rounds']] },
    { mode: 'niche', name: 'Niche', desc: 'Kei cars, homologation specials and the ones nobody remembers.', facts: c => [[c.niche, 'cars'], [TOTAL, 'rounds']] },
    { mode: 'supercar', name: 'Supercars', desc: 'Exotics only. Mid-engines, big wings, bigger numbers.', facts: c => [[c.supercar, 'cars'], [TOTAL, 'rounds']] },
    { mode: 'timeattack', name: 'Time Attack', desc: 'Every region, no time to think. Answer before the bar runs out.', facts: () => [['30 s', 'per car'], [TOTAL, 'rounds']] },
    { mode: 'kit', name: 'Kit Check', desc: 'Name the tuner behind the widebody: Liberty Walk, RWB, Rocket Bunny and more.', facts: c => [[c.kit, 'builds'], ['5 pts', 'per kit']] },
  ];
  const REGIONS = [
    { mode: 'japan', name: 'Japan', desc: 'JDM legends and kei cars' },
    { mode: 'germany', name: 'Germany', desc: 'Munich, Stuttgart, Wolfsburg' },
    { mode: 'usa', name: 'USA', desc: 'Muscle, pickups, Detroit steel' },
    { mode: 'france', name: 'France', desc: 'Peugeot, Renault, Citroën' },
    { mode: 'italy', name: 'Italy', desc: 'Ferrari, Lamborghini, Alfa, Lancia' },
    { mode: 'uk', name: 'UK', desc: 'Aston, Jaguar, Lotus, the odd Reliant' },
  ];

  const store = {
    get(k, fallback = '') { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const tabStore = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  async function api(method, url, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, {
        method, signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, data: data || {} };
    } catch {
      return { ok: false, status: 0, data: { error: 'network' } };
    } finally { clearTimeout(timer); }
  }

  function countTo(el, to) {
    const from = parseInt(el.textContent, 10) || 0;
    if (from === to) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    if (reduceMotion.matches) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 420;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Wikimedia thumbnails: 960px is plenty for a 640px column at 1.5x and roughly
  // halves the download. If that size isn't available, fall back to the original URL.
  const smallImg = src => String(src || '').replace(/\/1280px-/, '/960px-');

  // Load a car photo into an <img> with loading / error states.
  function loadPhoto(img, stateEl, original, { onShown, onFail } = {}) {
    const small = smallImg(original);
    let src = small;
    img.classList.remove('is-loaded');
    img.removeAttribute('src');
    stateEl.className = 'photo-state is-loading';
    stateEl.innerHTML = '';
    const token = (img._token = (img._token || 0) + 1);
    img.onload = () => {
      if (img._token !== token) return;
      img.classList.add('is-loaded');
      stateEl.className = 'photo-state';
      onShown && onShown();
    };
    img.onerror = () => {
      if (img._token !== token) return;
      if (src !== original) { src = original; img.src = original; return; }
      stateEl.className = 'photo-state';
      stateEl.innerHTML = '<div><p>This photo didn’t load.</p></div>';
      onFail && onFail(stateEl);
    };
    img.src = src;
  }
  const preload = src => { if (src) { const i = new Image(); i.decoding = 'async'; i.src = smallImg(src); } };

  // ---------------------------------------------------------------- crash + bug reports
  const crashSeen = new Set();
  function captureCrash(message, stack) {
    if (crashSeen.size >= 10) return;
    const k = `${message}|${String(stack || '').slice(0, 200)}`;
    if (crashSeen.has(k)) return;
    crashSeen.add(k);
    let mode = '';
    try { mode = solo.mode || party.mode || ''; } catch {}
    api('POST', '/api/report', { type: 'crash', message: String(message || ''), stack: String(stack || ''), mode, userAgent: navigator.userAgent });
  }
  addEventListener('error', e => captureCrash(e.message, e.error && e.error.stack));
  addEventListener('unhandledrejection', e => captureCrash('Unhandled rejection: ' + ((e.reason && e.reason.message) || e.reason), e.reason && e.reason.stack));

  // ---------------------------------------------------------------- screens + history
  const screens = {};
  document.querySelectorAll('[data-screen]').forEach(s => { screens[s.dataset.screen] = s; });
  let current = 'home';
  let depth = 0;
  const PARTY_SCREENS = new Set(['lobby', 'pgame', 'pfinal']);

  function show(name, { push = true, replace = false } = {}) {
    if (!screens[name]) name = 'home';
    if (name !== current) {
      screens[current].hidden = true;
      const el = screens[name];
      el.hidden = false;
      el.classList.remove('is-entering');
      void el.offsetWidth;
      el.classList.add('is-entering');
      window.scrollTo(0, 0);
      if (current === 'game' && name !== 'game') stopSoloClock();
      current = name;
    }
    if (replace) history.replaceState({ screen: name, depth }, '');
    else if (push) { depth += 1; history.pushState({ screen: name, depth }, ''); }
    if (name === 'home') deckLayout(false);
  }
  history.replaceState({ screen: 'home', depth: 0 }, '');

  addEventListener('popstate', e => {
    const target = (e.state && e.state.screen) || 'home';
    depth = (e.state && e.state.depth) || 0;
    if (party.code && !PARTY_SCREENS.has(target)) partyLeave({ silent: true });
    if (PARTY_SCREENS.has(target) && !party.code) return show('party', { replace: true });
    if (target === 'game' && !solo.sessionId) return show('home', { replace: true });
    show(target, { push: false });
    if (target === 'leaderboard') loadBoard();
  });

  function back() {
    if (depth > 0) history.back();
    else show('home', { replace: true });
  }

  // ---------------------------------------------------------------- meta (pool sizes, makes)
  let counts = {};
  const metaReady = api('GET', '/api/meta').then(r => {
    if (!r.ok) return;
    counts = r.data.modes || {};
    $('makeList').innerHTML = (r.data.makes || []).map(m => `<option value="${esc(m)}">`).join('');
    renderDeckFacts();
    renderRegions();
  });

  // ---------------------------------------------------------------- mode deck (carousel)
  const track = $('deckTrack');
  const viewport = $('deckViewport');
  let deckIdx = 0;
  let deckX = 0;

  track.innerHTML = DECK.map((d, i) => `
    <button class="mode" role="option" id="mode-${d.mode}" data-index="${i}" aria-selected="false">
      <span class="mode-name">${esc(d.name)}</span>
      <span class="mode-desc">${esc(d.desc)}</span>
      <span class="mode-facts" data-facts="${i}"></span>
    </button>`).join('');
  $('deckDots').innerHTML = DECK.map((d, i) => `<button class="deck-dot" data-index="${i}" aria-label="${esc(d.name)}"></button>`).join('');

  function renderDeckFacts() {
    DECK.forEach((d, i) => {
      const el = track.querySelector(`[data-facts="${i}"]`);
      el.innerHTML = d.facts(counts).filter(([v]) => v != null).map(([v, l]) => `<span><b>${esc(v)}</b> ${esc(l)}</span>`).join('');
    });
  }
  renderDeckFacts();

  const cards = () => [...track.children];
  function targetX(i) {
    const card = cards()[i];
    return viewport.clientWidth / 2 - (card.offsetLeft + card.offsetWidth / 2);
  }
  function setX(x, animate) {
    deckX = x;
    track.classList.toggle('is-animating', !!animate && !reduceMotion.matches);
    track.style.transform = `translate3d(${x}px,0,0)`;
  }
  function deckLayout(animate) {
    cards().forEach((c, i) => { c.classList.toggle('is-active', i === deckIdx); c.setAttribute('aria-selected', String(i === deckIdx)); c.tabIndex = i === deckIdx ? 0 : -1; });
    [...$('deckDots').children].forEach((d, i) => d.classList.toggle('is-active', i === deckIdx));
    const d = DECK[deckIdx];
    $('playBtn').textContent = d.mode === 'regional' ? 'Pick a region' : `Play ${d.name}`;
    setX(targetX(deckIdx), animate);
  }
  function deckGo(i, { wrap = false } = {}) {
    const n = DECK.length;
    deckIdx = wrap ? (i + n) % n : Math.max(0, Math.min(n - 1, i));
    deckLayout(true);
  }
  function playDeck() {
    const d = DECK[deckIdx];
    if (d.mode === 'regional') show('regional');
    else startSolo(d.mode);
  }

  // Pointer drag with flick velocity. Vertical swipes still scroll the page.
  let drag = null;
  viewport.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: deckX, axis: null, samples: [[e.timeStamp, e.clientX]] };
  });
  viewport.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'x') { viewport.setPointerCapture(e.pointerId); track.classList.add('is-dragging'); }
    }
    if (drag.axis !== 'x') return;
    const min = targetX(DECK.length - 1), max = targetX(0);
    let x = drag.base + dx;
    if (x > max) x = max + (x - max) * 0.35;           // rubber band at the ends
    if (x < min) x = min + (x - min) * 0.35;
    setX(x, false);
    drag.samples.push([e.timeStamp, e.clientX]);
    if (drag.samples.length > 6) drag.samples.shift();
  });
  const endDrag = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    track.classList.remove('is-dragging');
    if (d.axis !== 'x') return;
    const [t0, x0] = d.samples[0], [t1, x1] = d.samples[d.samples.length - 1];
    const v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;  // px per ms
    const step = cards()[1] ? cards()[1].offsetLeft - cards()[0].offsetLeft : 300;
    let i = Math.round((targetX(0) - deckX) / step);
    if (Math.abs(v) > 0.35) i = deckIdx + (v < 0 ? 1 : -1);
    deckGo(i);
    track._suppressClick = true;
    setTimeout(() => { track._suppressClick = false; }, 0);
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  track.addEventListener('click', e => {
    const card = e.target.closest('.mode');
    if (!card || track._suppressClick) return;
    const i = +card.dataset.index;
    if (i === deckIdx) playDeck(); else deckGo(i);
  });
  track.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      deckGo(deckIdx + (e.key === 'ArrowRight' ? 1 : -1), { wrap: true });
      cards()[deckIdx].focus({ preventScroll: true });
    }
  });
  $('deckDots').addEventListener('click', e => { const d = e.target.closest('.deck-dot'); if (d) deckGo(+d.dataset.index); });
  let resizeRaf = 0;
  addEventListener('resize', () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(() => { if (current === 'home') deckLayout(false); }); });
  if (document.fonts) document.fonts.ready.then(() => deckLayout(false));
  deckLayout(false);

  // ---------------------------------------------------------------- regions
  function renderRegions() {
    $('regionList').innerHTML = REGIONS.map(r => `
      <button class="region" data-action="solo" data-mode="${r.mode}">
        <span class="region-name">${esc(r.name)}</span>
        <span class="region-desc">${esc(r.desc)}</span>
        ${counts[r.mode] ? `<span class="region-count">${counts[r.mode]} cars</span>` : ''}
      </button>`).join('');
  }
  renderRegions();

  // ---------------------------------------------------------------- shared game UI helpers
  function setGuessMode(prefix, mode) {
    const kit = mode === 'kit';
    $(prefix + 'Fields').hidden = kit;
    $(prefix + 'KitFields').hidden = !kit;
  }
  const guessInputs = prefix => ['Make', 'Model', 'Year', 'Kit'].map(f => $(prefix + f));
  function resetGuess(prefix) {
    guessInputs(prefix).forEach(i => { i.value = ''; i.disabled = false; });
    $(prefix + 'Msg').textContent = '';
    const btn = $(prefix + 'Submit');
    btn.disabled = false;
    btn.classList.remove('is-busy');
  }
  function readGuess(prefix, mode) {
    if (mode === 'kit') return { kit: $(prefix + 'Kit').value.trim() };
    return { make: $(prefix + 'Make').value.trim(), model: $(prefix + 'Model').value.trim(), year: $(prefix + 'Year').value.trim() };
  }
  const isEmptyGuess = g => !Object.values(g).some(Boolean);
  function focusFirst(prefix, mode) {
    if (coarse.matches) return; // don't throw the keyboard over the photo on phones
    $(prefix + (mode === 'kit' ? 'Kit' : 'Make')).focus({ preventScroll: true });
  }

  function verdictFor(pts, max, empty, late) {
    if (late) return { text: 'Too late: the clock ran out', cls: 'is-miss' };
    if (empty) return { text: 'No answer', cls: 'is-miss' };
    if (pts >= max) return { text: 'Nailed it', cls: 'is-hit' };
    if (pts >= 3) return { text: 'Close', cls: 'is-hit' };
    if (pts > 0) return { text: 'Partly right', cls: '' };
    return { text: 'Not this time', cls: 'is-miss' };
  }
  function chipsHtml(res) {
    return (res || []).map((r, i) => {
      let label = r.label;
      const off = /off by \d+/.exec(r.detail || '');
      if (r.label === 'Year' && off && r.verdict !== 'hit') label += `, ${off[0]}`;
      else if (r.verdict === 'close') label += ', close';
      return `<li class="chip is-${r.verdict}" style="--i:${i}">${esc(label)} <b>${r.pts > 0 ? '+' + r.pts : '0'}</b></li>`;
    }).join('');
  }
  function answerHtml(a, mode) {
    if (mode === 'kit') return `${esc(a.kit)}`;
    return `${esc(a.make)} ${esc(a.model)} <span class="yr">${esc(a.year)}</span>`;
  }
  function hintText(a, mode) {
    return mode === 'kit' ? `${a.make} ${a.model}, ${a.year}. ${a.hint || ''}` : a.hint || '';
  }
  function playReveal(el) {
    el.hidden = false;
    el.classList.remove('is-in');
    void el.offsetWidth;
    el.classList.add('is-in');
  }

  // A deadline-based countdown (immune to timer drift and background-tab throttling).
  function makeClock(prefix) {
    let raf = 0, deadline = 0, total = 1, onEnd = null, fired = false, onTick = null;
    const wrap = $(prefix + 'Clock'), bar = $(prefix + 'ClockBar'), num = $(prefix + 'ClockNum');
    function frame() {
      const left = Math.max(0, deadline - Date.now());
      bar.style.transform = `scaleX(${left / total})`;
      const secs = Math.ceil(left / 1000);
      if (num.textContent !== String(secs)) num.textContent = secs;
      wrap.classList.toggle('is-urgent', left <= 10000);
      if (onTick) onTick(left);
      if (left <= 0) { if (!fired) { fired = true; if (onEnd) onEnd(); } return; }
      raf = requestAnimationFrame(frame);
    }
    return {
      start(dl, durationMs, endCb, tickCb) {
        cancelAnimationFrame(raf);
        deadline = dl; total = durationMs; onEnd = endCb; onTick = tickCb || null; fired = false;
        wrap.hidden = false;
        frame();
      },
      stop() { cancelAnimationFrame(raf); },
      hide() { cancelAnimationFrame(raf); wrap.hidden = true; },
    };
  }

  // ---------------------------------------------------------------- solo game
  const solo = { mode: '', sessionId: null, images: [], idx: 0, score: 0, maxPerCar: 5, timeLimitMs: 0, results: [], phase: 'idle', busy: false, saved: false };
  const soloClock = makeClock('g');
  function stopSoloClock() { soloClock.stop(); }

  function renderPips() {
    $('gPips').innerHTML = Array.from({ length: TOTAL }, (_, i) => {
      const r = solo.results[i];
      let cls = 'pip';
      if (r) cls += r.pts >= solo.maxPerCar ? ' is-hit' : r.pts > 0 ? ' is-close' : ' is-miss';
      else if (i === solo.idx && solo.phase === 'guess') cls += ' is-current';
      const label = r ? `Car ${i + 1}: ${r.pts} points` : `Car ${i + 1}`;
      return `<li class="${cls}" aria-label="${label}"></li>`;
    }).join('');
  }

  async function startSolo(mode) {
    Object.assign(solo, { mode, sessionId: null, images: [], idx: 0, score: 0, results: [], phase: 'starting', busy: false, saved: false });
    if (current !== 'game') show('game');
    $('gMode').textContent = MODE_NAME[mode] || mode;
    $('gScore').textContent = '0';
    $('gResults').hidden = true;
    $('gReveal').hidden = true;
    $('gForm').hidden = false;
    $('gPhoto').hidden = false;
    $('gCount').textContent = `Car 1 of ${TOTAL}`;
    setGuessMode('g', mode);
    resetGuess('g');
    soloClock.hide();
    renderPips();
    const img = $('gImg'), st = $('gPhotoState');
    img.classList.remove('is-loaded');
    st.className = 'photo-state is-loading';
    st.innerHTML = '';
    $('gSubmit').disabled = true;

    const r = await api('POST', '/api/solo/start', { mode });
    if (solo.mode !== mode || current !== 'game') return;
    if (!r.ok) {
      st.className = 'photo-state';
      st.innerHTML = `<div><p>${r.status === 0 ? 'Couldn’t reach the server.' : 'Couldn’t start the game.'}</p><button class="btn btn--ghost" data-action="solo" data-mode="${esc(mode)}">Try again</button></div>`;
      return;
    }
    Object.assign(solo, { sessionId: r.data.sessionId, images: r.data.images, maxPerCar: r.data.maxPerCar, timeLimitMs: r.data.timeLimitMs, phase: 'guess' });
    loadSoloRound();
  }

  function loadSoloRound() {
    solo.phase = 'guess';
    $('gCount').textContent = `Car ${solo.idx + 1} of ${TOTAL}`;
    $('gReveal').hidden = true;
    $('gReport').open = false;
    $('gReportNote').value = '';
    $('gForm').hidden = false;
    resetGuess('g');
    renderPips();
    soloClock.hide();
    const idx = solo.idx;
    loadPhoto($('gImg'), $('gPhotoState'), solo.images[idx], {
      onShown() {
        if (solo.idx !== idx || solo.phase !== 'guess') return;
        api('POST', '/api/solo/shown', { sessionId: solo.sessionId, idx });
        if (solo.timeLimitMs) soloClock.start(Date.now() + solo.timeLimitMs, solo.timeLimitMs, () => submitSolo({ timedOut: true }));
      },
      onFail(stateEl) {
        stateEl.querySelector('div').insertAdjacentHTML('beforeend', '<button class="btn btn--ghost" data-action="skip">Skip this car</button>');
        api('POST', '/api/report', { type: 'bug', note: `image failed to load: ${solo.images[idx]}`, mode: solo.mode, userAgent: navigator.userAgent });
      },
    });
    preload(solo.images[idx + 1]);
    focusFirst('g', solo.mode);
  }

  async function submitSolo({ timedOut = false, skip = false } = {}) {
    if (solo.phase !== 'guess' || solo.busy || !solo.sessionId) return;
    const guess = skip ? {} : readGuess('g', solo.mode);
    const empty = isEmptyGuess(guess);
    if (empty && !timedOut && !skip) {
      $('gMsg').textContent = solo.mode === 'kit' ? 'Type a tuner name, or your best guess.' : 'Fill in at least one box: make, model or year.';
      focusFirst('g', solo.mode);
      return;
    }
    solo.busy = true;
    soloClock.stop();
    guessInputs('g').forEach(i => { i.disabled = true; });
    $('gMsg').textContent = '';
    const btn = $('gSubmit');
    btn.disabled = true;
    btn.classList.add('is-busy');

    let r = await api('POST', '/api/solo/guess', { sessionId: solo.sessionId, idx: solo.idx, ...guess });
    if (!r.ok && r.status === 0) r = await api('POST', '/api/solo/guess', { sessionId: solo.sessionId, idx: solo.idx, ...guess });
    solo.busy = false;
    btn.classList.remove('is-busy');
    if (current !== 'game' || solo.phase !== 'guess') return;
    if (!r.ok) {
      if (r.status === 404) {
        $('gMsg').innerHTML = 'This game expired on the server. <button class="link-btn" data-action="replay">Start a new one</button>';
      } else {
        $('gMsg').textContent = 'Couldn’t reach the server. Check your connection and try again.';
        guessInputs('g').forEach(i => { i.disabled = false; });
        btn.disabled = false;
      }
      return;
    }
    const d = r.data;
    solo.results.push({ pts: d.pts, res: d.res, answer: d.answer, late: d.late });
    solo.idx = d.idx;
    solo.phase = 'reveal';
    renderSoloReveal(d, empty, timedOut);
  }

  function renderSoloReveal(d, empty, timedOut) {
    const v = verdictFor(d.pts, solo.maxPerCar, empty, d.late);
    if (timedOut && empty) v.text = 'Time’s up';
    $('gVerdict').textContent = v.text;
    $('gVerdict').className = `reveal-verdict ${v.cls}`;
    $('gAnswer').innerHTML = answerHtml(d.answer, solo.mode);
    $('gHint').textContent = hintText(d.answer, solo.mode);
    $('gChips').innerHTML = chipsHtml(d.res);
    $('gForm').hidden = true;
    $('gNext').textContent = d.done ? 'See results' : 'Next car';
    playReveal($('gReveal'));
    solo.score = d.score;
    countTo($('gScore'), d.score);
    renderPips();
    if (coarse.matches) $('gReveal').scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    else $('gNext').focus({ preventScroll: true });
  }

  function soloNext() {
    if (solo.phase !== 'reveal') return;
    if (solo.idx >= TOTAL) return showSoloResults();
    loadSoloRound();
  }

  function resultLine(pct) {
    if (pct >= 0.9) return 'Showroom-grade. You could run the auction.';
    if (pct >= 0.7) return 'Proper car person.';
    if (pct >= 0.5) return 'Solid. A few more meets and you’ll have it.';
    if (pct >= 0.25) return 'You know the badges. Now learn the cars.';
    return 'Back to the car park. Every expert started here.';
  }

  function showSoloResults() {
    solo.phase = 'done';
    soloClock.hide();
    ['gForm', 'gReveal', 'gPhoto'].forEach(id => { $(id).hidden = true; });
    const max = TOTAL * solo.maxPerCar;
    $('gCount').textContent = 'Finished';
    $('gResults').hidden = false;
    $('rScore').textContent = '0';
    $('rMax').textContent = max;
    countTo($('rScore'), solo.score);
    $('rLine').textContent = resultLine(solo.score / max);
    $('rSave').hidden = false;
    $('rSaved').hidden = true;
    $('rSaveBtn').disabled = false;
    $('rName').value = store.get('vc_name');
    $('rLog').innerHTML = solo.results.map((r, i) => {
      const a = r.answer;
      const name = solo.mode === 'kit' ? `${esc(a.kit)}<small>${esc(a.make)} ${esc(a.model)}</small>` : `${esc(a.make)} ${esc(a.model)}<small>${esc(a.year)}</small>`;
      const cls = r.pts >= solo.maxPerCar ? 'is-hit' : r.pts === 0 ? 'is-miss' : '';
      return `<li><span class="n">${i + 1}</span><span class="car">${name}</span><span class="pts ${cls}">${r.pts}</span></li>`;
    }).join('');
    window.scrollTo({ top: 0 });
  }

  async function saveScore(e) {
    e.preventDefault();
    const name = $('rName').value.trim();
    if (!name) { $('rName').focus(); toast('Add a name first'); return; }
    if (solo.saved) return;
    store.set('vc_name', name);
    const btn = $('rSaveBtn');
    btn.disabled = true;
    btn.classList.add('is-busy');
    const r = await api('POST', '/api/scores', { sessionId: solo.sessionId, name });
    btn.classList.remove('is-busy');
    if (r.ok || r.status === 409) {
      solo.saved = true;
      $('rSave').hidden = true;
      $('rSaved').hidden = false;
      $('rSaved').textContent = r.ok
        ? `Saved. You’re #${r.data.rank} of ${r.data.total} in ${MODE_NAME[solo.mode]}.`
        : 'This score is already on the board.';
      lbMode = solo.mode;
    } else {
      btn.disabled = false;
      toast(r.status === 0 ? 'Couldn’t reach the server. Try again.' : (r.data.error || 'Couldn’t save the score.'));
    }
  }

  async function sendReport() {
    const last = solo.results[solo.results.length - 1];
    if (!last) return;
    const note = $('gReportNote').value.trim();
    const a = last.answer;
    const r = await api('POST', '/api/report', { type: 'bug', note, mode: solo.mode, car: { id: a.id, make: a.make, model: a.model, year: a.year, kit: a.kit }, userAgent: navigator.userAgent });
    $('gReport').open = false;
    $('gReportNote').value = '';
    toast(r.ok ? 'Thanks. Report sent.' : 'Couldn’t send the report.');
  }

  $('gForm').addEventListener('submit', e => { e.preventDefault(); submitSolo(); });
  $('rSave').addEventListener('submit', saveScore);

  // ---------------------------------------------------------------- leaderboard
  let lbMode = 'worldwide';
  $('lbTabs').innerHTML = Object.keys(MODE_NAME).map(m => `<button class="tab" role="tab" data-mode="${m}" aria-selected="false">${esc(MODE_NAME[m])}</button>`).join('');
  $('lbTabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    lbMode = t.dataset.mode;
    loadBoard();
  });
  let lbReq = 0;
  async function loadBoard() {
    [...$('lbTabs').children].forEach(t => {
      const on = t.dataset.mode === lbMode;
      t.setAttribute('aria-selected', String(on));
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    const list = $('lbList');
    const req = ++lbReq;
    list.innerHTML = '<li class="board-empty is-loading">Loading scores…</li>';
    const r = await api('GET', `/api/leaderboard?mode=${encodeURIComponent(lbMode)}`);
    if (req !== lbReq) return;
    if (!r.ok) { list.innerHTML = '<li class="board-empty">Couldn’t load scores. Check your connection.</li>'; return; }
    const rows = Array.isArray(r.data) ? r.data : [];
    if (!rows.length) {
      list.innerHTML = `<li class="board-empty">No scores in ${esc(MODE_NAME[lbMode])} yet. Play a round and take the top spot.</li>`;
      return;
    }
    list.innerHTML = rows.map((row, i) => `<li><span class="rank">${i + 1}</span><span class="who">${esc(row.name)}</span><span class="score">${row.score}<small> / ${row.maxScore}</small></span></li>`).join('');
  }

  // ---------------------------------------------------------------- party
  const socket = typeof io === 'function' ? io({ transports: ['websocket', 'polling'] }) : null;
  const party = { code: null, youId: null, mode: null, state: null, players: [], round: null, answered: false, myResult: null, offset: 0, total: TOTAL, sending: false };
  const partyClock = makeClock('pg');
  const tabKey = (() => {
    let k = tabStore.get('vc_key');
    if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
      const a = new Uint8Array(18);
      crypto.getRandomValues(a);
      k = btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      tabStore.set('vc_key', k);
    }
    return k;
  })();

  $('pcMode').innerHTML = Object.entries(MODE_NAME).map(([m, n]) => `<option value="${m}">${esc(n)}</option>`).join('');
  $('pcName').value = $('pjName').value = store.get('vc_name');

  function emit(event, payload) {
    return new Promise(resolve => {
      if (!socket) return resolve({ ok: false, error: 'Multiplayer is unavailable.' });
      socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) resolve({ ok: false, error: 'Couldn’t reach the server. Check your connection.' });
        else resolve(res || { ok: false });
      });
    });
  }

  const me = () => party.players.find(p => p.id === party.youId);
  const host = () => party.players.find(p => p.host);
  const isHost = () => !!(me() && me().host);
  const partyNav = name => show(name, { replace: PARTY_SCREENS.has(current), push: !PARTY_SCREENS.has(current) });

  function applySnapshot(s) {
    party.code = s.code;
    party.youId = s.youId;
    party.mode = s.mode;
    party.state = s.state;
    party.players = s.players || [];
    party.offset = (s.serverNow || Date.now()) - Date.now();
    tabStore.set('vc_party', s.code);
    if (s.state === 'lobby') { renderLobby(); partyNav('lobby'); }
    else if (s.state === 'playing' || s.state === 'reveal') {
      enterRound({ idx: s.round.idx, img: s.round.img, deadline: s.round.deadline, durationMs: s.round.durationMs, serverNow: s.serverNow, total: s.total }, s.round.you);
      if (s.state === 'reveal') applyReveal(s.reveal);
    } else if (s.state === 'final') renderFinal(s.standings);
  }

  function clearParty() {
    Object.assign(party, { code: null, youId: null, mode: null, state: null, players: [], round: null, answered: false, myResult: null, sending: false });
    tabStore.del('vc_party');
    partyClock.hide();
    $('conn').hidden = true;
  }

  async function partyCreate(e) {
    e.preventDefault();
    const name = $('pcName').value.trim();
    $('pMsg').textContent = '';
    if (!name) { $('pMsg').textContent = 'Add your name so friends know who you are.'; $('pcName').focus(); return; }
    store.set('vc_name', name);
    const r = await emit('party:create', { name, mode: $('pcMode').value, key: tabKey });
    if (!r.ok) { $('pMsg').textContent = r.error || 'Couldn’t create the party.'; return; }
    applySnapshot(r);
  }

  async function partyJoin(e) {
    e.preventDefault();
    const name = $('pjName').value.trim();
    const code = $('pjCode').value.trim().toUpperCase();
    $('pMsg').textContent = '';
    if (!name) { $('pMsg').textContent = 'Add your name so friends know who you are.'; $('pjName').focus(); return; }
    if (!/^[A-Z0-9]{5}$/.test(code)) { $('pMsg').textContent = 'Party codes are 5 letters and numbers.'; $('pjCode').focus(); return; }
    store.set('vc_name', name);
    const r = await emit('party:join', { name, code, key: tabKey });
    if (!r.ok) { $('pMsg').textContent = r.error || 'Couldn’t join that party.'; return; }
    applySnapshot(r);
  }

  function partyLeave({ silent = false } = {}) {
    if (party.code) emit('party:leave', {});
    clearParty();
    if (!silent) show('party', { replace: true });
  }

  let lastRosterIds = new Set();
  function renderLobby() {
    $('lobbyCode').textContent = party.code;
    $('lobbyCode').setAttribute('aria-label', `Party code ${party.code.split('').join(' ')}`);
    $('lobbyMode').textContent = MODE_NAME[party.mode] || party.mode;
    $('lobbyCount').textContent = `${party.players.length}`;
    $('lobbyPlayers').innerHTML = party.players.map(p => `
      <li data-id="${esc(p.id)}" class="${lastRosterIds.size && !lastRosterIds.has(p.id) ? 'is-new' : ''}">
        <span>${esc(p.name)}${p.id === party.youId ? ' <span class="me">(you)</span>' : ''}</span>
        ${p.host ? '<span class="tag">Host</span>' : ''}
        ${p.connected ? '' : '<span class="tag tag--away">Reconnecting</span>'}
      </li>`).join('');
    lastRosterIds = new Set(party.players.map(p => p.id));
    const h = host();
    $('lobbyStart').hidden = !isHost();
    $('lobbyStart').textContent = party.players.length > 1 ? `Start with ${party.players.length} drivers` : 'Start game';
    $('lobbyWait').hidden = isHost();
    $('lobbyWait').textContent = `Waiting for ${h ? h.name : 'the host'} to start.`;
  }

  function renderStandings({ deltas = false } = {}) {
    const rows = [...party.players].sort((a, b) => b.score - a.score);
    $('pgStandings').innerHTML = rows.map((p, i) => {
      const lead = party.state === 'playing'
        ? `<span class="rank"><span class="dot ${p.answered ? 'is-answered' : ''} ${p.connected ? '' : 'is-away'}" title="${p.answered ? 'Answered' : 'Thinking'}"></span></span>`
        : `<span class="rank">${i + 1}</span>`;
      const delta = deltas && p.lastPts != null ? `<span class="delta ${p.lastPts ? '' : 'is-zero'}">+${p.lastPts}</span>` : '';
      return `<li>${lead}<span class="who">${esc(p.name)}${p.id === party.youId ? '<small>you</small>' : ''}${p.connected ? '' : '<small>reconnecting</small>'}</span><span class="score">${delta}${p.score}</span></li>`;
    }).join('');
    const m = me();
    if (m) countTo($('pgScore'), m.score);
  }

  function updateWaiting() {
    const left = party.players.filter(p => p.connected && !p.answered).length;
    $('pgWaiting').textContent = left > 0 ? `Waiting for ${left} more.` : '';
  }

  function enterRound(round, myResult) {
    party.state = 'playing';
    party.round = round;
    party.total = round.total || TOTAL;
    party.answered = !!myResult;
    party.myResult = myResult || null;
    if (round.serverNow) party.offset = round.serverNow - Date.now();
    partyNav('pgame');
    $('pgMode').textContent = MODE_NAME[party.mode] || party.mode;
    $('pgCount').textContent = `Car ${round.idx + 1} of ${party.total}`;
    setGuessMode('pg', party.mode);
    resetGuess('pg');
    $('pgReveal').hidden = true;
    $('pgForm').hidden = party.answered;
    $('pgLocked').hidden = !party.answered;
    loadPhoto($('pgImg'), $('pgPhotoState'), round.img);
    preload(round.nextImg);
    partyClock.start(round.deadline - party.offset, round.durationMs, () => {
      if (party.state === 'playing' && !party.answered) {
        guessInputs('pg').forEach(i => { i.disabled = true; });
        $('pgSubmit').disabled = true;
        $('pgMsg').textContent = 'Time’s up.';
      }
    }, left => {
      // Send whatever is typed just before the server closes the round.
      if (left < 600 && party.state === 'playing' && !party.answered && !party.sending && !isEmptyGuess(readGuess('pg', party.mode))) partySubmit();
    });
    renderStandings();
    updateWaiting();
    if (!party.answered) focusFirst('pg', party.mode);
  }

  async function partySubmit(e) {
    if (e) e.preventDefault();
    if (party.state !== 'playing' || party.answered || party.sending) return;
    const guess = readGuess('pg', party.mode);
    if (isEmptyGuess(guess)) {
      if (e) $('pgMsg').textContent = party.mode === 'kit' ? 'Type a tuner name, or your best guess.' : 'Fill in at least one box: make, model or year.';
      return;
    }
    party.sending = true;
    const btn = $('pgSubmit');
    btn.disabled = true;
    btn.classList.add('is-busy');
    guessInputs('pg').forEach(i => { i.disabled = true; });
    const r = await emit('party:guess', { idx: party.round.idx, ...guess });
    party.sending = false;
    btn.classList.remove('is-busy');
    if (!r.ok) {
      const final = r.error === 'Round is over' || r.error === 'Already answered';
      if (party.state === 'playing' && !final) {
        btn.disabled = false;
        guessInputs('pg').forEach(i => { i.disabled = false; });
      }
      $('pgMsg').textContent = r.error || 'Couldn’t send your answer.';
      return;
    }
    party.answered = true;
    party.myResult = { pts: r.pts, res: r.res };
    if (party.state === 'playing') {
      $('pgForm').hidden = true;
      $('pgLocked').hidden = false;
      updateWaiting();
    }
  }

  function applyReveal(d) {
    party.state = 'reveal';
    partyClock.hide();
    party.players = d.standings || party.players;
    $('pgForm').hidden = true;
    $('pgLocked').hidden = true;
    const mine = party.myResult;
    const v = verdictFor(mine ? mine.pts : 0, 5, !mine, false);
    $('pgVerdict').textContent = mine ? v.text : 'No answer this round';
    $('pgVerdict').className = `reveal-verdict ${v.cls}`;
    $('pgAnswer').innerHTML = answerHtml(d, party.mode);
    $('pgHint').textContent = hintText(d, party.mode);
    $('pgChips').innerHTML = mine ? chipsHtml(mine.res) : '';
    playReveal($('pgReveal'));
    updateHostControls();
    renderStandings({ deltas: true });
  }

  function updateHostControls() {
    const last = party.round && party.round.idx >= party.total - 1;
    if (party.state === 'reveal') {
      $('pgNext').hidden = !isHost();
      $('pgNext').textContent = last ? 'See final standings' : 'Next car';
      $('pgWaitHost').hidden = isHost();
      const h = host();
      $('pgWaitHost').textContent = `Waiting for ${h ? h.name : 'the host'} to continue.`;
    }
    if (party.state === 'final') {
      $('pfAgain').hidden = !isHost();
      $('pfWait').hidden = isHost();
    }
  }

  function renderFinal(standings) {
    party.state = 'final';
    party.players = standings || party.players;
    partyClock.hide();
    partyNav('pfinal');
    const rows = [...party.players].sort((a, b) => b.score - a.score);
    const top = rows[0];
    const tied = rows.filter(p => top && p.score === top.score);
    $('pfWinner').textContent = !top ? '' : tied.length > 1
      ? `${tied.map(p => p.name).join(' and ')} tie on ${top.score} points.`
      : `${top.name} wins with ${top.score} points.`;
    $('pfStandings').innerHTML = rows.map((p, i) => `<li><span class="rank">${i + 1}</span><span class="who">${esc(p.name)}${p.id === party.youId ? '<small>you</small>' : ''}</span><span class="score">${p.score}</span></li>`).join('');
    updateHostControls();
  }

  async function partyStart() {
    const r = await emit('party:start', {});
    if (!r.ok) toast(r.error || 'Couldn’t start the game.');
  }
  async function partyNext() {
    const btn = $('pgNext');
    if (btn.disabled) return;
    btn.disabled = true;
    const r = await emit('party:next', { idx: party.round ? party.round.idx : undefined });
    btn.disabled = false;
    if (!r.ok && r.error !== 'Already moved on') toast(r.error || 'Couldn’t continue.');
  }

  async function copyInvite() {
    const url = `${location.origin}/?join=${party.code}`;
    try {
      if (navigator.share && coarse.matches) { await navigator.share({ title: 'VicCall', text: `Join my VicCall party: ${party.code}`, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Invite link copied');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast(`Party code: ${party.code}`);
    }
  }

  async function resume() {
    const code = party.code || tabStore.get('vc_party');
    if (!code) return;
    const r = await emit('party:resume', { code, key: tabKey });
    if (r.ok) applySnapshot(r);
    else if (party.code || PARTY_SCREENS.has(current)) {
      clearParty();
      show('party', { replace: true });
      $('pMsg').textContent = 'That party has ended.';
    } else tabStore.del('vc_party');
  }

  if (socket) {
    socket.on('connect', () => { $('conn').hidden = true; resume(); });
    socket.on('disconnect', () => { if (party.code) $('conn').hidden = false; });
    socket.on('party:players', d => {
      party.players = d.players;
      if (party.state === 'lobby') renderLobby();
      else if (party.state === 'playing') { renderStandings(); updateWaiting(); }
      else if (party.state === 'reveal') { renderStandings({ deltas: true }); updateHostControls(); }
      else if (party.state === 'final') renderFinal(party.players);
    });
    socket.on('party:round', d => enterRound(d, null));
    socket.on('party:progress', d => {
      if (d.players) party.players = d.players;
      if (party.state === 'playing') { renderStandings(); updateWaiting(); }
    });
    socket.on('party:reveal', d => applyReveal(d));
    socket.on('party:final', d => renderFinal(d.standings));
  }

  $('pCreate').addEventListener('submit', partyCreate);
  $('pJoin').addEventListener('submit', partyJoin);
  $('pgForm').addEventListener('submit', partySubmit);
  $('pjCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  // Invite links: /?join=CODE
  (() => {
    const params = new URLSearchParams(location.search);
    const code = (params.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (!code) return;
    history.replaceState({ screen: 'home', depth: 0 }, '', location.pathname);
    show('party');
    $('pjCode').value = code;
    ($('pjName').value ? $('pJoin').querySelector('button') : $('pjName')).focus();
  })();

  // ---------------------------------------------------------------- actions + keyboard
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'nav': show(el.dataset.to); if (el.dataset.to === 'leaderboard') loadBoard(); break;
      case 'back': back(); break;
      case 'home': show('home'); break;
      case 'deck-prev': deckGo(deckIdx - 1, { wrap: true }); break;
      case 'deck-next': deckGo(deckIdx + 1, { wrap: true }); break;
      case 'deck-play': playDeck(); break;
      case 'solo': startSolo(el.dataset.mode); break;
      case 'quit-solo': solo.phase = 'idle'; soloClock.stop(); back(); break;
      case 'next': soloNext(); break;
      case 'skip': submitSolo({ skip: true }); break;
      case 'replay': startSolo(solo.mode); break;
      case 'report': sendReport(); break;
      case 'party-start': partyStart(); break;
      case 'party-next': partyNext(); break;
      case 'party-leave': partyLeave(); break;
      case 'copy-invite': copyInvite(); break;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing) return;
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (current === 'home' && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest('.deck-track')) {
      deckGo(deckIdx + (e.key === 'ArrowRight' ? 1 : -1), { wrap: true });
    }
    if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SUMMARY') {
      if (current === 'game' && solo.phase === 'reveal') { e.preventDefault(); soloNext(); }
      else if (current === 'pgame' && party.state === 'reveal' && isHost()) { e.preventDefault(); partyNext(); }
    }
  });

  // Small hook for automated UI checks.
  window.VicCall = { show, startSolo, state: () => ({ current, solo: { ...solo }, party: { ...party } }) };
  metaReady.catch(() => {});
})();
