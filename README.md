# VicCall

Vehicle Identification Call — a car-guessing game. You're shown a photo and have to call the make, model, and year (or, in Kit Check mode, the tuner behind the body kit). Play solo across several modes, race the clock, or spin up a real-time party with friends.

## Running it

```
npm install
npm run dev    # or: npm start
```

Serves on `http://localhost:3000` (override with `PORT`).

```
npm test       # scoring, API and multiplayer tests (node:test)
```

### Configuration

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000). |
| `ADMIN_TOKEN` | Required to read `/api/reports` (`/api/reports?token=...`). Without it, reports can only be read from the server machine itself. |
| `TRUST_PROXY` | Set to `1` when running behind a reverse proxy (Render, Railway, nginx) so rate limits see real client IPs. |

## Deploying

`render.yaml` is a Render Blueprint: in Render choose **New → Blueprint**, pick this repo, and it creates a free web service with `TRUST_PROXY` set and a random `ADMIN_TOKEN` (find it under the service's Environment tab).

On Render's free plan the service sleeps after 15 minutes without visitors (the first visit then takes about a minute), and the disk resets on every restart or deploy, so leaderboard scores and reports don't persist. Add a persistent disk mounted at `/opt/render/project/src/data` on a paid plan to keep them.

## Scoring

| | Points |
|---|---|
| Make | 1 |
| Model | 2 (1 if you get the family but not the trim or generation, like "Skyline" for an R34) |
| Year | 2 exact, 1 within 5 years |
| Kit Check | 5 for the right tuner |

Answers are forgiving about the way people actually type: nicknames ("VW", "Chevy", "Merc"), chassis codes ("R34", "E30"), trim extras ("Supra MK4"), small typos, missing accents and two-digit years all count. Per-car aliases live in `src/cars.json` (`modelAliases`, `makeAliases`).

The server keeps the answers and scores every guess, so leaderboard scores can't be posted by hand.

## Game modes

- **Worldwide** — random cars from every region.
- **Regional** — Japan, Germany, USA, France, Italy, or UK.
- **Niche** — obscure builds only.
- **Supercars** — exotic icons only.
- **Time Attack** — 30 seconds per car.
- **Kit Check** — name the tuner/body kit on a modified car (Liberty Walk, RWB, Rocket Bunny, and more).
- **Party code** — create or join a room (or share an invite link) and play the same ten cars together in real time, in any mode.

Scores save to a per-mode leaderboard.

## Updates

**2026-10-17 — Overnight polish pass** (branch `overnight-polish`; details in `OVERNIGHT_CHANGELOG.md`)
- New look: racing green, number-plate yellow, self-hosted Saira type, plate-style logo and party codes. No more CDN dependencies.
- Shared, alias-aware scoring for solo and party. Typos, nicknames and chassis codes are accepted, and close model answers earn partial credit.
- Solo games run as server sessions: the leaderboard only accepts finished games, and answers are never sent to the browser early.
- Party mode: Kit Check and Time Attack added, round timer, refresh/reconnect resumes your seat, host handoff, invite links, scores hidden until the reveal.
- Inline answer reveal, results logbook, deadline-based timers, back-button support, accessibility and mobile fixes.
- 39 automated tests (`npm test`).

**2026-07-19 — Kit Check mode, homepage carousel, bug/crash reporting**
- New Kit Check mode: guess the tuner/body kit on a modified car, with alias-aware scoring (e.g. "LB Works" matches "Liberty Walk").
- Homepage mode picker redesigned as a swipeable card-deck carousel — drag, arrow, or dot navigation, with a vignette-dimmed peek of neighboring cards.
- Uncaught client errors are now silently captured and logged server-side; players can also flag a specific car as wrong via an in-game "Report" button.
- Fixed a crash on undefined guess input and dimmed the answer-box placeholder text so it no longer reads as a pre-filled answer.

**2026-07-19 — American car roster expansion**
- Added 20 more USA-region cars spanning modern EVs, trucks, and hypercars to classic muscle.

**2026-07-19 — Shuffle fix**
- Replaced a biased `sort(() => Math.random() - 0.5)` shuffle (which skewed which cars came up) with a proper Fisher-Yates shuffle in both solo and party modes.

**2026-07-19 — Supercars mode**

**2026-07-18 — Party code multiplayer**
- Real-time party rooms via Socket.IO — create or join with a code, play synced rounds, live standings.

**2026-07-18 — Dataset expansion + leaderboard**
- Car dataset expanded to 77 entries; added a persistent leaderboard.

**2026-07-18 — Initial prototype**
