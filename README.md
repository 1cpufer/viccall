# VicCall

Vehicle Identification Call — a car-guessing game. You're shown a photo and have to call the make, model, and year (or, in Kit Check mode, the tuner behind the body kit). Play solo across several modes, race the clock, or spin up a real-time party with friends.

## Running it

```
npm install
npm run dev    # or: npm start
```

Serves on `http://localhost:3000` (override with `PORT`).

## Game modes

- **Worldwide** — random cars from every region.
- **Regional** — Japan, Germany, USA, France, Italy, or UK.
- **Niche** — obscure builds only.
- **Supercars** — exotic icons only.
- **Time Attack** — 30 seconds per car.
- **Kit Check** — name the tuner/body kit on a modified car (Liberty Walk, RWB, Rocket Bunny, and more).
- **Party code** — create or join a room and play the same round together in real time.

Scores save to a per-mode leaderboard.

## Updates

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
