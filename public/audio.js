/*
 * VicCall audio: sound effects and two music themes, all synthesised in the
 * browser with the Web Audio API. No samples, no recordings, nothing licensed.
 *
 *   Monaco     deep, melodic house. 122 BPM, Am9 / Fmaj9 / Cmaj7 / Em7.
 *   Night Run  drift phonk. 140 BPM half-time, distorted 808s, cowbell riff.
 *
 * Music is built in layers (pad, drums, bass, lead, top) that fade in as the
 * game's intensity rises (progress, streak, clock pressure), and a low-pass
 * filter on the music bus opens with it. Theme and scene changes crossfade.
 *
 * Artist playlist: real songs, used with each artist's written permission,
 * listed in public/music/tracks.json (see docs/MUSIC.md). Shuffled, credited
 * as they start, turned down during rounds. If the list is empty, choosing it
 * plays Monaco instead.
 *
 * Autoplay-safe: no AudioContext exists until the first click, tap or key
 * press. Settings persist in localStorage.
 */
(() => {
  'use strict';
  const KEY = 'vc_sound';
  const DEFAULTS = { muted: false, master: 80, music: 45, sfx: 80, theme: 'monaco' };
  const THEMES_OK = ['monaco', 'nightrun', 'playlist', 'off'];
  const DUCK = 0.5; // playlist volume during rounds, relative to menus
  const SCENE_LEVEL = { menu: 0.34, lobby: 0.34, results: 0.16 };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const midi = m => 440 * Math.pow(2, (m - 69) / 12);
  const vol = v => Math.pow(clamp(v, 0, 100) / 100, 2); // perceptual curve

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
      const out = { ...DEFAULTS };
      if (typeof s.muted === 'boolean') out.muted = s.muted;
      for (const k of ['master', 'music', 'sfx']) if (Number.isFinite(s[k])) out[k] = clamp(Math.round(s[k]), 0, 100);
      if (THEMES_OK.includes(s.theme)) out.theme = s.theme;
      return out;
    } catch { return { ...DEFAULTS }; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} }

  let settings = load();
  const listeners = [];

  // ---------------------------------------------------------------- graph
  function createGraph(ctx) {
    const g = { ctx };
    g.comp = ctx.createDynamicsCompressor();
    g.comp.threshold.value = -12; g.comp.knee.value = 8; g.comp.ratio.value = 4; g.comp.attack.value = 0.004; g.comp.release.value = 0.2;
    g.master = ctx.createGain();
    g.musicBus = ctx.createGain();
    g.musicFilter = ctx.createBiquadFilter();
    g.musicFilter.type = 'lowpass'; g.musicFilter.frequency.value = 1400; g.musicFilter.Q.value = 0.7;
    g.sfxBus = ctx.createGain();
    g.musicFilter.connect(g.musicBus);
    g.musicBus.connect(g.master);
    g.sfxBus.connect(g.master);
    g.master.connect(g.comp);
    g.comp.connect(ctx.destination);
    const len = ctx.sampleRate;
    g.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = g.noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
    return g;
  }
  function applyVolumes(g, s, ramp = 0.08) {
    const t = g.ctx.currentTime;
    g.master.gain.setTargetAtTime(s.muted ? 0 : vol(s.master), t, ramp);
    g.musicBus.gain.setTargetAtTime(s.theme === 'off' ? 0 : vol(s.music) * 0.9, t, ramp);
    g.sfxBus.gain.setTargetAtTime(vol(s.sfx), t, ramp);
  }

  // ---------------------------------------------------------------- instruments
  // Each takes (graph, destination, time, ...) and schedules itself.
  function env(param, t, peak, attack, decay, floor = 0.0001) {
    param.setValueAtTime(floor, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(floor, t + attack + decay);
  }
  function osc(g, type, freq, t, stop) {
    const o = g.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.start(t); o.stop(stop);
    return o;
  }
  function noiseSrc(g, t, stop) {
    const n = g.ctx.createBufferSource();
    n.buffer = g.noise; n.loop = true;
    n.start(t, Math.random() * 0.5); n.stop(stop);
    return n;
  }
  function filter(g, type, freq, q = 0.7) {
    const f = g.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }
  const curves = new Map();
  function shaper(g, amount) {
    const k = Math.round(amount * 10) / 10;
    if (!curves.has(k)) {
      const c = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(x * (1 + k * 6)) / Math.tanh(1 + k * 6); }
      curves.set(k, c);
    }
    const s = g.ctx.createWaveShaper();
    s.curve = curves.get(k); s.oversample = '2x';
    return s;
  }

  const I = {
    kick(g, dest, t, { gain = 0.9, f0 = 130, f1 = 46, decay = 0.38 } = {}) {
      const o = osc(g, 'sine', f0, t, t + decay + 0.05);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
      const a = g.ctx.createGain();
      env(a.gain, t, gain, 0.002, decay);
      o.connect(a).connect(dest);
    },
    hat(g, dest, t, { gain = 0.16, decay = 0.045, freq = 8000 } = {}) {
      const n = noiseSrc(g, t, t + decay + 0.03);
      const f = filter(g, 'highpass', freq, 0.9);
      const a = g.ctx.createGain();
      env(a.gain, t, gain, 0.001, decay);
      n.connect(f).connect(a).connect(dest);
    },
    clap(g, dest, t, { gain = 0.38, decay = 0.16, freq = 1400 } = {}) {
      const n = noiseSrc(g, t, t + decay + 0.06);
      const f = filter(g, 'bandpass', freq, 1.2);
      const a = g.ctx.createGain();
      a.gain.setValueAtTime(0.0001, t);
      [0, 0.011, 0.022].forEach(o => { a.gain.linearRampToValueAtTime(gain, t + o + 0.001); a.gain.exponentialRampToValueAtTime(gain * 0.25, t + o + 0.009); });
      a.gain.linearRampToValueAtTime(gain * 0.8, t + 0.034);
      a.gain.exponentialRampToValueAtTime(0.0001, t + 0.034 + decay);
      n.connect(f).connect(a).connect(dest);
    },
    snare(g, dest, t, { gain = 0.42 } = {}) {
      I.clap(g, dest, t, { gain: gain * 0.8, decay: 0.2, freq: 2200 });
      const o = osc(g, 'triangle', 200, t, t + 0.15);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
      const a = g.ctx.createGain();
      env(a.gain, t, gain * 0.7, 0.002, 0.11);
      o.connect(a).connect(dest);
    },
    pad(g, dest, t, notes, dur, { gain = 0.07, cutoff = 1500 } = {}) {
      const f = filter(g, 'lowpass', cutoff, 0.6);
      const a = g.ctx.createGain();
      a.gain.setValueAtTime(0.0001, t);
      a.gain.linearRampToValueAtTime(gain, t + Math.min(0.5, dur * 0.3));
      a.gain.setValueAtTime(gain, t + dur * 0.75);
      a.gain.linearRampToValueAtTime(0.0001, t + dur + 0.35);
      f.connect(a).connect(dest);
      notes.forEach(m => [-7, 7].forEach(cents => {
        const o = osc(g, 'sawtooth', midi(m), t, t + dur + 0.4);
        o.detune.value = cents;
        o.connect(f);
      }));
    },
    bass(g, dest, t, m, dur, { gain = 0.32 } = {}) {
      const o = osc(g, 'sine', midi(m), t, t + dur + 0.05);
      const o2 = osc(g, 'triangle', midi(m), t, t + dur + 0.05);
      const f = filter(g, 'lowpass', 420, 0.8);
      const a = g.ctx.createGain();
      env(a.gain, t, gain, 0.008, dur);
      const m2 = g.ctx.createGain(); m2.gain.value = 0.35;
      o.connect(a); o2.connect(m2).connect(a);
      a.connect(f).connect(dest);
    },
    pluck(g, dest, t, m, { gain = 0.12, decay = 0.28 } = {}) {
      const o = osc(g, 'triangle', midi(m), t, t + decay + 0.05);
      const o2 = osc(g, 'sine', midi(m + 12), t, t + decay + 0.05);
      const a = g.ctx.createGain();
      env(a.gain, t, gain, 0.003, decay);
      const b = g.ctx.createGain(); b.gain.value = 0.3;
      o.connect(a); o2.connect(b).connect(a);
      a.connect(dest);
    },
    // 808 cowbell: two detuned squares through a band-pass, pitched to the riff.
    cowbell(g, dest, t, m, { gain = 0.1, decay = 0.16 } = {}) {
      const f0 = midi(m);
      const f = filter(g, 'bandpass', f0 * 1.25, 2.2);
      const a = g.ctx.createGain();
      env(a.gain, t, gain, 0.001, decay);
      [1, 1.48].forEach(r => osc(g, 'square', f0 * r, t, t + decay + 0.05).connect(f));
      f.connect(a).connect(dest);
    },
    // Distorted 808: sine with a pitch punch, optional glide, long tail.
    eight08(g, dest, t, m, dur, { gain = 0.5, drive = 0.4, glideTo = null } = {}) {
      const f = midi(m);
      const o = osc(g, 'sine', f * 2.2, t, t + dur + 0.1);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(midi(glideTo), t + dur * 0.9);
      const sh = shaper(g, drive);
      const lp = filter(g, 'lowpass', 900, 0.5);
      const a = g.ctx.createGain();
      a.gain.setValueAtTime(0.0001, t);
      a.gain.linearRampToValueAtTime(gain, t + 0.004);
      a.gain.setTargetAtTime(gain * 0.55, t + 0.06, 0.12);
      a.gain.setTargetAtTime(0.0001, t + dur, 0.05);
      o.connect(sh).connect(lp).connect(a).connect(dest);
    },
    drone(g, dest, t, notes, dur, { gain = 0.06, cutoff = 520 } = {}) {
      I.pad(g, dest, t, notes, dur, { gain, cutoff });
    },
  };

  // ---------------------------------------------------------------- themes
  // Layers fade in around their threshold as intensity rises.
  const MONACO_CHORDS = [
    { pad: [57, 60, 64, 67, 71], root: 45, arp: [69, 72, 76, 79] }, // Am9
    { pad: [53, 57, 60, 64, 67], root: 41, arp: [65, 69, 72, 76] }, // Fmaj9
    { pad: [55, 60, 64, 67, 71], root: 48, arp: [67, 72, 76, 79] }, // Cmaj7/G
    { pad: [52, 55, 59, 62, 67], root: 40, arp: [64, 67, 71, 74] }, // Em7
  ];
  const NIGHT_808 = [
    [[0, 38, 5], [6, 38, 2], [10, 41, 3, 38], [14, 36, 2]],
    [[0, 34, 5], [6, 34, 2], [10, 36, 3], [13, 33, 3]],
  ];
  const NIGHT_BELL = [
    [[0, 74], [3, 74], [6, 77], [8, 74], [10, 72], [11, 74], [14, 69]],
    [[0, 74], [3, 74], [6, 77], [8, 79], [10, 77], [12, 74], [14, 72]],
  ];

  const THEMES = {
    monaco: {
      bpm: 122,
      swing: 0.08,
      layers: { pad: [0, 1], drums: [0.26, 0.95], groove: [0.5, 0.8], bass: [0.42, 0.95], lead: [0.64, 0.75], top: [0.82, 0.6] },
      step(e, s, t, len) {
        const bar = Math.floor(s / 16) % 4, i = s % 16, ch = MONACO_CHORDS[bar], L = e.layers, g = e.g;
        if (i === 0 && e.on('pad')) I.pad(g, L.pad, t, ch.pad, len * 16, { gain: 0.055, cutoff: 1100 + e.level * 1800 });
        if (e.on('drums')) {
          if (i % 4 === 0) I.kick(g, L.drums, t, { gain: 0.85 });
          if (i % 4 === 2) I.hat(g, L.drums, t, { gain: 0.13, decay: 0.06 });
        }
        if (e.on('groove') && (i === 4 || i === 12)) I.clap(g, L.groove, t, { gain: 0.3 });
        if (e.on('bass')) {
          const pat = { 2: 0, 6: 0, 7: 12, 10: 0, 14: 0, 15: 7 };
          if (i in pat) I.bass(g, L.bass, t, ch.root + pat[i], len * 1.6, { gain: 0.3 });
        }
        if (e.on('lead')) {
          const arp = { 0: 0, 3: 1, 6: 2, 8: 3, 10: 2, 13: 1 };
          if (i in arp) I.pluck(g, L.lead, t, ch.arp[arp[i]], { gain: 0.085 });
        }
        if (e.on('top') && i % 2 === 1) I.hat(g, L.top, t, { gain: 0.07, decay: 0.03, freq: 9500 });
      },
    },
    nightrun: {
      bpm: 140,
      swing: 0,
      layers: { pad: [0, 1], bass: [0.26, 0.95], drums: [0.3, 0.9], top: [0.52, 0.7], lead: [0.6, 0.85] },
      step(e, s, t, len) {
        const bar = Math.floor(s / 16) % 2, i = s % 16, L = e.layers, g = e.g;
        if (i === 0 && s % 32 === 0 && e.on('pad')) I.drone(g, L.pad, t, [38, 45, 50, 53], len * 32, { gain: 0.05, cutoff: 380 + e.level * 700 });
        if (e.on('bass')) {
          for (const [st, m, d, glide] of NIGHT_808[bar]) {
            if (st !== i) continue;
            I.kick(g, L.bass, t, { gain: 0.7, f0: 160, f1: 50, decay: 0.16 });
            I.eight08(g, L.bass, t, m, len * d, { gain: 0.42, drive: 0.25 + e.level * 0.6, glideTo: glide || null });
          }
        }
        if (e.on('drums')) {
          if (i === 8) I.snare(g, L.drums, t, { gain: 0.4 });
          if (i % 2 === 0) I.hat(g, L.drums, t, { gain: 0.09, decay: 0.035 });
        }
        if (e.on('top')) {
          if (i % 2 === 1) I.hat(g, L.top, t, { gain: 0.06, decay: 0.025, freq: 9000 });
          // Trap roll into the next bar at high intensity.
          if (e.level > 0.8 && (i === 14 || i === 15)) [0, 1, 2].forEach(k => I.hat(g, L.top, t + (len / 3) * k, { gain: 0.05, decay: 0.02, freq: 9500 }));
        }
        if (e.on('lead')) for (const [st, m] of NIGHT_BELL[bar]) if (st === i) I.cowbell(g, L.lead, t, m, { gain: 0.085 });
      },
    },
  };

  // Smooth step around a threshold: 0 below, 1 above.
  const layerAmount = (th, level) => clamp((level - (th - 0.08)) / 0.16, 0, 1);

  class Engine {
    constructor(g, theme) {
      this.g = g;
      this.def = THEMES[theme];
      this.theme = theme;
      this.out = g.ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(g.musicFilter);
      this.layers = {};
      this.targets = {};
      for (const [name] of Object.entries(this.def.layers)) {
        const n = g.ctx.createGain();
        n.gain.value = 0;
        n.connect(this.out);
        this.layers[name] = n;
        this.targets[name] = 0;
      }
      this.level = 0.3;
      this.stepIdx = 0;
      this.next = g.ctx.currentTime + 0.08;
      this.timer = 0;
    }
    on(name) { return this.targets[name] > 0.01; }
    setLevel(level, immediate = false) {
      this.level = clamp(level, 0, 1);
      const t = this.g.ctx.currentTime;
      for (const [name, [th, gain]] of Object.entries(this.def.layers)) {
        const target = gain * layerAmount(th, this.level);
        this.targets[name] = target;
        if (immediate) this.layers[name].gain.setValueAtTime(target, t);
        else this.layers[name].gain.setTargetAtTime(target, t, 0.7);
      }
    }
    schedule(until) {
      const len = 60 / this.def.bpm / 4;
      while (this.next < until) {
        const swing = this.stepIdx % 2 === 1 ? this.def.swing * len : 0;
        this.def.step(this, this.stepIdx, this.next + swing, len);
        this.next += len;
        this.stepIdx += 1;
      }
    }
    start(fade = 1.4) {
      const t = this.g.ctx.currentTime;
      this.next = t + 0.08;
      this.out.gain.setValueAtTime(0, t);
      this.out.gain.linearRampToValueAtTime(1, t + fade);
      this.timer = setInterval(() => this.schedule(this.g.ctx.currentTime + 0.15), 30);
      this.schedule(t + 0.15);
    }
    stop(fade = 1.2) {
      const t = this.g.ctx.currentTime;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      this.out.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => { clearInterval(this.timer); try { this.out.disconnect(); } catch {} }, fade * 1000 + 300);
    }
  }

  // ---------------------------------------------------------------- sound effects
  const SFX = {
    select(g, t) { I.pluck(g, g.sfxBus, t, 84, { gain: 0.09, decay: 0.07 }); },
    transition(g, t) {
      const n = noiseSrc(g, t, t + 0.45);
      const f = filter(g, 'bandpass', 500, 1.4);
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(3200, t + 0.32);
      const a = g.ctx.createGain();
      a.gain.setValueAtTime(0.0001, t);
      a.gain.linearRampToValueAtTime(0.09, t + 0.18);
      a.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      n.connect(f).connect(a).connect(g.sfxBus);
    },
    correct(g, t) {
      [[76, 0], [83, 0.085], [88, 0.17]].forEach(([m, d]) => I.pluck(g, g.sfxBus, t + d, m, { gain: 0.17, decay: 0.42 }));
    },
    partial(g, t) {
      [[72, 0], [76, 0.09]].forEach(([m, d]) => I.pluck(g, g.sfxBus, t + d, m, { gain: 0.14, decay: 0.32 }));
    },
    wrong(g, t) {
      const o = osc(g, 'sawtooth', 196, t, t + 0.32);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.28);
      const f = filter(g, 'lowpass', 900, 1);
      const a = g.ctx.createGain();
      env(a.gain, t, 0.13, 0.01, 0.28);
      o.connect(f).connect(a).connect(g.sfxBus);
    },
    tick(g, t) {
      const o = osc(g, 'sine', 1760, t, t + 0.05);
      const a = g.ctx.createGain();
      env(a.gain, t, 0.08, 0.001, 0.035);
      o.connect(a).connect(g.sfxBus);
    },
    warn(g, t) {
      [0, 0.13].forEach(d => {
        const o = osc(g, 'square', 988, t + d, t + d + 0.09);
        const f = filter(g, 'lowpass', 2400);
        const a = g.ctx.createGain();
        env(a.gain, t + d, 0.06, 0.002, 0.07);
        o.connect(f).connect(a).connect(g.sfxBus);
      });
    },
    score(g, t) { I.pluck(g, g.sfxBus, t, 91, { gain: 0.045, decay: 0.05 }); },
    streak(g, t) {
      SFX.transition(g, t);
      [72, 76, 79, 84].forEach((m, k) => I.pluck(g, g.sfxBus, t + 0.05 + k * 0.06, m, { gain: 0.12, decay: 0.3 }));
    },
    complete(g, t) {
      I.pad(g, g.sfxBus, t, [60, 64, 67, 71, 76], 1.1, { gain: 0.06, cutoff: 2600 });
      I.pluck(g, g.sfxBus, t, 84, { gain: 0.1, decay: 0.8 });
    },
    victory(g, t) {
      [[67, 0], [72, 0.1], [76, 0.2], [79, 0.3]].forEach(([m, d]) => I.pluck(g, g.sfxBus, t + d, m, { gain: 0.15, decay: 0.5 }));
      I.pad(g, g.sfxBus, t + 0.4, [60, 64, 67, 72, 79], 1.3, { gain: 0.07, cutoff: 3200 });
    },
    defeat(g, t) {
      [[69, 0], [65, 0.16], [62, 0.32]].forEach(([m, d]) => I.pluck(g, g.sfxBus, t + d, m, { gain: 0.12, decay: 0.45 }));
    },
  };

  // ---------------------------------------------------------------- runtime
  // ---------------------------------------------------------------- artist playlist
  let tracks = [];
  const trackListeners = [];
  const tracksReady = (typeof fetch === 'function' ? fetch('music/tracks.json', { cache: 'no-cache' }) : Promise.reject())
    .then(r => (r.ok ? r.json() : {}))
    .then(d => { tracks = (Array.isArray(d.tracks) ? d.tracks : []).filter(t => t && t.file && t.title && t.artist && t.enabled !== false); })
    .catch(() => { tracks = []; })
    .then(() => {
      listeners.forEach(f => { try { f(api.get()); } catch {} });
      syncMusic();
    });

  // Plays the songs through the music bus (volume and mute apply), past the
  // filter that shapes the synthesised themes.
  class Playlist {
    constructor(g) {
      this.g = g;
      this.theme = 'playlist';
      this.el = new Audio();
      this.el.preload = 'auto';
      this.src = g.ctx.createMediaElementSource(this.el);
      this.out = g.ctx.createGain();
      this.out.gain.value = 0;
      this.src.connect(this.out);
      this.out.connect(g.musicBus);
      this.order = [];
      this.pos = -1;
      this.duck = 1;
      this.fails = 0;
      this.current = null;
      this.el.addEventListener('ended', () => this.next());
      this.el.addEventListener('error', () => { if (++this.fails < tracks.length) this.next(); });
      this.el.addEventListener('playing', () => { this.fails = 0; });
    }
    // A fresh shuffle, never starting with the song that just played.
    shuffle() {
      const o = tracks.map((_, i) => i);
      for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
      if (o.length > 1 && this.current && tracks[o[0]] === this.current) o.push(o.shift());
      this.order = o;
      this.pos = -1;
    }
    next() {
      if (!tracks.length) return;
      if (this.pos + 1 >= this.order.length) this.shuffle();
      this.pos += 1;
      this.current = tracks[this.order[this.pos]];
      this.el.src = this.current.file;
      this.el.play().catch(() => {});
      const now = nowPlaying();
      trackListeners.forEach(f => { try { f(now); } catch {} });
    }
    start() {
      this.out.gain.setTargetAtTime(this.duck, this.g.ctx.currentTime, 0.4);
      if (!this.current) this.next(); else this.el.play().catch(() => {});
    }
    setLevel() {} // songs don't build with the game; setDuck turns them down during rounds
    setDuck(x) {
      if (x === this.duck) return;
      this.duck = x;
      this.out.gain.setTargetAtTime(x, this.g.ctx.currentTime, 0.5);
    }
    pause() { this.el.pause(); }
    resume() { if (this.current) this.el.play().catch(() => {}); }
    stop() {
      this.out.gain.setTargetAtTime(0, this.g.ctx.currentTime, 0.2);
      const { el, out, src } = this;
      setTimeout(() => { el.pause(); el.removeAttribute('src'); try { out.disconnect(); src.disconnect(); } catch {} }, 1200);
    }
  }
  const nowPlaying = () => {
    const t = engine && engine.theme === 'playlist' && engine.current;
    return t ? { id: t.id, title: t.title, artist: t.artist, link: t.link || null } : null;
  };

  let g = null;
  let engine = null;
  let scene = 'menu';
  let gameLevel = 0.2;
  const lastPlayed = {};

  function ensure() {
    if (g) return g;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { g = createGraph(new AC({ latencyHint: 'interactive' })); } catch { return null; }
    applyVolumes(g, settings, 0.01);
    return g;
  }
  const ready = () => g && g.ctx.state === 'running';
  const currentLevel = () => (scene in SCENE_LEVEL ? SCENE_LEVEL[scene] : gameLevel);

  function syncMusic() {
    if (!ready()) return;
    let want = settings.theme !== 'off' && !settings.muted && settings.music > 0 ? settings.theme : null;
    if (want === 'playlist' && !tracks.length) want = 'monaco'; // nothing licensed yet (or still loading)
    if (engine && engine.theme !== want) { engine.stop(); engine = null; }
    if (!engine && want) {
      engine = want === 'playlist' ? new Playlist(g) : new Engine(g, want);
      engine.setLevel(currentLevel(), true);
      engine.start();
    }
    if (engine && engine.setDuck) engine.setDuck(scene in SCENE_LEVEL ? 1 : DUCK);
    else if (engine) {
      engine.setLevel(currentLevel());
      const cutoff = 700 * Math.pow(2, currentLevel() * 4.2); // ~700 Hz closed, ~13 kHz open
      g.musicFilter.frequency.setTargetAtTime(cutoff, g.ctx.currentTime, 0.8);
    }
  }

  // The first gesture creates and resumes the context (browsers block audio before that).
  function unlock() {
    if (!ensure()) return;
    if (g.ctx.state !== 'running') g.ctx.resume().then(syncMusic).catch(() => {});
    else syncMusic();
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!g) return;
    if (document.hidden) { if (engine && engine.pause) engine.pause(); g.ctx.suspend().catch(() => {}); }
    else g.ctx.resume().then(() => { if (engine && engine.resume) engine.resume(); syncMusic(); }).catch(() => {});
  });

  const api = {
    play(name) {
      if (!ready() || settings.muted || !SFX[name] || settings.sfx === 0) return;
      const now = g.ctx.currentTime;
      if (lastPlayed[name] && now - lastPlayed[name] < 0.03) return; // no machine-gun stacking
      lastPlayed[name] = now;
      try { SFX[name](g, now + 0.005); } catch {}
    },
    scene(name) {
      if (scene === name) return;
      scene = name;
      syncMusic();
    },
    intensity(x) {
      gameLevel = clamp(Number(x) || 0, 0, 1);
      if (!(scene in SCENE_LEVEL)) syncMusic();
    },
    get: () => ({ ...settings }),
    set(patch) {
      const next = { ...settings, ...patch };
      if (!THEMES_OK.includes(next.theme)) next.theme = settings.theme;
      for (const k of ['master', 'music', 'sfx']) next[k] = clamp(Math.round(Number(next[k]) || 0), 0, 100);
      next.muted = !!next.muted;
      settings = next;
      save();
      if (g) { applyVolumes(g, settings); syncMusic(); }
      listeners.forEach(f => { try { f(api.get()); } catch {} });
    },
    onChange(f) { listeners.push(f); },

    // Artist playlist.
    tracks: () => tracks.map(({ id, title, artist, link }) => ({ id, title, artist, link: link || null })),
    nowPlaying,
    skip() { if (engine && engine.theme === 'playlist') engine.next(); },
    onTrack(f) { trackListeners.push(f); },
    tracksReady,
    debug: () => ({ theme: engine ? engine.theme : null, duck: engine && engine.duck, scene, time: engine && engine.el ? engine.el.currentTime : null, paused: engine && engine.el ? engine.el.paused : null }),

    // Render offline and measure levels (used by the automated audio check).
    async measure({ theme = null, level = 0.5, seconds = 6, sfx = [], sampleRate = 44100 } = {}) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const oc = new OAC(2, Math.ceil(sampleRate * seconds), sampleRate);
      const og = createGraph(oc);
      applyVolumes(og, { ...DEFAULTS, theme: theme || 'off' }, 0.001);
      if (theme) {
        const e = new Engine(og, theme);
        e.setLevel(level, true);
        e.out.gain.value = 1;
        og.musicFilter.frequency.value = 700 * Math.pow(2, level * 4.2);
        e.next = 0.02;
        e.schedule(seconds - 0.5);
      }
      sfx.forEach((name, k) => SFX[name](og, 0.05 + k * 1.2));
      const buf = await oc.startRendering();
      // bright = RMS of the sample-to-sample difference: a rough measure of high-frequency energy.
      let peak = 0, sum = 0, diff = 0, clipped = 0, n = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) {
          const v = Math.abs(d[i]);
          if (v > peak) peak = v;
          if (v >= 0.999) clipped++;
          sum += d[i] * d[i];
          if (i) diff += (d[i] - d[i - 1]) ** 2;
          n++;
        }
      }
      const db = v => (v > 0 ? 20 * Math.log10(v) : -Infinity);
      const rms = Math.sqrt(sum / n);
      return { peak, peakDb: db(peak), rms, rmsDb: db(rms), brightDb: db(Math.sqrt(diff / n)), clipped };
    },
    themes: Object.keys(THEMES),
    effects: Object.keys(SFX),
  };

  window.VCAudio = api;
})();
