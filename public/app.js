/* VicCall client. Vanilla JS, no build step. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- basics
  const $ = id => document.getElementById(id);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  const MAX = 10;

  const store = {
    get(k, fallback = '') { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    json(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const tabStore = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };
  const randomKey = () => {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const validKey = k => typeof k === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(k);
  // One key per browser (daily attempt), one per tab (party seat).
  const playerKey = (() => { let k = store.get('vc_player'); if (!validKey(k)) { k = randomKey(); store.set('vc_player', k); } return k; })();
  const tabKey = (() => { let k = tabStore.get('vc_key'); if (!validKey(k)) { k = randomKey(); tabStore.set('vc_key', k); } return k; })();

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Audio is optional: if audio.js failed to load, everything still works silently.
  const A = window.VCAudio || {
    play() {}, scene() {}, intensity() {}, onChange() {}, set() {},
    get: () => ({ muted: true, master: 80, music: 50, sfx: 80, theme: 'off' }),
  };

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(method, url, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        method, signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json', 'X-VicCall': '1' } : { 'X-VicCall': '1' },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, data: data || {} };
    } catch {
      return { ok: false, status: 0, data: { error: 'network' } };
    } finally { clearTimeout(timer); }
  }

  function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  function countTo(el, to, { dur = 420, onStep } = {}) {
    const from = parseInt(el.textContent, 10) || 0;
    if (from === to) return;
    bump(el);
    if (reduceMotion.matches) { el.textContent = to; return; }
    const t0 = performance.now();
    let last = from;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      el.textContent = v;
      if (onStep && v !== last) onStep(v);
      last = v;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const fmtTime = ms => {
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
  };
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const plateDate = iso => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
  const niceDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' }); };
  const shiftDay = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const localClock = ms => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ');

  // ---------------------------------------------------------------- photos
  // Wikimedia thumbnail -> original file, for photos smaller than the thumbnail size.
  const originalOf = url => { const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/thumb\/(.+)\/[^/]+$/.exec(url || ''); return m ? `${m[1]}/${m[2]}` : null; };
  const fallbacks = src => (src.startsWith('/api/img/') ? [src, `${src}?orig=1`] : [src, originalOf(src)].filter(Boolean));
  const commonsLink = credit => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(String(credit).replace(/ /g, '_'))}`;

  function loadPhoto(img, stateEl, src, { onShown, onFail } = {}) {
    const chain = fallbacks(src);
    let i = 0;
    img.classList.remove('is-loaded');
    img.removeAttribute('src');
    stateEl.className = 'photo-state is-loading';
    stateEl.innerHTML = '';
    const token = (img._token = (img._token || 0) + 1);
    img.onload = () => {
      if (img._token !== token) return;
      img.classList.add('is-loaded');
      stateEl.className = 'photo-state';
      if (onShown) onShown();
    };
    img.onerror = () => {
      if (img._token !== token) return;
      if (++i < chain.length) { img.src = chain[i]; return; }
      stateEl.className = 'photo-state';
      stateEl.innerHTML = '<div><p>This photo didn’t load.</p></div>';
      if (onFail) onFail(stateEl);
    };
    img.src = chain[0];
  }
  const preload = src => { if (src) { const i = new Image(); i.decoding = 'async'; i.src = src; } };

  // ---------------------------------------------------------------- crash reports
  const crashSeen = new Set();
  function captureCrash(message, stack) {
    if (crashSeen.size >= 10) return;
    const k = `${message}|${String(stack || '').slice(0, 200)}`;
    if (crashSeen.has(k)) return;
    crashSeen.add(k);
    let mode = '';
    try { mode = (solo.req && (solo.req.playlist || solo.req.kind)) || (party.code ? 'party' : ''); } catch {}
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
  const GAME_SCREENS = new Set(['game', 'pgame']);

  function show(name, { push = true, replace = false } = {}) {
    if (!screens[name]) name = 'home';
    closeMenus();
    closeNav();
    if (name !== current) {
      screens[current].hidden = true;
      const el = screens[name];
      el.hidden = false;
      el.classList.remove('is-entering');
      void el.offsetWidth;
      el.classList.add('is-entering');
      window.scrollTo(0, 0);
      // Move focus to the new screen so keyboard and screen-reader users land in the right place.
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
      if (current === 'game' && name !== 'game') leaveSolo();
      current = name;
      document.body.classList.toggle('in-game', GAME_SCREENS.has(name));
      document.querySelectorAll('.nav-btn[data-to]').forEach(b => b.classList.toggle('is-current', b.dataset.to === name));
      if (!GAME_SCREENS.has(name) && name !== 'lobby' && name !== 'pfinal') A.scene('menu');
    }
    if (replace) history.replaceState({ screen: name, depth }, '');
    else if (push) { depth += 1; history.pushState({ screen: name, depth }, ''); }
    if (name === 'home') renderHome();
    showHooks.forEach(fn => { try { fn(name); } catch (e) { captureCrash(e.message, e.stack); } });
  }
  const showHooks = []; // garage.js renders its screens when they open
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

  function goHome() {
    if (current === 'home') return;
    show('home');
  }

  // ---------------------------------------------------------------- top nav + dropdowns
  const nav = $('nav');
  const menuBtns = [...document.querySelectorAll('[data-menu]')];
  const popFor = btn => $(btn.getAttribute('aria-controls'));
  let hoverTimer = 0;

  function openMenu(btn, { focus = false } = {}) {
    menuBtns.forEach(b => { if (b !== btn) closeMenu(b); });
    btn.setAttribute('aria-expanded', 'true');
    const pop = popFor(btn);
    pop.hidden = false;
    if (focus) pop.querySelector('button').focus();
  }
  function closeMenu(btn) { btn.setAttribute('aria-expanded', 'false'); popFor(btn).hidden = true; }
  function closeMenus() { menuBtns.forEach(closeMenu); }
  function closeNav() { nav.classList.remove('is-open'); $('navToggle').setAttribute('aria-expanded', 'false'); }
  const desktopNav = () => matchMedia('(min-width: 861px) and (hover: hover)').matches;

  menuBtns.forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      // A click right after hovering it open keeps it open (the pointer got there first).
      if (btn.getAttribute('aria-expanded') === 'true' && Date.now() - (btn._hoverOpenedAt || 0) > 600) closeMenu(btn); else openMenu(btn);
    });
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(btn, { focus: true }); }
    });
    const wrap = btn.parentElement;
    wrap.addEventListener('mouseenter', () => {
      if (!desktopNav()) return;
      clearTimeout(hoverTimer);
      if (btn.getAttribute('aria-expanded') !== 'true') btn._hoverOpenedAt = Date.now();
      openMenu(btn);
    });
    wrap.addEventListener('mouseleave', () => { if (!desktopNav()) return; hoverTimer = setTimeout(() => closeMenu(btn), 160); });
    popFor(btn).addEventListener('keydown', e => {
      const items = [...popFor(btn).querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(btn); btn.focus(); }
      else if (e.key === 'Tab') closeMenu(btn);
    });
  });
  document.addEventListener('click', e => { if (!e.target.closest('.menu')) closeMenus(); if (!e.target.closest('.bar')) closeNav(); });

  // ---------------------------------------------------------------- meta + home
  let META = null;
  // The daily runs on one clock for everyone, the server's UTC day. This browser's
  // clock only decides how the reset time is shown, never which day it is.
  let clockOffset = 0;
  const serverNow = () => Date.now() + clockOffset;
  const useMeta = data => { META = data; clockOffset = typeof data.now === 'number' ? data.now - Date.now() : 0; };
  const metaReady = api('GET', '/api/meta').then(r => {
    if (!r.ok) { $('tower').innerHTML = '<li class="board-empty">Couldn’t reach the server. Check your connection and reload.</li>'; return; }
    useMeta(r.data);
    $('makeList').innerHTML = (META.makes || []).map(m => `<option value="${esc(m)}">`).join('');
    buildBuilder();
    buildPlaylistSelects();
    buildBoardTabs();
    renderHome();
  });
  const playlist = id => (META && META.playlists.find(p => p.id === id)) || { id, title: id, desc: '', kind: 'car' };

  const bestKey = board => `vc_best_${board}`;
  const dailyKey = date => `vc_daily_${date}`;

  function renderHome() {
    if (!META) return;
    renderDaily();
    const eb = store.json(bestKey('endless'));
    $('endlessBest').innerHTML = eb ? `Your best run: <b>${eb.cars}</b> cars, <b>${eb.score}</b> points` : 'No runs yet.';
    $('tower').innerHTML = `<li class="tower-head" aria-hidden="true"><span></span><span>Playlist</span><span></span><span>Cars</span><span>Your best</span><span></span></li>` +
      META.playlists.map(p => {
        const best = store.json(bestKey(`ranked:${p.id}`));
        return `<li><button class="tower-row" data-action="ranked" data-playlist="${esc(p.id)}" aria-label="${esc(p.title)}: ${esc(p.desc)}${best ? `, your best ${best.score}` : ''}">
          <span class="tower-name">${esc(p.title)}</span>
          <span class="tower-desc">${esc(p.desc)}</span>
          <span class="tower-num tower-num--cars">${p.size}</span>
          <span class="tower-num tower-num--best ${best ? '' : 'is-empty'}">${best ? best.score : '–'}</span>
          <svg class="ic tower-go" aria-hidden="true"><use href="#i-chevron-right"/></svg>
        </button></li>`;
      }).join('');
  }

  let dailyTimer = 0, metaCheckedAt = 0;
  const nextDailyAt = () => META.daily.nextAt || Date.parse(`${shiftDay(META.daily.date, 1)}T00:00:00Z`);
  // Past the reset with the page still open: fetch the new day (at most once a minute).
  async function refreshDaily() {
    if (Date.now() - metaCheckedAt < 60_000) return;
    metaCheckedAt = Date.now();
    const r = await api('GET', '/api/meta');
    if (!r.ok) return;
    useMeta(r.data);
    if (lbBoard && lbBoard.startsWith('daily:')) lbBoard = `daily:${META.daily.date}`;
    buildBoardTabs();
    renderHome();
    if (current === 'leaderboard') loadBoard();
  }
  function renderDaily() {
    const date = META.daily.date;
    const [, m, d] = date.split('-').map(Number);
    $('dailyPlate').innerHTML = `<span>${d}</span><span>${MONTHS[m - 1]}</span>`;
    const rec = store.json(dailyKey(date));
    if (rec) {
      $('dailyActions').innerHTML = `
        <div class="daily-done"><b>${rec.score}</b><span class="count">/ ${rec.max}</span><span class="squares" aria-label="Your ten cars">${esc(rec.squares)}</span></div>
        <button class="btn btn--ghost" data-action="share-daily"><svg class="ic"><use href="#i-share"/></svg>Share</button>
        <button class="btn btn--quiet" data-action="daily">Practice again</button>`;
    } else {
      $('dailyActions').innerHTML = '<button class="btn btn--primary btn--lg" data-action="daily">Play today’s ten</button><button class="btn btn--quiet" data-action="lb-daily">Today’s leaderboard</button>';
    }
    const tick = () => {
      const next = nextDailyAt();
      const mins = Math.max(0, Math.ceil((next - serverNow()) / 60000));
      const h = Math.floor(mins / 60), m = mins % 60;
      const when = h ? `${h} h ${m} min` : `${m} min`;
      const at = localClock(next);
      $('dailyMeta').textContent = rec
        ? `You’ve played today${rec.rank ? `: #${rec.rank} on the board` : ''}. Next ten at ${at} your time, in ${when}.`
        : `A new ten every day at midnight UTC (${at} your time). Next in ${when}.`;
    };
    tick();
    clearInterval(dailyTimer);
    dailyTimer = setInterval(() => {
      if (serverNow() >= nextDailyAt()) refreshDaily();
      else if (current === 'home') tick();
    }, 30_000);
  }

  // ---------------------------------------------------------------- Free Play builder
  const FILTER_UI = {
    era: { legend: 'Era', labels: { any: 'Any era', modern: 'Since 2010', nineties: '1990–2009', classic: 'Before 1990' } },
    region: { legend: 'Where from', wide: true, labels: { any: 'Anywhere', japan: 'Japan', germany: 'Germany', italy: 'Italy', uk: 'UK', usa: 'USA', france: 'France', europe: 'All of Europe' } },
    type: { legend: 'Type', labels: { any: 'Everything', supercar: 'Supercars', kit: 'Body kits' } },
    difficulty: { legend: 'Difficulty', labels: { any: 'Any', 1: 'Easy', 2: 'Medium', 3: 'Hard' } },
    timer: { legend: 'Clock', labels: { 0: 'Off', 60: '60 s', 30: '30 s', 15: '15 s' } },
  };
  let freeFilters = { era: 'any', region: 'any', type: 'any', difficulty: 'any', timer: '0', ...(store.json('vc_free') || {}) };

  function buildBuilder() {
    $('builderGroups').innerHTML = Object.entries(FILTER_UI).map(([k, ui]) => `
      <fieldset class="seg ${ui.wide ? 'seg--wide' : ''}">
        <legend>${esc(ui.legend)}</legend>
        <div class="seg-row">${(META.filters[k] || []).map(v => `
          <label><input type="radio" name="f-${k}" value="${esc(v)}" ${String(freeFilters[k]) === v ? 'checked' : ''}><span>${esc(ui.labels[v] || v)}</span></label>`).join('')}
        </div>
      </fieldset>`).join('');
    updateCount();
  }
  let countReq = 0, countTimer = 0;
  function updateCount() {
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      const req = ++countReq;
      const q = new URLSearchParams(freeFilters).toString();
      const r = await api('GET', `/api/pool?${q}`);
      if (req !== countReq || !r.ok) return;
      const n = r.data.size, el = $('builderCount');
      el.classList.toggle('is-warn', n === 0);
      $('builderStart').disabled = n === 0;
      el.innerHTML = n === 0 ? 'No cars match. Widen one of the filters.'
        : n < 10 ? `Only <b>${n}</b> ${n === 1 ? 'car matches' : 'cars match'}, so some will repeat.`
        : `<b>${n}</b> cars match.`;
    }, 120);
  }
  $('builder').addEventListener('change', e => {
    const k = e.target.name && e.target.name.replace(/^f-/, '');
    if (!k || !(k in FILTER_UI)) return;
    freeFilters[k] = e.target.value;
    store.setJson('vc_free', freeFilters);
    A.play('select');
    updateCount();
  });
  $('builder').addEventListener('submit', e => { e.preventDefault(); startSolo({ kind: 'free', filters: { ...freeFilters } }); });

  // ---------------------------------------------------------------- solo game
  const fresh = () => ({
    req: null, sessionId: null, kind: '', title: '', board: null, ruleset: 'casual', roundKind: 'car', clockMs: 0, rounds: 10, lives: null,
    idx: 0, score: 0, streak: 0, bestStreak: 0, strikes: 0, cars: 0, timeMs: 0, results: [], phase: 'idle', busy: false, saved: false,
    alreadyPlayed: false, date: null, photoFailed: false, lastSecond: -1, done: false,
  });
  const solo = { ...fresh(), token: 0 };
  const soloClock = makeClock('g');
  function leaveSolo() { soloClock.stop(); solo.phase = solo.phase === 'done' ? 'done' : 'idle'; }

  const titleFor = req => req.kind === 'daily' ? 'Daily Challenge' : req.kind === 'endless' ? 'Endless' : req.kind === 'free' ? 'Free Play' : playlist(req.playlist).title;
  function rulesLine() {
    if (solo.kind === 'free') return solo.clockMs ? `Typos forgiven. ${solo.clockMs / 1000} seconds a car.` : 'Typos forgiven. No clock.';
    if (solo.kind === 'endless') return 'Strict spelling, 45 seconds a car. Three misses ends the run.';
    return 'Strict spelling. The 45-second clock starts when the photo appears.';
  }

  function renderPips() {
    const el = $('gPips');
    if (solo.kind === 'endless') {
      el.className = 'pips pips--lives';
      el.setAttribute('aria-label', `${solo.lives - solo.strikes} of ${solo.lives} lives left`);
      el.innerHTML = Array.from({ length: solo.lives || 3 }, (_, i) => `<li class="life ${i < solo.strikes ? 'is-lost' : ''}"></li>`).join('');
      return;
    }
    el.className = 'pips';
    el.setAttribute('aria-label', 'Round results');
    el.innerHTML = Array.from({ length: solo.rounds }, (_, i) => {
      const r = solo.results[i];
      let cls = 'pip';
      if (r) cls += r.pts >= MAX ? ' is-hit' : r.pts > 0 ? ' is-close' : ' is-miss';
      else if (i === solo.idx && solo.phase !== 'reveal') cls += ' is-current';
      return `<li class="${cls}" aria-label="${r ? `Car ${i + 1}: ${r.pts} points` : `Car ${i + 1}`}"></li>`;
    }).join('');
  }
  function renderStreak(prev) {
    const el = $('gStreak');
    el.textContent = solo.streak;
    $('gStreakWrap').classList.toggle('is-hot', solo.streak >= 3);
    if (solo.streak > (prev || 0)) bump(el);
  }

  function setGuessMode(prefix, kind) {
    const kit = kind === 'kit';
    $(prefix + 'Fields').hidden = kit;
    $(prefix + 'KitFields').hidden = !kit;
  }
  const guessInputs = prefix => ['Car', 'Year', 'Kit', 'KitCar'].map(f => $(prefix + f));
  function resetGuess(prefix) {
    guessInputs(prefix).forEach(i => { i.value = ''; i.disabled = false; });
    $(prefix + 'Msg').textContent = '';
    const btn = $(prefix + 'Submit');
    btn.disabled = false;
    btn.classList.remove('is-busy');
  }
  function readGuess(prefix, kind) {
    const v = f => $(prefix + f).value.trim();
    if (kind === 'kit') return { kit: v('Kit'), car: v('KitCar') };
    return { car: v('Car'), year: v('Year') };
  }
  const isEmptyGuess = g => !Object.values(g).some(Boolean);
  function focusFirst(prefix, kind) {
    if (coarse.matches) return; // don't throw the keyboard over the photo on phones
    $(prefix + (kind === 'kit' ? 'Kit' : 'Car')).focus({ preventScroll: true });
  }
  const emptyMsg = kind => kind === 'kit' ? 'Type the tuner, or your best guess at the car underneath.' : 'Type the car, or at least the make or the year.';

  function identifiedFrom(res, kind) {
    const hit = l => (res || []).some(r => r.label === l && r.verdict === 'hit');
    return kind === 'kit' ? hit('Tuner') : hit('Make') && hit('Model');
  }
  function verdictFor(d, empty) {
    if (d.skipped) return { text: 'Skipped: the photo didn’t load', cls: '' };
    if (d.late) return { text: 'Too late, the clock ran out', cls: 'is-miss' };
    if (empty) return { text: d.timedOut ? 'Time’s up' : 'No answer', cls: 'is-miss' };
    if (d.pts >= MAX) return { text: 'Spot on', cls: 'is-hit' };
    if (d.identified) return { text: 'You named it', cls: 'is-hit' };
    if (d.pts >= 5) return { text: 'Close', cls: '' };
    if (d.pts > 0) return { text: 'Partly right', cls: '' };
    return { text: 'Not this time', cls: 'is-miss' };
  }
  function chipsHtml(res, skipped) {
    if (skipped) return '';
    return (res || []).map((r, i) => {
      const note = r.verdict === 'hit' ? '' : r.verdict === 'skip' ? 'Left blank' : r.note;
      const cls = r.verdict === 'skip' ? 'miss' : r.verdict;
      return `<li class="chip is-${cls}"><span class="lab">${esc(r.label)}</span><b>${r.pts > 0 ? '+' + r.pts : '0'}<span class="sr-only"> of ${r.max}</span></b>${note ? `<span class="note">${esc(note)}</span>` : ''}</li>`;
    }).join('');
  }
  // The chips come in one after another. Set through the DOM: the CSP allows no inline style attributes.
  const stagger = el => [...el.children].forEach((c, i) => c.style.setProperty('--i', i));
  const yearText = a => (Array.isArray(a.yearRange) && a.yearRange[0] !== a.yearRange[1] ? `${a.yearRange[0]}–${a.yearRange[1]}` : String(a.year));
  const carName = a => [a.make, a.model, a.variant].filter(Boolean).join(' ');
  const detail = a => [a.generation, yearText(a)].filter(Boolean).join(', ');
  // Keep hyphenated names ("MX-5", "GT-R") on one line.
  const unbroken = text => esc(text).split(' ').map(w => (w.includes('-') ? `<span class="nw">${w}</span>` : w)).join(' ');
  function answerHtml(a, kind) {
    if (kind === 'kit' || a.kit) return `${unbroken(a.kit)}<span class="yr">${esc(carName(a))}, ${esc(detail(a))}</span>`;
    return `${unbroken(carName(a))}<span class="yr">${esc(detail(a))}</span>`;
  }
  // Photo credit under the reveal. Community photos name the photographer
  // (profile opens in a new tab so a game in progress isn't lost); first-party
  // photos name the author and licence stated on Wikimedia Commons.
  function creditHtml(a) {
    if (a.photo && a.photo.source === 'community') {
      const by = a.photo.profile
        ? `<a href="/?profile=${encodeURIComponent(a.photo.profile)}" target="_blank" rel="noopener">${esc(a.photo.by)}</a>`
        : esc(a.photo.by);
      return `Photo: ${by}, VicCall Community Garage`;
    }
    if (!a.credit) return '';
    const at = a.attribution;
    const name = at && at.author ? at.author : a.credit.replace(/\.(jpe?g|png|webp)$/i, '');
    const licence = at && at.licence
      ? `, ${at.licenceUrl ? `<a href="${esc(at.licenceUrl)}" target="_blank" rel="noopener">${esc(at.licence)}</a>` : esc(at.licence)}`
      : '';
    return `Photo: <a href="${commonsLink(a.credit)}" target="_blank" rel="noopener">${esc(name)}</a>${licence}, Wikimedia Commons`;
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
      wrap.classList.toggle('is-urgent', left <= Math.min(10000, total / 3));
      if (onTick) onTick(left, secs);
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
  // Clock sounds and music pressure, shared by solo and party.
  function clockFeedback(state, secs, totalMs) {
    if (secs === state.lastSecond) return;
    state.lastSecond = secs;
    const warnAt = Math.min(10, Math.floor(totalMs / 3000));
    if (secs === warnAt) A.play('warn');
    else if (secs <= 5 && secs > 0) A.play('tick');
  }
  function musicLevel({ progress = 0, streak = 0, pressure = 0 }) {
    A.intensity(Math.min(1, 0.18 + progress * 0.4 + Math.min(streak, 8) * 0.05 + pressure * 0.35));
  }

  async function startSolo(req) {
    const token = ++solo.token;
    Object.assign(solo, fresh(), { req, title: titleFor(req), phase: 'starting', kind: req.kind });
    show('game', { replace: current === 'game', push: current !== 'game' });
    $('gTitle').textContent = solo.title;
    $('gScore').textContent = '0';
    solo.streak = 0; renderStreak();
    $('gStreakWrap').hidden = req.kind === 'free';
    $('gResults').hidden = true;
    screens.game.classList.remove('is-results');
    $('gStage').hidden = false;
    $('gReveal').hidden = true;
    $('gForm').hidden = false;
    $('gCredit').hidden = true;
    $('gCount').textContent = '';
    $('gRules').textContent = '';
    soloClock.hide();
    resetGuess('g');
    guessInputs('g').forEach(i => { i.disabled = true; });
    $('gSubmit').disabled = true;
    const img = $('gImg'), st = $('gPhotoState');
    img.classList.remove('is-loaded');
    st.className = 'photo-state is-loading';
    st.innerHTML = '';
    renderPips();

    const r = await api('POST', '/api/solo/start', { ...req, player: playerKey });
    if (token !== solo.token || current !== 'game') return;
    if (!r.ok) {
      st.className = 'photo-state';
      st.innerHTML = `<div><p>${r.status === 0 ? 'Couldn’t reach the server.' : esc(r.data.error || 'Couldn’t start the game.')}</p><button class="btn btn--ghost" data-action="retry-start">Try again</button></div>`;
      return;
    }
    const d = r.data;
    Object.assign(solo, {
      sessionId: d.sessionId, board: d.board, ruleset: d.ruleset, roundKind: d.roundKind, clockMs: d.clockMs,
      rounds: d.rounds, lives: d.lives, alreadyPlayed: d.alreadyPlayed, date: d.date,
    });
    if (d.kind === 'daily') solo.title = `Daily Challenge, ${niceDate(d.date)}`;
    $('gTitle').textContent = solo.title + (d.alreadyPlayed ? ' (practice)' : '');
    if (d.alreadyPlayed) toast('You’ve already posted today’s score. This run is practice.');
    $('gRules').textContent = rulesLine();
    setGuessMode('g', solo.roundKind);
    A.scene('game');
    musicLevel({});
    openRound();
  }

  async function openRound() {
    const token = solo.token, idx = solo.idx;
    solo.phase = 'loading';
    solo.photoFailed = false;
    solo.lastSecond = -1;
    $('gCount').textContent = solo.rounds ? `Car ${idx + 1} of ${solo.rounds}` : `Car ${idx + 1}`;
    $('gReveal').hidden = true;
    $('gReport').open = false;
    $('gReportNote').value = '';
    $('gForm').hidden = false;
    $('gCredit').hidden = true;
    resetGuess('g');
    renderPips();
    soloClock.hide();
    const img = $('gImg'), st = $('gPhotoState');
    img.classList.remove('is-loaded');
    st.className = 'photo-state is-loading';
    st.innerHTML = '';

    const r = await api('POST', '/api/solo/round', { sessionId: solo.sessionId, idx });
    if (token !== solo.token || solo.idx !== idx || current !== 'game') return;
    if (!r.ok) {
      st.className = 'photo-state';
      st.innerHTML = r.status === 404
        ? '<div><p>This game expired on the server.</p><button class="btn btn--ghost" data-action="replay">Start a new one</button></div>'
        : '<div><p>Couldn’t reach the server.</p><button class="btn btn--ghost" data-action="retry-round">Try again</button></div>';
      return;
    }
    solo.phase = 'guess';
    loadPhoto(img, st, r.data.img, {
      onShown() {
        if (token !== solo.token || solo.idx !== idx || solo.phase !== 'guess') return;
        A.play('transition');
        if (solo.clockMs) {
          soloClock.start(Date.now() + solo.clockMs, solo.clockMs, () => submitSolo({ timedOut: true }), (left, secs) => {
            clockFeedback(solo, secs, solo.clockMs);
            if (secs !== solo._lvl) { solo._lvl = secs; musicLevel({ progress: solo.rounds ? idx / solo.rounds : Math.min(1, idx / 20), streak: solo.streak, pressure: 1 - left / solo.clockMs }); }
          });
        }
      },
      onFail(stateEl) {
        if (token !== solo.token || solo.idx !== idx) return;
        solo.photoFailed = true;
        soloClock.stop();
        stateEl.querySelector('div').insertAdjacentHTML('beforeend', '<button class="btn btn--ghost" data-action="skip">Skip this car</button>');
        api('POST', '/api/report', { type: 'bug', note: 'photo failed to load', mode: solo.req.playlist || solo.kind, userAgent: navigator.userAgent });
      },
    });
    preload(r.data.next);
    focusFirst('g', solo.roundKind);
  }

  async function submitSolo({ timedOut = false, skip = false } = {}) {
    if (solo.phase !== 'guess' || solo.busy || !solo.sessionId) return;
    const guess = skip ? {} : readGuess('g', solo.roundKind);
    const empty = isEmptyGuess(guess);
    if (empty && !timedOut && !skip) {
      $('gMsg').textContent = emptyMsg(solo.roundKind);
      focusFirst('g', solo.roundKind);
      return;
    }
    solo.busy = true;
    soloClock.stop();
    guessInputs('g').forEach(i => { i.disabled = true; });
    $('gMsg').textContent = '';
    const btn = $('gSubmit');
    btn.disabled = true;
    btn.classList.add('is-busy');

    const body = { sessionId: solo.sessionId, idx: solo.idx, ...guess, timedOut, photoFailed: skip && solo.photoFailed };
    let r = await api('POST', '/api/solo/guess', body);
    if (!r.ok && r.status === 0) r = await api('POST', '/api/solo/guess', body);
    solo.busy = false;
    btn.classList.remove('is-busy');
    if (current !== 'game' || solo.phase !== 'guess') return;
    if (!r.ok) {
      if (r.status === 404) {
        $('gMsg').innerHTML = 'This game expired on the server. <button class="btn btn--quiet" data-action="replay">Start a new one</button>';
      } else {
        $('gMsg').textContent = 'Couldn’t reach the server. Check your connection and try again.';
        guessInputs('g').forEach(i => { i.disabled = false; });
        btn.disabled = false;
      }
      return;
    }
    const d = r.data;
    const prevStreak = solo.streak;
    solo.results.push({ pts: d.pts, res: d.res, answer: d.answer, late: d.late, skipped: d.skipped });
    Object.assign(solo, { idx: d.idx, score: d.score, streak: d.streak, bestStreak: d.bestStreak, strikes: d.strikes, cars: d.cars, timeMs: d.timeMs || 0, phase: 'reveal', done: d.done });
    renderSoloReveal(d, empty);
    renderStreak(prevStreak);

    if (d.skipped) A.play('select');
    else if (d.pts >= MAX) A.play('correct');
    else if (d.pts > 0 && !d.late) A.play('partial');
    else A.play('wrong');
    if (d.streak > prevStreak && [3, 5, 10, 15, 20, 30, 50].includes(d.streak)) setTimeout(() => A.play('streak'), 280);
    musicLevel({ progress: solo.rounds ? solo.idx / solo.rounds : Math.min(1, solo.idx / 20), streak: solo.streak });
  }

  function renderSoloReveal(d, empty) {
    const v = verdictFor(d, empty);
    $('gVerdict').textContent = v.text;
    $('gVerdict').className = `reveal-verdict ${v.cls}`;
    $('gAnswer').innerHTML = answerHtml(d.answer, solo.roundKind);
    $('gHint').textContent = d.answer.hint || '';
    $('gChips').innerHTML = chipsHtml(d.res, d.skipped);
    stagger($('gChips'));
    $('gCredit').innerHTML = creditHtml(d.answer);
    $('gCredit').hidden = !$('gCredit').innerHTML;
    $('gForm').hidden = true;
    soloClock.hide();
    $('gNext').innerHTML = `${d.done ? 'See results' : 'Next car'} <kbd class="kbd-hint">Enter</kbd>`;
    playReveal($('gReveal'));
    if (d.pts > 0) countTo($('gScore'), d.score);
    renderPips();
    if (coarse.matches) $('gReveal').scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    else $('gNext').focus({ preventScroll: true });
  }

  function soloNext() {
    if (solo.phase !== 'reveal') return;
    if (solo.done) return showSoloResults();
    openRound();
  }

  function resultLine(pct) {
    if (pct >= 0.9) return 'Showroom-grade. You could run the auction.';
    if (pct >= 0.7) return 'Proper car person.';
    if (pct >= 0.5) return 'Solid. A few more meets and you’ll have it.';
    if (pct >= 0.25) return 'You know the badges. Now learn the cars.';
    return 'Back to the car park. Every expert started here.';
  }
  const squaresFor = results => results.map(r => (r.pts >= MAX ? '🟨' : r.pts > 0 ? '⬜' : '🟥')).join('');

  function showSoloResults() {
    solo.phase = 'done';
    soloClock.hide();
    A.scene('results');
    screens.game.classList.add('is-results');
    $('gStage').hidden = true;
    $('gResults').hidden = false;
    const played = solo.results.length;
    const max = (solo.rounds || played) * MAX;
    $('rLabel').textContent = solo.kind === 'endless' ? `Endless run: ${played} cars` : solo.title;
    $('rScore').textContent = '0';
    $('rMax').textContent = max;
    $('rLine').textContent = solo.kind === 'endless'
      ? (solo.cars >= 20 ? 'That’s a long run. The hard cars found you in the end.' : solo.cars >= 8 ? 'Into the hard stuff before it got you.' : 'Three misses comes round fast. Go again.')
      : resultLine(solo.score / max);

    // Personal bests are kept in this browser.
    let newBest = false;
    if (solo.board && !solo.alreadyPlayed) {
      const key = bestKey(solo.kind === 'daily' ? 'daily' : solo.board);
      const prev = store.json(key);
      if (!prev || solo.score > prev.score) {
        newBest = !!prev && solo.kind !== 'daily';
        store.setJson(key, { score: solo.score, cars: solo.cars, ts: Date.now() });
      }
    }
    if (solo.kind === 'daily' && !solo.alreadyPlayed) store.setJson(dailyKey(solo.date), { score: solo.score, max, squares: squaresFor(solo.results) });

    const stats = [['Cars named', `${solo.cars} of ${played}`], ['Best streak', solo.bestStreak]];
    if (solo.clockMs && played) stats.push(['Average answer', fmtTime(solo.timeMs / played)]);
    if (newBest) stats.push(['Personal best', 'New']);
    $('rStats').innerHTML = stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="${k === 'Personal best' ? 'is-best' : ''}">${esc(v)}</dd></div>`).join('');

    const ranked = !!solo.board && !solo.alreadyPlayed;
    $('rSave').hidden = !ranked;
    $('rSaved').hidden = ranked;
    $('rSaved').textContent = solo.kind === 'free' ? 'Free Play games don’t go on a leaderboard.' : solo.alreadyPlayed ? 'Practice run: today’s ranked attempt is already posted.' : '';
    $('rSaved').hidden = !$('rSaved').textContent;
    $('rSaveBtn').disabled = false;
    $('rName').value = store.get('vc_name');
    $('rAgain').textContent = solo.kind === 'daily' ? 'Practice again' : 'Play again';

    $('rLog').innerHTML = solo.results.map((r, i) => {
      const a = r.answer;
      const name = a.kit ? `${esc(a.kit)} <small>${esc(carName(a))}</small>` : `${esc(carName(a))} <small>${esc(detail(a))}${a.credit ? `<a href="${commonsLink(a.credit)}" target="_blank" rel="noopener">Photo source</a>` : ''}</small>`;
      const cls = r.pts >= MAX ? 'is-hit' : r.pts === 0 ? 'is-miss' : '';
      return `<li><span class="n">${i + 1}</span><span class="car">${name}</span><span class="pts ${cls}">${r.pts}</span></li>`;
    }).join('');
    window.scrollTo({ top: 0 });
    A.play('complete');
    countTo($('rScore'), solo.score, { dur: Math.min(1400, 300 + solo.score * 10), onStep: v => { if (v % 5 === 0) A.play('score'); } });
    if (newBest) setTimeout(() => A.play('victory'), 900);
    if (ranked && !coarse.matches) $('rName').focus({ preventScroll: true });
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
      const boardName = solo.kind === 'daily' ? 'today’s Daily Challenge' : solo.kind === 'endless' ? 'the Endless board' : `the ${solo.title} board`;
      $('rSaved').textContent = r.ok
        ? (r.data.rank ? `Posted. You’re #${r.data.rank} of ${r.data.total} on ${boardName}.` : `Posted, but it’s outside the top ${r.data.total} on ${boardName}.`)
        : (r.data.error || 'This score is already on the board.');
      lbBoard = solo.board;
      if (r.ok) {
        lastSaved = { board: solo.board, rank: r.data.rank, score: solo.score };
        A.play('select');
        if (solo.kind === 'daily') { const rec = store.json(dailyKey(solo.date)); if (rec) store.setJson(dailyKey(solo.date), { ...rec, rank: r.data.rank }); }
      }
    } else {
      btn.disabled = false;
      toast(r.status === 0 ? 'Couldn’t reach the server. Try again.' : (r.data.error || 'Couldn’t post the score.'));
    }
  }

  // A spoiler-free result line people can paste into a group chat.
  async function shareText(text) {
    try {
      if (navigator.share && coarse.matches) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      toast('Result copied');
    } catch (err) {
      if (!err || err.name !== 'AbortError') toast('Couldn’t copy. Long-press to share instead.');
    }
  }
  function shareResult() {
    const max = (solo.rounds || solo.results.length) * MAX;
    const head = solo.kind === 'daily' ? `VicCall Daily ${solo.date}` : solo.kind === 'endless' ? `VicCall Endless: ${solo.cars} cars` : `VicCall ${solo.title}`;
    shareText(`${head}: ${solo.score}/${max}\n${squaresFor(solo.results)}\n${location.origin}`);
  }
  function shareDaily() {
    const date = META.daily.date, rec = store.json(dailyKey(date));
    if (rec) shareText(`VicCall Daily ${date}: ${rec.score}/${rec.max}\n${rec.squares}\n${location.origin}`);
  }

  async function sendReport() {
    const last = solo.results[solo.results.length - 1];
    if (!last) return;
    const note = $('gReportNote').value.trim();
    const a = last.answer;
    const kind = META && META.garage ? $('gReportKind').value : 'bug';
    // Photo problems go to the moderators (Community Garage); everything else is a bug report.
    if (kind !== 'bug' && window.VCGarage) {
      const sent = await window.VCGarage.report(a, kind, note);
      if (sent) { $('gReport').open = false; $('gReportNote').value = ''; }
      return;
    }
    const r = await api('POST', '/api/report', { type: 'bug', note, mode: solo.req.playlist || solo.kind, car: { id: a.id, make: a.make, model: a.model, year: a.year, kit: a.kit }, userAgent: navigator.userAgent });
    $('gReport').open = false;
    $('gReportNote').value = '';
    toast(r.ok ? 'Thanks. Report sent.' : 'Couldn’t send the report.');
  }

  $('gForm').addEventListener('submit', e => { e.preventDefault(); submitSolo(); });
  $('rSave').addEventListener('submit', saveScore);

  // ---------------------------------------------------------------- leaderboards
  let lbBoard = null;
  let lastSaved = null;
  // Today's board, plus the one before it: the reset lands mid-afternoon or evening in
  // much of the world, and players should still be able to see where they finished.
  const pastDaily = b => b.startsWith('daily:') && b !== `daily:${META.daily.date}`;
  const boardTitle = b => b.startsWith('daily:') ? (pastDaily(b) ? `the ${niceDate(b.slice(6))} Daily Challenge` : 'Today’s Daily Challenge') : b === 'endless' ? 'Endless' : playlist(b.slice(7)).title;
  function buildBoardTabs() {
    lbBoard = lbBoard || `daily:${META.daily.date}`;
    const tab = (id, label) => `<button class="tab" role="tab" data-board="${esc(id)}" aria-selected="false">${esc(label)}</button>`;
    $('lbTabs').innerHTML = `<span class="lb-group">Daily and Endless</span>${tab(`daily:${META.daily.date}`, 'Today’s daily')}${tab(`daily:${shiftDay(META.daily.date, -1)}`, 'Previous daily')}${tab('endless', 'Endless')}<span class="lb-group">Ranked playlists</span>` +
      META.playlists.map(p => tab(`ranked:${p.id}`, p.title)).join('');
  }
  $('lbTabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    lbBoard = t.dataset.board;
    A.play('select');
    loadBoard();
  });
  $('lbTabs').addEventListener('keydown', e => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...$('lbTabs').querySelectorAll('.tab')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });
  let lbReq = 0;
  async function loadBoard() {
    await metaReady;
    if (!META) return;
    if (!lbBoard) lbBoard = `daily:${META.daily.date}`;
    [...$('lbTabs').querySelectorAll('.tab')].forEach(t => {
      const on = t.dataset.board === lbBoard;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && !matchMedia('(min-width: 900px)').matches) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    $('lbPlay').textContent = lbBoard.startsWith('daily:') ? 'Play today’s ten' : `Play ${boardTitle(lbBoard)}`;
    const list = $('lbList');
    const req = ++lbReq;
    list.innerHTML = '<li class="board-empty is-loading">Loading scores…</li>';
    const r = await api('GET', `/api/leaderboard?board=${encodeURIComponent(lbBoard)}`);
    if (req !== lbReq) return;
    if (!r.ok) { list.innerHTML = '<li class="board-empty">Couldn’t load scores. Check your connection.</li>'; return; }
    const rows = Array.isArray(r.data) ? r.data : [];
    if (!rows.length) {
      list.innerHTML = pastDaily(lbBoard)
        ? `<li class="board-empty">Nobody posted on ${esc(boardTitle(lbBoard))}.</li>`
        : `<li class="board-empty">Nobody has posted on ${esc(boardTitle(lbBoard))} yet. Play it and take the top spot.</li>`;
      return;
    }
    const mine = lastSaved && lastSaved.board === lbBoard ? lastSaved : null;
    let marked = false;
    list.innerHTML = rows.map((row, i) => {
      const you = mine && !marked && i + 1 === mine.rank && row.score === mine.score && (marked = true);
      return `<li class="${you ? 'is-you' : ''}"><span class="rank">${i + 1}</span><span class="who">${esc(row.name)}${you ? '<small>you</small>' : ''}</span>
        <span class="num">${row.cars ?? '–'}</span><span class="num num--streak">${row.bestStreak ?? '–'}</span><span class="num num--time">${row.timeMs != null ? fmtTime(row.timeMs) : '–'}</span>
        <span class="score">${row.score}<small> / ${row.maxScore}</small></span></li>`;
    }).join('');
  }
  function playBoard(b) {
    if (b.startsWith('daily:')) startSolo({ kind: 'daily' });
    else if (b === 'endless') startSolo({ kind: 'endless' });
    else startSolo({ kind: 'ranked', playlist: b.slice(7) });
  }

  // ---------------------------------------------------------------- party
  // Only open a socket when someone actually plays with friends.
  const socket = typeof io === 'function' ? io({ transports: ['websocket', 'polling'], autoConnect: false }) : null;
  const ensureSocket = () => { if (socket && !socket.connected && !socket.active) socket.connect(); };
  const party = { code: null, youId: null, playlist: 'world', ruleset: 'casual', kind: 'car', state: null, players: [], round: null, answered: false, myResult: null, offset: 0, total: 10, sending: false, lastSecond: -1 };
  const partyClock = makeClock('pg');

  function buildPlaylistSelects() {
    const opts = META.playlists.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
    $('pcPlaylist').innerHTML = opts;
    $('lsPlaylist').innerHTML = opts;
  }
  $('pcName').value = $('pjName').value = store.get('vc_name');

  function emit(event, payload) {
    return new Promise(resolve => {
      if (!socket) return resolve({ ok: false, error: 'Multiplayer is unavailable.' });
      ensureSocket();
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
  const partyRulesText = () => `${playlist(party.playlist).title}, ${party.ruleset === 'competitive' ? 'competitive rules (45 s, strict spelling)' : 'casual rules (60 s, typos forgiven)'}`;

  function applySnapshot(s) {
    Object.assign(party, { code: s.code, youId: s.youId, playlist: s.playlist, ruleset: s.ruleset, kind: s.kind, state: s.state, players: s.players || [] });
    party.offset = (s.serverNow || Date.now()) - Date.now();
    tabStore.set('vc_party', s.code);
    if (s.state === 'lobby') { renderLobby(); partyNav('lobby'); }
    else if (s.state === 'playing' || s.state === 'reveal') {
      enterRound({ idx: s.round.idx, img: s.round.img, deadline: s.round.deadline, durationMs: s.round.durationMs, serverNow: s.serverNow, total: s.total }, s.round.you);
      if (s.state === 'reveal') applyReveal(s.reveal);
    } else if (s.state === 'final') renderFinal(s.standings);
  }

  function clearParty() {
    Object.assign(party, { code: null, youId: null, state: null, players: [], round: null, answered: false, myResult: null, sending: false });
    tabStore.del('vc_party');
    partyClock.hide();
    $('conn').hidden = true;
  }

  function openParty(focusId) {
    show('party', { replace: current === 'party', push: current !== 'party' });
    ensureSocket();
    if (focusId && !coarse.matches) $(focusId).focus();
  }

  async function partyCreate(e) {
    e.preventDefault();
    const name = $('pcName').value.trim();
    $('pMsg').textContent = '';
    if (!name) { $('pMsg').textContent = 'Add your name so friends know who you are.'; $('pcName').focus(); return; }
    store.set('vc_name', name);
    const ruleset = (document.querySelector('input[name="pcRules"]:checked') || {}).value || 'casual';
    const r = await emit('party:create', { name, playlist: $('pcPlaylist').value, ruleset, key: tabKey });
    if (!r.ok) { $('pMsg').textContent = r.error || 'Couldn’t create the party.'; return; }
    A.play('select');
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
    A.play('select');
    applySnapshot(r);
  }

  function partyLeave({ silent = false } = {}) {
    if (party.code) emit('party:leave', {});
    clearParty();
    if (!silent) show('party', { replace: true });
  }

  let lastRosterIds = new Set();
  function renderLobby() {
    A.scene('menu');
    $('lobbyCode').textContent = party.code;
    $('lobbyCode').setAttribute('aria-label', `Party code ${party.code.split('').join(' ')}`);
    const hostNow = isHost();
    $('lobbySettings').hidden = !hostNow;
    $('lobbyMode').hidden = hostNow;
    $('lobbyMode').textContent = partyRulesText();
    $('lsPlaylist').value = party.playlist;
    document.querySelectorAll('input[name="lsRules"]').forEach(i => { i.checked = i.value === party.ruleset; });
    $('lobbyCount').textContent = `${party.players.length}`;
    $('lobbyPlayers').innerHTML = party.players.map(p => `
      <li data-id="${esc(p.id)}" class="${lastRosterIds.size && !lastRosterIds.has(p.id) ? 'is-new' : ''}">
        <span>${esc(p.name)}${p.id === party.youId ? ' <span class="me">(you)</span>' : ''}</span>
        ${p.host ? '<span class="tag">Host</span>' : ''}
        ${p.connected ? '' : '<span class="tag tag--away">Reconnecting</span>'}
      </li>`).join('');
    lastRosterIds = new Set(party.players.map(p => p.id));
    const h = host();
    $('lobbyStart').hidden = !hostNow;
    $('lobbyStart').textContent = party.players.length > 1 ? `Start with ${party.players.length} drivers` : 'Start game';
    $('lobbyWait').hidden = hostNow;
    $('lobbyWait').textContent = `Waiting for ${h ? h.name : 'the host'} to start.`;
  }
  async function pushSettings(change) {
    const r = await emit('party:settings', change);
    if (!r.ok) { toast(r.error || 'Couldn’t change that.'); renderLobby(); return; }
    party.playlist = r.playlist; party.ruleset = r.ruleset;
  }
  $('lsPlaylist').addEventListener('change', e => pushSettings({ playlist: e.target.value }));
  $('lsRules').addEventListener('change', e => pushSettings({ ruleset: e.target.value }));

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
  function renderPartyPips() {
    $('pgPips').innerHTML = Array.from({ length: party.total }, (_, i) => `<li class="pip ${party.round && i < party.round.idx ? 'is-close' : party.round && i === party.round.idx ? 'is-current' : ''}"></li>`).join('');
  }

  function updateWaiting() {
    const left = party.players.filter(p => p.connected && !p.answered).length;
    $('pgWaiting').textContent = left > 0 ? `Waiting for ${left} more.` : '';
  }

  function enterRound(round, myResult) {
    party.state = 'playing';
    party.round = round;
    party.total = round.total || 10;
    party.answered = !!myResult;
    party.myResult = myResult || null;
    party.lastSecond = -1;
    if (round.players) party.players = round.players; // fresh scores (a rematch starts everyone at 0)
    if (round.serverNow) party.offset = round.serverNow - Date.now();
    partyNav('pgame');
    A.scene('game');
    $('pgTitle').textContent = playlist(party.playlist).title;
    $('pgCount').textContent = `Car ${round.idx + 1} of ${party.total}`;
    setGuessMode('pg', party.kind);
    resetGuess('pg');
    $('pgReveal').hidden = true;
    $('pgCredit').hidden = true;
    $('pgForm').hidden = party.answered;
    $('pgLocked').hidden = !party.answered;
    loadPhoto($('pgImg'), $('pgPhotoState'), round.img, { onShown: () => A.play('transition') });
    preload(round.nextImg);
    partyClock.start(round.deadline - party.offset, round.durationMs, () => {
      if (party.state === 'playing' && !party.answered) {
        guessInputs('pg').forEach(i => { i.disabled = true; });
        $('pgSubmit').disabled = true;
        $('pgMsg').textContent = 'Time’s up.';
      }
    }, (left, secs) => {
      clockFeedback(party, secs, round.durationMs);
      if (secs !== party._lvl) { party._lvl = secs; musicLevel({ progress: round.idx / party.total, pressure: 1 - left / round.durationMs }); }
      // Send whatever is typed just before the server closes the round.
      if (left < 600 && party.state === 'playing' && !party.answered && !party.sending && !isEmptyGuess(readGuess('pg', party.kind))) partySubmit();
    });
    renderPartyPips();
    if (round.idx === 0) $('pgScore').textContent = '0'; // new game: no count-down animation from the last total
    renderStandings();
    updateWaiting();
    if (!party.answered) focusFirst('pg', party.kind);
  }

  async function partySubmit(e) {
    if (e) e.preventDefault();
    if (party.state !== 'playing' || party.answered || party.sending) return;
    const guess = readGuess('pg', party.kind);
    if (isEmptyGuess(guess)) {
      if (e) $('pgMsg').textContent = emptyMsg(party.kind);
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
    A.play('select');
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
    const v = mine ? verdictFor({ pts: mine.pts, identified: identifiedFrom(mine.res, party.kind) }, false) : { text: 'No answer this round', cls: 'is-miss' };
    $('pgVerdict').textContent = v.text;
    $('pgVerdict').className = `reveal-verdict ${v.cls}`;
    $('pgAnswer').innerHTML = answerHtml(d, party.kind);
    $('pgHint').textContent = d.hint || '';
    $('pgChips').innerHTML = mine ? chipsHtml(mine.res) : '';
    stagger($('pgChips'));
    $('pgCredit').innerHTML = creditHtml(d);
    $('pgCredit').hidden = !$('pgCredit').innerHTML;
    playReveal($('pgReveal'));
    updateHostControls();
    renderStandings({ deltas: true });
    if (mine && mine.pts >= MAX) A.play('correct'); else if (mine && mine.pts > 0) A.play('partial'); else A.play('wrong');
    if (isHost() && !coarse.matches) $('pgNext').focus({ preventScroll: true });
  }

  function updateHostControls() {
    const last = party.round && party.round.idx >= party.total - 1;
    if (party.state === 'reveal') {
      $('pgNext').hidden = !isHost();
      $('pgNext').innerHTML = `${last ? 'See final standings' : 'Next car'} <kbd class="kbd-hint">Enter</kbd>`;
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
    const first = party.state !== 'final';
    party.state = 'final';
    party.players = standings || party.players;
    partyClock.hide();
    partyNav('pfinal');
    A.scene('results');
    const rows = [...party.players].sort((a, b) => b.score - a.score);
    const top = rows[0];
    const tied = rows.filter(p => top && p.score === top.score);
    $('pfWinner').textContent = !top ? '' : tied.length > 1
      ? `${tied.map(p => p.name).join(' and ')} tie on ${top.score} points.`
      : `${top.name} wins with ${top.score} points.`;
    $('pfStandings').innerHTML = rows.map((p, i) => `<li><span class="rank">${i + 1}</span><span class="who">${esc(p.name)}${p.id === party.youId ? '<small>you</small>' : ''}</span><span class="score">${p.score}</span></li>`).join('');
    updateHostControls();
    if (first && rows.length > 1) A.play(top && top.score === (me() || {}).score ? 'victory' : 'defeat');
    else if (first) A.play('complete');
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
    socket.on('party:settings', d => {
      Object.assign(party, d);
      if (party.state === 'lobby' || party.state === 'final') renderLobby();
      if (!isHost()) toast(`Now playing ${partyRulesText()}`);
    });
    socket.on('party:round', d => enterRound(d, null));
    socket.on('party:progress', d => {
      if (d.players) party.players = d.players;
      if (party.state === 'playing') { renderStandings(); updateWaiting(); }
    });
    socket.on('party:reveal', d => applyReveal(d));
    socket.on('party:final', d => renderFinal(d.standings));
  }

  if (tabStore.get('vc_party')) ensureSocket(); // came back to a party after a refresh
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
    openParty();
    $('pjCode').value = code;
    ($('pjName').value ? $('pJoin').querySelector('button') : $('pjName')).focus();
  })();

  // ---------------------------------------------------------------- sound settings
  const dlgSound = $('dlgSound');
  function syncSoundUi() {
    const s = A.get();
    document.querySelectorAll('[data-action="mute"]').forEach(b => {
      b.setAttribute('aria-pressed', String(!!s.muted));
      b.querySelector('use').setAttribute('href', s.muted ? '#i-volume-off' : '#i-volume');
      b.querySelector('.sr-only').textContent = s.muted ? 'Unmute sound' : 'Mute sound';
    });
    if (!dlgSound.open) return;
    [['sndMaster', 'master'], ['sndMusic', 'music'], ['sndSfx', 'sfx']].forEach(([id, k]) => {
      const el = $(id);
      if (document.activeElement !== el) el.value = s[k];
      el.style.setProperty('--pct', `${s[k]}%`);
      $(id + 'Out').textContent = s[k];
    });
    $('sndMute').checked = !!s.muted;
    document.querySelectorAll('input[name="sndTheme"]').forEach(i => { i.checked = i.value === s.theme; });
  }
  A.onChange(syncSoundUi);
  function openSound() { dlgSound.showModal(); syncSoundUi(); }
  [['sndMaster', 'master'], ['sndMusic', 'music'], ['sndSfx', 'sfx']].forEach(([id, k]) => {
    $(id).addEventListener('input', e => A.set({ [k]: Number(e.target.value) }));
  });
  $('sndSfx').addEventListener('change', () => A.play('correct'));
  $('sndMute').addEventListener('change', e => A.set({ muted: e.target.checked }));
  $('sndTheme').addEventListener('change', e => A.set({ theme: e.target.value }));
  dlgSound.addEventListener('click', e => { if (e.target === dlgSound) dlgSound.close(); });
  syncSoundUi();

  // ---------------------------------------------------------------- leave-game confirmation
  const dlgQuit = $('dlgQuit');
  function askQuit() {
    if (current === 'game' && (solo.phase === 'done' || solo.phase === 'idle' || !solo.sessionId)) { goHome(); return; }
    $('quitText').textContent = current === 'pgame' ? 'You’ll leave the party. You can rejoin with the code while the game is still going.'
      : solo.board && !solo.alreadyPlayed ? 'This ranked game won’t count, and your progress will be lost. The clock keeps running while you decide.' : 'Your progress in this game will be lost.';
    dlgQuit.returnValue = '';
    dlgQuit.showModal();
  }
  dlgQuit.addEventListener('close', () => {
    if (dlgQuit.returnValue !== 'leave') return;
    if (current === 'pgame') partyLeave();
    else { solo.phase = 'idle'; solo.token++; goHome(); }
  });

  // ---------------------------------------------------------------- actions + keyboard
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    if (['ranked', 'daily', 'endless', 'goto', 'party-open', 'lb-daily'].includes(act)) A.play('select');
    switch (act) {
      case 'home': goHome(); break;
      case 'goto':
        show(el.dataset.to, { replace: current === el.dataset.to, push: current !== el.dataset.to });
        if (el.dataset.to === 'leaderboard') loadBoard();
        if (el.dataset.anchor) requestAnimationFrame(() => $(el.dataset.anchor).scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' }));
        break;
      case 'nav-toggle': {
        const open = !nav.classList.contains('is-open');
        nav.classList.toggle('is-open', open);
        el.setAttribute('aria-expanded', String(open));
        break;
      }
      case 'daily': startSolo({ kind: 'daily' }); break;
      case 'endless': startSolo({ kind: 'endless' }); break;
      case 'ranked': startSolo({ kind: 'ranked', playlist: el.dataset.playlist }); break;
      case 'retry-start': if (solo.req) startSolo(solo.req); break;
      case 'retry-round': openRound(); break;
      case 'quit': askQuit(); break;
      case 'next': soloNext(); break;
      case 'skip': submitSolo({ skip: true }); break;
      case 'replay': if (solo.req) startSolo(solo.req); break;
      case 'report': sendReport(); break;
      case 'share': shareResult(); break;
      case 'share-daily': shareDaily(); break;
      case 'lb-daily': lbBoard = META ? `daily:${META.daily.date}` : null; show('leaderboard'); loadBoard(); break;
      case 'lb-play': if (lbBoard) playBoard(lbBoard); break;
      case 'party-open': openParty(el.dataset.focus); break;
      case 'party-start': partyStart(); break;
      case 'party-next': partyNext(); break;
      case 'party-leave': if (current === 'pgame') askQuit(); else partyLeave(); break;
      case 'copy-invite': copyInvite(); break;
      case 'mute': A.set({ muted: !A.get().muted }); break;
      case 'sound-settings': openSound(); break;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('dialog[open]')) return; // dialogs handle their own keys
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === 'Escape') {
      if (menuBtns.some(b => b.getAttribute('aria-expanded') === 'true')) { closeMenus(); return; }
      if (nav.classList.contains('is-open')) { closeNav(); return; }
      if (GAME_SCREENS.has(current)) { e.preventDefault(); askQuit(); }
      return;
    }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'm' || e.key === 'M')) { A.set({ muted: !A.get().muted }); return; }
    if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SUMMARY' && tag !== 'A') {
      if (current === 'game' && solo.phase === 'reveal') { e.preventDefault(); soloNext(); }
      else if (current === 'pgame' && party.state === 'reveal' && isHost()) { e.preventDefault(); partyNext(); }
    }
  });

  // Small hook for automated UI checks.
  window.VicCall = { show, startSolo, state: () => ({ current, solo: { ...solo }, party: { ...party } }) };
  // Shared helpers for garage.js (accounts and the Community Garage).
  window.VC = {
    $, esc, api, toast, show, metaReady, meta: () => META, current: () => current, onShow: fn => showHooks.push(fn),
    inGame: () => GAME_SCREENS.has(current),
    // The socket carries the sign-in cookie from when it connected; reconnect after signing in or out.
    reconnectSocket: () => { if (socket && socket.connected && !party.code) { socket.disconnect(); socket.connect(); } },
  };
  metaReady.catch(() => {});
})();
