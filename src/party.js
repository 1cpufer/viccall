const crypto = require('crypto');
const VCScore = require('../public/scoring.js');
const Modes = require('./modes');
const Pools = require('./pools');

const TOTAL = Modes.ROUNDS;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const MAX_PLAYERS = 16;
const MAX_ROOMS = 2000;

const DEFAULTS = {
  roundMs: 60_000,          // casual rules
  competitiveMs: 45_000,    // competitive rules
  graceMs: 45_000,          // how long a dropped player keeps their seat
  awayMs: 8_000,            // how long the round waits for a dropped player before moving on
  idleRoomMs: 2 * 60 * 60_000,
  sweepMs: 60_000,
};

function sanitizeName(raw) {
  const cleaned = String(raw || '').replace(/[^\w \-'.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return cleaned || 'Anonymous';
}

const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const validKey = k => typeof k === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(k);

// Old clients sent a region "mode"; map those onto the closest playlist.
const LEGACY = { worldwide: 'world', timeattack: 'world', japan: 'jdm', germany: 'euro', italy: 'euro', uk: 'euro', france: 'euro', usa: 'world', niche: 'world', supercar: 'super', kit: 'kits' };
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const playlistFor = p => (own(Modes.PLAYLISTS, p) ? p : own(LEGACY, p) ? LEGACY[p] : 'world');

function poolFor(ALL, playlist) {
  const pool = Modes.live(ALL).filter(Modes.PLAYLISTS[playlistFor(playlist)].filter);
  return pool.length ? pool : Modes.live(ALL).filter(c => !c.kit);
}

// Ten cars, no repeats unless the pool is smaller than ten (then no back-to-back repeats).
function buildQueue(CARS, playlist, total = TOTAL) {
  return Modes.pick(poolFor(CARS, playlist), total);
}

function attachParty(io, CARS, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const images = opts.images || null;
  const index = opts.index || VCScore.buildIndex(CARS);
  const rooms = new Map();
  const roundMsFor = room => (room.ruleset === 'competitive' ? cfg.competitiveMs : cfg.roundMs);
  const kindFor = room => Modes.PLAYLISTS[room.playlist].kind || 'car';
  // Community photos need the proxy (they're served by token) and a way to tell who's playing.
  const community = images && opts.community ? opts.community : null;
  const identify = opts.identify || (() => null);
  const track = opts.track || (() => {}); // play counter: 'room', 'game' (with player count), 'finished'
  // Everyone seated in the room counts, connected or not.
  const ctxFor = room => ({ competitive: room.ruleset === 'competitive', participants: [...room.players.values()].map(p => p.userId || null) });
  // Photo URL players see. With the proxy it's opaque, so the file name can't give the car away.
  // A community photo's token checks the room's players again when it's fetched.
  const photo = (room, car) => {
    if (car.community) return images.issueLocal(() => community.photo(car.imageId, ctxFor(room)));
    return images ? images.issue(car.img) : car.img;
  };
  // Last check before a round's photo goes out: a community photo that may no
  // longer be shown to this room (removed, flagged, or a player's own) is
  // replaced with a first-party photo.
  function roundCar(room) {
    let car = room.queue[room.curIdx];
    if (car.community && !(community && Pools.communityAllowed(community.state(car.imageId), ctxFor(room)).ok)) {
      car = Pools.replacement(room.queue, room.fallback);
      if (!car) return null;
      room.queue[room.curIdx] = car;
    }
    return car;
  }

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
      idx: room.curIdx, make: car.make, model: car.model, variant: car.variant || null, generation: car.generation || null, year: car.year, yearRange: car.yearRange || null,
      kit: car.kit || null, hint: car.hint, credit: car.credit || null, photo: car.photo || null,
      attribution: !car.community && opts.attributionFor ? opts.attributionFor(car) : null, carId: car.id, standings: standings(room),
    };
  }

  function snapshot(room, youId) {
    const s = {
      code: room.code, playlist: room.playlist, ruleset: room.ruleset, kind: kindFor(room), state: room.state, youId, total: TOTAL,
      players: publicPlayers(room), serverNow: Date.now(),
    };
    if (room.state === 'playing' || room.state === 'reveal') {
      const car = room.queue[room.curIdx];
      s.round = { idx: room.curIdx, img: room.imgs[room.curIdx], deadline: room.deadline, durationMs: roundMsFor(room) };
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
    const ms = roundMsFor(room);
    room.deadline = Date.now() + ms;
    room.timer = setTimeout(() => revealRound(room), ms);
    const car = roundCar(room);
    if (!car) { // nothing safe to show: end the game rather than show an excluded photo
      clearRoundTimer(room);
      room.state = 'final';
      io.to(room.code).emit('party:final', { standings: standings(room) });
      return;
    }
    room.imgs[room.curIdx] = photo(room, car);
    const next = room.queue[room.curIdx + 1];
    // Next photo: warm the server cache (proxied) or let clients preload it (direct).
    if (next && images && !next.community) images.warm(next.img);
    io.to(room.code).emit('party:round', {
      idx: room.curIdx, total: TOTAL, img: room.imgs[room.curIdx], players: publicPlayers(room),
      deadline: room.deadline, durationMs: ms, serverNow: Date.now(),
      nextImg: next && !images && !next.community ? next.img : null,
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
    player.userId = identify(socket); // re-read on every (re)connect: signing in or out changes it
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
      const playlist = playlistFor(payload.playlist || payload.mode);
      const ruleset = payload.ruleset === 'competitive' ? 'competitive' : 'casual';
      const room = { code: makeCode(), playlist, ruleset, hostId: null, players: new Map(), queue: [], imgs: [], fallback: [], curIdx: -1, state: 'lobby', timer: null, deadline: 0, lastActive: Date.now() };
      rooms.set(room.code, room);
      track('room');
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

    // Host picks the playlist and rules while in the lobby (or after a game, for a rematch).
    on('party:settings', (payload, cb) => {
      const { room, player } = myRoom();
      if (!room || room.hostId !== player.id) return cb({ ok: false, error: 'Only the host can change settings' });
      if (room.state !== 'lobby' && room.state !== 'final') return cb({ ok: false, error: 'Game in progress' });
      if (payload.playlist !== undefined) room.playlist = playlistFor(payload.playlist);
      if (payload.ruleset !== undefined) room.ruleset = payload.ruleset === 'competitive' ? 'competitive' : 'casual';
      touch(room);
      io.to(room.code).emit('party:settings', { playlist: room.playlist, ruleset: room.ruleset, kind: kindFor(room) });
      cb({ ok: true, playlist: room.playlist, ruleset: room.ruleset });
    });

    on('party:start', (payload, cb) => {
      const { room, player } = myRoom();
      if (!room || room.hostId !== player.id) return cb({ ok: false, error: 'Only the host can start' });
      if (room.state !== 'lobby' && room.state !== 'final') return cb({ ok: false, error: 'Already started' });
      // First-party cars plus community photos cleared for everyone in the room.
      const base = poolFor(CARS, room.playlist);
      const extra = community ? Pools.eligible(community.items(), ctxFor(room)).filter(Modes.PLAYLISTS[room.playlist].filter) : [];
      room.fallback = base;
      room.queue = extra.length ? Pools.dedupe(Modes.pick(base.concat(extra), TOTAL), base) : Modes.pick(base, TOTAL);
      room.imgs = [];
      room.curIdx = 0;
      room.players.forEach(p => { p.score = 0; p.pending = 0; });
      touch(room);
      track('game', room.players.size);
      startRound(room);
      cb({ ok: true });
    });

    on('party:guess', (payload, cb) => {
      const { room, player } = myRoom();
      if (!room || room.state !== 'playing') return cb({ ok: false, error: 'Round is over' });
      if (player.answered) return cb({ ok: false, error: 'Already answered' });
      if (Number.isInteger(payload.idx) && payload.idx !== room.curIdx) return cb({ ok: false, error: 'Round is over' });
      const guess = { car: str(payload.car, 100), make: str(payload.make, 60), model: str(payload.model, 60), year: str(payload.year, 8), kit: str(payload.kit, 60) };
      const result = VCScore.scoreRound(room.queue[room.curIdx], guess, { ruleset: room.ruleset, kind: kindFor(room), index });
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
        track('finished');
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
