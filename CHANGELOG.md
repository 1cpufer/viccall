# Changelog

## 2026-10-24: Every photo checked

All 301 photos then in play were downloaded from Wikimedia, exactly as the game requests them, and looked at against their answers. Earlier sessions couldn't reach Wikimedia. Every URL loads without the fallback.

- **Wrong car, replaced.**
  - Mazda MX-5 (NA): the photo was a current ND.
  - Cadillac Eldorado (1959): the photo was a 1967 Eldorado.
  - Peugeot 306: the "photo" was the 306 wordmark logo, which spelled out the answer.
  - Pontiac GTO (1966): two GTOs in one photo, the nearer one a 1969.
- **Right car, unusable photo, replaced.**
  - Venturi 400 GT: a speck on a distant track.
  - BMW Isetta and AMC Javelin AMX: interiors only.
  - Lincoln Continental Mark III: a close-up of the grille. Its hint ("suicide-door") described the 1961 Continental, and was rewritten.
  - Chevrolet Nova SS: a night shot of the supercharger.
  - Iso Grifo: a black-and-white shot of the A3/C race car, which looks nothing like the road car.
- **Replacements** are CC BY, CC BY-SA or public domain (the `src/provenance.js` test), at least 2,400 px wide, and have no plate or sign that gives the answer away.
- **Right car, details corrected to match the photo.**
  - Lancer Evolution: the photo is a 2005 Evo IX, so the entry is now the IX (2005–2007).
  - Triumph Spitfire: a Spitfire IV, now 1970–1974.
  - Tesla Model S: the 2016 facelift, now 2016–2021.
  - TechArt Panamera: the Grand GT on the first-generation Panamera (970), not the second. Years 2009–2016, alias 970, hint.
  - Larte Design QX60: the first-generation L50 (2014–2020). 2025 was when the photo was taken.
  - Production-year ranges where the photo shows a different year of the same car: Mustang Mach 1 (a 1970), Peugeot 205 GTI (1989), Honda Prelude (1990), Toyota Soarer (1988), plus the new MX-5, 306, Isetta and Grifo photos.
- **The six held-back cars are back**, so all 307 entries are in play. Each has a new photo of the right car, chosen like the replacements above:
  - Subaru Impreza WRX STI: a GC8 type RA STi, without the STi bumper decals. Range 1994–2000.
  - Mini Cooper: a 1968 Austin Mini Cooper S. Year 1968, range 1961–1971 (the id still says 1959).
  - Mazda Cosmo: the Eunos Cosmo at the Mazda Museum. Range 1990–1996.
  - Opel GT: a 1969 GT 1900 with no plate in view. Two other good photos had plates reading "GT 68H" and "GT72H". Range 1968–1973.
  - Renault 4: an early 4L in a museum. Range 1961–1994: it was built for 33 years with few visible changes.
  - Peugeot 205 Turbo 16: a road car in Gris Winchester. Range 1984–1985. Another road car had a "205 T16" plate.
- **Trims, so short answers score like the rest of the game.**
  - The STI is now the Impreza with trim WRX STI (generation GC8). "Subaru Impreza" was earning full credit; it's now "Right model, missed the trim".
  - The 205 Turbo 16 and 205 GTI are now the 205 with trims Turbo 16 and GTI. "Peugeot 205" was full credit for the Turbo 16, and for the GTI it said "that's the 205 Turbo 16".
  - The 2015 WRX STI (VA) loses the alias "Impreza WRX STI". The VA was only ever sold as the WRX STI, and the name now belongs to the GC8. "WRX STI" and "STI" are partial for both and name the two options.
- **Licences.** `src/provenance.js` run against all 307 photos: 307 usable, none to review.
- **Tests.** The Evo generation test now uses the IX as the sibling generation that's in the game. The photo-skip test guessed "Ferrari" and failed whenever the third Endless car happened to be one; it now checks only the skipped rounds.

## 2026-10-24: Leaderboards that stay, and no more sleeping

- **Leaderboards survive restarts** (`src/scores-backup.js`).
  - With `SCORES_GITHUB_TOKEN` set, scores are kept in a private gist on GitHub as well as on the server.
  - They're restored when the server starts, saved 15 seconds after a new score, and saved again on shutdown.
  - Nothing is saved until a restore has succeeded, so a GitHub outage at start-up can't wipe the saved boards; the restore retries every minute.
  - Boards keep their top 100. Daily Challenge boards are now cleared after 30 days.
- **Keep-awake** (`src/keep-awake.js`). On Render the server requests its own `/api/health` every 10 minutes, so the free instance no longer sleeps: no one-minute wait for the first visitor, and no reset from sleeping. This uses about 744 of the 750 free hours a month.
- **Photo proxy check.** On start-up the server fetches one ranked photo through its proxy and logs whether it worked.
- **Tests:** 5 new (93 total), with a stand-in GitHub API.

