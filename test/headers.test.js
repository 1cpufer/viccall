/*
 * Security headers and the Content Security Policy. The policy allows no
 * inline scripts or style attributes, so the static check at the end keeps
 * the pages and scripts free of them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers');

const PUBLIC = path.join(__dirname, '..', 'public');

test('every response carries the security headers; the full CSP is report-only until CSP_ENFORCE', async () => {
  const srv = await startServer();
  try {
    for (const url of ['/', '/app.js', '/api/meta', '/api/nope']) {
      const r = await fetch(srv.base + url);
      const h = name => r.headers.get(name);
      assert.equal(h('content-security-policy'), "object-src 'none'; base-uri 'self'; frame-ancestors 'none'", url);
      const full = h('content-security-policy-report-only');
      for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' https://upload.wikimedia.org blob:", "frame-ancestors 'none'", "object-src 'none'", 'report-uri /api/csp-report']) {
        assert.ok(full.includes(d), `${url}: ${d}`);
      }
      assert.doesNotMatch(full, /unsafe-inline|unsafe-eval/);
      assert.equal(h('x-frame-options'), 'DENY');
      assert.equal(h('x-content-type-options'), 'nosniff');
      assert.equal(h('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.equal(h('cross-origin-opener-policy'), 'same-origin');
      assert.match(h('permissions-policy'), /camera=\(\), geolocation=\(\)/);
      assert.equal(h('x-powered-by'), null);
      assert.equal(h('strict-transport-security'), null, 'not over plain http');
    }
  } finally { await srv.stop(); }

  const enforced = await startServer({ cspEnforce: true });
  try {
    const r = await fetch(`${enforced.base}/`);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'; script-src 'self'/);
    assert.equal(r.headers.get('content-security-policy-report-only'), null);
  } finally { await enforced.stop(); }
});

test('HSTS is sent for https requests behind the proxy', async () => {
  const before = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  const srv = await startServer();
  try {
    const r = await fetch(`${srv.base}/`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  } finally {
    await srv.stop();
    if (before === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = before;
  }
});

test('CSP reports are collected once per kind a day, without query strings, and only the owner can read them', async () => {
  const srv = await startServer();
  try {
    const legacy = body => fetch(`${srv.base}/api/csp-report`, { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: JSON.stringify({ 'csp-report': body }) });
    const one = { 'document-uri': 'https://viccall.test/?join=ABCDE', 'violated-directive': 'img-src', 'effective-directive': 'img-src', 'blocked-uri': 'https://evil.example/x.png?token=secret', disposition: 'report' };
    assert.equal((await legacy(one)).status, 204);
    assert.equal((await legacy(one)).status, 204);
    const modern = await fetch(`${srv.base}/api/csp-report`, {
      method: 'POST', headers: { 'content-type': 'application/reports+json' },
      body: JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://viccall.test/', effectiveDirective: 'script-src-elem', blockedURL: 'inline', disposition: 'report' } }, { type: 'other', body: {} }]),
    });
    assert.equal(modern.status, 204);
    assert.equal((await fetch(`${srv.base}/api/csp-report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nothing":1}' })).status, 204, 'junk is ignored');

    const reports = (await srv.api('GET', '/api/reports')).body.filter(r => r.type === 'csp');
    assert.equal(reports.length, 2);
    const img = reports.find(r => r.directive === 'img-src');
    assert.equal(img.count, 2, 'repeats are counted, not stored again');
    assert.equal(img.blocked, 'https://evil.example/x.png');
    assert.equal(img.page, '/');
    assert.ok(!JSON.stringify(reports).includes('secret') && !JSON.stringify(reports).includes('ABCDE'), 'no query strings kept');
    assert.equal((await srv.api('GET', '/api/reports', null, { 'x-forwarded-for': '1.2.3.4' })).status, 404, 'owner only');
  } finally { await srv.stop(); }
});

test('pages and scripts have no inline scripts, event handlers or style attributes (the CSP would block them)', () => {
  const files = fs.readdirSync(PUBLIC).filter(f => /\.(html|js)$/.test(f) && !f.startsWith('socket.io'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    if (f.endsWith('.html')) {
      for (const tag of src.match(/<script\b[^>]*>/gi) || []) assert.match(tag, /\bsrc=/, `${f}: inline <script>`);
      assert.doesNotMatch(src, /<style\b/i, `${f}: <style> block`);
    }
    assert.doesNotMatch(src, /\sstyle="/, `${f}: style attribute`);
    assert.doesNotMatch(src, /\son(click|load|error|input|change|submit|mouseover|keydown)=["']/i, `${f}: inline event handler`);
    assert.doesNotMatch(src, /javascript:/i, `${f}: javascript: URL`);
  }
});
