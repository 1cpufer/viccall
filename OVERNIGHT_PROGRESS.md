# VicCall: Overnight Progress

> Historical log of the 17 October overnight session. The current state is in `README.md` under **Status**.

Session start: 2026-10-17, ~00:30 CT. Branch: `overnight-polish` (cut from `main` @ `a7a2048`).

## How to resume after context loss

1. Read `README.md`, this file, and `OVERNIGHT_CHANGELOG.md`.
2. `git log --oneline overnight-polish` shows the completed milestones.
3. Pick the top unchecked item in the backlog below.

## Environment notes

- The session's network allowlist blocks `upload.wikimedia.org`, `cdn.jsdelivr.net`, and Google Fonts. Browser screenshots replace every car photo with a locally generated stand-in. Real photo URLs **cannot be verified** from here.
- Pushing to GitHub is refused from this session because the Claude GitHub App isn't linked to `1cpufer/viccall`. All work is committed locally on `overnight-polish` and delivered as a git bundle/patch.

## Commands

| Purpose | Command |
|---|---|
| Install | `npm install` |
| Run | `npm start` (port 3000, override with `PORT`) |
| Dev | `npm run dev` |
| Tests | *(none at baseline; added during the session, see below)* |
| Build | none: plain Node + static files, no bundler |

## Baseline state (what exists at `a7a2048`)

- Express + Socket.IO server (`src/server.js`, `src/party.js`); vanilla JS client (`public/app.js`, ~540 lines); one CSS file.
- 220 cars in `src/cars.json`: japan 48, germany 38, usa 55, italy 30, france 23, uk 26. Flags: niche 121, supercar 33, kit 13. All images are hotlinked from Wikimedia at 1280px.
- Scores and reports are stored as JSON files in `data/` (gitignored).
- No tests, no linter.

## Problems found during the baseline audit

### Critical / gameplay
1. **Answer matching is exact-only.** "VW" ≠ "Volkswagen", "Mercedes" ≠ "Mercedes-Benz", "Supra MK4" ≠ "Supra", one typo = 0 pts. "94" for 1994 scores as off by 1900 years.
2. **Scoring logic is duplicated** in `app.js` and `party.js` and has already drifted: party mode has no kit scoring at all.
3. **Party mode can't play Kit Check or Time Attack.** They're missing from the selector, the server never scores kits, and there's no party timer.
4. **The Time Attack timeout throws away typed answers** (it scores 0 even if fields are filled), and the interval-based countdown drifts.
5. **The leaderboard trusts the client.** Anyone can `POST /api/scores` with 50/50. `/api/cars` ships every answer to the browser.
6. **`GET /api/reports` is public.** It exposes every crash report and user agent to anyone.

### Multiplayer
7. Joining or creating while already in a room leaves a ghost player in the old room.
8. A refresh or network blip drops the player permanently (new socket id, no rejoin).
9. On host handoff mid-reveal, the new host never gets the "Next" button (the UI only re-renders in the lobby).
10. No payload validation or size limits on socket events.

