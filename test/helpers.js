const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: ioc } = require('socket.io-client');
const { createApp } = require('../src/server.js');

async function startServer(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-test-'));
  const inst = createApp({ dataDir, adminToken: '', ...opts });
  await new Promise(r => inst.server.listen(0, '127.0.0.1', r));
  const { port } = inst.server.address();
  const base = `http://127.0.0.1:${port}`;
  const clients = [];
  return {
    ...inst, base, dataDir,
    async api(method, url, body, headers = {}) {
      const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
      let json = null;
      try { json = await res.json(); } catch {}
      return { status: res.status, body: json };
    },
    async client() {
      const c = ioc(base, { transports: ['websocket'], forceNew: true, reconnection: false });
      clients.push(c);
      await new Promise((res, rej) => { c.once('connect', res); c.once('connect_error', rej); });
      return c;
    },
    async stop() {
      clients.forEach(c => c.close());
      inst.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// A browser-like client: keeps the session cookie, sends the CSRF header.
function agent(srv) {
  let cookie = '';
  async function send(method, url, body, headers) {
    const res = await fetch(srv.base + url, { method, redirect: 'manual', headers: { 'x-viccall': '1', ...(cookie ? { cookie } : {}), ...headers }, body });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      cookie = v ? `${k}=${v}` : '';
    }
    const type = res.headers.get('content-type') || '';
    let json = null, buf = null;
    if (type.includes('json')) { try { json = await res.json(); } catch {} } else buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: json, buf, headers: res.headers };
  }
  return {
    get cookie() { return cookie; },
    req(method, url, body, extra = {}) {
      return send(method, url, body ? JSON.stringify(body) : undefined, { 'content-type': 'application/json', ...extra });
    },
    raw(method, url, buf, type = 'image/jpeg') { return send(method, url, buf, { 'content-type': type }); },
  };
}

const emit = (c, ev, payload) => new Promise(res => c.emit(ev, payload, res));
const once = (c, ev, ms = 3000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
  c.once(ev, d => { clearTimeout(t); res(d); });
});
const key = n => `testkey_${n}_${'x'.repeat(16)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { startServer, agent, emit, once, key, sleep };
