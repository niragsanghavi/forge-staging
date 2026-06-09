# FORGE — Project Context (CLAUDE.md)

_Last updated: 9 June 2026. Paste at the top of every new session._

---

## WHAT FORGE IS
A competitive, team-based fitness habit tracker for friend groups. People log daily workouts; points accrue individually and per-team; the social pressure of a shared team streak is the core retention mechanic. Dry, witty voice (not gym-bro hype). Web app served via GitHub Pages, Firebase/Firestore backend.

- **Live URL:** https://niragsanghavi.github.io/forge/
- **Staging URL:** https://niragsanghavi.github.io/forge-staging/
- **Repo (prod):** github.com/niragsanghavi/forge
- **Repo (staging):** github.com/niragsanghavi/forge-staging
- **Firebase prod:** forge-25c8c (asia-south1)
- **Firebase staging:** forge-staging (asia-south1, free tier, open rules)
- **Super admin:** append `?superadmin` to URL, PIN `FORGE2026`
- **Admin (per group):** PIN `9090`

---

## CURRENT SCALE (as of 9 June 2026)
- Active groups:
  - **Vandrao nu Todu** (BR0RRU): ~16 players, June 2026
  - **HardCore Gully** (IPJEGE): ~12 players, June 2026
  - **YH60EP**: dead group — pending deletion
- Strategic goal: ~100 retained users with formed habit before wedding season (Nov–Jan)
- Rollout: July = friends & family | August = strangers (social media)
- **Batched release target: ~June 13** (all staging work promoted to prod together)
- Firebase free-tier headroom: ~300–500 active users before reads become a concern

---

## ARCHITECTURE

### Data model — SEASON-SCOPED
groups/{CODE} name, players:[{name}], currentSeasonId, createdAt
groups/{CODE}/seasons/{YYYY-MM} month, year, days, capTarget, vcTarget, minWorkouts, numTeams, teamStreakThreshold, rolesEnabled, roster:[{name, team, role, pin, uid}], foundryGoal (optional — per-season manual goal for The Foundry), status:"active"|"archived", startedAt, endedAt
groups/{CODE}/seasons/{YYYY-MM}/twists/{twistId} enabled + config fields
logs/{auto} groupCode, player, team, role, workouts[], day, month, year, timestamp bonuses_30day/{auto} groupCode, player, month, year flags/{auto} groupCode, logId, player, flaggedBy, month, year, timestamp analytics/baseline-{YYYY-MM} aggregated baseline doc (May 2026 stored as baseline-2026-04 due to old 0-index)

- Group identity is separate from monthly season. Months never bleed.
- `groups.players` = names only. Team+role+pin+uid live on season roster.
- Scoring reads ONLY from `window.season`.
- Rollover = super admin action: archives current, creates next, carries roster forward.

### Files (current working file is index-3.html on staging)
- `index.html` (prod) / `index-3.html` (staging) — all UI + app logic (~2010 lines)
- `scoringEngine.js` — score() + teamTotal()
- `appState.js` — globals, constants, TWIST_LIBRARY, helpers
- `firebase.js` — Firebase init + dual prod/staging config + window.ensureAuth()
- `main.css` — styles, dark + light theme via data-theme attribute
- `sw.js` — network-first service worker (cache version: forge-v1, bump to bust cache)
- `manifest.json` — PWA manifest

### score() return shape
`{wo, base, sb, wb, rb, tb, b30, pen, bossBonus, total, streak, days(Set), fullWeeks}`

### Scoring (canonical rules)
- Base: +5 per logged day
- Individual streak: DISPLAY ONLY, no points
- Perfect week: +10 per complete Mon–Sun week (⚠️ rolling 7-day rule canonical but NOT YET DEPLOYED)
- Team streak: cumulative +1/+2/+3, threshold = ceil(teamSize × teamStreakThreshold ?? 0.6)
- Role bonus (if rolesEnabled): Captain ±10 (capTarget), VC +15/−10 (vcTarget), last day only
- Min-workout penalty: −5 per workout below minWorkouts, last day only
- 30-day bonus: +50, admin-awarded
- Boss Week twist: doubles base for chosen calendar week

---

## WHAT'S COMPLETE (staging, not yet in prod)

### Foundation hardening (all live on staging)
- XSS fix: `esc()` helper, input validation on name/workout fields, ~18 output sites escaped
- Error surfacing: `logErr(where,e)` helper, replaced silent catches
- Roster-race hardening: `toggleGlobalConsent`, `saveRoles`, `submitNewPin` all use `db.runTransaction()`
- Register-branch bug fixed: `submitNewPin` register branch was passing `undefined` entry — fixed to `newPlayerObj`

