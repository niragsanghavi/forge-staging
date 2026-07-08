# MODULE 2 — THE FORGE RESURRECTION ENGINE (`RESURRECTION_ENGINE.md`)
_Execution contract. Build lane: December 2026 (year plan: "build the comeback machine, don't fight the trough"), live for the Jan 1 revival campaign. Depends on: NORTHSTAR S2 (rollover writer) shipped; S3 (per-group admin, ?ref attribution) shipped; Module 1 optional but preferred (archived-immutability rule)._

## 0. Premise correction (design-shaping)
"Copy roster, **reset points to zero**, archive the old season" — points are never stored anywhere. They are derived at render time from month-scoped `logs`. A new season with a new month/year has zero points BY CONSTRUCTION; there is nothing to reset and no mutation of player records anywhere in this feature. Consequence: the Resurrection Engine is a thin, safe extension of the EXISTING S2 rollover writer — one new entry path, one UX layer, one attribution layer. Sonnet must not build a second season-creation code path; there is exactly one (`writeSeasonSnapshot` + the rollover transaction), and resurrection calls it.

## 1. Dormancy model
A group is **dormant** when `currentSeasonId`'s month is ≥ 2 calendar months behind today (1 month behind = normal auto-rollover territory; S2 already handles it silently). Dormancy is computed, never stored: `monthsBehind(group) = (todayY*12+todayM) - (sidY*12+sidM)`.

## 2. The One-Tap Reboot
**Surface:** a returning member of a dormant group boots → loadGroup detects `monthsBehind >= 2` → instead of silently auto-rolling (S2's behavior for 1 month), shows the Resurrection card: "**{Group} has been cold since {Month}.** Relight it for {CurrentMonth}? Roster carries over. History stays on the wall." Button: `Reboot for {Month} →` — enabled for any member (not admin-only: a dead group's admin is usually the deadest member; any survivor may relight — this is a deliberate product decision, record it).

**Transaction (the S2 rollover tx with a resurrection variant — steps exact):**
1. OUTSIDE the tx: `writeSeasonSnapshot(code, staleSid)` — idempotent (skip-if-exists per S2). If it fails → abort with toast; never proceed to step 2. Snapshotting a months-dead season is valid: `score()`'s `seasonPast` path prices it correctly; badges may be awarded for that long-dead month — correct, they earned them.
2. Transaction, ALL READS FIRST: read group doc; abort silently if `currentSeasonId != staleSid` (another survivor won the race — reload). Read `seasons/{newSid}` (newSid = TODAY'S month always; intermediate dead months are never created); if exists → repair-path: just update the pointer.
3. WRITES: stale season → `{status:'archived', endedAt: serverTimestamp}` (after Module 1, the archived-immutability rule makes this doc permanently frozen — the "completely immutable" requirement is enforced at the rules layer, not by promises). New season doc: today's month/year, `days` computed from the calendar (never prompted), config carried (`numTeams, teamStreakThreshold, minWorkouts`), **`rolesEnabled: false` regardless of prior value** (a resurrected group restarts light; admin can re-enable), roster deep-copied with every entry's `role` reset to `'Player'` but `team`, `isAdmin`, `userId`, auth fields untouched. Plus: `resurrectedFrom: staleSid`, `resurrectedBy: me.name / userId`. Group doc: `currentSeasonId: newSid`, `resurrectionCount: increment(1)`, `lastResurrectedAt`.
4. Post-commit: `loadGroup()`; every other live device follows via the Batch-1 group-doc listener. The rebooter's feed shows a seeded system moment (client-rendered, not a written doc): "🔥 {name} relit the forge."

**Clock-skew guard (same as S2):** never reboot into a FUTURE month relative to the season being archived… concretely: refuse if computed `newSid <= staleSid`; refuse if device date parses to a year outside [2026, 2035] (a dead-battery device with a 1970 clock must not archive a live season — `monthsBehind` goes negative there and the ≥2 check already fails, but state the guard explicitly).

## 3. Flame Relight — returning-player logic
**No engine change is required and none is permitted.** The streak walk-back computes from the current month's logs; a player returning after 4 months has streak 0 → first log makes it 1 — already correct. The Resurrection layer is presentation + one badge:
- **Amnesty Spark (visual state, zero schema):** condition — `users.lastActiveAt` older than 30 days AND player logged today. For 48h after that first log (derived: `todayLogged && (now - lastActiveAtBeforeThisBoot) > 30d`, held in a sessionStorage flag set at log time, NOT in Firestore), the Heat card renders the small lit flame with copy: "**Relit.** Day 1 of the comeback. The flame doesn't care how long it was out." The existing `COMEBACK_MSGS` machinery fires as normal on top.
- **`comeback` milestone badge** (if §2.4 milestone badges exist by then): first log after ≥30 silent days → written via the same jackAwards-style deterministic doc (`{userId}_{YYYY-MM}_comeback`), create-only.
- Trap: do NOT bridge or backfill streaks for returners. Amnesty windows (STRATEGY_PACK §3) are group-declared future windows; resurrection grants sympathy copy, never streak credit.

## 4. Grandchild referral attribution
**Chain model on `groups/{code}`:** `referredBy: <parentCode|null>` (exists from S3) plus new `lineage: [parent, grandparent, ...]` capped at 5, computed once at creation: read parent group; `lineage = [parentCode, ...(parent.lineage||[])].slice(0,5)`. Never recomputed, never mutated (lineage is provenance, not a relationship).
**Propagation path:** December recap images render `…/forge/?create&ref={CODE}` (S7). The create flow (S3) already parses `?ref` — extend: on submit, read `groups/{ref}`; if missing/invalid → store `referredBy:null` and proceed silently (a bad ref must never block creation); if valid → store `referredBy` + computed lineage. The ref ALSO survives the picker → localStorage round-trip: stash `pendingRef` in sessionStorage at first page load (WhatsApp opens can bounce through the browser chooser and lose query strings on reload — capture immediately at boot, consume at creation).
**Security posture (explicit):** `ref` is untrusted user input. It grants NOTHING — no tier, no points, no admin, no read access. It is written once, rendered only in super-admin contexts (esc()'d), and validated only for existence. Any future "referral rewards" must re-derive from server-side data, never from the client-supplied string.
**Measurement:** super-admin group list gains lineage annotation ("child of X · gen 2"); the pilot/growth question "does the recap recruit grandchildren" becomes the query `groups.where(referredBy in pilotCodes)` — run from the export at n<100, no dashboard.

## 5. SONNET TRAPS
1. Building a second season-creation path. There is one writer. Resurrection is an entry point to it.
2. "Resetting" anything on players/rosters beyond `role→Player`. Points/streaks are derived; touching stored data to zero them is corruption, not resetting.
3. Creating season docs for skipped months. June→January is June-archived + January-created. Nothing in between.
4. Writing the Amnesty Spark state to Firestore. It's ephemeral UX; sessionStorage only.
5. Trusting `?ref`: no existence check → lineage poisoning with garbage codes; blocking creation on invalid ref → growth-funnel breakage. Validate-or-null, never validate-or-fail.
6. Letting two survivors race the reboot: the tx's `currentSeasonId` recheck is the guard — if Sonnet finds itself adding a client-side lock flag instead, it has re-invented the broken version.
7. Archiving without snapshotting first (order inversion) — the stale season's badges/standings are computed from its OWN month's logs; once archived+rules-frozen, a missed snapshot is unwritable forever.
