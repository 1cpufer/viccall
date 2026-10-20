# Community Garage

Players photograph cars they've seen and submit them to the game. A moderator checks every photo before anyone else sees it, and the server makes sure nobody gets their own photos in a competitive game.

**Status:** built and tested (unit, integration and browser tests below), but **switched off in production**. It needs a persistent disk, sign-in credentials and the legal checklist at the end of this page first.

Accounts exist only for this. Every game mode still works without one, and nothing asks players to sign up to play.

## Switching it on

| Variable | Purpose |
|---|---|
| `GARAGE_ENABLED=1` | Turns on accounts, the Garage and community photos in games. Off by default. |
| `PUBLIC_URL` | The site's public address, e.g. `https://viccall.onrender.com`. Used in email links and sign-in redirects. |
| `ADMIN_EMAILS` | Comma-separated emails that become admins once confirmed. Admins appoint moderators in **Moderation → People**. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. "Continue with Google". Redirect URI: `PUBLIC_URL/api/auth/oauth/google/callback`. |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Optional. "Continue with Discord". Redirect URI: `PUBLIC_URL/api/auth/oauth/discord/callback`. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email for address confirmation and password resets, through Resend. Without them, links are only written to the server log. |
| `COMMONS_META=0` | Optional. Stops the weekly check of first-party photo credits on Wikimedia Commons. |

