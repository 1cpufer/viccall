/*
 * Photo proxy for ranked play.
 *
 * Wikimedia file names usually spell out the car ("Nissan_GT-R_Nismo_(R35)..."),
 * so anyone watching the network tab could read the answer. Ranked and party
 * rounds hand the browser an opaque /api/img/<token> URL instead, and the
 * server fetches the photo itself.
 *
 * The token is only issued when a round opens, so a photo can't be looked at
 * before its clock is running; the moment the photo is first served is
 * recorded and used as the start of the clock.
 *
 * If Wikimedia can't be reached from the server, the proxy answers with a
 * redirect to the direct URL so the game stays playable (the anti-peek
 * protection is lost for that photo only).
 */
const crypto = require('crypto');

const USER_AGENT = 'VicCall/2.0 (https://github.com/1cpufer/viccall; car photo quiz)';
const CACHE_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const TOKEN_TTL_MS = 3 * 60 * 60_000;
const MAX_TOKENS = 50_000;
const UPSTREAM_TIMEOUT_MS = 9_000;

// "…/commons/thumb/a/ab/Name.jpg/960px-Name.jpg" -> "…/commons/a/ab/Name.jpg"
function originalOf(url) {
  const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/thumb\/(.+)\/[^/]+$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

function createImageProxy(opts = {}) {
  const fetcher = opts.fetch || ((url, init) => fetch(url, init));
  const cache = new Map(); // url -> { buf, type }   (Map keeps insertion order = LRU)
  let bytes = 0;
  const inflight = new Map();
  const tokens = new Map(); // token -> { url, onServe, exp }

  function remember(url, entry) {
    cache.set(url, entry);
    bytes += entry.buf.length;
    while (bytes > CACHE_BYTES && cache.size > 1) {
      const [oldest, e] = cache.entries().next().value;
      cache.delete(oldest);
      bytes -= e.buf.length;
    }
  }

  async function fetchOne(url) {
    const res = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new Error(`not an image (${type})`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_IMAGE_BYTES) throw new Error('image too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new Error('bad image size');
    return { buf, type };
  }

  // Thumbnail first; if Wikimedia won't render that size (source smaller than
  // the requested width), fall back to the original file.
  function load(url) {
    const hit = cache.get(url);
    if (hit) { cache.delete(url); cache.set(url, hit); return Promise.resolve(hit); }
    if (inflight.has(url)) return inflight.get(url);
    const p = (async () => {
      let entry;
      try { entry = await fetchOne(url); } catch (e) {
        const orig = originalOf(url);
        if (!orig) throw e;
        entry = await fetchOne(orig);
      }
      remember(url, entry);
      return entry;
    })().finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }

  function warm(url) {
    if (url) load(url).catch(() => {});
  }

  function sweep() {
    const now = Date.now();
    for (const [t, v] of tokens) if (v.exp < now) tokens.delete(t);
    while (tokens.size > MAX_TOKENS) tokens.delete(tokens.keys().next().value);
  }

  // Opaque URL for a photo. onServe(ok) runs once, when the photo (or the fallback redirect) first goes out.
  function issue(url, onServe) {
    if (tokens.size > MAX_TOKENS) sweep();
    const token = crypto.randomBytes(16).toString('base64url');
    tokens.set(token, { url, onServe: onServe || null, exp: Date.now() + TOKEN_TTL_MS });
    return `/api/img/${token}`;
  }

  // ok = the photo itself went out (false = we redirected to Wikimedia instead).
  function served(t, ok) {
    if (t.onServe) { const f = t.onServe; t.onServe = null; try { f(ok); } catch {} }
  }

  async function handle(req, res) {
    const t = tokens.get(String(req.params.token || ''));
    if (!t || t.exp < Date.now()) return res.status(404).json({ error: 'not found' });
    try {
      const { buf, type } = await load(t.url);
      served(t, true);
      res.set('Cache-Control', 'private, max-age=10800, immutable');
      res.set('Content-Type', type);
      res.send(buf);
    } catch (e) {
      // Upstream unreachable: keep the game playable.
      served(t, false);
      res.set('Cache-Control', 'no-store');
      res.redirect(302, req.query.orig === '1' ? originalOf(t.url) || t.url : t.url);
    }
  }

  const timer = setInterval(sweep, 10 * 60_000);
  if (timer.unref) timer.unref();

  return { issue, handle, warm, load, close() { clearInterval(timer); }, stats: () => ({ cached: cache.size, bytes, tokens: tokens.size }) };
}

module.exports = { createImageProxy, originalOf, USER_AGENT };
