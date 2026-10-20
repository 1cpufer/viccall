# Browser end-to-end checks

These scripts drive real Chromium through the game. They're kept out of `npm test` so the normal test run needs no browser. Each starts its own server in-process (ports 3300 and 3200), gives the photo proxy a stub upstream that returns `fixtures/stand-in-car.jpg`, and answers direct Wikimedia requests from the browser with the same image, so no network is needed.

```
npm i --no-save playwright && npx playwright install chromium
node e2e/ui.e2e.js [screenshotDir]   # defaults to e2e/shots
node e2e/party.e2e.js
node e2e/garage.e2e.js [screenshotDir]          # AXE=/path/to/axe.min.js also runs axe-core
```

- `ui.e2e.js`:
  - **Desktop:** nav menus (hover, arrow keys, Esc), Free Play filters and live count, direct photos, the empty-guess message, perfect and partial answers, blank-field feedback, Commons credit, the leave-game dialog, a 15 s clock auto-submitting a typed answer, a full ranked JDM game with opaque photo URLs, posting a score and personal best, leaderboard tabs, a kit round with tuner and car boxes, a shorthand answer (the shortest name that identifies the car) earning full make and model credit, the Daily Challenge (post, home summary, practice rerun), Endless lives, sound settings persisting and `M` to mute, the scoring page, the back button and a car report.
  - **Phone:** the hamburger menu, the thumbnail-to-original photo fallback, progress pips and a full round.
  - **Party:** host settings, an invite link, a playlist change reaching the guest, opaque photos, the reveal, refresh-resume and final standings.
- `party.e2e.js`: a three-player Body Kit party, the server timer reveal, the host closing the tab mid-reveal, auto-submitting a typed answer at the buzzer, refreshing on the final screen, play again with scores reset, the leave confirmation, and leaving with the back button.

- `garage.e2e.js`: starts a server with the Community Garage on and a small car list. It covers:
  - Accounts: sign-up validation and the confirmation link.
  - Submitting: the licence, an upload with every declaration required, and a pending photo that stays private.
  - Moderation: the queue, a blur box drawn by dragging, and approval.
  - In the game: the photographer's credit after a round and the public profile.
  - Reports: a privacy report and its fix with another blur; a copyright complaint, upheld, then the contributor's counter-notice and reinstatement.
  - Account: anonymous credit, signing out and back in.
  - Phone: the account menu and the submit form.

Each line prints `PASS` or `FAIL`; `ui.e2e.js` ends with a page-error count and exits non-zero on any failure.
