# FORGE — Project Context (CLAUDE.md)

_Last updated: 11 July 2026. Paste at the top of every new session._

---

## WHAT FORGE IS
A competitive, team-based fitness habit tracker for friend groups. People log daily workouts; points accrue individually and per-team; the social pressure of a shared team streak is the core retention mechanic. Dry, witty voice (not gym-bro hype). Web app served via GitHub Pages, Firebase/Firestore backend.

- **Live URL:** https://goforge.in (custom domain via CNAME; also reachable at niragsanghavi.github.io/forge/)
- **Staging URL:** https://niragsanghavi.github.io/forge-staging/
- **Repo (prod):** github.com/niragsanghavi/forge
- **Repo (staging):** github.com/niragsanghavi/forge-staging
- **Firebase prod:** forge-25c8c (asia-south1)
- **Firebase staging:** forge-staging-865ff (asia-south1). NOTE: staging enforces the SAME locked Firestore rules as prod — NOT "open rules". Confirmed 2026-07-11 (client deletes on logs/users return permission-denied).
- **Super admin:** append `?superadmin` to URL — PIN hash stored in `src/state/appState.js` as `SUPER_PIN_HASH`
- **Admin (per group):** PIN hash stored in `src/state/appState.js` as `ADMIN_PIN_HASH`

---

## CURRENT SCALE (as of 11 July 2026)
- **4 live groups** (all on season 2026-07):
  - **Vandrao nu Todu** (BR0RRU): ~17 players
  - **HardCore Gully** (IPJEGE): ~17 players
  - **Ghadiyali Cousins** (75EKZT): ~14 players
  - **Squad +1s** (AJ6W6B): ~7 players
  - (**YH60EP**: dead group — DELETED from prod 2026-07-11, verified zero traces.)
- ~52 user identities / ~49 distinct people (a few have unlinked dual identities pending Option-A relink).
- Strategic goal: ~100 retained users with a formed habit before wedding season (Nov–Jan).
- Rollout: July = friends & family | August = strangers (social media).
- Firebase free-tier headroom: ~300–500 active users before reads become a concern.

---

## ARCHITECTURE

### Data model — SEASON-SCOPED
groups/{CODE} name, players:[{name}], currentSeasonId, createdAt
groups/{CODE}/seasons/{YYYY-MM} month, year, days, capTarget, vcTarget, minWorkouts, numTeams, teamStreakThreshold, rolesEnabled, roster:[{name, team, role, pin, uid, userId, isAdmin}], foundryGoal (optional), rebalancedAt/rebalanceDismissed (optional — team auto-balance state), status:"active"|"archived", startedAt, endedAt; archived seasons also carry finalStandings/teamStandings/badgesAwarded/snapshotAt (S2 snapshot writer).
groups/{CODE}/seasons/{YYYY-MM}/twists|bets|jackAwards|twistWindows subcollections
logs/{auto} groupCode, player, team, role, workouts[], day, month, year, timestamp, userId, uid, voided (tombstone)
users/{userId} name, nameLower, pinHash, memberships{code:{...}}, knownDeviceUids[], stats{currentStreak,longestStreak,lastLoggedDay,totalWorkouts,seasonsPlayed,badgeCounts}, monthlyGoals, mergedInto (tombstone → canonical); users/{userId}/seasons/{code}_{sid} per-user season archive
bonuses_30day / flags / reactions / bonuses_iron_pledge / errorLogs top-level collections
analytics/{code}/tabClicks/{YYYY-MM} tab-usage counters

- Group identity is separate from monthly season. Months never bleed.
- `groups.players` = names only. Team/role/pin/uid/userId live on the season roster.
- **Identity = canonical userId.** A users doc with `mergedInto` is a tombstone; `memberships` collapses multi-group membership into one userId. Dedup by userId, never roster row or name.
- Scoring reads ONLY from `window.season`.
- Rollover is now AUTO (S2 `checkAutoRollover`/`writeSeasonSnapshot`): opportunistic on group load, archives current + creates next + carries roster forward. Manual `manualRolloverRepair` is only a fallback.

### Files — SINGLE working file `index.html` on BOTH prod and staging
- `index.html` — all UI + app logic (~5,800 lines). (There is no `index-3.html`; that naming is retired.)
- `src/services/scoringEngine.js` — score() + teamTotal()
- `src/state/appState.js` — globals, constants, TWIST_LIBRARY, helpers (seasonIdOf, rosterEntry, PIN hashes)
- `src/config/firebase.js` — Firebase init + dual prod/staging config (auto-detect by hostname) + window.ensureAuth()
- `src/style/main.css` — styles, dark + light theme via data-theme attribute
- `sw.js` — network-first service worker (cache version currently **forge-v26**; bump on every deploy to bust cache)
- `manifest.json` — PWA manifest

### score() return shape
`{wo, base, sb, wb, rb, tb, b30, pen, bossBonus, dayBonuses, underdogBonus, jackBonus, ipBonus, total, streak, days(Set)}`

