/*
 * Accounts and the Community Garage.
 *
 * Only active when the server has the Garage switched on (/api/meta garage).
 * Playing never needs an account: everything here is for people who want to
 * submit photos, keep a profile, or moderate.
 */
(() => {
  'use strict';
  const VC = window.VC;
  if (!VC) return;
  const { $, esc, api, toast } = VC;
  const dlg = $('dlgGarage');

  const S = {
    on: false, user: null, methods: {}, garage: null, licence: null,
    subs: null, tab: 'add', modTab: 'queue', modStatus: 'pending', modSel: null, modCache: {},
  };
  const isMod = () => !!S.user && (S.user.role === 'moderator' || S.user.role === 'admin');
  const isAdmin = () => !!S.user && S.user.role === 'admin';

  // ---------------------------------------------------------------- small helpers
  const fmtDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const ago = t => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return fmtDate(t);
  };
  const vehicleText = v => [v.year, v.make, v.model, v.trim, v.generation ? `(${v.generation})` : ''].filter(Boolean).join(' ');
  const STATUS_CLASS = { draft: 'draft', pending: 'pending', needs_correction: 'fix', approved: 'ok', rejected: 'no', removed: 'no' };
  const statusChip = s => `<span class="status status--${STATUS_CLASS[s.status] || 'draft'}">${esc(s.statusLabel)}</span>`;

  function busy(btn, on) { if (!btn) return; btn.disabled = on; btn.classList.toggle('is-busy', on); }
  // Named fields of a form as an object; checkboxes as booleans.
  function values(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name || el.tagName === 'BUTTON') continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.type !== 'file') out[el.name] = el.value.trim();
    }
    return out;
  }
  function fail(form, r) {
    const msg = r.status === 0 ? 'Couldn’t reach the server. Check your connection.' : (r.data && r.data.error) || 'Something went wrong. Try again.';
    const box = form.querySelector('.form-msg');
    if (box) box.textContent = msg; else toast(msg);
    const f = r.data && r.data.field && form.elements[r.data.field];
    if (f && f.focus) f.focus();
  }
  const clearMsg = form => { const m = form.querySelector('.form-msg'); if (m) m.textContent = ''; };

  function openDialog(html) {
    dlg.innerHTML = `<div class="dialog-body">${html}</div>`;
    if (!dlg.open) dlg.showModal();
    const first = dlg.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), select, textarea, button.btn--primary');
    if (first) first.focus();
  }
  const closeDialog = () => { if (dlg.open) dlg.close(); };
  const dialogHead = (title, sub) => `<header class="dialog-head"><h2 class="h3" id="dlgGarageTitle">${esc(title)}</h2>
    <button class="icon-btn" type="button" data-g="close" aria-label="Close"><svg class="ic"><use href="#i-x"/></svg></button></header>${sub ? `<p class="dialog-sub">${sub}</p>` : ''}`;
  dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });

  const input = (name, label, attrs = '', help = '') => `<label class="field"><span>${label}</span><input name="${name}" ${attrs}>${help ? `<small class="field-note">${help}</small>` : ''}</label>`;
  const check = (name, label, attrs = '') => `<label class="check check--wrap"><input type="checkbox" name="${name}" ${attrs}><span>${label}</span></label>`;

  // Upload with progress (fetch can't report upload progress).
  function putFile(url, file, onProgress) {
    return new Promise(resolve => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      x.setRequestHeader('X-VicCall', '1');
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => { let data = {}; try { data = JSON.parse(x.responseText); } catch {} resolve({ ok: x.status >= 200 && x.status < 300, status: x.status, data }); };
      x.onerror = () => resolve({ ok: false, status: 0, data: {} });
      x.send(file);
    });
  }
  const MAX_BYTES = 15 * 1024 * 1024;
  const fileProblem = f => (!f ? 'Choose a photo.' : !/^image\/(jpeg|png|webp)$/.test(f.type) ? 'Choose a JPEG, PNG or WebP photo.' : f.size > MAX_BYTES ? 'Photos can be up to 15 MB.' : null);

  // ---------------------------------------------------------------- account state
  async function refresh() {
    const r = await api('GET', '/api/auth/me');
    if (!r.ok) return;
    S.user = r.data.user;
    S.methods = r.data.methods || {};
    S.garage = null;
    S.subs = null;
    if (S.user) {
      const g = await api('GET', '/api/garage/me');
      if (g.ok) S.garage = g.data;
    }
    renderAccount();
    rerender();
  }

  function renderAccount() {
    $('signinBtn').hidden = !!S.user;
    $('acctWrap').hidden = !S.user;
    if (!S.user) return;
    $('acctName').textContent = S.user.displayName || 'Account';
    const items = [
      '<button role="menuitem" data-action="goto" data-to="garage"><b>Your photos</b><span>Add photos and see where they are</span></button>',
      S.garage && S.garage.profile ? '<button role="menuitem" data-g="my-profile"><b>Your profile</b><span>Approved photos and badges</span></button>' : '',
      isMod() ? '<button role="menuitem" data-action="goto" data-to="mod"><b>Moderation</b><span>Review photos and reports</span></button>' : '',
      '<button role="menuitem" data-g="account"><b>Account</b><span>Name, photo credit, sign-in, close account</span></button>',
      '<button role="menuitem" data-g="signout"><b>Sign out</b></button>',
    ];
    $('m-acct').innerHTML = items.join('');
  }

  function rerender() {
    const cur = VC.current();
    if (cur === 'garage') renderGarage();
    else if (cur === 'mod') renderMod();
  }

  // ---------------------------------------------------------------- sign in / sign up
  const returnTo = () => (VC.current() === 'garage' ? '/?garage=1' : '/');
  function providerButtons() {
    const b = [];
    if (S.methods.google) b.push(`<a class="btn btn--ghost btn--block" href="/api/auth/oauth/google/start?return=${encodeURIComponent(returnTo())}">Continue with Google</a>`);
    if (S.methods.discord) b.push(`<a class="btn btn--ghost btn--block" href="/api/auth/oauth/discord/start?return=${encodeURIComponent(returnTo())}">Continue with Discord</a>`);
    return b.length ? `<div class="providers">${b.join('')}</div><p class="or"><span>or with email</span></p>` : '';
  }

  function signinDialog(view = 'signin', message = '') {
    if (VC.inGame()) { toast('Finish or leave this game first.'); return; }
    let body;
    if (view === 'signup') {
      body = `${dialogHead('Create an account', 'You only need an account to submit photos. Playing never needs one.')}
        ${providerButtons()}
        <form class="dialog-form" data-g-form="signup" novalidate>
          ${input('email', 'Email', 'type="email" autocomplete="email" required maxlength="254"')}
          ${input('password', 'Password', 'type="password" autocomplete="new-password" required minlength="10" maxlength="200"', 'At least 10 characters.')}
          ${input('displayName', 'Display name', 'autocomplete="nickname" required minlength="3" maxlength="20"', 'Shown with your photos. 3 to 20 letters, numbers, spaces, dots or dashes.')}
          ${input('birthDate', 'Date of birth', 'type="date" required', 'You need to be 13 or older for an account and 18 or older to submit photos. Only whether you’re 18 or over is kept, not the date.')}
          ${check('acceptTerms', 'I agree to the <a href="/terms.html" target="_blank" rel="noopener">terms and privacy notice</a>.')}
          <p class="form-msg" role="alert">${esc(message)}</p>
          <button class="btn btn--primary btn--block" type="submit">Create account</button>
        </form>
        <p class="dialog-alt">Already have an account? <button class="link" type="button" data-g="view" data-view="signin">Sign in</button></p>`;
    } else if (view === 'forgot') {
      body = `${dialogHead('Reset your password', 'We’ll email you a link to choose a new one.')}
        <form class="dialog-form" data-g-form="forgot" novalidate>
          ${input('email', 'Email', 'type="email" autocomplete="email" required maxlength="254"')}
          <p class="form-msg" role="alert">${esc(message)}</p>
          <button class="btn btn--primary btn--block" type="submit">Send reset link</button>
        </form>
        <p class="dialog-alt"><button class="link" type="button" data-g="view" data-view="signin">Back to sign in</button></p>`;
    } else {
      body = `${dialogHead('Sign in', 'Sign in to submit photos to the Community Garage. Playing never needs an account.')}
        ${providerButtons()}
        <form class="dialog-form" data-g-form="signin" novalidate>
          ${input('email', 'Email', 'type="email" autocomplete="email" required maxlength="254"')}
          ${input('password', 'Password', 'type="password" autocomplete="current-password" required maxlength="200"')}
          <p class="form-msg" role="alert">${esc(message)}</p>
          <button class="btn btn--primary btn--block" type="submit">Sign in</button>
        </form>
        <p class="dialog-alt"><button class="link" type="button" data-g="view" data-view="forgot">Forgot your password?</button></p>
        <p class="dialog-alt">New here? <button class="link" type="button" data-g="view" data-view="signup">Create an account</button></p>`;
    }
    openDialog(body);
  }

  function finishDialog(suggest = '') {
    const needAge = !S.user.ageChecked;
    openDialog(`${dialogHead('Finish setting up', 'Choose how you’re shown in the game.')}
      <form class="dialog-form" data-g-form="finish" novalidate>
        ${input('displayName', 'Display name', `autocomplete="nickname" required minlength="3" maxlength="20" value="${esc(S.user.displayName || suggest)}"`, 'Shown with your photos. 3 to 20 letters, numbers, spaces, dots or dashes.')}
        ${needAge ? input('birthDate', 'Date of birth', 'type="date" required', 'You need to be 13 or older for an account and 18 or older to submit photos. Only whether you’re 18 or over is kept.') : ''}
        ${check('acceptTerms', 'I agree to the <a href="/terms.html" target="_blank" rel="noopener">terms and privacy notice</a>.')}
        <p class="form-msg" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Save</button>
      </form>`);
  }

  function resetDialog(token) {
    openDialog(`${dialogHead('Choose a new password')}
      <form class="dialog-form" data-g-form="reset" data-token="${esc(token)}" novalidate>
        ${input('password', 'New password', 'type="password" autocomplete="new-password" required minlength="10" maxlength="200"', 'At least 10 characters. Other devices will be signed out.')}
        <p class="form-msg" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Save password</button>
      </form>`);
  }

  function accountDialog() {
    const u = S.user;
    openDialog(`${dialogHead('Account')}
      <form class="dialog-form" data-g-form="account" novalidate>
        ${input('displayName', 'Display name', `required minlength="3" maxlength="20" value="${esc(u.displayName || '')}"`)}
        ${check('creditAnonymous', 'Credit my photos as “Community photographer” instead of my name (this also hides my public profile)', u.creditAnonymous ? 'checked' : '')}
        ${check('notifyEmail', 'Email me when a moderator decides on one of my photos', u.notifyEmail ? 'checked' : '')}
        <p class="form-msg" role="alert"></p>
        <button class="btn btn--primary" type="submit">Save</button>
      </form>
      <div class="acct-facts">
        <p><b>Email</b> ${esc(u.email || '')} ${u.emailVerified ? '<span class="status status--ok">Confirmed</span>' : '<span class="status status--fix">Not confirmed</span> <button class="link" type="button" data-g="resend">Send the link again</button>'}</p>
        <p><b>Sign-in</b> ${[u.hasPassword ? 'Email and password' : '', ...(u.providers || []).map(p => p[0].toUpperCase() + p.slice(1))].filter(Boolean).map(esc).join(', ') || 'None'}</p>
        <p><b>Submitting photos</b> ${u.adult ? 'Allowed (18 or over)' : 'Needs you to be 18 or over'}</p>
      </div>
      <details class="danger">
        <summary>Close your account</summary>
        <form class="dialog-form" data-g-form="close" novalidate>
          <p>Your email, password and display name are deleted, and every photo you submitted is removed from the game. Records of past moderation are kept without the photos. This can’t be undone.</p>
          ${input('confirm', 'Type “close” to confirm', 'autocomplete="off" required')}
          <p class="form-msg" role="alert"></p>
          <button class="btn btn--ghost btn--danger" type="submit">Close my account</button>
        </form>
      </details>`);
  }

  async function signedInChanged(message) {
    closeDialog();
    if (message) toast(message);
    VC.reconnectSocket();
    await refresh();
    if (S.user && !S.user.profileComplete) finishDialog();
  }

  // ---------------------------------------------------------------- licence
  async function loadLicence() {
    if (!S.licence) { const r = await api('GET', '/api/garage/licence'); if (r.ok) S.licence = r.data; }
    return S.licence;
  }
  async function licenceDialog() {
    const L = await loadLicence();
    if (!L) return toast('Couldn’t load the licence.');
    openDialog(`${dialogHead('Contributor licence', `${esc(L.name)}${L.draft ? ' (draft)' : ''}`)}
      <ul class="licence-points">
        <li>You keep the copyright in every photo you submit.</li>
        <li>You let VicCall store, resize, crop and show it in the game, worldwide and without payment.</li>
        <li>You must have taken the photo yourself and own the rights to it.</li>
        <li>Every photo is reviewed before it appears, and VicCall may decline any photo.</li>
        <li>Your photos never appear in a competitive game you play in.</li>
        <li>You’re credited by your display name after each round that uses your photo.</li>
        <li>You can remove a photo at any time.</li>
        <li>VicCall won’t sell your photo or use it to train generative AI.</li>
      </ul>
      <p><a href="/contributor-licence.html" target="_blank" rel="noopener">Read the full licence</a></p>
      <form class="dialog-form" data-g-form="licence" novalidate>
        ${check('accept', 'I’ve read the contributor licence and accept it for the photos I submit.')}
        <p class="form-msg" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Accept</button>
      </form>`);
  }

  // ---------------------------------------------------------------- reports from the game
  async function report(answer, kind, note) {
    if (kind === 'copyright') { copyrightDialog(answer); return false; }
    const message = note || (kind === 'privacy' ? 'Readable number plate or face' : '');
    if (kind === 'wrong_id' && !message) { toast('Say what the car is, so a moderator can check.'); return false; }
    const r = await api('POST', '/api/garage/reports', { kind, target: answer.id, message });
    toast(r.ok ? 'Thanks. A moderator will look at it.' : (r.data && r.data.error) || 'Couldn’t send the report.');
    return r.ok;
  }
  function copyrightDialog(answer) {
    openDialog(`${dialogHead('Copyright complaint', 'If this is your photo and you didn’t allow it here, tell us. The photo is taken out of the game while a moderator checks.')}
      <form class="dialog-form" data-g-form="copyright" data-target="${esc(answer.id)}" novalidate>
        ${input('name', 'Your full name', 'autocomplete="name" required maxlength="100"')}
        ${input('email', 'Email', 'type="email" autocomplete="email" required maxlength="120"')}
        <label class="field"><span>Your original work</span><textarea name="work" required maxlength="500" placeholder="Where your photo is published, or how you can show it’s yours"></textarea></label>
        ${check('goodFaith', 'I believe in good faith that this use isn’t authorised by me, my agent or the law.')}
        ${check('accurate', 'The information here is accurate, and under penalty of perjury, I’m the owner or authorised to act for the owner.')}
        ${input('signature', 'Signature (type your full name)', 'required maxlength="100"')}
        <p class="dialog-note">Your name and email are shared with the photographer if they send a counter-notice.</p>
        <p class="form-msg" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Send complaint</button>
      </form>`);
  }

  // ---------------------------------------------------------------- the Garage screen
  function blockerBanners() {
    const g = S.garage;
    if (!g) return '';
    const out = [];
    const b = new Set(g.blockers);
    if (b.has('blocked')) out.push('<div class="banner banner--no"><b>Your submission rights have been removed</b><p>This follows upheld copyright complaints. Your approved photos and your profile stay.</p></div>');
    if (b.has('profile')) out.push('<div class="banner"><b>Finish setting up your account</b><p>Choose a display name to be credited with.</p><button class="btn btn--primary" data-g="finish">Finish setting up</button></div>');
    if (b.has('verify')) out.push(`<div class="banner"><b>Confirm your email address</b><p>We sent a link to ${esc(S.user.email || 'your email')}. Open it on any device.</p><button class="btn btn--ghost" data-g="resend">Send the link again</button></div>`);
    if (b.has('age')) out.push('<div class="banner"><b>You need to be 18 or over to submit photos</b><p>You can still play every mode, with or without an account.</p></div>');
    else if (b.has('licence') && !b.has('blocked')) out.push('<div class="banner"><b>Read the contributor licence</b><p>It says what VicCall may do with your photos and what you keep. You accept it once.</p><button class="btn btn--primary" data-g="licence">Read and accept</button></div>');
    return out.join('');
  }

  async function renderGarage() {
    const el = $('garageBody');
    if (!S.on) { el.innerHTML = '<p class="block-sub">The Community Garage isn’t open on this server yet.</p>'; return; }
    if (!S.user) {
      el.innerHTML = `<div class="garage-intro">
          <ol class="steps">
            <li><b>Take a photo</b><span>A car you’ve seen, clear enough to name. Your own photo, not one from the internet.</span></li>
            <li><b>Send it in</b><span>Tell us what it is. Location and camera details are removed from every copy players see.</span></li>
            <li><b>A moderator checks it</b><span>Then it joins the game, with your name on it after each round.</span></li>
          </ol>
          <div class="garage-cta">
            <button class="btn btn--primary btn--lg" data-action="signin">Sign in to submit photos</button>
            <p class="wait">Playing never needs an account.</p>
          </div>
        </div>`;
      return;
    }
    const g = S.garage || { counts: {}, blockers: [] };
    const waiting = (g.counts.pending || 0) + (g.counts.needs_correction || 0) + (g.counts.draft || 0);
    const total = Object.values(g.counts || {}).reduce((a, b) => a + b, 0);
    el.innerHTML = `${blockerBanners()}
      ${g.badges && g.badges.length ? `<ul class="badges" aria-label="Your badges">${g.badges.map(b => `<li title="${esc(b.desc)}">${esc(b.name)}</li>`).join('')}</ul>` : ''}
      <div class="tabs tabs--row" role="tablist" aria-label="Garage">
        <button class="tab" role="tab" data-g="tab" data-tab="add" aria-selected="${S.tab === 'add'}">Add a photo</button>
        <button class="tab" role="tab" data-g="tab" data-tab="mine" aria-selected="${S.tab === 'mine'}">Your photos${total ? ` <span class="count">${total}</span>` : ''}${waiting ? ` <span class="sr-only">(${waiting} waiting)</span>` : ''}</button>
      </div>
      <div class="garage-pane" id="garagePane"></div>`;
    if (S.tab === 'mine') renderMine(); else renderAdd();
  }

  async function renderAdd() {
    const pane = $('garagePane');
    if (!S.garage || !S.garage.canSubmit) {
      pane.innerHTML = '<p class="wait">Once the steps above are done, you can add photos here.</p>';
      return;
    }
    const L = await loadLicence();
    const decl = L ? Object.entries(L.declarations) : [];
    pane.innerHTML = `<form class="submit" id="gsForm" novalidate>
      <div class="submit-photo">
        <label class="drop" id="gsDrop">
          <input type="file" id="gsFile" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo">
          <img id="gsPreview" alt="" hidden>
          <span class="drop-text" id="gsDropText"><b>Choose a photo</b><span>JPEG, PNG or WebP, at least 1200 × 700 pixels, up to 15 MB</span></span>
        </label>
        <p class="field-note">Location and camera details are removed from every copy players see. Number plates and faces are blurred during review.</p>
      </div>
      <div class="submit-fields">
        <fieldset class="group"><legend>The car</legend>
          <div class="grid2">
            ${input('make', 'Make', 'required maxlength="40" list="makeList" placeholder="Porsche"')}
            ${input('model', 'Model', 'required maxlength="60" placeholder="911"')}
            ${input('trim', 'Trim or version', 'maxlength="60" placeholder="GT3 RS"')}
            ${input('generation', 'Generation', 'maxlength="40" placeholder="992"')}
            ${input('year', 'Model year', 'inputmode="numeric" maxlength="4" placeholder="2023"', 'Leave blank if you’re not sure.')}
          </div>
          ${check('modified', 'It’s modified (body kit, swap, wrap)')}
          <div class="grid2" id="gsMods" hidden>
            ${input('kit', 'Kit or tuner', 'maxlength="60" placeholder="Liberty Walk"')}
            ${input('mods', 'Other changes', 'maxlength="300"')}
          </div>
        </fieldset>
        <fieldset class="group"><legend>Where</legend>
          <div class="grid2">
            ${input('location', 'Town or area', 'maxlength="80" placeholder="Goodwood"', 'Never an exact address.')}
            ${input('event', 'Event', 'maxlength="80" placeholder="Festival of Speed"')}
          </div>
          ${check('showLocation', 'Show the place and event with my photo')}
        </fieldset>
        <label class="field"><span>Notes for the moderator</span><textarea name="notes" maxlength="500" rows="2"></textarea></label>
        ${check('promo', 'VicCall may also use this photo, with credit, in promotional material (optional)')}
        <fieldset class="group decl"><legend>About this photo</legend>
          ${decl.map(([k, t]) => check(`decl_${k}`, esc(t))).join('')}
        </fieldset>
        <p class="form-msg" role="alert"></p>
        <div class="progress" id="gsProgress" hidden><div class="progress-bar" id="gsBar"></div></div>
        <button class="btn btn--primary btn--lg" type="submit" id="gsSubmit">Send for review</button>
      </div>
    </form>`;
    const form = $('gsForm');
    form.elements.modified.addEventListener('change', e => { $('gsMods').hidden = !e.target.checked; });
    $('gsFile').addEventListener('change', () => {
      const f = $('gsFile').files[0];
      const prev = $('gsPreview');
      if (prev.src) URL.revokeObjectURL(prev.src);
      const problem = f && fileProblem(f);
      clearMsg(form);
      if (problem) { form.querySelector('.form-msg').textContent = problem; prev.hidden = true; return; }
      if (f) { prev.src = URL.createObjectURL(f); prev.hidden = false; $('gsDropText').hidden = true; }
    });
    form.addEventListener('submit', submitPhoto);
  }

  async function submitPhoto(e) {
    e.preventDefault();
    const form = e.target;
    clearMsg(form);
    const file = $('gsFile').files[0];
    const problem = fileProblem(file);
    if (problem) { form.querySelector('.form-msg').textContent = problem; $('gsFile').focus(); return; }
    const v = values(form);
    const L = await loadLicence();
    const declarations = Object.fromEntries(Object.keys(L.declarations).map(k => [k, v[`decl_${k}`] === true]));
    if (Object.values(declarations).some(x => !x)) { form.querySelector('.form-msg').textContent = 'Confirm every statement about the photo.'; return; }
    const btn = $('gsSubmit');
    busy(btn, true);
    const body = {
      make: v.make, model: v.model, trim: v.trim, generation: v.generation, year: v.year, modified: v.modified, kit: v.kit, mods: v.mods,
      location: v.location, event: v.event, showLocation: v.showLocation, notes: v.notes, promo: v.promo,
      licenceVersion: L.version, declarations,
    };
    const c = await api('POST', '/api/garage/submissions', body);
    if (!c.ok) { busy(btn, false); return fail(form, c); }
    $('gsProgress').hidden = false;
    const up = await putFile(`/api/garage/submissions/${c.data.submission.id}/photo`, file, p => { $('gsBar').style.width = `${Math.round(p * 100)}%`; });
    busy(btn, false);
    $('gsProgress').hidden = true;
    if (!up.ok) {
      fail(form, up);
      form.querySelector('.form-msg').insertAdjacentHTML('beforeend', ' The details are saved as a draft in Your photos.');
      return;
    }
    const checks = (up.data.checks || []).filter(x => x.code !== 'location');
    toast(checks.length ? 'Sent for review. A moderator will look at the notes below.' : 'Sent for review.');
    S.tab = 'mine';
    await refreshGarageMe();
    renderGarage();
  }

  async function refreshGarageMe() {
    const g = await api('GET', '/api/garage/me');
    if (g.ok) S.garage = g.data;
    S.subs = null;
    renderAccount();
  }

  async function renderMine() {
    const pane = $('garagePane');
    if (!S.subs) {
      pane.innerHTML = '<p class="wait">Loading your photos…</p>';
      const r = await api('GET', '/api/garage/submissions');
      if (!r.ok) { pane.innerHTML = '<p class="form-msg">Couldn’t load your photos.</p>'; return; }
      S.subs = r.data.submissions;
    }
    if (!S.subs.length) { pane.innerHTML = '<p class="wait">No photos yet. Add your first one.</p>'; return; }
    const canEdit = S.garage && S.garage.canSubmit;
    pane.innerHTML = `<ul class="subs">${S.subs.map(s => {
      const img = s.image && s.image.preview ? `<img src="${esc(s.image.preview)}" alt="" loading="lazy">` : '<div class="sub-noimg">No photo</div>';
      const checks = (s.checks || []).filter(c => c.code !== 'location');
      const acts = [];
      if (canEdit && s.status === 'draft') acts.push(`<label class="btn btn--ghost btn--sm file-btn">Add the photo<input type="file" accept="image/jpeg,image/png,image/webp" data-g-file="${esc(s.id)}"></label>`);
      if (canEdit && s.status === 'needs_correction') {
        acts.push(`<button class="btn btn--primary btn--sm" data-g="edit-sub" data-id="${esc(s.id)}">Correct details</button>`);
        acts.push(`<label class="btn btn--ghost btn--sm file-btn">Replace the photo<input type="file" accept="image/jpeg,image/png,image/webp" data-g-file="${esc(s.id)}"></label>`);
      }
      if (['draft', 'pending', 'needs_correction', 'approved'].includes(s.status)) acts.push(`<button class="btn btn--quiet btn--sm" data-g="remove-sub" data-id="${esc(s.id)}">${s.status === 'approved' ? 'Remove from the game' : 'Withdraw'}</button>`);
      if (s.status === 'removed' && /counter-notice/.test(s.reason || '')) acts.push(`<button class="btn btn--ghost btn--sm" data-g="counter" data-id="${esc(s.id)}">Send a counter-notice</button>`);
      return `<li class="sub">
        <div class="sub-img">${img}</div>
        <div class="sub-body">
          <p class="sub-top"><b>${esc(vehicleText(s.vehicle))}</b> ${statusChip(s)}</p>
          ${s.image && s.image.vehicle && s.status === 'approved' ? `<p class="sub-meta">In the game as ${esc(s.image.vehicle.label)}, ${esc(s.image.vehicle.year)}${s.image.eligibility === 'competitive' ? ', all modes' : s.image.eligibility === 'casual' ? ', casual modes' : ''}</p>` : ''}
          ${s.reason ? `<p class="sub-reason">${esc(s.reason)}</p>` : ''}
          ${checks.length && s.status === 'pending' ? `<p class="sub-meta">Automatic checks: ${checks.map(c => esc(c.text)).join(' ')}</p>` : ''}
          <p class="sub-meta">Sent ${esc(ago(s.createdAt))}</p>
          ${acts.length ? `<div class="sub-acts">${acts.join('')}</div>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>`;
  }

  function editSubDialog(id) {
    const s = (S.subs || []).find(x => x.id === id);
    if (!s) return;
    const v = s.vehicle;
    openDialog(`${dialogHead('Correct the details', s.reason ? `Moderator: ${esc(s.reason)}` : '')}
      <form class="dialog-form" data-g-form="edit-sub" data-id="${esc(id)}" novalidate>
        <div class="grid2">
          ${input('make', 'Make', `required maxlength="40" value="${esc(v.make || '')}" list="makeList"`)}
          ${input('model', 'Model', `required maxlength="60" value="${esc(v.model || '')}"`)}
          ${input('trim', 'Trim or version', `maxlength="60" value="${esc(v.trim || '')}"`)}
          ${input('generation', 'Generation', `maxlength="40" value="${esc(v.generation || '')}"`)}
          ${input('year', 'Model year', `inputmode="numeric" maxlength="4" value="${esc(v.year || '')}"`)}
        </div>
        <label class="field"><span>Notes for the moderator</span><textarea name="notes" maxlength="500" rows="2">${esc(s.notes || '')}</textarea></label>
        <p class="form-msg" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Send for review again</button>
      </form>`);
  }

  function confirmDialog({ title, text, action, data, button = 'Confirm' }) {
    openDialog(`${dialogHead(title)}<p>${text}</p>
      <form class="dialog-form" data-g-form="${esc(action)}" data-id="${esc(data)}">
        <p class="form-msg" role="alert"></p>
        <div class="dialog-actions"><button class="btn btn--primary" type="submit">${esc(button)}</button><button class="btn btn--ghost" type="button" data-g="close">Cancel</button></div>
      </form>`);
  }

  function counterDialog(id) {
    openDialog(`${dialogHead('Counter-notice', 'If your photo was taken down by mistake, you can ask for it to be put back. We forward this to the person who complained; if they don’t start court action, the photo can return.')}
      <form class="dialog-form" data-g-form="counter" data-id="${esc(id)}" novalidate>
        ${input('name', 'Your full legal name', 'autocomplete="name" required maxlength="100"')}
        <label class="field"><span>Address, phone and email</span><textarea name="contact" required maxlength="300" rows="2"></textarea></label>
        <label class="field"><span>Statement</span><textarea name="statement" required maxlength="2000" rows="4" placeholder="Why the photo is yours, and that you believe in good faith it was removed by mistake."></textarea></label>
        ${check('consent', 'I agree that my name, address and statement are sent to the person who complained.')}
        <p class="form-msg" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Send counter-notice</button>
      </form>`);
  }

  async function uploadFor(id, file) {
    const problem = fileProblem(file);
    if (problem) return toast(problem);
    toast('Uploading…');
    const up = await putFile(`/api/garage/submissions/${id}/photo`, file);
    if (!up.ok) return toast((up.data && up.data.error) || 'Upload failed.');
    toast('Sent for review.');
    await refreshGarageMe();
    renderGarage();
  }

  // ---------------------------------------------------------------- profiles
  async function showProfile(name) {
    VC.show('profile');
    const el = $('profileBody');
    el.innerHTML = '<p class="wait">Loading…</p>';
    const r = await api('GET', `/api/garage/profiles/${encodeURIComponent(name)}`);
    if (!r.ok) {
      el.innerHTML = `<h2 class="h2" id="profile-title">Photographer</h2><p class="block-sub">${r.status === 404 ? 'There’s no public profile with that name.' : 'Couldn’t load this profile.'}</p>`;
      return;
    }
    const p = r.data.profile;
    el.innerHTML = `<h2 class="h2" id="profile-title">${esc(p.name)}</h2>
      <p class="block-sub">Community Garage photographer since ${esc(fmtDate(p.joined))}. ${p.stats.approved} approved photo${p.stats.approved === 1 ? '' : 's'}${p.stats.makes > 1 ? ` of ${p.stats.makes} makes` : ''}.</p>
      ${p.badges.length ? `<ul class="badges">${p.badges.map(b => `<li title="${esc(b.desc)}">${esc(b.name)}</li>`).join('')}</ul>` : ''}
      <ul class="gallery">${p.photos.map(ph => `<li>
        <img src="${esc(ph.medium)}" alt="${esc(ph.vehicle)}" loading="lazy" width="${ph.width}" height="${ph.height}">
        <p><b>${esc(ph.vehicle)}</b> ${esc(ph.year || '')}</p>
        ${ph.location || ph.event ? `<p class="sub-meta">${esc([ph.event, ph.location].filter(Boolean).join(', '))}</p>` : ''}
      </li>`).join('')}</ul>`;
  }

  // ---------------------------------------------------------------- moderation
  const MOD_TABS = () => [
    ['queue', 'Review queue'], ['reports', 'Reports'], ['notices', 'Counter-notices'], ['history', 'History'],
    ...(isAdmin() ? [['people', 'People'], ['credits', 'Photo credits']] : []),
  ];

  async function renderMod() {
    if (!isMod()) {
      $('modTabs').innerHTML = '';
      $('modBody').innerHTML = `<p class="block-sub">${S.user ? 'Moderation is for moderators.' : 'Sign in as a moderator to see this.'}</p>`;
      return;
    }
    $('modTabs').innerHTML = MOD_TABS().map(([id, label]) => `<button class="tab" role="tab" data-g="mod-tab" data-tab="${id}" aria-selected="${S.modTab === id}">${esc(label)}</button>`).join('');
    const body = $('modBody');
    body.innerHTML = '<p class="wait">Loading…</p>';
    if (S.modTab === 'queue') return renderQueue(body);
    if (S.modTab === 'reports') return renderReports(body);
    if (S.modTab === 'notices') return renderNotices(body);
    if (S.modTab === 'history') return renderHistory(body);
    if (S.modTab === 'people') return renderPeople(body);
    if (S.modTab === 'credits') return renderCredits(body);
  }

  async function renderQueue(body) {
    const r = await api('GET', `/api/garage/mod/queue?status=${S.modStatus}`);
    if (!r.ok) { body.innerHTML = '<p class="form-msg">Couldn’t load the queue.</p>'; return; }
    const { counts, submissions } = r.data;
    const statuses = [['pending', 'Pending review'], ['needs_correction', 'Needs correction'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['removed', 'Removed']];
    body.innerHTML = `<div class="seg-row mod-filter" role="group" aria-label="Status">${statuses.map(([id, label]) =>
      `<button class="chip-btn" data-g="mod-status" data-status="${id}" aria-pressed="${S.modStatus === id}">${esc(label)} <span class="count">${counts[id] || 0}</span></button>`).join('')}</div>
      <div class="mod-split">
        <ul class="mod-list">${submissions.length ? submissions.map(s => `<li><button class="mod-item${S.modSel === s.id ? ' is-sel' : ''}" data-g="mod-pick" data-id="${esc(s.id)}">
          ${s.image && s.image.preview ? `<img src="${esc(s.image.preview.replace('/medium', '/small'))}" alt="" loading="lazy">` : '<span class="sub-noimg">–</span>'}
          <span><b>${esc(vehicleText(s.vehicle))}</b><small>${esc(s.contributor ? s.contributor.displayName || 'Closed account' : '')} · ${esc(ago(s.updatedAt))}${s.checks.length ? ` · ${s.checks.length} note${s.checks.length > 1 ? 's' : ''}` : ''}${s.duplicateOf ? ' · possible copy' : ''}</small></span>
        </button></li>`).join('') : '<li class="wait">Nothing here.</li>'}</ul>
        <div class="mod-detail" id="modDetail">${S.modSel ? '<p class="wait">Loading…</p>' : '<p class="wait">Choose a photo to review.</p>'}</div>
      </div>`;
    if (S.modSel) renderReview(S.modSel);
  }

  // Blur boxes: drag on the photo to draw; each box has a remove button.
  function blurEditor(container, boxes) {
    const state = boxes.map(b => ({ ...b }));
    const layer = container.querySelector('.blur-layer');
    const list = container.querySelector('.blur-list');
    function draw() {
      layer.innerHTML = state.map((b, i) => `<div class="blur-box" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"><button type="button" data-blur-del="${i}" aria-label="Remove blur box ${i + 1}">×</button></div>`).join('');
      list.textContent = state.length ? `${state.length} area${state.length > 1 ? 's' : ''} will be blurred.` : 'Nothing will be blurred.';
    }
    let start = null, temp = null;
    const pos = e => { const r = layer.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
    layer.addEventListener('pointerdown', e => {
      if (e.target.closest('[data-blur-del]')) return;
      start = pos(e);
      layer.setPointerCapture(e.pointerId);
      temp = document.createElement('div');
      temp.className = 'blur-box is-drawing';
      layer.appendChild(temp);
    });
    layer.addEventListener('pointermove', e => {
      if (!start) return;
      const p = pos(e);
      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y), w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      Object.assign(temp.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
      temp.dataset.box = JSON.stringify({ x, y, w, h });
    });
    const end = () => {
      if (!start) return;
      const b = temp && temp.dataset.box && JSON.parse(temp.dataset.box);
      start = null;
      if (b && b.w > 0.01 && b.h > 0.01) state.push(b);
      draw();
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);
    layer.addEventListener('click', e => {
      const del = e.target.closest('[data-blur-del]');
      if (del) { state.splice(Number(del.dataset.blurDel), 1); draw(); }
    });
    container.querySelector('[data-blur-add]').addEventListener('click', () => { state.push({ x: 0.4, y: 0.7, w: 0.2, h: 0.1 }); draw(); });
    draw();
    return () => state.map(b => ({ x: +b.x.toFixed(4), y: +b.y.toFixed(4), w: +b.w.toFixed(4), h: +b.h.toFixed(4) }));
  }
  const blurPanel = (src, alt) => `<div class="blur-edit">
      <div class="blur-stage"><img src="${esc(src)}" alt="${esc(alt)}"><div class="blur-layer" role="group" aria-label="Blurred areas"></div></div>
      <p class="field-note">Drag across a number plate or a face to blur it. <button type="button" class="link" data-blur-add>Add a box</button> <span class="blur-list" aria-live="polite"></span></p>
    </div>`;

  // Vehicle picker: suggestions plus search, as radio buttons, and a way to add
  // a vehicle the game doesn't have yet.
  const REGION_LABEL = { japan: 'Japan', germany: 'Germany', italy: 'Italy', uk: 'Britain', usa: 'United States', france: 'France', sweden: 'Sweden', croatia: 'Croatia', korea: 'South Korea', other: 'Somewhere else' };
  const vopt = (v, checked = false) => `<label class="vopt"><input type="radio" name="vehicleKey" value="${esc(v.key)}" ${checked ? 'checked' : ''}><span>${esc(v.label)} <small>${esc(v.years[0] === v.years[1] ? v.years[0] : `${v.years[0]}–${v.years[1]}`)}${v.added ? ' · added by a moderator' : ''}</small></span></label>`;
  function vehiclePicker(suggestions, current) {
    return `<fieldset class="group"><legend>Vehicle in the game</legend>
      <div class="vopts" data-vopts>${suggestions.map(v => vopt(v, v.key === current)).join('') || '<p class="wait">No close match. Search below.</p>'}</div>
      <label class="field"><span>Search</span><input type="search" data-vsearch placeholder="Make, model or generation" autocomplete="off"></label>
      <div class="vopts" data-vresults></div>
      <details class="vadd" data-vadd>
        <summary>Not in the game? Add the vehicle</summary>
        <div class="vadd-body">
        <p class="field-note">Search first. A new vehicle can be named in every mode from then on, so its names are checked against every car already in the game.</p>
        <div class="grid2">
          ${input('nvMake', 'Make', 'maxlength="40" autocomplete="off"')}
          ${input('nvModel', 'Model', 'maxlength="60" autocomplete="off"')}
          ${input('nvVariant', 'Trim (optional)', 'maxlength="40" autocomplete="off"', 'Only if it’s part of the name: Type R, GT3 RS')}
          ${input('nvGeneration', 'Generation (optional)', 'maxlength="30" autocomplete="off"', 'Chassis or generation code: E30, A70')}
          ${input('nvYearFrom', 'Built from', 'inputmode="numeric" maxlength="4"')}
          ${input('nvYearTo', 'Built until', 'inputmode="numeric" maxlength="4"', 'Leave empty for a single year')}
        </div>
        ${input('nvModelAliases', 'Other names for the model (optional)', 'maxlength="200" autocomplete="off"', 'Separate with commas: Celica Supra, MA70')}
        ${input('nvGenerationAliases', 'Other names for the generation (optional)', 'maxlength="120" autocomplete="off"', 'Separate with commas: Mk3, MkIII')}
        <label class="field"><span>Maker’s country</span><select name="nvRegion"><option value="">Choose…</option>${Object.entries(REGION_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        ${check('nvSupercar', 'It’s a supercar')}
        <p class="vadd-msg" role="alert"></p>
        <div><button class="btn btn--ghost" type="button" data-vadd-go>Add vehicle</button></div>
        </div>
      </details>
    </fieldset>`;
  }
  function wirePicker(root) {
    const box = root.querySelector('[data-vsearch]');
    const out = root.querySelector('[data-vresults]');
    let t = 0;
    box.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = box.value.trim();
        if (!q) { out.innerHTML = ''; return; }
        const r = await api('GET', `/api/garage/mod/vehicles?q=${encodeURIComponent(q)}`);
        out.innerHTML = r.ok && r.data.vehicles.length ? r.data.vehicles.map(v => vopt(v)).join('') : '<p class="wait">No vehicles match. If it isn’t in the game yet, add it below.</p>';
      }, 200);
    });
    const add = root.querySelector('[data-vadd]');
    const go = add.querySelector('[data-vadd-go]');
    const msg = add.querySelector('.vadd-msg');
    // The panel sits inside the decision form: Enter here adds the vehicle, never approves the photo.
    add.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); go.click(); }
    });
    go.addEventListener('click', async () => {
      const f = name => add.querySelector(`[name="${name}"]`);
      const val = name => (f(name).type === 'checkbox' ? f(name).checked : f(name).value.trim());
      msg.textContent = '';
      busy(go, true);
      const r = await api('POST', '/api/garage/mod/vehicles', {
        make: val('nvMake'), model: val('nvModel'), variant: val('nvVariant'), generation: val('nvGeneration'),
        yearFrom: val('nvYearFrom'), yearTo: val('nvYearTo'), modelAliases: val('nvModelAliases'), generationAliases: val('nvGenerationAliases'),
        region: val('nvRegion'), supercar: val('nvSupercar'),
      });
      busy(go, false);
      if (!r.ok) {
        msg.textContent = r.status === 0 ? 'Couldn’t reach the server. Check your connection.' : (r.data && r.data.error) || 'Something went wrong. Try again.';
        return;
      }
      // Select the new vehicle, and fill in the year if it's still empty.
      root.querySelector('[data-vopts]').insertAdjacentHTML('afterbegin', vopt(r.data.vehicle, true));
      const year = root.querySelector('[name="year"]');
      if (year && !year.value) year.value = r.data.vehicle.years[0];
      add.open = false;
      toast(`Added: ${r.data.vehicle.label}`);
    });
  }

  async function renderReview(id) {
    const el = $('modDetail');
    const r = await api('GET', `/api/garage/mod/submissions/${encodeURIComponent(id)}`);
    if (!r.ok) { el.innerHTML = '<p class="form-msg">Couldn’t load this submission.</p>'; return; }
    const s = r.data.submission;
    const img = s.image;
    const pending = s.status === 'pending';
    const flags = s.checks || [];
    el.innerHTML = `<article class="review">
      ${img && img.preview ? blurPanel(img.preview.replace('/medium', '/large'), vehicleText(s.vehicle)) : '<p class="wait">No photo.</p>'}
      ${img ? `<p class="sub-meta">${img.width} × ${img.height} · <a href="${esc(img.original)}" target="_blank" rel="noopener">Open the original</a> (may include location data)</p>` : ''}
      <div class="review-facts">
        <p><b>${esc(vehicleText(s.vehicle))}</b> ${statusChip(s)}</p>
        <p>By ${esc(s.contributor ? s.contributor.displayName || 'a closed account' : '')}${s.contributor ? ` · ${s.contributor.approved} approved, ${s.contributor.rejected} rejected` : ''}</p>
        ${s.modified ? `<p>Modified: ${esc([s.kit, s.mods].filter(Boolean).join('; ') || 'yes')}</p>` : ''}
        ${s.location || s.event ? `<p>Where: ${esc([s.event, s.location].filter(Boolean).join(', '))}${s.showLocation ? ' (shown)' : ' (private)'}</p>` : ''}
        ${s.notes ? `<p>Notes: ${esc(s.notes)}</p>` : ''}
        ${flags.length ? `<ul class="flags">${flags.map(f => `<li class="flag flag--${esc(f.code)}">${esc(f.text)}</li>`).join('')}</ul>` : '<p class="sub-meta">No automatic notes.</p>'}
        ${s.duplicateOf ? `<div class="dup">${s.duplicateOf.preview ? `<img src="${esc(s.duplicateOf.preview)}" alt="The matching photo">` : ''}<p>Looks like a copy of photo ${esc(s.duplicateOf.id)} (${esc(s.duplicateOf.moderation)}${s.duplicateOf.sameContributor ? ', same contributor' : ', another contributor'}).</p></div>` : ''}
      </div>
      ${pending ? `<form class="dialog-form review-form" data-g-form="decide" data-id="${esc(s.id)}" novalidate>
        ${vehiclePicker(s.suggestions || [], (s.suggestions || [])[0] && s.suggestions[0].exact ? s.suggestions[0].key : '')}
        <div class="grid2">
          ${input('year', 'Model year', `inputmode="numeric" maxlength="4" value="${esc(s.vehicle.year || '')}"`)}
          <fieldset class="seg"><legend>Difficulty</legend><div class="seg-row">${[1, 2, 3, 4, 5].map(d => `<label><input type="radio" name="difficulty" value="${d}" ${d === 3 ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></fieldset>
        </div>
        <fieldset class="seg"><legend>Use in</legend><div class="seg-row">
          <label><input type="radio" name="eligibility" value="competitive" ${img && img.flagged ? 'disabled' : 'checked'}><span>All modes</span></label>
          <label><input type="radio" name="eligibility" value="casual" ${img && img.flagged ? 'checked' : ''}><span>Casual only</span></label>
          <label><input type="radio" name="eligibility" value="restricted"><span>Keep out of play</span></label>
        </div></fieldset>
        ${s.duplicateOf ? check('confirmDuplicate', 'I’ve checked the possible copy and want to approve this anyway') : ''}
        <label class="field"><span>Message to the contributor</span><textarea name="reason" maxlength="500" rows="2" placeholder="Required to reject or ask for a correction"></textarea></label>
        <p class="form-msg" role="alert"></p>
        <div class="dialog-actions">
          <button class="btn btn--primary" type="submit" name="action" value="approve">Approve</button>
          <button class="btn btn--ghost" type="submit" name="action" value="needs_correction">Ask for a correction</button>
          <button class="btn btn--ghost btn--danger" type="submit" name="action" value="reject">Reject</button>
        </div>
      </form>` : img && img.moderation === 'approved' ? `<form class="dialog-form" data-g-form="remove-image" data-id="${esc(img.id)}" novalidate>
        <label class="field"><span>Reason for removal</span><input name="reason" maxlength="300"></label>
        <p class="form-msg" role="alert"></p>
        <button class="btn btn--ghost btn--danger" type="submit">Remove from the game</button>
      </form>` : ''}
      <details class="history"><summary>History</summary><ol>${(s.history || []).map(h => `<li><b>${esc(h.action)}</b> ${esc(h.actor || '')} · ${esc(ago(h.at))}</li>`).join('')}</ol></details>
    </article>`;
    if (img && img.preview) S.modCache.getBlur = blurEditor(el.querySelector('.blur-edit'), img.blur || []);
    if (pending) wirePicker(el);
  }

  const REPORT_LABEL = { wrong_id: 'Wrong car', copyright: 'Copyright', privacy: 'Privacy', quality: 'Quality', other: 'Other' };
  async function renderReports(body) {
    const r = await api('GET', '/api/garage/mod/reports');
    if (!r.ok) { body.innerHTML = '<p class="form-msg">Couldn’t load reports.</p>'; return; }
    const reps = r.data.reports;
    if (!reps.length) { body.innerHTML = '<p class="wait">No open reports.</p>'; return; }
    body.innerHTML = `<ul class="reports">${reps.map(rep => {
      const d = rep.details;
      return `<li class="report-card">
        <p class="sub-top"><span class="status status--${rep.kind === 'copyright' || rep.kind === 'privacy' ? 'no' : 'fix'}">${esc(REPORT_LABEL[rep.kind])}</span> <span class="sub-meta">${esc(ago(rep.createdAt))}</span></p>
        ${rep.image ? `<p><b>${esc(rep.image.vehicle || 'Community photo')}</b> by ${esc(rep.image.contributor)} · ${rep.image.takedown === 'disputed' ? 'out of play while open' : rep.image.flagged ? 'out of competitive play while open' : 'still in play'}</p>` : ''}
        ${rep.car ? `<p><b>${esc(rep.car.label)}</b> (first-party photo)</p>` : ''}
        ${rep.message ? `<p>“${esc(rep.message)}”</p>` : ''}
        ${d ? `<dl class="facts"><dt>Name</dt><dd>${esc(d.name)}</dd><dt>Email</dt><dd>${esc(d.email)}</dd><dt>Work</dt><dd>${esc(d.work)}</dd><dt>Signed</dt><dd>${esc(d.signature)}</dd></dl>` : ''}
        <form class="dialog-form" data-g-form="resolve" data-id="${esc(rep.id)}" novalidate>
          ${rep.image && rep.image.preview ? `<details class="fix"><summary>Fix the photo instead (blur)</summary>${blurPanel(rep.image.preview, rep.image.vehicle || '')}</details>` : ''}
          <label class="field"><span>Note for the record</span><input name="note" maxlength="500" required></label>
          <p class="form-msg" role="alert"></p>
          <div class="dialog-actions">
            <button class="btn btn--ghost" type="submit" name="action" value="dismiss">Dismiss</button>
            ${rep.image && rep.image.preview ? '<button class="btn btn--ghost" type="submit" name="action" value="fix">Save the blur</button>' : ''}
            ${rep.image ? '<button class="btn btn--ghost btn--danger" type="submit" name="action" value="uphold">Uphold and remove</button>' : ''}
          </div>
        </form>
      </li>`;
    }).join('')}</ul>`;
    body.querySelectorAll('.report-card').forEach((card, i) => {
      const ed = card.querySelector('.blur-edit');
      if (ed) card.querySelector('form')._getBlur = blurEditor(ed, reps[i].image.blur || []);
    });
  }

  async function renderNotices(body) {
    const r = await api('GET', '/api/garage/mod/counter-notices');
    if (!r.ok) { body.innerHTML = '<p class="form-msg">Couldn’t load counter-notices.</p>'; return; }
    const list = r.data.notices;
    body.innerHTML = list.length ? `<ul class="reports">${list.map(n => `<li class="report-card">
      <p class="sub-top"><b>${esc(n.contributor || 'Closed account')}</b> <span class="status status--${n.status === 'open' ? 'fix' : 'ok'}">${esc(n.status)}</span> <span class="sub-meta">${esc(ago(n.createdAt))}</span></p>
      <dl class="facts"><dt>Name</dt><dd>${esc(n.name)}</dd><dt>Contact</dt><dd>${esc(n.contact)}</dd><dt>Statement</dt><dd>${esc(n.statement)}</dd></dl>
      <div class="dialog-actions">
        ${n.status === 'open' ? `<button class="btn btn--ghost btn--sm" data-g="notice" data-id="${esc(n.id)}" data-status="forwarded">Mark forwarded</button>` : ''}
        ${n.image && n.status !== 'reinstated' ? `<button class="btn btn--ghost btn--sm" data-g="reinstate" data-id="${esc(n.image)}">Put the photo back</button>` : ''}
        ${n.status !== 'closed' && n.status !== 'reinstated' ? `<button class="btn btn--quiet btn--sm" data-g="notice" data-id="${esc(n.id)}" data-status="closed">Close</button>` : ''}
      </div>
    </li>`).join('')}</ul>
    <p class="dialog-note">Forward the notice to the complainant by email. If they don’t tell you within 10 to 14 business days that they’ve started court action, the photo can go back.</p>` : '<p class="wait">No counter-notices.</p>';
  }

  async function renderHistory(body) {
    const r = await api('GET', '/api/garage/mod/audit?limit=100');
    if (!r.ok) { body.innerHTML = '<p class="form-msg">Couldn’t load the history.</p>'; return; }
    body.innerHTML = `<ol class="audit">${r.data.entries.map(e => `<li><span class="sub-meta">${esc(ago(e.at))}</span> <b>${esc(e.action)}</b> ${esc(e.entity)} ${esc(e.entity_id || '')} <span class="sub-meta">${esc(e.actor || 'system')}</span></li>`).join('')}</ol>`;
  }

  async function renderPeople(body, q = '') {
    const r = await api('GET', `/api/garage/admin/users?q=${encodeURIComponent(q)}`);
    if (!r.ok) { body.innerHTML = '<p class="form-msg">Couldn’t load people.</p>'; return; }
    body.innerHTML = `<form class="people-search" data-g-form="people-search"><label class="field"><span>Find by name or email</span><input name="q" value="${esc(q)}" type="search"></label></form>
      <ul class="people">${r.data.users.map(u => `<li>
        <span><b>${esc(u.display_name || '(no name)')}</b><small>${esc(u.email || '')} · joined ${esc(fmtDate(u.created_at))}</small></span>
        <form class="people-row" data-g-form="person" data-id="${esc(u.id)}">
          <label class="field field--inline"><span class="sr-only">Role</span><select name="role">${['user', 'moderator', 'admin'].map(x => `<option ${u.role === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="field field--inline"><span class="sr-only">Status</span><select name="status">${['active', 'suspended'].map(x => `<option ${u.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <button class="btn btn--ghost btn--sm" type="submit" ${u.id === S.user.id ? 'disabled' : ''}>Save</button>
        </form>
      </li>`).join('')}</ul>`;
  }

  async function renderCredits(body, summary) {
    const r = await api('GET', '/api/garage/admin/provenance/review');
    if (!r.ok) { body.innerHTML = '<p class="form-msg">Couldn’t load photo credits.</p>'; return; }
    const list = r.data.photos;
    body.innerHTML = `<p class="block-sub">Authors and licences for the first-party photos, as stated on each file’s Wikimedia Commons page. The server checks weekly.</p>
      ${summary ? `<p class="banner">Checked ${summary.fetched}: ${summary.ok} fine, ${summary.review} to review, ${summary.no} not usable, ${summary.missing} missing${summary.failed ? `, ${summary.failed} couldn’t be reached` : ''}.</p>` : ''}
      <button class="btn btn--ghost" data-g="credits-refresh">Check Wikimedia Commons now</button>
      ${list.length ? `<h3 class="h3 sc-h">Needs a decision (${list.length})</h3><ul class="people">${list.map(x => `<li><span><b>${esc(x.car)}</b><small>${esc(x.file)}</small></span><span>${esc(x.status === 'ok' ? `${x.licence || 'No licence'} (${x.use === 'no' ? 'non-commercial' : 'check'})` : x.status)}</span></li>`).join('')}</ul>` : '<p class="wait">Every first-party photo has a usable licence on record.</p>'}`;
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', async e => {
    const signin = e.target.closest('[data-action="signin"]');
    if (signin) { signinDialog(); return; }
    const el = e.target.closest('[data-g]');
    if (!el) return;
    const g = el.dataset.g;
    if (el.closest('#m-acct')) { $('m-acct').hidden = true; $('acctBtn').setAttribute('aria-expanded', 'false'); }
    if (g === 'close') return closeDialog();
    if (g === 'view') return signinDialog(el.dataset.view);
    if (g === 'finish') return finishDialog();
    if (g === 'licence') return licenceDialog();
    if (g === 'account') return accountDialog();
    if (g === 'my-profile') return S.garage && S.garage.profile && showProfile(S.garage.profile);
    if (g === 'signout') {
      await api('POST', '/api/auth/logout', {});
      await signedInChanged('Signed out');
      if (VC.current() === 'mod') VC.show('home');
      return;
    }
    if (g === 'resend') {
      const r = await api('POST', '/api/auth/resend-verification', {});
      toast(r.ok ? (r.data.already ? 'Your email is already confirmed.' : 'Link sent. Check your email.') : (r.data.error || 'Couldn’t send the link.'));
      return;
    }
    if (g === 'tab') { S.tab = el.dataset.tab; return renderGarage(); }
    if (g === 'edit-sub') return editSubDialog(el.dataset.id);
    if (g === 'remove-sub') {
      const s = (S.subs || []).find(x => x.id === el.dataset.id);
      return confirmDialog({
        title: s && s.status === 'approved' ? 'Remove this photo from the game?' : 'Withdraw this photo?',
        text: 'It stops appearing straight away and the files are deleted. This can’t be undone.',
        action: 'remove-sub', data: el.dataset.id, button: s && s.status === 'approved' ? 'Remove' : 'Withdraw',
      });
    }
    if (g === 'counter') return counterDialog(el.dataset.id);
    if (g === 'mod-tab') { S.modTab = el.dataset.tab; S.modSel = null; return renderMod(); }
    if (g === 'mod-status') { S.modStatus = el.dataset.status; S.modSel = null; return renderMod(); }
    if (g === 'mod-pick') {
      S.modSel = el.dataset.id;
      document.querySelectorAll('.mod-item').forEach(b => b.classList.toggle('is-sel', b === el));
      $('modDetail').innerHTML = '<p class="wait">Loading…</p>';
      await renderReview(S.modSel);
      if (matchMedia('(max-width: 899px)').matches) $('modDetail').scrollIntoView({ block: 'start' });
      return;
    }
    if (g === 'notice') {
      const r = await api('POST', `/api/garage/mod/counter-notices/${encodeURIComponent(el.dataset.id)}`, { status: el.dataset.status });
      toast(r.ok ? 'Saved' : r.data.error || 'Couldn’t save.');
      return renderMod();
    }
    if (g === 'reinstate') {
      openDialog(`${dialogHead('Put the photo back?', 'It returns in casual modes only. You can change that afterwards.')}
        <form class="dialog-form" data-g-form="reinstate" data-id="${esc(el.dataset.id)}" novalidate>
          ${input('reason', 'Reason, for the record', 'required maxlength="300" placeholder="No court action within 14 business days"')}
          <p class="form-msg" role="alert"></p>
          <button class="btn btn--primary btn--block" type="submit">Put it back</button>
        </form>`);
      return;
    }
    if (g === 'credits-refresh') {
      busy(el, true);
      const r = await api('POST', '/api/garage/admin/provenance/refresh', {});
      busy(el, false);
      if (!r.ok) return toast(r.data.error || 'Couldn’t reach Wikimedia Commons.');
      return renderCredits($('modBody'), r.data);
    }
  });

  document.addEventListener('change', e => {
    const f = e.target.closest('[data-g-file]');
    if (f && f.files[0]) uploadFor(f.dataset.gFile, f.files[0]);
  });

  document.addEventListener('submit', async e => {
    const form = e.target.closest('[data-g-form]');
    if (!form) return;
    e.preventDefault();
    clearMsg(form);
    const kind = form.dataset.gForm;
    const v = values(form);
    const btn = e.submitter || form.querySelector('[type=submit]');
    busy(btn, true);
    try {
      if (kind === 'signin') {
        const r = await api('POST', '/api/auth/login', { email: v.email, password: form.elements.password.value });
        if (!r.ok) return fail(form, r);
        await signedInChanged(`Signed in as ${r.data.user.displayName || r.data.user.email}`);
      } else if (kind === 'signup') {
        if (!v.acceptTerms) return fail(form, { data: { error: 'Accept the terms to create an account.', field: 'acceptTerms' } });
        const r = await api('POST', '/api/auth/signup', { email: v.email, password: form.elements.password.value, displayName: v.displayName, birthDate: v.birthDate, acceptTerms: true });
        if (!r.ok) return fail(form, r);
        await signedInChanged(r.data.mailSent ? 'Account created. Check your email for a link to confirm it.' : 'Account created.');
      } else if (kind === 'forgot') {
        const r = await api('POST', '/api/auth/forgot', { email: v.email });
        if (!r.ok) return fail(form, r);
        closeDialog();
        toast('If there’s an account with that email, a reset link is on its way.');
      } else if (kind === 'reset') {
        const r = await api('POST', '/api/auth/reset', { token: form.dataset.token, password: form.elements.password.value });
        if (!r.ok) return fail(form, r);
        await signedInChanged('Password saved. You’re signed in.');
      } else if (kind === 'finish') {
        if (!v.acceptTerms) return fail(form, { data: { error: 'Accept the terms to finish setting up.', field: 'acceptTerms' } });
        const body = { displayName: v.displayName, acceptTerms: true };
        if (form.elements.birthDate) body.birthDate = v.birthDate;
        const r = await api('POST', '/api/auth/profile', body);
        if (!r.ok) {
          if (r.data && r.data.closed) { closeDialog(); toast(r.data.error); return refresh(); }
          return fail(form, r);
        }
        await signedInChanged('All set.');
      } else if (kind === 'account') {
        const r = await api('POST', '/api/auth/profile', { displayName: v.displayName, creditAnonymous: v.creditAnonymous, notifyEmail: v.notifyEmail });
        if (!r.ok) return fail(form, r);
        closeDialog();
        toast('Saved');
        await refresh();
      } else if (kind === 'close') {
        if (v.confirm.toLowerCase() !== 'close') return fail(form, { data: { error: 'Type “close” to confirm.', field: 'confirm' } });
        const r = await api('POST', '/api/auth/close', { confirm: 'close' });
        if (!r.ok) return fail(form, r);
        await signedInChanged('Your account is closed.');
        VC.show('home');
      } else if (kind === 'licence') {
        if (!v.accept) return fail(form, { data: { error: 'Tick the box to accept.', field: 'accept' } });
        const L = await loadLicence();
        const r = await api('POST', '/api/garage/licence', { version: L.version });
        if (!r.ok) return fail(form, r);
        closeDialog();
        await refreshGarageMe();
        S.tab = 'add';
        renderGarage();
      } else if (kind === 'copyright') {
        const r = await api('POST', '/api/garage/reports', {
          kind: 'copyright', target: form.dataset.target,
          copyright: { name: v.name, email: v.email, work: v.work, signature: v.signature, goodFaith: v.goodFaith, accurate: v.accurate },
        });
        if (!r.ok) return fail(form, r);
        closeDialog();
        toast('Complaint sent. The photo is out of the game while a moderator checks.');
      } else if (kind === 'counter') {
        const r = await api('POST', `/api/garage/submissions/${encodeURIComponent(form.dataset.id)}/counter`, { name: v.name, contact: v.contact, statement: v.statement, consent: v.consent });
        if (!r.ok) return fail(form, r);
        closeDialog();
        toast('Counter-notice sent. A moderator will forward it.');
      } else if (kind === 'edit-sub') {
        const r = await api('PATCH', `/api/garage/submissions/${encodeURIComponent(form.dataset.id)}`, { make: v.make, model: v.model, trim: v.trim, generation: v.generation, year: v.year, notes: v.notes, resubmit: true });
        if (!r.ok) return fail(form, r);
        closeDialog();
        toast('Sent for review again.');
        await refreshGarageMe();
        renderGarage();
      } else if (kind === 'remove-sub') {
        const r = await api('DELETE', `/api/garage/submissions/${encodeURIComponent(form.dataset.id)}`);
        if (!r.ok) return fail(form, r);
        closeDialog();
        toast('Removed.');
        await refreshGarageMe();
        renderGarage();
      } else if (kind === 'decide') {
        const action = btn && btn.value;
        const body = { action, reason: v.reason };
        if (action === 'approve') {
          Object.assign(body, { vehicleKey: v.vehicleKey, year: v.year, difficulty: Number(v.difficulty), eligibility: v.eligibility, confirmDuplicate: !!v.confirmDuplicate, blur: S.modCache.getBlur ? S.modCache.getBlur() : [] });
          if (!v.vehicleKey) return fail(form, { data: { error: 'Choose the vehicle.' } });
        }
        const r = await api('POST', `/api/garage/mod/submissions/${encodeURIComponent(form.dataset.id)}/decision`, body);
        if (!r.ok) return fail(form, r);
        toast(action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Sent back for a correction');
        S.modSel = null;
        renderMod();
      } else if (kind === 'remove-image') {
        const r = await api('POST', `/api/garage/mod/images/${encodeURIComponent(form.dataset.id)}/remove`, { reason: v.reason });
        if (!r.ok) return fail(form, r);
        toast('Removed from the game');
        S.modSel = null;
        renderMod();
      } else if (kind === 'resolve') {
        const action = btn && btn.value;
        const body = { action, note: v.note };
        if (action === 'fix') body.blur = form._getBlur ? form._getBlur() : [];
        const r = await api('POST', `/api/garage/mod/reports/${encodeURIComponent(form.dataset.id)}/resolve`, body);
        if (!r.ok) return fail(form, r);
        toast(action === 'uphold' ? (r.data.contributorBlocked ? 'Removed. The contributor can no longer submit.' : 'Removed') : action === 'fix' ? 'Fixed' : 'Dismissed');
        renderMod();
      } else if (kind === 'reinstate') {
        const r = await api('POST', `/api/garage/mod/images/${encodeURIComponent(form.dataset.id)}/reinstate`, { reason: v.reason });
        if (!r.ok) return fail(form, r);
        closeDialog();
        toast('The photo is back, in casual modes.');
        renderMod();
      } else if (kind === 'people-search') {
        renderPeople($('modBody'), v.q);
      } else if (kind === 'person') {
        const r = await api('POST', `/api/garage/admin/users/${encodeURIComponent(form.dataset.id)}`, { role: v.role, status: v.status });
        toast(r.ok ? 'Saved' : r.data.error || 'Couldn’t save.');
      }
    } finally { busy(btn, false); }
  });

  VC.onShow(name => {
    if (!S.on) return;
    if (name === 'garage') renderGarage();
    else if (name === 'mod') renderMod();
  });

  // ---------------------------------------------------------------- start
  VC.metaReady.then(async () => {
    const meta = VC.meta();
    if (!meta || !meta.garage) return;
    S.on = true;
    $('navGarage').hidden = false;
    $('gReportKindWrap').hidden = false;
    await refresh();
    // Links from emails and sign-in redirects.
    const params = new URLSearchParams(location.search);
    const clean = () => history.replaceState(history.state, '', location.pathname);
    if (params.has('verify')) {
      const r = await api('POST', '/api/auth/verify', { token: params.get('verify') });
      clean();
      toast(r.ok ? 'Email confirmed.' : (r.data.error || 'That link didn’t work.'));
      if (r.ok) await refresh();
    } else if (params.has('reset')) {
      const token = params.get('reset');
      clean();
      resetDialog(token);
    } else if (params.has('signin_error')) {
      const msg = params.get('signin_error');
      clean();
      signinDialog('signin', msg);
    } else if (params.has('profile')) {
      const name = params.get('profile');
      clean();
      showProfile(name);
      return;
    }
    if (params.has('garage')) {
      if (params.get('garage') === 'mine') S.tab = 'mine'; // from a decision email
      clean();
      VC.show('garage');
    }
    if (params.has('finish') || (S.user && !S.user.profileComplete)) {
      const suggest = params.get('suggest') || '';
      if (params.has('finish')) clean();
      if (S.user && !S.user.profileComplete) finishDialog(suggest);
    }
  });

  // For the moderation e2e checks and the game's report button.
  window.VCGarage = { report, state: () => ({ ...S }), refresh };
})();
