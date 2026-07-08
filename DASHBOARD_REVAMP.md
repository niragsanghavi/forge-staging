# MODULE 5 — SUPERADMIN OPERATIONAL COCKPIT (`DASHBOARD_REVAMP.md`)
_Execution contract. Precedence: FORGE_NORTHSTAR.md > this file. Build lane: armed by the SAME trigger as PERFORMANCE_SHIELD (25 active groups OR 30k sustained reads/day) because every metric here reads Module 3's aggregates — building the cockpit before the aggregation layer exists forces exactly the raw-scan queries this contract bans. Until the trigger arms, NORTHSTAR S8 (at-risk list + PIN adoption counter) IS the dashboard; this module is its scale-up successor, not a competitor._

## 0. Design stance (Lead Product Designer)
A solo founder's dashboard is a **triage queue, not a trophy case**. Every card answers "what needs me today"; anything that only ever says "things are fine" is demoted below the fold. Layout order is severity order: at-risk humans → cooling groups → funnel leaks → trends → growth. Visual system: 100% existing Forged Glass tokens (`.card`, `.srow/.sc/.sv/.sl` stat tiles, the tab-analytics table pattern, `--green/--gold/--orange/--red` as the ONLY band palette). No new CSS system, no new chart library — Chart.js is already loaded.

## 1. High-signal metrics — definitions, algorithms, data sources

### 1.1 KPI header strip (four `.sc` tiles, computed from data already fetched below — zero extra reads)
- **WAU** = count of users with `lastActiveAt` ≥ now−7d (from the §1.4 query results).
- **Groups alive this week** = groups whose agg `lastLogAt` ≥ now−7d.
- **Month-2 survival rate** (the product's real KPI, per the pilot): of groups whose PREVIOUS month agg had `totalLogs > 0`, the % whose CURRENT month agg has `totalLogs > 0` by today. Early-month caveat rendered honestly: before day 5 show "settling" instead of a scary number.
- **D7 new-user retention** = of users with `createdAt` in [now−14d, now−7d], % with `lastActiveAt` ≥ now−7d.

### 1.2 Frictionless Onboarding Funnel
**Instrumentation (new, cheap, PII-free):** merge-increment counters via the existing `tabClicks` write pattern — fire-and-forget, never blocking UX.
- Pre-group steps → global doc `analytics/funnel-global/events/{YYYY-MM}`: `landing_cta_tap` (from `?src=landing` arrival), `create_started`, `create_completed`, `code_attempted`, `code_invalid`.
- Post-code steps → per-group `analytics/{groupCode}/funnel/{YYYY-MM}`: `code_ok`, `name_picked`, `register_started`, `pin_locked`, `entered_app`, `first_log` (fired once per member via a localStorage guard — approximate by design; counters, not identities).
**Rendering:** a five-stage horizontal funnel (CSS bars, not a chart): Code OK → Name → PIN → In App → First Log, each stage showing count + % of previous + Δ vs last month. **The alarm rule:** any adjacent-stage retention < 70% renders that stage's bar `--red` with the drop count ("lost 14 people here this month") — the founder's job is the red bar, nothing else.
**Hard constraints:** never store attempted code strings (junk + quasi-PII — count `code_invalid`, store nothing); never write per-user funnel docs; all funnel writes wrapped in the standard try/logErr-and-continue.

### 1.3 Group Cohesion Score (0–100, rolling 7 days)
**Formula (fixed weights — Sonnet does not tune these):**
`Cohesion = round(100 × (0.5·P + 0.25·C + 0.25·W))`
- **P (participation)** = players with ≥1 log in last 7d ÷ roster size.
- **C (co-presence)** = days in last 7d where ≥40% of roster (min 3 players) logged, ÷ 7.
- **W (witness density)** = min(1, reactions in last 7d ÷ logs in last 7d); if zero logs, W = 0.
**Bands:** ≥70 **Forged** (`--green`) · 40–69 **Warm** (`--gold`) · 1–39 **Cooling** (`--orange`) · 0 actives **Cold** (`--red`). The groups table sorts ASCENDING by cohesion — worst first, triage order.
**Data source — requires a Module 3 schema amendment (record it there when built):** `agg/summary` gains `lastDayByPlayer: {name: dayOfMonth}` and `dayReactions: {"1": n, …}`, maintained by the same marker-transaction triggers. Rolling-7d windows that cross the month boundary read TWO agg docs (current + previous month) during days 1–6; this is bounded (2 reads/group), month-clamped by the same convention as every weekly mechanic, and the ONLY sanctioned month-spanning computation in the app — dashboard-read-side only, never engine-side.

### 1.4 Silent Drop-Off Triage (At-Risk list, scaled)
**The one true query (no per-group loops, no collection scans):**
`users.where('lastActiveAt','<', now−4d).orderBy('lastActiveAt','asc').limit(100)` — a single-field range+orderBy on the same field: auto-indexed, cost = docs returned, independent of group count. Paginate with `startAfter` if 100 hits.
**Triage buckets, rendered as three lists:** 4–7d **Nudgeable** (name · groups from the memberships map on the doc — zero extra reads · days silent) · 8–14d **Cooling** · >14d **Lost** (collapsed by default; these are RESURRECTION_ENGINE targets, not daily worry — counting the long-dead as "at risk" forever is how at-risk lists become ignored).
**Governance amendment to Module 1 (required, do not improvise around it):** strict rules make `users` self-read-only, which breaks this query for the founder. Sanctioned fix: a `su: true` custom claim, minted by `verifyPin` when the authenticating user's doc carries `superadmin: true` (set once, manually, via console on Nirag's own userId — never settable by any client path or function input). Rules: `allow read: if self(userId) || request.auth.token.su == true`. AUTH_UPGRADE.md inherits this as §5-amendment; the claim gates READS only — super writes continue to route through existing admin paths.