## 2026-10-20: Community Garage (branch `game-expansion`, switched off by default)

Off unless `GARAGE_ENABLED=1`. Every game mode still works without an account. Full write-up: `docs/COMMUNITY_GARAGE.md`.

- **Accounts** (`src/auth.js`, `src/db.js`, `src/mailer.js`).
  - Sign-in: email and password (scrypt), Google (PKCE) and Discord.
  - Sessions: HttpOnly session cookies, of which only a hash is stored. State-changing requests need an `X-VicCall` header.
  - Email: confirmation and reset links through Resend.
  - Age: 13+ for an account and 18+ to submit. The date of birth is asked once and not stored.
  - Admins come from `ADMIN_EMAILS` and appoint moderators.
  - Closing an account deletes personal details and removes that person's photos.
- **Submissions** (`src/garage.js`, `src/photos.js`).
  - Gate: contributor licence acceptance (versioned), six declarations per photo, 20 a day and 25 waiting at once.
  - Refused outright: wrong format, over 15 MB, under 1200 × 700, damaged file.
  - Flagged for moderators: dark, blurry, heavily compressed, AI or C2PA metadata, location data, no camera data.
  - Originals are stored privately. Players get WebP copies with metadata stripped and blur applied.
  - Duplicates: SHA-256 plus crop-aware difference hashes. Everyone with a claim on any copy is linked to all copies.
- **Moderation.** Review queue, blur boxes, vehicle suggestions from the answer engine plus search, year, difficulty, casual or all-modes eligibility, approve, ask for a correction or reject with a reason, removals, an audit log, and admin roles and suspensions.
- **Community photos in games** (`src/pools.js`).
  - The rule: approved photos for the ruleset, minus photos any participant contributed.
  - Competitive games need all-modes, unflagged photos and every player signed in. The Daily Challenge stays first-party.
  - Each round re-checks its photo before it's shown and swaps in a first-party photo if needed. One-time photo links check again when fetched.
- **Credit and profiles.** The photographer's name, or "Community photographer", appears after the round. Public profiles show approved photos and badges, and the place or event only by choice.
- **Reports and copyright.**
  - Reports from the game need no account.
  - Automatic effects: copyright and privacy reports pull a photo from all play at once; wrong-car reports pull it from competitive play.
  - Moderators dismiss, fix (re-blur, correct the car) or uphold.
  - Copyright notices collect the 512(c)(3) elements. After an upheld complaint the original is kept for a 30-day counter-notice window, then deleted.
  - Counter-notices, reinstatement (casual only) and a two-strike rule.
- **First-party photo credits** (`src/provenance.js`).
  - Lookup: authors and licences as stated on Wikimedia Commons, fetched in batches, saved, and refreshed weekly in production.
  - Display: shown after each round, with a link to the licence.
  - Review: non-commercial or unclear licences are listed for an admin.
- **Manufacturer media researched, not used.**
  - Porsche, BMW, Toyota/Lexus and Ford press terms limit photos to editorial or press use and require written permission for anything else.
  - Findings and how a licensed source would be added are in `docs/IMAGE_SOURCES.md`.
- **Client** (`public/garage.js`).
  - Sign-in and sign-up dialog, finishing a Google or Discord account, account settings.
  - Garage screens: add a photo with upload progress, your photos with statuses and reasons, corrections, withdrawal, counter-notices.
  - Public profiles and the moderation screens.
  - The report button asks what's wrong when the Garage is on.
  - Pages: the contributor licence draft (`/contributor-licence.html`) and an interim terms summary (`/terms.html`).
- **Dependencies.** `sharp` 0.35.5, which clears the high-severity advisories in the image libraries it bundles (libvips, libheif, librsvg). `npm audit` reports no vulnerabilities.
- **Small fixes.**
  - A menu opened by hovering no longer closes when it's then clicked.
  - The Daily Challenge tops up a short difficulty tier instead of coming up short (only with small car lists).
  - A teen account can't re-enter a different date of birth.
- **Tests:** 88 unit and integration tests, 38 of them new.
  - `garage.test.js`: uploads, checks, moderation, duplicates, removal and limits.
  - `integrity.test.js`: exclusion in real solo and party games, plus a 10,000-case property test. Mutation-checked: the suite fails if the exclusion or the per-round recheck is removed.
  - `community.test.js`: credit, profiles, reports, copyright and provenance.
  - Browser: a new `e2e/garage.e2e.js` with 60 checks, including axe-core on each new screen. The existing 73 UI and 13 party checks still pass.
- **Not done yet:**
  - Never deployed.
  - Real OAuth apps, the email key and the live Commons lookup are untested.
  - The licence awaits legal review, and full terms aren't written.
  - Moderators can only approve cars already in the database.

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
