# MODULE 3 — PERFORMANCE SHIELD & AGGREGATION (`PERFORMANCE_SHIELD.md`)
_Execution contract. Build lane: triggered, not scheduled — arm when EITHER 25 active groups OR 30k reads/day sustained (whichever first; year plan pencils May 2027, January growth may pull it forward). Depends on Module 1's Blaze plan. Rule of the module: aggregate the CROSS-GROUP surfaces; leave in-group scoring client-side — it is correct, cheap, and offline-capable there._

## 1. The audit — where reads actually scale badly (measured against this codebase, not folklore)
**NOT the problem (do not "fix"):** the 8 boot listeners in `subscribe()`. All are group+month scoped (~200–500 docs/group-month ceiling), and offline persistence (shipped) makes re-opens delta-priced. In-group `score()` is O(month-logs) client-side over data the listener already holds — zero marginal reads. A 500-user Forge where users only ever open their own groups costs ~2–4k reads/day. Fine forever.
**THE PROBLEM — every surface that fans out across groups:**
| Surface | Today's cost per uncached hit | At 50 groups × 300 logs/mo |
|---|---|---|
| Global tab (`loadGlobal`) | all groups + month-pair logs + 3 reads/group | **~15,000+ reads per tap** (cache TTL 5 min, in-memory only — every fresh session pays) |
| Super dashboard + trends | 2× current-month all-groups logs scans | ~15,000/open |
| Recruitment/landing counters | (correctly baked static — keep) | 0 |
`logs` grows ~15k docs/month at target scale and never shrinks; any unscoped month query grows linearly forever. The shield's success metric: **Global tab and dashboards cost ≤ (#groups + small constant) reads, independent of log volume** — that is the ≥80% cut, concentrated where 100% of the blowup lives.

## 2. Aggregation architecture — on-write triggers maintaining per-season rollups
**One aggregate doc per group-season:** `groups/{code}/seasons/{sid}/agg/summary`
```
{ totalLogs, totalWorkoutItems, uniquePlayers: {name: dayCount,...},
  dayTotals: {"1": n, ...}, teamDayCounts: {A: {"1": n,...},...},
  reactionsCount, lastLogAt, processed: {logId: true, ...} }
```
Write rate at target ≈ 10–30 writes/group/day → single-doc contention (1 sustained write/sec limit) is a non-issue by 30×. `processed` map ≈ 500 ids × ~25 bytes ≈ 12KB/month — inside the 1MiB doc limit with 80× headroom.
**Triggers (Node 20, asia-south1):**
- `logs onCreate`: TRANSACTION on agg doc — read; if `processed[logId]` exists → exit (this marker, inside the transaction, is the idempotence mechanism; onCreate is at-least-once and WILL redeliver); else increment fields + set marker. Derive the agg path from the log's own `groupCode+month+year` → sid; a log for a nonexistent season doc still gets an agg doc (merge-create).
- `logs onUpdate`: fires only for tombstones/photo (rules restrict keys). If `voided` flipped false→true and `processed[logId]` → decrement counters, set `processed[logId]:'voided'` (tri-state prevents double-decrement).
- `reactions onCreate/onDelete`: increment/decrement `reactionsCount` (same marker pattern keyed `r_{reactionId}`; deletes use a `removed_` marker).
- **Nightly reconciliation** (scheduled function, 03:00 IST): for each ACTIVE season only, recount from `logs` where group+month+year and rewrite the agg doc wholesale. This is the self-healing backstop that makes marker bookkeeping non-fatal — drift lives ≤24h. Archived seasons are never reconciled (immutable, and their agg is final).
**Consumers switch (client changes are read-path only):** `loadGlobal` → read all groups (1 query) + each active season doc + its agg/summary (2 reads/group; batched via `getAll`-style parallel gets) — group boards, "most active today" (`dayTotals[today]`), avg-points… **honesty note:** exact cross-group POINTS require the full scoring engine; agg gives logs/actives. Decision (make it, don't fudge): the Global boards re-rank on **participation metrics** (logs, active players, day streaks) from agg; the opt-in points board remains the ONE full-fidelity computation and moves behind a tap ("compute standings") rather than auto-fire — priced honestly at its true cost, paid only on demand. Super dashboard/trends read the same agg docs (dayTotals is exactly the trend chart's series). The stale-month group case: pairs derive from each group's own sid — aggregation makes the Batch-1 month-pair logic obsolete for these surfaces.

## 3. Offline resiliency (what to build vs. what persistence already does)
Already true with `enablePersistence({synchronizeTabs:true})` (shipped): queued offline writes auto-flush on reconnect; scoped queries serve from cache; equality-only filters need no composite indexes (index errors offline are a symptom of ADDING range+equality combos — the standing rule below).
Contract additions:
1. **Log integrity offline:** the `day` field is chosen by the user at tap time (day strip) — an overnight sync does NOT shift it; `timestamp` is `serverTimestamp()` and resolves at flush. Feed's "backlog" chip already renders that divergence honestly. No client merge logic to write — do not invent a reconciliation layer; Firestore's last-write-wins per-field is sufficient because log docs are create-only + key-restricted updates.
2. **The one real merge hazard — roster-array transactions offline:** `runTransaction` REQUIRES connectivity (it round-trips). Every roster write (consent, roles, PIN ops) must fail fast with the existing "check connection" toasts — never fall back to a blind `update()` on the roster array. That fallback is the classic Sonnet "fix" and it reintroduces the roster-clobber race the transactions were built to kill.
3. **Aggregate lag UX:** agg docs update seconds after a log syncs; the in-group UI never reads agg (it has the logs), so no user-visible staleness exists in-group. Global/dashboard readers accept ≤24h drift by contract (reconciler bound).
4. **Trigger cold-start pile-up after mass reconnect** (Monday-morning gym-basement flushes): transactions on the agg doc serialize naturally; retries are the idempotence marker's job. No queues, no pub/sub — at this scale that's architecture cosplay.

## 4. SONNET TRAPS
1. Aggregating the in-group hot path "for consistency" — it deletes offline correctness (agg lags; local logs don't) and saves nothing. The shield covers cross-group surfaces ONLY.
2. Increment-without-marker in onCreate (at-least-once delivery double-counts) or marker-without-transaction (read-check-write race double-counts anyway). Marker + transaction, always.
3. Sharded counters / distributed aggregation — contention math says single doc is fine below ~1 write/sec; adding shards adds read fan-out for nothing.
4. Composite-index sprawl: keep every new query equality-only (group/month/year/sid). A range filter on `lastLogAt` etc. mid-build means an index deploy Sonnet cannot perform silently — stop and surface.
5. "Fixing" offline roster failures with plain updates (see 3.2) — the transaction requirement is the feature.
6. Deleting the `processed` map to "save space" — it IS the correctness mechanism; space is budgeted (12KB/month, reset each season by construction).
7. Letting the reconciler touch archived seasons — their aggs are final artifacts (Module 4 renders Halls from them); recompute only `status=='active'`.
