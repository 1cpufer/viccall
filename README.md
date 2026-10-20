# VicCall

Vehicle Identification Call: a car-guessing game. You see one photo and name the make, model and year, or for a modified car, the tuner behind the body kit. No account needed for anything.

## Running it

```
npm install
npm run dev    # or: npm start
```

Serves on `http://localhost:3000` (override with `PORT`).

```
npm test                                   # scoring, modes, API, photo proxy and multiplayer (node:test, 47 tests)
node e2e/ui.e2e.js [shotDir]               # browser run of every mode, desktop + phone + a 2-player party
node e2e/party.e2e.js                      # party edge cases (timers, host leaving, refresh, rematch)
```

The two browser scripts need Playwright (`npm i --no-save playwright && npx playwright install chromium`). They start their own server, stub the photo upstream, and need no network.

### Configuration

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000). |
| `ADMIN_TOKEN` | Required to read `/api/reports` (`/api/reports?token=...`). Without it, reports can only be read from the server machine itself. |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy (Render, Railway, nginx) so rate limits see real client IPs. |

### Dependencies

Runtime: `express`, `compression`, `socket.io`. Dev: `socket.io-client` (tests). No dependencies were added in the expansion pass; audio is generated with the browser's Web Audio API and the photo proxy uses Node's built-in `fetch` (Node 18+).

## Deploying

`render.yaml` is a Render Blueprint: in Render choose **New → Blueprint**, pick this repo, and it creates a free web service with `TRUST_PROXY` set and a random `ADMIN_TOKEN`.

On Render's free plan the service sleeps after 15 minutes without visitors (the first visit then takes about a minute), and the disk resets on every restart or deploy, so leaderboards and reports don't persist. Add a persistent disk mounted at `/opt/render/project/src/data` on a paid plan to keep them.

## Modes

| Mode | Rules | Clock | Leaderboard |
|---|---|---|---|
| **Daily Challenge** | 10 cars, the same for everyone each UTC day: 3 easy, 4 medium, 3 hard, easiest first. One ranked attempt per browser; later runs are practice. | 45 s | One per day |
| **Ranked** | Seven playlists: Worldwide, Modern Cars (2010+), Classic Icons (pre-1990), JDM Challenge, European Performance, Supercar Challenge, Body Kit ID. 10 cars, ordered easy to hard. | 45 s | One per playlist |
| **Endless** | Keep going until you miss three cars. Difficulty follows your streak; no car repeats. | 45 s | One board |
| **Free Play** | Pick era, region, type (everything / supercars / body kits), difficulty and clock (off, 60, 30, 15 s). Forgiving spelling. | Optional | None |
| **Party** | Up to 16 players on the same car at the same time. The host picks the playlist and casual or competitive rules, and can change them between games. Invite links, refresh-to-resume, host handoff. | 60 s casual, 45 s competitive | None |

Ranked, Daily and Endless use the **competitive** rules; Free Play uses **casual**; parties choose. Ties on a leaderboard go to whoever used less time.

## Scoring

Every car is worth 10 points. The same scorer (`public/scoring.js`) runs in the browser and on the server, and the server's result is the one that counts.

| Cars | Points |
|---|---|
| Make | 2 |
| Model | 5 for the exact car. 3 for the right model with the trim missing (M4 for an M4 Competition) or the wrong generation (Evo VIII for an Evo X). |
| Year | 3 for any year the car was built (`yearRange`). Casual: 2 within 2 years, 1 within 5. Competitive: 1 within 2 years. |

| Body kits | Points |
|---|---|
| Tuner | 6 |
| Make | 2 |
| Model | 2, or 1 for the right model with the wrong trim |

What counts and what doesn't:

- Nicknames, chassis codes and per-car aliases count in both rule sets (Beemer, Chevy, R34, FD). They live in `src/cars.json` (`modelAliases`, `makeAliases`, `variantAliases`, `kitAliases`).
- Casual rules forgive one slip in a word of six letters or more (Lamborgini). Competitive rules forgive nothing. Digits are never fuzzy-matched.
- Partial words score nothing ("Lam" is not Lamborghini). Sharing a letter or two with the answer is worth nothing.
- Hedging scores nothing: in "Silvia Skyline 350Z" every extra word has to be a trim (Spec-R, Type R, Competition), not another car.
- A generation code from a different car (MkIV on a Mk5, Evo VIII on an Evo X) caps the model at partial credit.
- Each answer field gets its own feedback line on the reveal: "Right model, missed the trim: Competition", "Off by 2 (2019–2024)", "Left blank".

## How ranked play is protected

- The server holds the answers, runs the clock and keeps score. Nothing in the start or round payload names the car.
- Ranked and party photos are served through `/api/img/<token>`. Wikimedia file names usually spell out the car, so the browser never sees them before the reveal. A token is only issued when its round opens, and the 45-second clock starts when the photo is first served, so slow photo loads don't eat your time. If Wikimedia can't be reached from the server, the proxy redirects to the direct URL so the game stays playable (that one photo is no longer hidden).
- An answer that arrives more than 3 s after the clock ends scores 0. Free skips for photos that fail to load are limited to two per ranked game, and only when the server couldn't deliver the photo.
- Leaderboards only accept finished server sessions, once each. The daily lock is per browser (a hashed random key), so it stops accidents, not someone determined to clear their storage.

