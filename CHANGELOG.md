# Changelog

## 2026-10-19: Game expansion (branch `game-expansion`)

Built on `overnight-polish`. Commits, oldest first:

1. **Scoring v2** (`aa9cd62`)
   - Every car is worth 10: make 2, model 5, year 3. Body kits: tuner 6, make 2, model 2.
   - Two rule sets. Casual forgives one typo in words of 6+ letters and gives part of the year points within 2 and 5 years. Competitive forgives no typos and gives part of the year points within 2 years only.
   - Partial model credit (3 of 5) for a missing trim (`variant`) or a wrong generation.
   - Anti-hedging: extra words must be trims, not other models. Short fragments and shared letters score nothing. A generation code that belongs to a different car caps the model at partial credit.
   - Per-field feedback notes: "Right model, missed the trim: Competition", "Off by 2 (2019–2024)", "It's the …".
   - Year ranges: any production year is exact.
2. **Database** (`8987d6c`)
   - 307 entries (302 in play), up from 220, including 75 modern cars.
   - Difficulty tier on every car, from how recognisable it is.
   - 12 new tuner builds: VeilSide, TechArt, Mansory, Brabus, Liberty Walk, Rocket Bunny, RWB, Novitec. Every build is a documented one on the car it was made for.
   - Commons credit on every photo. Integrity tests cover hash paths, credits, difficulty and year ranges. Five entries with the wrong photo are held back.
3. **Game modes and photo proxy** (`9ec5ac8`)
   - Daily Challenge, seven ranked playlists, Endless and Free Play (`src/modes.js`), plus per-board leaderboards with time-used tiebreaks.
   - Rounds open one at a time (`/api/solo/round`). Answers include the variant and photo credit.
   - Opaque photo URLs for ranked and party play (`src/images.js`). The clock starts when the photo is served, and the proxy falls back to a redirect if Wikimedia is unreachable.
   - Party hosts choose playlist and rules. Hardened against prototype-key lookups.
4. **Desktop interface, sound and docs** (this commit)
   - New client (`public/index.html`, `style.css`, `app.js`).
   - Top bar with Singleplayer and Party menus. The home screen leads with the Daily Challenge, then the ranked playlists as a timing tower and a Free Play builder with a live car count.
   - The game screen puts the photo first with a side answer panel. Kit rounds now ask for the make and model as well as the tuner; before this, the browser only sent the tuner, so kit rounds were capped at 6.
   - Results show stats, personal bests and a credited logbook. Leaderboards are tabbed per board. Added a How scoring works page and a leave-game confirmation.
   - Keyboard: Enter, Esc and M, plus arrow keys in menus.
   - Synthesised sound (`public/audio.js`): 12 effects and two music themes, Monaco (deep house) and Night Run (drift phonk). Layered intensity tied to progress, streak and clock, with crossfades, volume and mute controls, saved settings and autoplay-safe start.
   - `/api/pool` gives Free Play counts. Photo-failure skips are limited in ranked games. Spec-R, Type-R and Spec-C spellings count as trims.
   - Fixed: on a party rematch, the standings and your score showed the previous game's totals until the next update. The round-start player list is now used.
   - Browser tests rewritten for the new client: 72 checks across desktop, phone and a two-player party, plus 13 party edge-case checks. The rematch check now fails without that fix. Both scripts run their own server with a stubbed photo upstream. axe-core reports no violations.

### Verified

- `npm test`: 47 passing.
- `e2e/ui.e2e.js`: 72 passing, no page errors.
- `e2e/party.e2e.js`: 13 passing.
- axe-core: no violations on any screen at 1440 px and 390 px.
- Audio: offline renders show no clipping in any theme or effect. High-frequency energy rises with intensity, so the layers work. No AudioContext is created before the first gesture.

### Not done / planned

- Listening tests for the music and effects. They are measured, not yet heard.
- A look at every photo. Wikimedia isn't reachable from the dev sandbox.
- Top Secret, Varis and newer Prior Design builds: no free-licensed photos found.
- Optional accounts and cross-device personal bests. The modes are built so these can be added without changing play.
- Manufacturer playlists (e.g. "Porsche only") as a ranked option. Free Play covers regions today.
- Persistent storage on the host. Render's free disk resets on deploy.
