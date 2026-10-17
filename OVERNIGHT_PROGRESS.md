# VicCall: Overnight Progress

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