### UI / UX
11. **The score popup persists across screens** (seen in the screenshot on the party screen) and its `setTimeout`s collide on fast play.
12. **The background canvas is broken.** It renders as a 300×150 box in the top-left because it has no CSS size.
13. Icons come from `@tabler/icons-webfont@latest`, an unpinned CDN dependency (a breaking release can change the UI).
14. Mode cards are clickable `<div>`s, so they're unreachable by keyboard. Labels aren't `<label>`s, and focus outlines are removed.
15. Mobile: the party cards squeeze into 2 columns at 390px, and the inputs have autocorrect/autocapitalize on (iOS mangles "BMW" etc.).
16. Very low text contrast (#333–#444 on #0a0a0a) in many places.
17. The look is generic: system font, pill/rounded cards, tinted gold everywhere, no real identity.

## Backlog (priority order)

- [ ] P1 Shared scoring module (client + server) with make/model aliases, typo tolerance, 2-digit years, kit scoring; unit tests
- [ ] P1 Party: kit + time attack modes, server timer, validation, room-leak fix, host handoff UI, reconnection grace period; socket tests
- [ ] P1 Solo: deadline-based timer, score typed answers on timeout, popup lifecycle, image preload
- [ ] P1 Server-authoritative solo sessions so leaderboard scores can't be forged
- [ ] P1 Lock down `/api/reports`
- [ ] P3 Visual identity: self-hosted type + SVG icons, new art direction, fix canvas, contrast
- [ ] P4 Motion: carousel physics, answer feedback, score count-up, reduced-motion
- [ ] P6 Accessibility: keyboard carousel/cards, labels, focus rings, aria-live feedback
- [ ] P5 Images: smaller Wikimedia thumbs (960px), preload next car

## Cycle log

*(appended per cycle below)*

### Cycle 1: shared scoring (commit f67b505)
- **Changed:** new `public/scoring.js` shared by client and server; `cars.json` gained `id`, `modelAliases`, `makeAliases`; `party.js` and `app.js` now call it; `npm test` added.
- **Why:** exact-only matching punished correct answers ("VW", "R34", "Supra MK4", "94"), and the two copies had drifted (party had no kit scoring).
- **Tests:** 18 `node:test` tests pass, including every car matching its own answer and aliases, plus a cross-car false-positive sweep (only Golf GTI→Golf and Corvette Stingray→1963 Corvette remain, and both are legitimately correct).
- **Remaining:** model "close" credit (1 pt) is a new rule. The README needs to explain it.
- **Next:** multiplayer hardening.

### Cycle 2: multiplayer + solo server sessions (commit b0ac853)
- **Changed:** `src/party.js` rewritten; `src/server.js` now exports `createApp()` and adds `/api/solo/*` and `/api/meta`, gates `/api/reports` and requires a session for `/api/scores`. Tests in `test/party.test.js` and `test/api.test.js`; `socket.io-client` is a devDependency.
- **Why:** audit items 2–10 (forgeable leaderboard, public reports, ghost players, no reconnection, AFK stalls, missing party modes).
- **Tests:** 39/39 passing, run 3× for flakiness.
- **Decisions for human review:** see "Decisions needing review" below.

### Cycle 3: client redesign (commit 10eaa5f)
- **Design plan:** racing green `#0f2019` base, ivory `#f0ebdc` text, plate yellow `#f5c324` as the single accent (= primary action / correct answer), coral `#f2826f` for misses. Type is Saira variable (self-hosted): expanded italic for display, regular for body. The brand device is a UK rear number plate, reused for the party code. Boldness is spent on the plate and the reveal moment; everything else stays quiet.
- **Files:** `public/index.html`, `public/style.css`, `public/app.js` (full rewrite), `public/fonts/*`, `public/favicon.svg`.
- **Verified in a browser (Playwright, Chromium, desktop 1280 + mobile 390):** scratchpad e2e script covering carousel drag, regional, a full 10-car solo game with hit/partial/miss, results + save, leaderboard, back button, Time Attack clock, Kit Check scoring, empty-guess message, and a 2-player party (invite link, lobby, guess, guest refresh + resume mid-round, reveal, host-only Next, 10 rounds, final, host leave → handoff). All checks pass with no console errors. **Car photos were replaced by a stand-in image** because Wikimedia is blocked here.

## Decisions needing review
1. **Model "close" credit:** the right model family with the wrong trim/generation now scores 1 of 2 model points.
2. **Party round timer:** 60 s per car (30 s in Time Attack), so the round ends even if someone never answers. Previously there was no timer.
3. **`/api/reports`** now returns 404 unless `ADMIN_TOKEN` is set and passed as `?token=` / the `x-admin-token` header, or the request comes from the same machine. **If you read reports on the deployed site, set `ADMIN_TOKEN`.**
4. **`/api/cars` removed** (it exposed every answer). Nothing else in the repo used it.
5. **Kit cars are excluded from non-kit pools** (Worldwide etc.), so a widebody Huracán won't show up where you'd guess make/model/year.

### Cycles 4–6: polish, accessibility, sharing (commits after 10eaa5f)
- Photos request 960px Wikimedia thumbnails (47 cars were 1280px) and fall back to the original URL if a size is missing. The e2e run forces every downsized thumbnail to 404 to prove the fallback works.
- axe-core audit on 7 screens: **0 violations** (fixed missing h1, heading order, inactive card contrast). Focus moves to each new screen.
- Results "Share result" (spoiler-free 10-square grid); the leaderboard highlights your just-saved row.
- README documents scoring, configuration (`ADMIN_TOKEN`, `TRUST_PROXY`) and tests.
- **Verification:** `npm test` 39/39. The e2e script (26 checks, desktop + mobile + 2-player party) passes on repeated runs with zero console errors.

## Current backlog
- [x] P1 shared scoring · [x] P1 party hardening · [x] P1 solo sessions/leaderboard · [x] P1 reports lockdown
- [x] P3 visual identity · [x] P4 reveal/score/carousel motion · [x] P6 accessibility pass · [x] P5 image size + preload
- [ ] Reduced-motion run-through in a browser
- [ ] Final full verification + delivery bundle

### Cycles 7–9: performance, data audit, installability, e2e
- gzip and the minified socket.io client: HTML/JS/CSS go out at about 37 KB compressed. The WebSocket only opens for party play. `npm audit fix` brought vulnerabilities from 5 (baseline) to 0.
- Data audit of all 220 image filenames against their answers (see "Data issues" below).
- Web app manifest, icons and an Open Graph link-preview card.
- Browser e2e scripts committed under `e2e/`.

---

# End-of-session report

## Final verification (all on the last commit)
| Check | Result |
|---|---|
| `npm test` (scoring, REST API, Socket.IO flows) | **42 / 42 pass** |
| `e2e/ui.e2e.js` desktop 1280 + mobile 390 + 2-player party | **27 / 27 pass**, zero console errors |
| `e2e/party.e2e.js` 3-player edge cases | **12 / 12 pass** |
| axe-core on 7 screens | **0 violations** |
| `npm audit` | **0 vulnerabilities** |
| Viewports 320 px and 1920 px | no horizontal overflow |

Visual checks used real Chromium screenshots, but **every car photo was a stand-in image** because this sandbox can't reach Wikimedia. Real photo URLs were not loaded.

## Modified systems
- `public/scoring.js` (new): shared answer matching.
- `src/server.js`: app factory, solo sessions, leaderboard validation, report lockdown, compression, headers, rate limits, OG tags.
- `src/party.js`: rewritten multiplayer.
- `src/cars.json`: ids, aliases, year ranges, generation fixes, exclusions.
- `public/index.html`, `public/style.css`, `public/app.js`: full redesign and rewrite.
- `public/fonts/`, icons, manifest, OG card (new).
- `test/` (new) and `e2e/` (new).

## Known remaining issues
- **Photos are unverified from here.** Run a game locally and skim the photos. The in-game "Wrong answer or photo?" link and the automatic image-failure reports (`/api/reports`) will catch broken ones.
- `citroen-ds-1955`'s photo is a car-event shot from Bornholm. It might not show a DS clearly. Please check it.
- The 5 `excluded` cars need correct photos before they can come back (search `"excluded"` in `src/cars.json`).
- Scores and reports are still JSON files on disk. That's fine for one server, but they reset on hosts with ephemeral disks (Render free tier, Railway without a volume).
- Party rooms live in memory, so a server restart ends any parties in progress.

## Recommended next steps
1. Look at the game with real photos and replace the 5 excluded images.
2. Choose hosting. If it's ephemeral, move scores to SQLite on a volume, or a hosted DB.
3. Set `ADMIN_TOKEN` (and `TRUST_PROXY=1` behind a proxy) when deploying.
4. Feature ideas: a daily challenge (same 10 cars for everyone, one attempt, which shares well with the result grid), more Kit Check builds (only 13 now), per-car difficulty.

## Decisions needing human review
Listed above under "Decisions needing review" (close-model credit, party timer, reports token, `/api/cars` removal, kit cars excluded from other modes). Also:
6. **Year ranges:** 29 cars now accept any year in their production run as exact (e.g. the 911 entry accepts 1974–1989), because the photos often show a later model year.
7. **4 cars changed year** to match their photo's generation (Pajero, Cayenne, fortwo, CTS-V).

## How to get this branch
Pushing from the session was refused because the Claude GitHub App isn't linked to `1cpufer/viccall`. The branch is delivered as `viccall-overnight.bundle`:
```
cd viccall
git fetch /path/to/viccall-overnight.bundle overnight-polish:overnight-polish
git checkout overnight-polish && npm install && npm test && npm start
```
