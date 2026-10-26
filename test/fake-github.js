// An in-memory stand-in for the GitHub gists API (tests only).
const { FILE } = require('../src/scores-backup');

function fakeGitHub() {
  const gists = new Map();
  const calls = [];
  const state = { down: false };
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  async function fetch(url, init = {}) {
    const method = init.method || 'GET';
    const u = new URL(url);
    calls.push(`${method} ${u.pathname}`);
    if (state.down) return reply(503, {});
    if (!/^Bearer tok_/.test((init.headers || {}).Authorization || '')) return reply(401, {});
    if (method === 'GET' && u.pathname === '/gists') return reply(200, [...gists.values()].map(g => ({ id: g.id, description: g.description, files: { [FILE]: {} } })));
    const m = /^\/gists\/(\w+)$/.exec(u.pathname);
    if (method === 'GET' && m) return gists.has(m[1]) ? reply(200, gists.get(m[1])) : reply(404, {});
    if (method === 'POST' && u.pathname === '/gists') {
      const b = JSON.parse(init.body);
      const g = { id: `g${gists.size + 1}`, description: b.description, public: b.public, files: Object.fromEntries(Object.entries(b.files).map(([k, v]) => [k, { content: v.content }])) };
      gists.set(g.id, g);
      return reply(201, g);
    }
    if (method === 'PATCH' && m) {
      const b = JSON.parse(init.body);
      for (const [k, v] of Object.entries(b.files)) gists.get(m[1]).files[k] = { content: v.content };
      return reply(200, gists.get(m[1]));
    }
    return reply(404, {});
  }
  return { fetch, gists, calls, state, saved: () => JSON.parse([...gists.values()][0].files[FILE].content) };
}

module.exports = { fakeGitHub };
