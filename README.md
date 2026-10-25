# VicCall

Vehicle Identification Call: a car-guessing game. You see one photo and name the make, model and year, or for a modified car, the tuner behind the body kit. No account needed to play. Accounts exist only for the optional Community Garage, where players submit their own photos.

## Status (24 October 2026)

- **Live:** https://viccall.onrender.com, Render free plan, deployed from the `overnight-polish` branch. Pushing there deploys.
- **Branches:**
  - `main` has the latest code and notes, so start there.
  - `game-expansion` is the work branch.
  - `overnight-polish` is what's live, and it only ever moves forward to `main`. `git log origin/overnight-polish..origin/main` lists anything not live yet.
- **Running on the live site:**
  - Every game mode and answer recognition.
  - Keep-awake: the site doesn't sleep.
  - Leaderboards backed up to a private gist (`SCORES_GITHUB_TOKEN` is set on Render).
  - Photo proxy: confirmed working.
  - Commons photo credits: all 307 photos have usable licences.
- **Photos checked:** on 24 October every photo was looked at against its answer. 10 were replaced, 9 entries corrected, and the 6 held-back cars came back with correct photos, so all 307 entries are in play (see `CHANGELOG.md`).
- **Built but switched off:** the Community Garage, meaning accounts, photo submissions and moderation (`GARAGE_ENABLED` isn't set). See `docs/COMMUNITY_GARAGE.md`.
- **Still to do (owner):**
  - Before opening the Garage:
    - a paid instance with a persistent disk
    - `GARAGE_ENABLED`, `PUBLIC_URL` and `ADMIN_EMAILS` set on Render
    - email through Resend, which needs a domain
    - Google and Discord sign-in apps (optional)
  - Legal: licence decisions and a lawyer's review, terms and a privacy notice, and a DMCA agent registration.
  - Renew the GitHub token before it expires.
- **Still to do (code):**
  - Let moderators add vehicles that aren't in the database.
  - Email contributors about decisions.
  - Fingerprint the first-party photos so copies of them are caught.
  - Test Google, Discord and Resend for real once the keys exist.
- **Picking it up:** clone, `npm install` (Node 22.13 or newer), `npm test` (93 tests), `npm run dev`. The change history is in `CHANGELOG.md`.

## Running it

```
npm install
npm run dev    # or: npm start
```

Serves on `http://localhost:3000` (override with `PORT`).

```
npm test                                   # node:test, 93 tests: recognition, modes, API, proxy, multiplayer, accounts, Garage, integrity, leaderboard backup
node e2e/ui.e2e.js [shotDir]               # browser run of every mode, desktop + phone + a 2-player party
node e2e/party.e2e.js                      # party edge cases (timers, host leaving, refresh, rematch)
node e2e/garage.e2e.js [shotDir]           # accounts, upload, moderation, credit, reports, counter-notice, phone
```

The browser scripts need Playwright (`npm i --no-save playwright && npx playwright install chromium`). They start their own server, stub the photo upstream, and need no network.

### Configuration

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000). |
| `ADMIN_TOKEN` | Required to read `/api/reports` (`/api/reports?token=...`). Without it, reports can only be read from the server machine itself. |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy (Render, Railway, nginx) so rate limits see real client IPs. |
| `GARAGE_ENABLED` | `1` turns on accounts and the Community Garage (off by default). Its other settings (`PUBLIC_URL`, `ADMIN_EMAILS`, Google, Discord and email keys) are listed in `docs/COMMUNITY_GARAGE.md`. |
| `COMMONS_META` | `0` stops the weekly lookup of first-party photo authors and licences on Wikimedia Commons. |
| `SCORES_GITHUB_TOKEN` | A GitHub token allowed to edit gists. Leaderboards are then also kept in a private gist, restored on start-up and saved after each score and on shutdown, so they survive restarts on hosting without a disk. `SCORES_GIST_ID` pins a specific gist (normally found by its description). |
| `KEEP_AWAKE`, `KEEP_AWAKE_URL` | On Render the server requests its own `/api/health` every 10 minutes (using `RENDER_EXTERNAL_URL`) so the free instance doesn't sleep. `KEEP_AWAKE=0` turns it off; `KEEP_AWAKE_URL` sets the address elsewhere. |

### Dependencies

Runtime: `express`, `compression`, `socket.io`, and `sharp` (image checks and resizing for the Garage). Dev: `socket.io-client` (tests). Needs Node 22.13 or newer: the Garage uses the built-in `node:sqlite`, so there's no database server. Audio is generated with the browser's Web Audio API and the photo proxy uses Node's built-in `fetch`.