## 2. Serverless optimization contract (Database Performance Architect)
1. **Banned outright in dashboard code:** any read of the `logs`, `reactions`, `bets`, or `flags` collections. The current `renderSuperDashboard`/`renderTrendCharts` full-month logs scans are DELETED in this build, not conditionally bypassed. Trend charts consume `agg.dayTotals` (it is exactly the series the charts plot today).
2. **The complete read budget per dashboard open:** 1 groups query + per group (season doc + current agg + [prev agg, days 1–6 only]) + 1 at-risk query + 2 funnel docs ≈ `3×G + 4` reads. At 50 groups ≈ ~160 reads. Any feature that can't fit this shape gets pre-computed into agg by a Module 3 trigger instead — that is the extension mechanism, always.
3. **No live listeners on the cockpit.** One-shot loads + a manual "Refresh" button + a 15-minute staleness stamp ("as of 10:42"). A founder triaging once a day does not need realtime; 50 groups × N listeners is cost and re-render churn purchasing nothing. (The in-APP super tools keep their existing behavior; this governs the cockpit surfaces.)
4. All cockpit data flows through ONE fetch function returning a single assembled model object; every card renders from that object. No card fetches for itself — the read budget is enforceable only if there is exactly one place that reads.

## 3. Cockpit information architecture (top to bottom)
1. KPI strip (§1.1) · 2. **At-Risk triage** (§1.4) · 3. **Groups table** — cohesion band dot, actives/roster, last-log age, month-2 status (✓/✗/settling), PIN adoption %, amnesty days used, tier badge, lineage tag ("child of X"); row-tap opens the existing Manage panel · 4. Funnel (§1.2) · 5. Trends (existing Chart.js visuals, agg-fed, window toggle preserved) · 6. Growth: newest groups + referral lineage + resurrection log. Existing tools (Manage, export, create, tab analytics) remain below, untouched.

## 4. SONNET TRAPS
1. **Per-group at-risk loops** (`for each group: query users/logs…`) — the single indexed range query is the entire design; a loop is O(groups) queries and a failed review.
2. **Un-indexed compound queries:** adding `where('lastActiveAt','<',…)` PLUS another field's filter/order creates a composite-index deploy Sonnet cannot perform silently. Filter by the one field; bucket and group CLIENT-side from returned docs.
3. **Chart re-render thrash:** re-instantiating Chart.js on every refresh without `.destroy()` leaks canvases and stutters — the `_trendCharts` destroy-then-create array pattern already in the codebase is the required idiom. No `setInterval` polling refresh, ever.
4. Reading `logs` "just for this one card" — the ban in §2.1 has no exceptions; missing data means a Module 3 trigger amendment, not a scan.
5. Computing rolling windows by querying logs date-ranges — rolling state lives in agg maps; the dashboard does arithmetic on maps, never queries on time.
6. Storing funnel identities (per-user docs, attempted codes, name strings) — counters only; the funnel measures the pipe, not the people.
7. Treating `lastDayByPlayer` names as identity keys for anything beyond display — names are display + scoring keys (invariant); cross-referencing users happens via memberships, not name joins.
8. Building this module before PERFORMANCE_SHIELD exists — the data source is agg; without it every metric silently degrades into the banned scans. Check the trigger, cite the lane, stop.