### Scoring (canonical rules)
- Base: +5 per logged day
- Individual streak: DISPLAY ONLY, no points
- Perfect week: +10 per complete rolling non-overlapping 7-day window within the month (DEPLOYED — `scoringEngine.js`)
- Team streak: cumulative +1/+2/+3, threshold = ceil(teamSize × teamStreakThreshold ?? 0.6)
- Role bonus (if rolesEnabled): Captain ±10 (capTarget), VC +15/−10 (vcTarget), last day only
- Min-workout penalty: −5 per workout below minWorkouts, last day only
- 30-day bonus: +50, admin-awarded
- Boss Week twist: INERT — `bossBonus` is always 0 now (twist retired in the engine)

---

## STATE (all shipped to prod, 10–11 July 2026 — prod and staging byte-identical)
- **Foundation hardening**: esc()/XSS fixes, logErr() surfacing, roster-race transactions.
- **Staging env / PWA / app-feel / toasts / after-log celebration** — all live. (alert()→toast() conversion essentially done: 1 alert left vs 65 toast calls.)
- **The Foundry visual redesign** (palette, The Heat streak flame, Your Steel hero, The Foundry monument, spark burst) — live. Per-season `foundryGoal` override shipped.
- **S1 identity layer**: users/{userId} docs + idempotent name-scoped migration (shared-laptop safe) + login self-heal — migrated live on prod.
- **S2 self-running season**: auto-rollover, snapshot writer (per-user season archive), Iron Pledge auto-settlement.
- **S3**: per-group admin (isAdmin + last-admin guard), self-serve group creation, PIN reset dual-clear.
- **S4**: tombstone void-log model (logs never hard-deleted; voided:true filtered everywhere) + rules.
- **S5**: Profile tab (stats/seasons/recap), cross-group streak in submitLog, 🔥 reactions on feed.
- **Auth**: anonymous auth + PIN-set grace flow, and **PIN enforcement at login is LIVE** (SHA-256 `users.pinHash` first, legacy plaintext `roster.pin` fallback pending scrub).
- **SuperDash cockpit**: Pulse · Growth&Participation (month-over-month + platform/active participation, deduped by userId) · Participation chart (Chart.js, 30d vs prev 30d) · Needs Attention · Group Health · Trends · Champions · Errors. Reads live logs + users, no hardcoded month.
- **Error logging**: errorLogs pipeline + session_lost breadcrumb + Errors panel.
- **Stats backfill** + **post-rollover team auto-balance** (snake draft from prev-season finalStandings).

---

## OPEN / NEXT
- **Option-A relink** the ~4 people with unlinked dual identities (Nirag does this via Profile "Link Group").
- **Firestore rules — real remaining debt:** rules are LOCKED (isAuthed-gated + per-collection immutability + default-deny), but `isAuthed()` = any anonymous visitor can still READ. Closing that needs custom-token auth (AUTH_UPGRADE Module 1), NOT "open rules" (that claim was always false).
- `loadGlobal` read optimization before scaling past ~300 users.
- Legacy plaintext `roster.pin` scrub (pinHash is now the source of truth).

---

## WORKING AGREEMENT
- PyCharm + GitHub. Delivery format: **byte-exact inline find/replace blocks targeting specific files. Never file artifacts.**
- Always re-read live files (bash grep for line numbers → view specific ranges) before generating edits. Snapshots go stale.
- Efficient navigation: `grep -rn` across the full project dir to confirm presence/absence. Empty grep = meaningful signal.
- Staging workflow: develop+test on staging → copy files to prod forge repo → push to promote. Currently prod==staging.
- Real users live: NO untested deploys to main.
- **Every claim about what's "live" must be proven by a fresh fetch of the actual URL, never local git state — local state has been wrong before.**
- **Service worker cache**: bump `CACHE_VERSION` in sw.js whenever pushing JS changes, or users get stale scripts.
- **Never commit `CNAME` from staging** (it hijacks the custom domain) and keep planning docs gitignored/untracked.

---

## DECISIONS LOCKED
- Name: **Forge**. Vibe: dry-witty, "Foundry" theme (dark-only for now; light toggle deferred).
- PIN: 4 digits, **SHA-256 hashed** (`users.pinHash` / `sha256hex`); Model A (localStorage handles same-device memory).
- Perfect-week → rolling 7-day: DEPLOYED.
- numTeams + teamStreakThreshold: per season, default 3 / 0.6. rolesEnabled: per season, default true.
- Multi-group membership: supported via users.memberships + Option-A self-serve linking.
- Play Store: needs 12+ testers for 14 days — timeline uncompressible.

---

## PARKED (post-July)
- Extra stats in score(): bestStreak/comebacks/favWorkout/wCounts/uniqueWorkouts.
- Archive tab. Weekly mini-goal / streak freeze (Duolingo-style).
- Read optimization (important before scaling past ~300 users).
- Trigger-gated future modules (see AUTH_UPGRADE / RESURRECTION_ENGINE / PERFORMANCE_SHIELD / MONETIZATION_ENGINE / DASHBOARD_REVAMP / STRATEGY_PACK — all forward-looking contracts, not yet authorized to build).
