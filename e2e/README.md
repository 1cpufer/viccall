# Browser end-to-end checks

These scripts drive real Chromium through the game. They're kept out of `npm test` so the normal test run needs no browser.

```
npm i --no-save playwright && npx playwright install chromium
npm start                                   # terminal 1
node e2e/ui.e2e.js http://localhost:3000 e2e/shots run   # terminal 2
node e2e/party.e2e.js                       # starts its own fast-timer server
```

- `ui.e2e.js`: mode carousel drag, regional, a full 10-car solo game, results, save, share, leaderboard, back button, Time Attack clock, Kit Check, the empty-guess message, the photo-size fallback, and a 2-player party (invite link, refresh-resume, reveal, final, host handoff). Screenshots are saved to `e2e/shots/`.
- `party.e2e.js`: a 3-player Kit Check party, the server timer reveal, the host closing the tab mid-reveal, auto-submitting a typed answer at the buzzer, refreshing on the final screen, play again, and leaving with the back button.

Each line prints `PASS` or `FAIL`, and the run ends with `no page errors` when the console stayed clean.
