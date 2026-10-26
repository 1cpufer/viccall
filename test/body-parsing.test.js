/*
 * Request bodies: a compressed body with trailing bytes used to crash the
 * whole server (body-parser < 1.20.9, GHSA-27r3-jxmh-p828). The server runs in
 * a child process here, so a crash fails this test instead of the test run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const zlib = require('zlib');
const { fork } = require('child_process');

const SERVER = `
  const { createApp } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'server.js'))});
  const app = createApp({ dataDir: process.argv[2], adminToken: '', log: false });
  app.server.listen(0, '127.0.0.1', () => process.send(app.server.address().port));
`;

test('a compressed request body with trailing bytes is refused, and the server stays up', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-body-'));
  const script = path.join(dataDir, 'server.js');
  fs.writeFileSync(script, SERVER);
  const child = fork(script, [dataDir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let exited = null;
  child.on('exit', code => { exited = code; });
  try {
    const port = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', () => reject(new Error('server did not start'))); });
    const base = `http://127.0.0.1:${port}`;
    const body = Buffer.concat([zlib.gzipSync(JSON.stringify({ type: 'bug', message: 'x' })), Buffer.from('trailing bytes')]);
    const r = await fetch(`${base}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body });
    assert.equal(r.status, 415, 'compressed request bodies are not accepted');
    await new Promise(res => setTimeout(res, 300)); // where the old crash happened, after the response
    assert.equal(exited, null, 'the server process is still running');
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    // Uploads (raw bodies) don't accept compressed bodies either.
    const up = await fetch(`${base}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'deflate' }, body: zlib.deflateSync('{}') });
    assert.equal(up.status, 415);

    // Bad bodies get a plain JSON error: no stack trace, no file paths.
    for (const [bodyText, type, want] of [['{not json', 'application/json', 400], [JSON.stringify({ message: 'x'.repeat(20_000) }), 'application/json', 413]]) {
      const bad = await fetch(`${base}/api/report`, { method: 'POST', headers: { 'content-type': type }, body: bodyText });
      assert.equal(bad.status, want);
      assert.match(bad.headers.get('content-type'), /application\/json/);
      const text = await bad.text();
      assert.doesNotMatch(text, /node_modules|at [A-Za-z.]+ \(|\.js:\d+/, 'no stack trace or paths');
    }
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