## Deploying

`render.yaml` is a Render Blueprint: in Render choose **New → Blueprint**, pick this repo, and it creates a free web service with `TRUST_PROXY` set and a random `ADMIN_TOKEN`.

On Render's free plan the service would sleep after 15 minutes without visitors (the next visit then takes about a minute), and its files reset on every restart, sleep or deploy. Two things work around that:

- **Keep-awake.** The server requests its own address every 10 minutes, so it doesn't sleep. Staying up all month uses about 744 of the workspace's 750 free instance hours, so this only fits while VicCall is the workspace's only free service. If the hours run out, Render suspends free services until the next month.
- **Leaderboards on GitHub.** With `SCORES_GITHUB_TOKEN` set, scores are saved to a private gist and restored after a restart. Nothing is saved until a restore has succeeded, so a GitHub outage at start-up can't overwrite them. Bug reports aren't backed up.

A persistent disk mounted at `/opt/render/project/src/data` (paid plans) keeps everything, and the Community Garage needs one.

## Modes

| Mode | Rules | Clock | Leaderboard |
|---|---|---|---|
| **Daily Challenge** | 10 cars, the same for everyone each UTC day: 3 easy, 4 medium, 3 hard, easiest first. One ranked attempt per browser; later runs are practice. | 45 s | One per day |
| **Ranked** | Seven playlists: Worldwide, Modern Cars (2010+), Classic Icons (pre-1990), JDM Challenge, European Performance, Supercar Challenge, Body Kit ID. 10 cars, ordered easy to hard. | 45 s | One per playlist |
| **Endless** | Keep going until you miss three cars. Difficulty follows your streak; no car repeats. | 45 s | One board |
| **Free Play** | Pick era, region, type (everything / supercars / body kits), difficulty and clock (off, 60, 30, 15 s). Forgiving spelling. | Optional | None |
| **Party** | Up to 16 players on the same car at the same time. The host picks the playlist and casual or competitive rules, and can change them between games. Invite links, refresh-to-resume, host handoff. | 60 s casual, 45 s competitive | None |

Ranked, Daily and Endless use the **competitive** rules; Free Play uses **casual**; parties choose. Ties on a leaderboard go to whoever used less time.

## Scoring and answer recognition

Every car is worth 10 points. Players type the car into one box ("Porsche 918 Spyder", "918", "R34 GT-R"), plus a year box (kit rounds: tuner plus car). The scorer (`public/scoring.js`) reads the answer against an index of every vehicle in the database. Only the server's result counts.

| Cars | Points |
|---|---|
| Make | 2, typed or implied by the model ("918" means Porsche) |
| Model | 5 for an answer that identifies the car. 3 for the right model with the trim or generation missing, or a name that fits several cars. 1 for a designation that's part of the name but identifies nothing (Spyder). |
| Year | 3 for any year the car was built (`yearRange`). Casual: 2 within 2 years, 1 within 5. Competitive: 1 within 2 years. |

| Body kits | Points |
|---|---|
| Tuner | 6 (typed in the tuner box or the car box) |
| Make | 2 |
| Model | 2, or 1 for the right model with the trim or generation missing |

### How an answer is read

Each vehicle is an identity: make, model, trim (`variant`) and generation. Every identity carries verified names: the canonical name, model, trim and generation aliases, and chassis codes. A stock car and the same car under a body kit share one identity. Different generations don't: an E46 M3 and a G80 M3 are separate vehicles.

- **Identifying words can be dropped** if what's left still points to exactly one vehicle. "918" is the 918 Spyder, "GT3 RS" is the 911 GT3 RS, "SVJ" is the Aventador SVJ, "R34" is the Skyline GT-R R34.
- **Qualifiers can't be dropped.** Trims, designations and generation marks separate real cars: "GT3" isn't a GT3 RS, "M4" isn't an M4 Competition, "Civic" isn't a Civic Type R. Those earn 3.
- **Designations never identify on their own.** Spyder, RS, Nismo, Quadrifoglio and similar could be dozens of cars. They earn 1 when they're part of the right name. "Porsche Spyder" for a 918 Spyder scores make 2 plus model 1.
- **Shared names are partial.** "Supra" could be the A80 or the A90, and "Skyline" could be the R32, R33 or R34. The feedback lists the options and says which one it was. A stated make settles names shared across makes, so "Pontiac GTO" isn't the Mitsubishi GTO.
- **Other cars earn nothing.** "Porsche 911 Spyder" for a 918 Spyder scores the make only. Naming two cars at once ("Civic Integra") earns nothing for the model, and a second trim stuffed into an answer caps it at partial.
- **Unknown words are ignored.** A car that isn't in the database is never the answer, so extra words can't help a guess.
- **Formatting is forgiven:** case, accents, spacing and hyphens ("GT 3 RS", "918Spyder", "GT-R"), Spider/Spyder, Mk4/MkIV/Mark 4. A year typed in the car box counts when the year box is empty.
- **The rule sets differ only in spelling and years.** Casual forgives one slip in a word of six letters or more. Competitive forgives none, and digits are never fuzzy-matched.

