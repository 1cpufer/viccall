/* Play counter page: reads /api/stats with the owner key. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const store = {
    get: () => { try { return localStorage.getItem('vc_admin') || ''; } catch { return ''; } },
    set: v => { try { localStorage.setItem('vc_admin', v); } catch {} },
    del: () => { try { localStorage.removeItem('vc_admin'); } catch {} },
  };
  const MODE = { free: 'Free Play', daily: 'Daily Challenge', endless: 'Endless' };
  let playlists = {};
  // Playlist titles from the menu data (asked without ?seen=, so it isn't counted as a visit).
  const titles = fetch('/api/meta').then(r => r.json()).then(m => { playlists = Object.fromEntries((m.playlists || []).map(p => [p.id, p.title])); }).catch(() => {});
  const modeName = m => MODE[m] || (m.startsWith('ranked:') ? `Ranked: ${playlists[m.slice(7)] || m.slice(7)}` : m);
  const n = v => (v || 0).toLocaleString();
  const dayName = d => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  function card(title, t) {
    return `<section class="stats-card">
      <h2 class="h3">${esc(title)}</h2>
      <dl>
        <div><dt>Visitors</dt><dd>${n(t.visitors)}</dd></div>
        <div><dt>New</dt><dd>${n(t.newVisitors)}</dd></div>
        <div><dt>Came back</dt><dd>${n(t.returning)}</dd></div>
        <div><dt>Games started</dt><dd>${n(t.started)}</dd></div>
        <div><dt>Games finished</dt><dd>${n(t.finished)}</dd></div>
        <div><dt>Party games</dt><dd>${n(t.partyGames)}${t.partyPlayers ? ` <small>(${n(t.partyPlayers)} players)</small>` : ''}</dd></div>
      </dl>
    </section>`;
  }

  function render(s) {
    const today = s.days.find(d => d.day === s.today) || {};
    const modes = Object.entries(s.modes7).sort((a, b) => b[1] - a[1]);
    $('out').innerHTML = `
      <div class="stats-cards">${card('Today', today)}${card('Last 7 days', s.last7)}${card('Last 30 days', s.last30)}</div>
      <h2 class="h3 sc-h">Games started this week, by mode</h2>
      ${modes.length ? `<ul class="stats-modes">${modes.map(([m, c]) => `<li><span>${esc(modeName(m))}</span><b>${n(c)}</b></li>`).join('')}</ul>` : '<p class="wait">No games yet.</p>'}
      <h2 class="h3 sc-h">Day by day</h2>
      <div class="stats-table-wrap" tabindex="0" role="region" aria-label="Day by day">
        <table class="sc-table stats-table">
          <thead><tr><th scope="col">Day</th><th scope="col">Visitors</th><th scope="col">New</th><th scope="col">Came back</th><th scope="col">Games</th><th scope="col">Finished</th><th scope="col">Cars answered</th><th scope="col">Scores posted</th><th scope="col">Party games</th></tr></thead>
          <tbody>${s.days.map(d => `<tr><th scope="row">${esc(dayName(d.day))}</th><td>${n(d.visitors)}</td><td>${n(d.newVisitors)}</td><td>${n(d.returning)}</td><td>${n(d.started)}</td><td>${n(d.finished)}</td><td>${n(d.rounds)}</td><td>${n(d.scoresPosted)}</td><td>${n(d.partyGames)}</td></tr>`).join('') || '<tr><td colspan="9">Nothing yet.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="field-note">Days run on ${esc(s.tz)} time. A visitor is one browser on one day, so the same person on their phone and laptop counts twice.</p>
      <p><button class="btn btn--quiet" id="forget" type="button">Forget the key on this browser</button></p>`;
    $('forget').addEventListener('click', () => { store.del(); location.reload(); });
  }

  async function load(key) {
    await titles;
    const res = await fetch('/api/stats?days=30', { headers: { 'x-admin-token': key } }).catch(() => null);
    if (!res) { $('out').innerHTML = '<p class="form-msg">Couldn’t reach the server.</p>'; return false; }
    if (!res.ok) return false;
    render(await res.json());
    return true;
  }

  $('keyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const key = $('key').value.trim();
    if (await load(key)) { store.set(key); $('keyForm').hidden = true; } else $('keyMsg').textContent = 'That key didn’t work.';
  });

  (async () => {
    const key = store.get();
    if (!key || !(await load(key))) $('keyForm').hidden = false;
  })();
})();
