# Changelog

## 2026-10-20: Answer recognition (branch `game-expansion`)

- **One answer box.** Players type the car the way they'd say it ("Porsche 918 Spyder", "918", "R34 GT-R"), plus the year. Kit rounds take the tuner and the car, and the tuner can also go in the car box. The API takes `car`, and the old `make` and `model` fields still work.
- **Vehicle index** (`buildIndex` in `public/scoring.js`). Every answer is read against all 298 vehicles, not just the one on screen.
  - Identifying words can be dropped if the rest is still unique ("918", "GT3 RS", "SVJ").
  - Qualifiers can't be dropped: GT3 isn't a GT3 RS.
  - Designations alone earn a 1-point hint (Spyder).
  - Shared names earn partial credit, and the feedback lists the options ("Supra": A80 or A90).
  - A stated make settles names shared across makes.
  - Naming two cars earns nothing. Words outside the database are ignored.
  - The make is implied by an unambiguous model.
  - Formatting variants are normalised (GT 3 RS, 918Spyder, Spider/Spyder, Mk4/MkIV/Mark 4).
  - A year typed in the car box counts.
- **New feedback lines.** "Right model, missed the trim: GT3 RS", "That could be the Supra (A80) or GR Supra (A90)", "That's the 911, a different car", "Porsche, from the model".
- **Data audit** (`src/cars.json`).
  - New `generation` and `generationAliases` fields on 48 entries, wherever the database holds more than one generation of a name (M3 E46/G80, 911 G-body/964/993/997/992, Civic Type R EK9/FK8/FL5, Silvia S14/S15, Supra A80/A90, G-Class W460/W464 and others). Before this, an E46 M3 photo gave full credit for "G80".
  - Fixed wrong aliases:
    - Rocket Bunny Silvias tagged as both S14 and S15.
    - "Aventador" as an exact alias of the Aventador S.
    - "AMG GT R" on the Black Series.
    - "BRZ" on a Toyota GT86.
    - "V8 Vantage" on the 2018 Vantage.
    - "Range Rover" as a make.
  - Redundant squashed aliases removed (GT3RS, TurboS, GT4RS). The scorer now handles spacing itself.
  - Aventador S and G 63 restructured as trims. The Evo VIII and Evo X became generations.
  - Held back the "1999 Impreza WRX STI": its photo is a 2023 Impreza (GU). Six entries are now held back.
- **Tests:**
  - New recognition suite with 20 tests, including the 918 Spyder table.
  - Whole-database guarantees: every car has a full-credit answer in both rule sets; aliases are exact or reviewed ambiguities; no car's name earns full credit for another car of the same make.
  - The browser run gained a shorthand check through the real UI. 50 unit, 73 UI and 13 party checks pass, and axe-core reports no violations.

### Known limits

- Ambiguity is judged against this database. "Spyder" is always generic, but a nameplate is only ambiguous if two vehicles in the database share it. Adding cars can turn a full-credit answer into a partial one, which is the intended behaviour. The test suite reports every such collision.
- The game doesn't ask "Which one did you mean?". Competitive scoring has to be deterministic, so an ambiguous answer earns partial credit and the feedback names the options instead.
- "Alpine A110" is shared by the 1961 original and the 2017 revival. "A110 Berlinette" and "A110 Pure" each identify one of them.

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
