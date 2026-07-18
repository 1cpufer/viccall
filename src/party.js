const TOTAL = 10;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const MAX_PLAYERS = 16;

function clean(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function scoreGuess(car, mg, mol, yr) {
  const res = [];
  let pts = 0;
  if (mg) {
    const hit = clean(mg) === clean(car.make);
    const p = hit ? 1 : 0;
    pts += p;
    res.push({ label: 'Make', detail: hit ? car.make : `Not ${car.make}`, pts: p });
  }
  if (mol) {
    const hit = clean(mol) === clean(car.model);
    const p = hit ? 2 : 0;
    pts += p;
    res.push({ label: 'Model', detail: hit ? car.model : `Not ${car.model}`, pts: p });
  }
  if (yr) {
    const yg = parseInt(yr, 10);
    const ya = car.year;
    let p = 0, d = '';
    if (!isNaN(yg)) {
      const df = Math.abs(yg - ya);
      if (df === 0) { p = 2; d = `Exact — ${ya}`; }
      else if (df <= 5) { p = 1; d = `Within 5 yrs — ${ya}`; }
      else { p = 0; d = `Off by ${df} — ${ya}`; }
    }
    pts += p;
    res.push({ label: 'Year', detail: d, pts: p });
  }
  return { pts, res };
}

function shuffle(a) {
  return [...a].sort(() => Math.random() - 0.5);
}

function sanitizeName(raw) {
  const cleaned = String(raw || '').replace(/[^\w \-'.]/g, '').trim().slice(0, 20);
  return cleaned || 'Anonymous';
}

function attachParty(io, CARS, MODES) {
  const rooms = new Map();

  function getQueue(mode) {
    let pool = mode === 'niche' ? CARS.filter(c => c.niche)
      : mode === 'worldwide' || mode === 'timeattack' ? [...CARS]
      : CARS.filter(c => c.region === mode);
    while (pool.length < TOTAL) pool = [...pool, ...pool];
    return shuffle(pool).slice(0, TOTAL);
  }

  function makeCode() {
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function playersList(room) {
    return [...room.players.values()].map(p => ({
      id: p.id, name: p.name, score: p.score, answered: p.answered, host: p.id === room.hostId,
    }));
  }

  function standings(room) {
    return playersList(room).sort((a, b) => b.score - a.score);
  }

  function connectedCount(room) {
    return room.players.size;
  }

  function allAnswered(room) {
    return connectedCount(room) > 0 && [...room.players.values()].every(p => p.answered);
  }

  function revealRound(room) {
    room.state = 'reveal';
    const car = room.queue[room.curIdx];
    io.to(room.code).emit('party:reveal', {
      make: car.make, model: car.model, year: car.year, hint: car.hint,
      standings: standings(room),
    });
  }

  function endRoom(code) {
    rooms.delete(code);
  }

  io.on('connection', socket => {
    socket.on('party:create', (payload, cb) => {
      if (typeof cb !== 'function') return;
      const name = sanitizeName(payload && payload.name);
      const mode = MODES.includes(payload && payload.mode) ? payload.mode : 'worldwide';
      const code = makeCode();
      const room = { code, mode, hostId: socket.id, players: new Map(), queue: [], curIdx: -1, state: 'lobby' };
      room.players.set(socket.id, { id: socket.id, name, score: 0, answered: false });
      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      cb({ ok: true, code, youId: socket.id, mode, players: playersList(room) });
    });

    socket.on('party:join', (payload, cb) => {
      if (typeof cb !== 'function') return;
      const code = String((payload && payload.code) || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, error: 'Room not found' });
      if (room.state !== 'lobby') return cb({ ok: false, error: 'Game already in progress' });
      if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full' });
      const name = sanitizeName(payload && payload.name);
      room.players.set(socket.id, { id: socket.id, name, score: 0, answered: false });
      socket.join(code);
      socket.data.roomCode = code;
      io.to(code).emit('party:players', { players: playersList(room) });
      cb({ ok: true, code, youId: socket.id, mode: room.mode, players: playersList(room) });
    });

    socket.on('party:start', (payload, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return cb({ ok: false, error: 'Only the host can start' });
      if (room.state !== 'lobby' && room.state !== 'final') return cb({ ok: false, error: 'Already started' });
      room.queue = getQueue(room.mode);
      room.curIdx = 0;
      room.state = 'playing';
      room.players.forEach(p => { p.score = 0; p.answered = false; });
      io.to(room.code).emit('party:round', { idx: 0, total: TOTAL, img: room.queue[0].img, players: playersList(room) });
      cb({ ok: true });
    });

    socket.on('party:guess', (payload, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.state !== 'playing') return cb({ ok: false, error: 'No active round' });
      const player = room.players.get(socket.id);
      if (!player || player.answered) return cb({ ok: false, error: 'Already answered' });
      const car = room.queue[room.curIdx];
      const { pts, res } = scoreGuess(car, payload && payload.make, payload && payload.model, payload && payload.year);
      player.score += pts;
      player.answered = true;
      io.to(room.code).emit('party:progress', {
        answeredCount: [...room.players.values()].filter(p => p.answered).length,
        total: connectedCount(room),
      });
      cb({ ok: true, pts, res });
      if (allAnswered(room)) revealRound(room);
    });

    socket.on('party:reveal', (payload, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id || room.state !== 'playing') return cb({ ok: false });
      revealRound(room);
      cb({ ok: true });
    });

    socket.on('party:next', (payload, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id || room.state !== 'reveal') return cb({ ok: false });
      room.players.forEach(p => { p.answered = false; });
      room.curIdx += 1;
      if (room.curIdx >= TOTAL) {
        room.state = 'final';
        io.to(room.code).emit('party:final', { standings: standings(room) });
      } else {
        room.state = 'playing';
        io.to(room.code).emit('party:round', { idx: room.curIdx, total: TOTAL, img: room.queue[room.curIdx].img, players: playersList(room) });
      }
      cb({ ok: true });
    });

    socket.on('party:leave', () => {
      leaveRoom(socket);
    });

    socket.on('disconnect', () => {
      leaveRoom(socket);
    });

    function leaveRoom(socket) {
      const code = socket.data.roomCode;
      if (!code) return;
      const room = rooms.get(code);
      socket.leave(code);
      delete socket.data.roomCode;
      if (!room) return;
      const wasHost = room.hostId === socket.id;
      room.players.delete(socket.id);
      if (room.players.size === 0) {
        endRoom(code);
        return;
      }
      if (wasHost) {
        room.hostId = room.players.keys().next().value;
      }
      io.to(code).emit('party:players', { players: playersList(room) });
      if (room.state === 'playing' && allAnswered(room)) revealRound(room);
    }
  });
}

module.exports = { attachParty };