Every answer gets a feedback line per field, for example:
- "Right model, missed the trim: GT3 RS"
- "That could be the Supra (A80) or GR Supra (A90). This is the Supra (A80)"
- "That's the 911, a different car"
- "Spyder is part of it, but on its own it could be many cars"
- "Porsche, from the model"

`npm test` checks that every car in play has an answer worth full credit in both rule sets. It also checks that every alias is either exact or a reviewed ambiguity, and that no car's full name earns full credit for a different car of the same make.

## How ranked play is protected

- The server holds the answers, runs the clock and keeps score. Nothing in the start or round payload names the car.
- Ranked and party photos are served through `/api/img/<token>`. Wikimedia file names usually spell out the car, so the browser never sees them before the reveal. A token is only issued when its round opens, and the 45-second clock starts when the photo is first served, so slow photo loads don't eat your time. If Wikimedia can't be reached from the server, the proxy redirects to the direct URL so the game stays playable (that one photo is no longer hidden).
- An answer that arrives more than 3 s after the clock ends scores 0. Free skips for photos that fail to load are limited to two per ranked game, and only when the server couldn't deliver the photo.
- Leaderboards only accept finished server sessions, once each. The daily lock is per browser (a hashed random key), so it stops accidents, not someone determined to clear their storage.

## Car database

`src/cars.json`: 307 entries, all in play, 298 distinct vehicles, 84 makes. An entry whose photo turns out to be wrong can be held back with `"excluded": "<reason>"` until it's fixed.

- Eras: 110 from 2010 onward, 63 from 1990–2009, 134 before 1990.
- Difficulty, from how recognisable the car is: 62 easy, 124 medium, 121 hard.
- 59 supercars, 18 cars with a scored trim (`variant`: GT-R Nismo, M4 Competition, 911 GT3 RS, 205 Turbo 16…) and 49 entries with a `generation` (E46, 992, S15, A80, W464…) wherever the database holds more than one generation of a name.
- 25 tuner builds from 13 tuners: ABT Sportsline, Brabus, Hamann, Larte Design, Liberty Walk, Mansory, Novitec, Prior Design, RWB, Rocket Bunny, TechArt, VeilSide, Vorsteiner. Every build is a real one, photographed on the car it was made for.
- Every photo is a Wikimedia Commons file, credited and linked on the reveal (`credit` holds the file name). The server looks up each file's author and licence on Commons and shows them after the round (`src/provenance.js`, see `docs/IMAGE_SOURCES.md`). `npm test` checks every URL's Commons hash path, difficulty, credit and year range.

Entry fields: `id, make, model, variant?, variantAliases?, generation?, generationAliases?, year, yearRange, region, niche, supercar, difficulty (1–3), img, credit, hint`. Optional `modelAliases` and `makeAliases`; tuner builds add `kit` and `kitAliases`.

## Community Garage

Off unless `GARAGE_ENABLED=1`. Full details in `docs/COMMUNITY_GARAGE.md`.

- **Accounts.** Email and password, Google or Discord. 13+ for an account and 18+ to submit. The date of birth isn't stored.
- **Submissions.** Upload, automatic checks, a moderator, then the game. Every photo has a licence and provenance record, and a person reviews it before anyone else sees it.
- **Moderation.** Blur boxes for plates and faces, vehicle matching from the answer engine, casual or all-modes eligibility, reasons the contributor sees, and an audit log.
- **Competitive integrity.** Nobody gets a photo they or any other player in the game contributed, copies included. It's checked when a game is planned and again before each round. Competitive games use community photos only when every player is signed in. The Daily Challenge stays first-party.
- **Reports and copyright.** Reports from the game, immediate takedown while disputed, DMCA-style notices, counter-notices, and a two-strike rule.
- **Before launch.** The contributor licence is a draft awaiting legal review (`public/contributor-licence.html`), and the terms page is an interim summary. Manufacturer press photos were researched and aren't used, because their terms limit them to editorial use (`docs/IMAGE_SOURCES.md`).

## Sound

All sound is synthesised in the browser (`public/audio.js`, Web Audio API). There are no samples, recordings or licensed tracks.

