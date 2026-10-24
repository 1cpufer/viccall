/*
 * Keep a free Render instance awake.
 *
 * Free instances sleep after 15 minutes without inbound traffic, the next
 * visitor waits about a minute, and the restart wipes the local files.
 * Requesting our own public address every 10 minutes counts as traffic.
 * Staying up all month uses about 744 of the 750 free instance hours, so
 * this only fits while VicCall is the workspace's one free service.
 */
function startKeepAwake({ url, intervalMs = 10 * 60_000, fetch: fetcher = (u, i) => fetch(u, i), log = true } = {}) {
  if (!url) return { stop() {}, enabled: false };
  const target = `${String(url).replace(/\/$/, '')}/api/health`;
  let fails = 0;
  const ping = async () => {
    try {
      const res = await fetcher(target, { headers: { 'User-Agent': 'VicCall keep-awake' }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      if (fails && log) console.log('[keep-awake] reachable again');
      fails = 0;
    } catch (e) {
      fails++;
      if (log && (fails === 1 || fails % 6 === 0)) console.warn(`[keep-awake] ${target} failed: ${e.message}`);
    }
  };
  const timer = setInterval(ping, intervalMs);
  if (timer.unref) timer.unref();
  if (log) console.log(`[keep-awake] visiting ${target} every ${Math.round(intervalMs / 60_000)} min`);
  return { stop() { clearInterval(timer); }, ping, enabled: true };
}

module.exports = { startKeepAwake };
