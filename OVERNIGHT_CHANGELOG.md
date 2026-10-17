# Overnight changelog

Concise record of changes made on `overnight-polish`. Newest at the bottom.

- **Scoring:** one shared alias-aware scorer for solo and party. Accepts common make nicknames, model aliases, chassis codes, trim extras, small typos, and two-digit years. "Close" model answers earn 1 pt. Party Kit Check is now scored.
- **Data:** stable car ids and alias lists for about 110 cars.
- **Tests:** added `npm test` (node:test), with no new dependencies.
- **Server:** solo games are server sessions (answers stay on the server, Time Attack is enforced), and the leaderboard only accepts finished sessions. `/api/cars` was replaced by `/api/meta`. `/api/reports` is owner-only (`ADMIN_TOKEN`). Added atomic writes, rate limits and security headers.
- **Party:** added Kit Check and Time Attack, a server round timer, resume after refresh or disconnect, host handoff, no ghost players, invite links, scores hidden until the reveal, and payload validation and flood control.
- **Design:** racing green and plate yellow, with self-hosted Saira type and a number-plate logo and party code. Uses inline SVG icons; the CDN, the broken canvas and the floating popup are gone.
- **UX:** inline reveal with staggered score chips, a score count-up, a 10-segment progress strip, a results logbook, share result, an own-row highlight, back-button support, and a connection-lost banner.
- **Motion:** pointer carousel with flick and rubber-band, deadline-based clocks, reduced-motion support.
- **Accessibility:** labels, focus rings, keyboard carousel, aria-live reveals, focus moved per screen. axe reports 0 violations.
- **Performance:** 960px photos with fallback, next photo preloaded, fonts preloaded and cached for 7 days.