- **Effects:** menu select, photo arrival, correct, partial, wrong, clock warning and final-second ticks, score count, streak (3, 5, 10, 15…), game complete, victory and defeat.
- **Music:** *Monaco* (deep, melodic house, 122 BPM) and *Night Run* (drift phonk, 140 BPM half-time, distorted 808s and a cowbell riff), or no music. Each theme is built from layers (pad, drums, bass, lead, top) that fade in as intensity rises with game progress, your streak and the clock running down, while a filter on the music opens up. Theme and screen changes crossfade.
- **Controls:** master, music and effects volume, music style, mute (also the `M` key). Saved in the browser.
- **Autoplay-safe:** nothing is created until the first click, tap or key press; audio suspends when the tab is hidden.

## Interface

- Desktop: a top bar with Singleplayer and Party menus (hover or keyboard), Leaderboards and How scoring works, plus Community Garage and Sign in when the Garage is on. The game screen puts the photo first with the answer panel beside it; the bar hides during play.
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
| `POST /api/solo/guess` | `{ sessionId, idx, car, year, kit? }` (older `make` + `model` fields still work). Returns per-field feedback, streak, strikes and the answer with generation and photo credit. |
| `POST /api/scores` | Posts a finished ranked session. |
| `GET /api/leaderboard?board=` | `ranked:<playlist>`, `daily:YYYY-MM-DD` or `endless`. |
| `GET /api/img/:token` | Photo proxy for ranked and party rounds. |
| `POST /api/report`, `GET /api/reports` | Bug and crash reports (reading needs `ADMIN_TOKEN`). |
| `/api/auth/*` | Garage only. Sign-up, sign-in, sign-out, email links, profile, closing an account, Google and Discord sign-in. |
| `/api/garage/*` | Garage only. Licence, submissions and uploads, photos, profiles, reports, counter-notices. Moderation lives under `/mod/*` and admin under `/admin/*`. State-changing requests need the `X-VicCall: 1` header. |

Party events over Socket.IO: `party:create`, `party:join`, `party:resume`, `party:settings`, `party:start`, `party:guess`, `party:reveal`, `party:next`, `party:leave`.

## Known limitations

- No human has listened to the music or effects yet. They were checked by rendering offline and measuring levels: no clipping anywhere, and the high-frequency energy rises with intensity in both themes as layers come in. The mix may still need tuning by ear.
- Photos were last looked at by eye on 24 October 2026. `npm test` checks file names and hash paths, not what a photo shows, so a new or changed photo needs a look. The cloud sandbox can't reach Wikimedia; a session on a computer can.
- No free-licensed photos were found for Top Secret, Varis or newer Prior Design builds, so those tuners aren't in the game yet.
- Scores from before the expansion used a 50-point scale and the old mode names. They stay in the scores file but aren't shown on the new boards.
- Leaderboards survive restarts only with `SCORES_GITHUB_TOKEN` set, or on a persistent disk. Scores posted in the 15 seconds before a crash (not a normal restart) can be lost.
- Personal bests live in the browser only, also for signed-in players. Accounts are only used by the Community Garage.
- The Community Garage has never run on the production server, and Google and Discord sign-in, Resend email and the Commons credit lookup have only been tested against stubs. Its own limitations are listed in `docs/COMMUNITY_GARAGE.md`.

## Updates

See `CHANGELOG.md` for the full record.

- **2026-10-24, photo check:** every photo looked at; 10 replaced (wrong car, a logo, interiors, a speck on a track), 9 entries corrected to match their photos, and the 6 held-back cars back in play.
- **2026-10-24, staying power:** leaderboards backed up to GitHub, keep-awake on the free plan, a start-up photo proxy check.
- **2026-10-20, Community Garage** (off until switched on): accounts, photo submissions with automatic checks, moderation, competitive exclusion of contributors' photos, reports and copyright handling, first-party photo credits from Commons.
- **2026-10-20, answer recognition:** one answer box, a vehicle index with generations, shorthand and implied makes, ambiguity handling, data audit.
- **2026-10-19, game expansion** (branch `game-expansion`): 10-point scoring with casual and competitive rules, 302-car database with difficulty tiers and 25 tuner builds, Daily / Ranked / Endless / Free Play modes, photo proxy, desktop-first interface, synthesised sound effects and music.
- **2026-10-17, overnight polish** (branch `overnight-polish`): visual identity, shared scoring, server-held answers, party hardening. See `OVERNIGHT_CHANGELOG.md`.
- **2026-07-18 to 07-19:** prototype, leaderboard, party codes, Supercars, Kit Check, bug reports, USA roster.