The database (`garage.db`, SQLite via Node's built-in `node:sqlite`, Node 22.13+) and the photos (`garage/`) live in the `data/` folder. On Render that folder must be on a persistent disk mounted at `/opt/render/project/src/data`, or every deploy wipes accounts and photos. At the time of writing, disks need a paid instance (the cheapest is $7 a month) and cost $0.25 per GB a month.

## How a photo gets into the game

`Draft → Pending review → Approved | Needs correction | Rejected`, and `Removed` at any point.

1. **Account.** Email and password, Google or Discord. Accounts are 13+.
   - The date of birth is asked once and not stored; only "18 or over" is kept.
   - Submitting needs 18+, a confirmed email and the contributor licence.
2. **Details and declarations.** The contributor confirms the six statements in section 5 of the licence. Up to 20 submissions a day, and 25 waiting at once.
3. **Upload checks** (`src/photos.js`).
   - Refused outright:
     - not a JPEG, PNG or WebP (HEIC gets a hint)
     - over 15 MB
     - under 1200 × 700 pixels
     - unreadable or truncated
   - Flagged for the moderator but accepted:
     - very dark or bright
     - blurry (variance of the Laplacian)
     - heavily compressed (often a re-saved social media copy)
     - AI-generation or C2PA markers in the metadata (also blocks competitive use until cleared)
     - location data present
     - no camera data
4. **Copies.** The original is stored privately. Players get WebP copies at 1600, 960 and 480 px: rotated upright, metadata stripped, blur applied.
5. **Duplicates.** Each upload gets a SHA-256 and seven 64-bit difference hashes: the whole frame, the centre at 85% and 70%, and the four corners at 85%. That catches copies, resizes, re-compressions, light edits and most crops.
   - The same contributor re-uploading the same photo is refused.
   - A match with someone else's photo is flagged, and both people are linked to both photos (see competitive rules).
   - Approving a likely copy needs an explicit confirmation.
6. **Moderation** (Moderation → Review queue).
   - The moderator sees the photo, the original, automatic notes, any possible copy, the contributor's record and suggested vehicles. Suggestions come from running the contributor's description through the answer-recognition engine.
   - They drag to blur plates and faces, choose the vehicle, year and difficulty (1–5), choose "all modes", "casual only" or "keep out of play", and approve, ask for a correction or reject.
   - Rejections and corrections need a message, which the contributor sees.
   - Moderators can't review their own photos. Every action goes in the audit log.
7. **In the game.** Approved photos join the round pool alongside the first-party photos. The photographer is credited after the round, or as "Community photographer" if they chose that. Public profiles show approved photos and badges, and the place or event only if the contributor opted in.

Rejected photos have their files deleted straight away; the record and fingerprints stay. Contributors can withdraw or remove a photo at any time, and it leaves the game immediately. Closing an account removes all of that person's photos the same way.

## Competitive integrity

```
eligible = approved photos for this ruleset − photos contributed by any participant
```

One function decides this for every mode: `communityAllowed` in `src/pools.js`.

- **Contributors** are everyone linked to a photo: the uploader, plus anyone who uploaded a copy of it, and the reverse.
- **Competitive games** (Ranked, Endless, competitive parties) only use photos marked "all modes" that aren't flagged or disputed. They use them only when every participant is signed in, because an anonymous player could be the photographer. Their games use first-party photos only.
- **The Daily Challenge** never uses community photos, so it stays the same ten cars for everyone.
- **Casual games** use any approved photo except the player's own.
- **When it's checked:**
  - when the game is planned
  - when each round opens, against the photo's current state and the current players (a removal, a new flag or report, or someone rejoining a party signed in as the photographer)
  - when the photo is fetched through its one-time link
- **What happens when a check fails.** The round gets a first-party photo instead. If there were none, the game would end rather than show the photo.
- **Missing records.** A photo whose record can't be read is never shown.

Tests: `test/integrity.test.js`. It runs real solo and party games against a small car list, so community photos come up constantly, and checks every photo actually handed out. It includes a 10,000-case property test of the rule. Mutation checks confirm the tests fail if either the exclusion or the per-round recheck is removed.

## Reports, takedowns and counter-notices

- **Reports.** "Report this car" after any round, no account needed, 10 an hour per IP. Reasons: wrong car, plate or face visible, poor photo, copyright, or a game bug.
- **Automatic effects:**
  - A copyright or privacy report takes a community photo out of all play at once.
  - A wrong-car report takes it out of competitive play.
  - The moderator then dismisses the report (the photo returns), fixes it (re-blur, correct the vehicle), or upholds it (the photo is removed).
- **Copyright complaints** collect what a DMCA notice needs: name, email, the original work, both statements, and a typed signature. An upheld complaint:
  - removes the photo
  - tells the contributor why
  - keeps the original privately for 30 days so it can be reinstated after a counter-notice
  - then deletes the original automatically
- **Repeat infringers.** Two upheld copyright complaints end a contributor's submission rights.
- **Counter-notices.** The contributor fills them in on Your photos. Moderators mark them forwarded and can put the photo back (casual only). Forwarding to the complainant and waiting out the 10 to 14 business days is done by hand.

## Where things are

| Path | What |
|---|---|
| `src/db.js` | Schema and migrations: users, sessions, identities, licence acceptances, images, contributors, submissions, reports, counter-notices, audit log |
| `src/auth.js` | Accounts, sessions, Google and Discord sign-in, email links |
| `src/photos.js` | Upload checks, fingerprints, display copies |
| `src/garage.js` | Submissions, moderation, profiles, reports, photo delivery, round items |
| `src/pools.js` | Who may see which community photo |
| `src/provenance.js` | First-party photo credits from Wikimedia Commons |
| `public/garage.js` | Sign-in, Garage, profile and moderation screens |
| `public/contributor-licence.html`, `public/terms.html` | Licence (draft) and interim terms summary |

## Scale

This is built for one server: a single SQLite file and local disk.

- Photo processing runs two at a time.
- The duplicate check compares each upload with every stored fingerprint. That's fine into the tens of thousands of photos, then wants an index (a BK-tree or a prefix table).
- The round pool is cached for up to a minute, and every round still re-reads the one photo it's about to show.
- File access goes through a small store interface (`put`, `get`, `remove`), so it can move to object storage.
- More than one server would need Postgres and shared storage.

## Known limitations

- **Duplicate detection:**
  - Mirrored or heavily edited copies, and arbitrary crops, can get past it; moderators and reports are the backstop.
  - First-party photos aren't fingerprinted, so an upload of a Commons photo isn't caught automatically.
- **Vehicles.** Only vehicles already in the car database can be approved. A photo of anything else has to wait for the car to be added.
- **Contributors:**
  - They aren't emailed about decisions; they see the status and reason on Your photos.
  - A display-name or credit change can take up to a minute to show in new rounds.
- **The blur tool** is pointer-first. A keyboard user can add and remove boxes but not position them.
- **Untested against the real services.** Google and Discord sign-in, Resend email and the Commons credit lookup are tested against stubs. None has run against the real service yet.
- **Not deployed.** The Garage has never run on the production server.

## Before real uploads

- [ ] Add a persistent disk and set the variables above.
- [ ] Create the Google and Discord OAuth apps and the Resend key. Verify the sending domain in Resend.
- [ ] Settle the open decisions in the contributor licence draft and have a lawyer review it. Then remove "draft" from `public/contributor-licence.html` and bump `LICENCE_VERSION` in `src/garage.js` if the text changed.
- [ ] Publish real terms of use and a privacy notice in place of `public/terms.html`.
- [ ] Register a DMCA designated agent with the US Copyright Office and put the agent's details in the licence and a copyright page.
- [ ] Appoint at least one moderator besides the admin.
