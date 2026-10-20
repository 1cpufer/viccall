# Image sources and rights

Every photo VicCall shows needs a record of where it came from and what it may be used for. This page lists the sources the game uses, how each is recorded, and the sources that were researched but not used.

## In use

### Wikimedia Commons (first-party photos)

All 301 photos in `src/cars.json` are Wikimedia Commons files. `credit` holds the file name and `img` the file URL.

- **What's recorded.** `src/provenance.js` asks the Commons API what each file page states: author, licence short name, licence URL, whether attribution is required. Lookups go in batches of 50.
- **Where it's saved.** `DATA_DIR/commons-meta.json`. When the Garage is on, it's also saved as one `images` row per photo (`id = commons:<car id>`, `source = 'commons'`) with the evidence: page URL, fetch time, and "Wikimedia Commons file page".
- **When it runs.** The production server checks on start-up and daily, and asks Commons again when the saved copy is missing or a week old. Admins can also run it from **Moderation → Photo credits**. Set `COMMONS_META=0` to turn this off.
- **Credit.** After each round the game shows the author and licence, linked to the file page and the licence text. It falls back to the file name until the lookup has run.
- **Review.** A photo is listed for review if its stated licence is non-commercial (marked `restricted`), has no-derivatives terms, is unrecognised, or the file is missing.
- **What it isn't.** This is what Commons states on the date it was fetched, not independent legal verification. It hasn't run against live Commons yet, because the development sandbox can't reach it. It's tested against a stubbed API in `test/community.test.js`.

### Community Garage (contributed photos)

Each community photo has an `images` row with:

- `source = 'community'` and `source_ref = upload:<submission id>`
- the contributor, and `licence = 'VicCall Contributor Licence 0.1-draft'`
- `licence_evidence` pointing to the contributor's licence acceptance and the submission, which holds the six declarations they confirmed and when
- every moderation action, in the audit log

Moderators can read the whole record at `GET /api/garage/mod/images/:id/provenance`. The licence is a draft: no real uploads should be accepted until it has had legal review (see the launch checklist in `docs/COMMUNITY_GARAGE.md`).

## Researched, not used: manufacturer press sites

Manufacturer media sites have excellent, accurately labelled photos. The terms of use checked restrict them to editorial or press use, and require written permission for anything else. A commercial game, even a free one, isn't editorial use. **None of these images are in the game, and none should be added without a written licence.**

Checked on 20 October 2026:

| Site | What the terms say | Status |
|---|---|---|
| Porsche Newsroom | "Intended exclusively for use by journalists as a source for their own media reporting", "not intended for commercial use"; any other use "must be approved beforehand by Dr. Ing. h.c. F. Porsche AG". ([terms](https://newsroom.porsche.com/en/images-videos/porsche-newsroom-terms-and-conditions.html)) | Requires written permission |
| BMW Group PressClub | Material "must be used for press purposes exclusively"; contents "may not be copied, distributed, altered or made accessible to third parties for commercial purposes". Some images belong to third parties. ([legal notice](https://www.press.bmwgroup.com/new-zealand/info/legal)) | Requires written permission |
| Toyota / Lexus pressroom | "These materials are for editorial use only. They may not be copied for commercial use or distribution, nor may these materials be modified"; any other use "requires the prior written consent of Toyota". Read from the Lexus copy of the notice; the Toyota page didn't load from here. ([Lexus terms](https://pressroom.lexus.com/terms-agreements/), [Toyota terms](https://pressroom.toyota.com/terms-agreements/)) | Requires written permission |
| Ford Media Center | Media is "provided for the purpose of editorial use only"; "any commercial use of this material without express written permission from Ford is prohibited". Contact for photo use: fromtheroad@ford.com. ([terms](https://www.fromtheroad.ford.com/us/en/terms-and-conditions)) | Requires written permission |

Other manufacturers weren't checked one by one. Assume the same restrictions until their terms say otherwise.

No manufacturer portal was scraped, and no login-only area was accessed.

## Adding a licensed source later

If a manufacturer, agency or photographer grants permission in writing:

1. Keep the signed agreement somewhere durable, and note the location.
2. Add each image as an `images` row with these fields:
   - `source = 'manufacturer'` (or `'licensed'` or `'commissioned'`)
   - `source_ref`: the original URL or asset ID
   - `photographer` and `attribution`: exactly as the agreement requires
   - `licence`: a short name for the agreement
   - `licence_evidence`: where the agreement is kept
   - `permission_at`: when permission was granted
   - `expires_at`: if the licence ends
   - `restrictions`: territories, modes, no cropping and so on, as JSON
   - `commercial_ok`
3. Make the image `competitive` only if the agreement allows every mode, and `restricted` if anything is unclear.

Game rounds currently draw from `src/cars.json` (Commons) and from approved community photos. A third pool for licensed images would plug into the same eligibility function, `src/pools.js`.