## Car database

`src/cars.json`: 307 entries (302 in play, 5 held back because their photo doesn't show the right car), 84 makes.

- Eras: 110 from 2010 onward, 62 from 1990–2009, 130 before 1990.
- Difficulty, from how recognisable the car is: 61 easy, 123 medium, 118 hard.
- 59 supercars; 13 cars with a scored trim (`variant`, e.g. GT-R Nismo, M4 Competition).
- 25 tuner builds from 13 tuners: ABT Sportsline, Brabus, Hamann, Larte Design, Liberty Walk, Mansory, Novitec, Prior Design, RWB, Rocket Bunny, TechArt, VeilSide, Vorsteiner. Every build is a real one, photographed on the car it was made for.
- Every photo is a Wikimedia Commons file, credited and linked on the reveal (`credit` holds the file name). `npm test` checks every URL's Commons hash path, difficulty, credit and year range.

Entry fields: `id, make, model, variant?, year, yearRange, region, niche, supercar, difficulty (1–3), img, credit, hint`, plus `kit` and `kitAliases` on tuner builds and optional alias lists.

## Sound

All sound is synthesised in the browser (`public/audio.js`, Web Audio API). There are no samples, recordings or licensed tracks.

- **Effects:** menu select, photo arrival, correct, partial, wrong, clock warning and final-second ticks, score count, streak (3, 5, 10, 15…), game complete, victory and defeat.
- **Music:** *Monaco* (deep, melodic house, 122 BPM) and *Night Run* (drift phonk, 140 BPM half-time, distorted 808s and a cowbell riff), or no music. Each theme is built from layers (pad, drums, bass, lead, top) that fade in as intensity rises with game progress, your streak and the clock running down, while a filter on the music opens up. Theme and screen changes crossfade.
- **Controls:** master, music and effects volume, music style, mute (also the `M` key). Saved in the browser.
- **Autoplay-safe:** nothing is created until the first click, tap or key press; audio suspends when the tab is hidden.

## Interface

- Desktop: a top bar with Singleplayer and Party menus (hover or keyboard), Leaderboards and How scoring works. The game screen puts the photo first with the answer panel beside it; the bar hides during play.
- Phones: the same screens in one column, with the menu behind a button.
- Keyboard: `Tab` between boxes, `Enter` to lock in and to move on, `Esc` to leave a game (asks first), `M` to mute, arrow keys in menus and leaderboard tabs.
- Accessibility: labelled fields, visible focus, live regions for reveals, reduced-motion support. axe-core reports no violations on any screen at desktop or phone size.

## API

| Endpoint | |
|---|---|
| `GET /api/meta` | Playlists with pool sizes, Free Play filter values, makes, today's daily date. No answers. |
| `GET /api/pool?era=&region=&type=&difficulty=` | How many cars a Free Play filter matches. |
| `POST /api/solo/start` | `{ kind: 'free'|'ranked'|'daily'|'endless', playlist?, filters?, player? }` |
| `POST /api/solo/round` | Opens round `idx` and returns its photo URL. |
| `POST /api/solo/guess` | Scores the guess; returns per-field feedback, streak, strikes and the answer with its photo credit. |
| `POST /api/scores` | Posts a finished ranked session. |
| `GET /api/leaderboard?board=` | `ranked:<playlist>`, `daily:YYYY-MM-DD` or `endless`. |
| `GET /api/img/:token` | Photo proxy for ranked and party rounds. |
| `POST /api/report`, `GET /api/reports` | Bug and crash reports (reading needs `ADMIN_TOKEN`). |

Party events over Socket.IO: `party:create`, `party:join`, `party:resume`, `party:settings`, `party:start`, `party:guess`, `party:reveal`, `party:next`, `party:leave`.

## Known limitations

- No human has listened to the music or effects yet. They were checked by rendering offline and measuring levels: no clipping anywhere, and the high-frequency energy rises with intensity in both themes as layers come in. The mix may still need tuning by ear.
- Photos are checked by file name and hash path only. Wikimedia isn't reachable from the development sandbox, so nobody has looked at every image; the 5 held-back entries were caught by file name. The proxy was tested against a stubbed upstream, not live Wikimedia.
- No free-licensed photos were found for Top Secret, Varis or newer Prior Design builds, so those tuners aren't in the game yet.
- Scores from before the expansion used a 50-point scale and the old mode names. They stay in the scores file but aren't shown on the new boards.
- Personal bests live in the browser only. There are no accounts.

## Updates

See `CHANGELOG.md` for the full record.

- **2026-10-19, game expansion** (branch `game-expansion`): 10-point scoring with casual and competitive rules, 302-car database with difficulty tiers and 25 tuner builds, Daily / Ranked / Endless / Free Play modes, photo proxy, desktop-first interface, synthesised sound effects and music.
- **2026-10-17, overnight polish** (branch `overnight-polish`): visual identity, shared scoring, server-held answers, party hardening. See `OVERNIGHT_CHANGELOG.md`.
- **2026-07-18 to 07-19:** prototype, leaderboard, party codes, Supercars, Kit Check, bug reports, USA roster.