### Features (all live on staging)
- **Staging environment**: separate Firebase + repo, orange banner, auto-detects via hostname
- **PWA / installable**: manifest.json + service worker + icons (512/192/180px)
- **App-feel**: bottom tab bar (Home/Log/Board/Feed/Global/Admin), page fade-up transition, safe-area padding
- **Toast system**: `toast(msg, type)` — success=green, error=red, default=gold. NOTE: 37 existing `alert()` calls NOT yet converted — deferred
- **After-log celebration**: `celebrateLog(sc)`, `fireConfetti()`, `countUp()`, hype title array, count-up stats animation
- **Super-admin engagement charts**: Chart.js line charts (active people/day, participation %), 7/14/All window toggle, reads live logs + analytics baseline doc
- **The Foundry visual redesign** ("Foundry" theme — iron, molten metal, sparks, heat):
  - Chunk 1: palette overhaul (`--bg:#0c0c11`, `--gold:#d4af37`, `--orange:#ff5a1f` etc.)
  - Chunk 2: animated flame streak indicator ("The Heat") — scales with streak length
  - Chunk 3: personal points + rank hero ("Your Steel") with competitive sting
  - Chunk 4: shared season goal monument ("The Foundry") — rising molten ingots, auto-computed goal with `season.foundryGoal` override field planned
  - Chunk 5: spark burst on log submission (`fireSparks()`)
- **succStats count-up fix**: spans need `id="cuPoints/cuWo/cuStreak"` — confirm applied (see open items)

### Auth (staged)
- Stage 1+2: anonymous auth + PIN set grace flow — live on staging
- Stage 3: PIN enforcement at login — **WRITTEN, NOT DEPLOYED**. Hold until >50% of BR0RRU has set PINs. Check via JSON export (roster entries need `pin` field).

---

## OPEN / NEXT SESSION

### Must-do before June 13 batch release
1. **Per-season Foundry goal-setting** — admin input writes `season.foundryGoal`; renderHome falls back to auto-computed if unset. Small build, high retention value.
2. **Convert 37 `alert()` → `toast()`** — global `alert(` → `toast(` replace + ~10 typed success/error follow-ups.
3. **Confirm `cuPoints/cuWo/cuStreak` span IDs** are in succStats innerHTML (count-up animation fix) — verify in index-3.html line ~1128.
4. **Delete dead group YH60EP** — one-time Firestore delete.
5. **Promote staging → prod** — copy tested files from forge-staging repo into forge repo, push.

### Soon after
- Deploy Stage 3 auth once PIN adoption threshold met
- Phase-2 auth scoping (real identity replacing anonymous) — needed before Aug stranger rollout
- `loadGlobal` read optimization before scaling
- Firestore rules lockdown (**security debt** — rules are fully open `allow read,write:if true`)

---

## WORKING AGREEMENT
- PyCharm + GitHub. Delivery format: **byte-exact inline find/replace blocks targeting specific files. Never file artifacts.**
- Always re-read live files (bash grep for line numbers → view specific ranges) before generating edits. Snapshots go stale.
- Efficient navigation: `grep -rn` across full project dir to confirm presence/absence. Empty grep = meaningful signal.
- Staging workflow: develop+test on staging → copy files to prod forge repo → push to promote.
- Real users live: NO untested deploys to main.
- **Service worker cache**: bump `CACHE_VERSION` in sw.js (e.g. forge-v1 → forge-v2) whenever pushing breaking JS changes, or users get stale scripts.

---

## DECISIONS LOCKED
- Name: **Forge**
- Vibe: dry-witty voice, strong/weighty/memorable visual direction ("Foundry" theme)
- Calendar redesign: Version B "game board" style — after extra-stats land in score()
- PIN: 4 digits, plain text, Model A (localStorage handles same-device memory)
- Perfect-week → rolling 7-day: canonical, deploy with scoring update
- numTeams + teamStreakThreshold: configurable per season, default 3 / 0.6
- rolesEnabled: configurable per season, default true
- Theme: dark default ("Foundry" is dark-only for now), light toggle deferred
- Multi-group membership: deferred until post-auth identity layer
- App/Play Store: Play Store needs 12+ testers for 14 days — timeline uncompressible

---

## PARKED (post-July)
- Extra stats in score(): bestStreak, comebacks, favWorkout, wCounts, uniqueWorkouts
- Archive tab (matters from 1 July when first seasons archive)
- Reactions on feed entries
- Weekly mini-goal / streak freeze (Duolingo-style)
- Read optimization (important before scaling past ~300 users)