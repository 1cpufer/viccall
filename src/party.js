const crypto = require('crypto');
const VCScore = require('../public/scoring.js');

const TOTAL = 10;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const MAX_PLAYERS = 16;
const MAX_ROOMS = 2000;

const DEFAULTS = {
  roundMs: 60_000,          // normal modes
  timeAttackMs: 30_000,     // Time Attack
  graceMs: 45_000,          // how long a dropped player keeps their seat
  awayMs: 8_000,            // how long the round waits for a dropped player before moving on
  idleRoomMs: 2 * 60 * 60_000,
  sweepMs: 60_000,
};

function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function sanitizeName(raw) {
  const cleaned = String(raw || '').replace(/[^\w \-'.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return cleaned || 'Anonymous';
}

const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const validKey = k => typeof k === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(k);

function poolFor(ALL, mode) {
  // Entries flagged `excluded` (wrong photo etc.) stay in the data but never get served.
  const CARS = ALL.filter(c => !c.excluded);
  const pool = mode === 'niche' ? CARS.filter(c => c.niche && !c.kit)
    : mode === 'supercar' ? CARS.filter(c => c.supercar && !c.kit)
    : mode === 'kit' ? CARS.filter(c => c.kit)
    : mode === 'worldwide' || mode === 'timeattack' ? CARS.filter(c => !c.kit)
    : CARS.filter(c => c.region === mode && !c.kit);
  return pool.length ? pool : CARS.filter(c => !c.kit);
}

// Ten cars, no repeats unless the pool is smaller than ten (then no back-to-back repeats).
function buildQueue(CARS, mode, total = TOTAL) {
  const pool = poolFor(CARS, mode);
  const out = [];
  while (out.length < total) {
    const batch = shuffle(pool);
    if (out.length && batch.length > 1 && batch[0] === out[out.length - 1]) batch.push(batch.shift());
    out.push(...batch);
  }
  return out.slice(0, total);
}

function attachParty(io, CARS, MODES, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const rooms = new Map();
  const roundMsFor = mode => (mode === 'timeattack' ? cfg.timeAttackMs : cfg.roundMs);

  function makeCode() {
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  const connected = room => [...room.players.values()].filter(p => p.socketId);
  // Players the round still waits for: connected, or dropped only moments ago (a refresh).
  const waitingOn = room => [...room.players.values()].filter(p => p.socketId || Date.now() - p.awaySince < cfg.awayMs);

  function publicPlayers(room) {
    return [...room.players.values()].map(p => ({
      id: p.id, name: p.name, score: p.score, answered: p.answered,
      // This round's points stay hidden until the reveal so nobody can read the answer off the scoreboard.
      lastPts: room.state === 'playing' ? null : p.lastPts,
      host: p.id === room.hostId, connected: !!p.socketId,
    }));
  }
  const standings = room => publicPlayers(room).sort((a, b) => b.score - a.score);

  function uniqueName(room, name) {
    const taken = new Set([...room.players.values()].map(p => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name.slice(0, 17)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  function revealPayload(room) {
    const car = room.queue[room.curIdx];
    return {
      idx: room.curIdx, make: car.make, model: car.model, year: car.year, yearRange: car.yearRange || null, kit: car.kit || null,
      hint: car.hint, carId: car.id, standings: standings(room),
    };
  }

  function snapshot(room, youId) {
    const s = {
      code: room.code, mode: room.mode, state: room.state, youId, total: TOTAL,
      players: publicPlayers(room), serverNow: Date.now(),
    };
    if (room.state === 'playing' || room.state === 'reveal') {
      const car = room.queue[room.curIdx];
      s.round = { idx: room.curIdx, img: car.img, deadline: room.deadline, durationMs: roundMsFor(room.mode) };
      const me = room.players.get(youId);
      if (me && me.answered) s.round.you = me.lastResult;
    }
    if (room.state === 'reveal') s.reveal = revealPayload(room);
    if (room.state === 'final') s.standings = standings(room);
    return s;
  }

  function broadcastPlayers(room) {
    io.to(room.code).emit('party:players', { players: publicPlayers(room) });
  }

  function touch(room) { room.lastActive = Date.now(); }

  function clearRoundTimer(room) {
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  }

  function revealRound(room) {
    if (room.state !== 'playing') return;
    clearRoundTimer(room);
    room.state = 'reveal';
    room.players.forEach(p => {
      if (!p.answered) p.lastPts = 0;
      p.score += p.pending || 0;
      p.pending = 0;
    });
    io.to(room.code).emit('party:reveal', revealPayload(room));
  }

  function startRound(room) {
    clearRoundTimer(room);
    room.state = 'playing';
    room.players.forEach(p => { p.answered = false; p.lastPts = null; p.lastResult = null; p.pending = 0; });
    const ms = roundMsFor(room.mode);
    room.deadline = Date.now() + ms;
    room.timer = setTimeout(() => revealRound(room), ms);
    const car = room.queue[room.curIdx];
    const next = room.queue[room.curIdx + 1];
    io.to(room.code).emit('party:round', {
      idx: room.curIdx, total: TOTAL, img: car.img, players: publicPlayers(room),
      deadline: room.deadline, durationMs: ms, serverNow: Date.now(),
      nextImg: next ? next.img : null,
    });
  }

  function maybeRevealEarly(room) {
    const live = waitingOn(room);
    if (room.state === 'playing' && live.length > 0 && live.every(p => p.answered)) revealRound(room);
  }

  function destroyRoom(room) {
    clearRoundTimer(room);
    room.players.forEach(p => { if (p.dropTimer) clearTimeout(p.dropTimer); });
    rooms.delete(room.code);
  }

  // Host must be someone who's actually here; hand it to the next connected player.
  function ensureHost(room) {
    const host = room.players.get(room.hostId);
    if (host && host.socketId) return;
    const next = connected(room)[0];
    if (next) room.hostId = next.id;
  }

  function removePlayer(room, pid) {
    const p = room.players.get(pid);
    if (!p) return;
    if (p.dropTimer) clearTimeout(p.dropTimer);
    room.players.delete(pid);
    if (room.players.size === 0) return destroyRoom(room);
    ensureHost(room);
    broadcastPlayers(room);
    maybeRevealEarly(room);
  }

  // Socket leaves on purpose (leave button, or before joining another room).
  function leaveCurrent(socket) {
    const code = socket.data.roomCode;
    const pid = socket.data.pid;
    delete socket.data.roomCode;
    delete socket.data.pid;
    if (!code) return;
    socket.leave(code);
    const room = rooms.get(code);
    if (room) removePlayer(room, pid);
  }

  function bind(socket, room, player) {
    player.socketId = socket.id;
    player.awaySince = 0;
    if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.pid = player.id;
  }

  function addPlayer(socket, room, name, key) {
    const player = {
      id: crypto.randomUUID(), key: validKey(key) ? key : null, name: uniqueName(room, name),
      score: 0, pending: 0, answered: false, lastPts: null, lastResult: null, socketId: null, dropTimer: null, awaySince: 0,
    };
    room.players.set(player.id, player);
    bind(socket, room, player);
    return player;
  }

  // Basic flood control: 30 events per 5 s per socket.
  function allow(socket) {
    const now = Date.now();
    const b = socket.data.bucket || (socket.data.bucket = { t: now, n: 0 });
    if (now - b.t > 5000) { b.t = now; b.n = 0; }
    return ++b.n <= 30;
  }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (now - room.lastActive > cfg.idleRoomMs) destroyRoom(room);
    }
  }, cfg.sweepMs);
  if (sweeper.unref) sweeper.unref();

  io.on('connection', socket => {
    const on = (event, handler) => socket.on(event, (payload, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      if (!allow(socket)) return reply({ ok: false, error: 'Slow down' });
      try { handler(obj(payload), reply); } catch (e) {
        console.error(`[party] ${event} failed:`, e);
        reply({ ok: false, error: 'Server error' });
      }
    });

    const myRoom = () => {
      const room = rooms.get(socket.data.roomCode);
      const player = room && room.players.get(socket.data.pid);
      return player && player.socketId === socket.id ? { room, player } : {};
    };

    on('party:create', (payload, cb) => {
      if (rooms.size >= MAX_ROOMS) return cb({ ok: false, error: 'Server is busy, try again soon' });
      leaveCurrent(socket);
      const mode = MODES.includes(payload.mode) ? payload.mode : 'worldwide';
      const room = { code: makeCode(), mode, hostId: null, players: new Map(), queue: [], curIdx: -1, state: 'lobby', timer: null, deadline: 0, lastActive: Date.now() };
      rooms.set(room.code, room);
      const p = addPlayer(socket, room, sanitizeName(payload.name), payload.key);
      room.hostId = p.id;
      cb({ ok: true, ...snapshot(room, p.id) });
    });

    on('party:join', (payload, cb) => {
      const code = str(payload.code, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, error: 'No party with that code' });
      // Same browser tab coming back: reclaim the seat instead of duplicating it.
      const existing = validKey(payload.key) && [...room.players.values()].find(p => p.key === payload.key);
      if (existing) {
        if (socket.data.roomCode !== code) leaveCurrent(socket);
        bind(socket, room, existing);
        ensureHost(room); touch(room); broadcastPlayers(room);
        return cb({ ok: true, ...snapshot(room, existing.id) });
      }
      if (room.state !== 'lobby' && room.state !== 'final') return cb({ ok: false, error: 'That game already started' });
      if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'That party is full' });
      leaveCurrent(socket);
      const p = addPlayer(socket, room, sanitizeName(payload.name), payload.key);
      touch(room);
      broadcastPlayers(room);
      cb({ ok: true, ...snapshot(room, p.id) });
    });

    // Reconnect after refresh / network drop. Identified by the per-tab key.
    on('party:resume', (payload, cb) => {
      const room = rooms.get(str(payload.code, 8).toUpperCase());
      const player = room && validKey(payload.key) && [...room.players.values()].find(p => p.key === payload.key);
      if (!player) return cb({ ok: false, error: 'Party ended' });
      if (player.socketId && player.socketId !== socket.id) {
        const old = io.sockets.sockets.get(player.socketId);
        if (old) { old.leave(room.code); delete old.data.roomCode; delete old.data.pid; }
      }
      bind(socket, room, player);
      ensureHost(room); touch(room); broadcastPlayers(room);
      cb({ ok: true, ...snapshot(room, player.id) });
    });

    on('party:start', (payload, cb) => {
      const { room, player } = myRoom();
      if (!room || room.hostId !== player.id) return cb({ ok: false, error: 'Only the host can start' });
      if (room.state !== 'lobby' && room.state !== 'final') return cb({ ok: false, error: 'Already started' });
      room.queue = buildQueue(CARS, room.mode);
      room.curIdx = 0;
      room.players.forEach(p => { p.score = 0; p.pending = 0; });
      touch(room);
      startRound(room);
      cb({ ok: true });
    });

    on('party:guess', (payload, cb) => {
      const { room, player } = myRoom();
      if (!room || room.state !== 'playing') return cb({ ok: false, error: 'Round is over' });
      if (player.answered) return cb({ ok: false, error: 'Already answered' });
      if (Number.isInteger(payload.idx) && payload.idx !== room.curIdx) return cb({ ok: false, error: 'Round is over' });
      const guess = { make: str(payload.make, 60), model: str(payload.model, 60), year: str(payload.year, 8), kit: str(payload.kit, 60) };
      const result = VCScore.scoreRound(room.queue[room.curIdx], guess, { ruleset: 'casual', kind: room.mode === 'kit' ? 'kit' : 'car' });
      player.pending = result.pts;
      player.answered = true;
      player.lastPts = result.pts;
      player.lastResult = { pts: result.pts, res: result.res };
      touch(room);
      cb({ ok: true, pts: result.pts, res: result.res });
      io.to(room.code).emit('party:progress', {
        answeredCount: waitingOn(room).filter(p => p.answered).length,
        total: waitingOn(room).length,
        players: publicPlayers(room),
      });
      maybeRevealEarly(room);
    });

    on('party:reveal', (payload, cb) => {
      const { room, player } = myRoom();
      if (!room || room.hostId !== player.id || room.state !== 'playing') return cb({ ok: false });
      revealRound(room);
      cb({ ok: true });
    });

    on('party:next', (payload, cb) => {
      const { room, player } = myRoom();
      if (!room || room.hostId !== player.id || room.state !== 'reveal') return cb({ ok: false, error: 'Not ready yet' });
      if (Number.isInteger(payload.idx) && payload.idx !== room.curIdx) return cb({ ok: false, error: 'Already moved on' });
      touch(room);
      room.curIdx += 1;
      if (room.curIdx >= TOTAL) {
        room.state = 'final';
        room.players.forEach(p => { p.answered = false; });
        io.to(room.code).emit('party:final', { standings: standings(room) });
      } else {
        startRound(room);
      }
      cb({ ok: true });
    });

    on('party:leave', (payload, cb) => {
      leaveCurrent(socket);
      cb({ ok: true });
    });

    socket.on('disconnect', () => {
      const code = socket.data.roomCode;
      const room = rooms.get(code);
      const player = room && room.players.get(socket.data.pid);
      if (!player || player.socketId !== socket.id) return;
      // Keep the seat for a while so a refresh or network blip can resume.
      player.socketId = null;
      player.awaySince = Date.now();
      ensureHost(room);
      broadcastPlayers(room);
      // Give a refreshing player a moment before the round stops waiting for them.
      const recheck = setTimeout(() => { const r = rooms.get(code); if (r) maybeRevealEarly(r); }, cfg.awayMs + 50);
      if (recheck.unref) recheck.unref();
      player.dropTimer = setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.players.get(player.id) === player && !player.socketId) removePlayer(r, player.id);
      }, cfg.graceMs);
      if (player.dropTimer.unref) player.dropTimer.unref();
    });
  });

  return {
    rooms,
    close() { clearInterval(sweeper); for (const r of [...rooms.values()]) destroyRoom(r); },
  };
}

module.exports = { attachParty, buildQueue, poolFor, sanitizeName, TOTAL };
