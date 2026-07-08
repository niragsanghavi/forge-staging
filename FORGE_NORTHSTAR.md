# FORGE NORTHSTAR — Implementation Guide (rev 2)
_Rev 2, 8 July 2026, after the final design session. Supersedes rev 1 entirely. Changes from rev 1: the definition of done is now the PILOT, not the mechanical rehearsal (§10); reactions promoted to S5 and the twist calendar demoted to S6; the public funnel is hard-coupled to the security gate (§4.2/§5); the identity layer's scope cut is now enumerated field-by-field (§2.1) — including a reversal of ARCHITECTURE.md §D's cross-group streak; a witness strip lands on Home with reactions (§7). Sonnet: follow literally; where genuinely ambiguous, STOP and surface — do not improvise._

## 0. THE BET AND THE TEST

The bet: **the group is the atomic unit, and the product is a self-running ritual for it.**

The test is NOT the software running untouched (that's the launch gate, §10.1). The test is the **Stranger Pilot** (§10.2): five real friend groups, zero members known to the founder, running unaided across a month boundary. Everything S1–S8 builds exists to make that pilot possible by **August 15, 2026**. The pilot — not the feature list — is this sprint's definition of done.

**Departure table (do not re-litigate, do not silently revert):**
| Existing plan | Decision | Why |
|---|---|---|
| Coins/rewards economy | Never build | Manual fulfillment re-creates founder dependency; console-mintable on open rules; overjustification effect corrodes habit identity. Status artifacts are the currency. |
| Corporate wellness product work | Zero until a pilot group survives month 2 | The proof is the asset. |
| ARCHITECTURE.md §A gender field | Do not ship | Sensitive data, openly-writable DB, n=56. Revisit after real auth + n≥300. |
| ARCHITECTURE.md §D cross-group per-user streak + activity subcollection | **CUT this sprint** (rev 2 reversal — see §2.1) | Serves <10% of users, none of them pilot groups; real write cost + month-boundary complexity for zero pilot signal. The Heat stays group-scoped. |
| ARCHITECTURE.md §1.4 heatmap aggregation writes | Cut (UI was already cut in rev 1; the writes go too) | No consumer this sprint. |
| ARCHITECTURE.md Phase 4 analytics | Only the at-risk list + PIN adoption counter survive | Founder tooling doesn't compound at 56 users. |
| Global tab | Frozen | Vanity table; zero investment. |
| Reactions "post-July" parking | **S5, pre-pilot, mandatory** | The pilot must test the product WITH its witness loop. |
| Home screen reorganization (feed-first) | Deferred with a named trigger (§7.3) | Scope risk pre-pilot; witness strip is the down payment. |
| ARCHITECTURE.md Phases 1–3 | Stand, as modified by §2.1's cut list | Identity is plumbing for the group ritual. |

## 1. SEQUENCE (dependency-ordered; every S# staged + tested before the next)

- **S1** — users/{userId} + migration *(Phase 1, scope-CUT per §2.1)*
- **S2** — snapshot writer + auto-rollover + pledge auto-settlement
- **S3** — per-group admin, self-serve group creation (**dark**, §4.2), PIN reset
- **S4** — strangers security gate — **the funnel goes visible only inside this package's prod promotion** (§5)
- **S5** — reactions + Home witness strip *(promoted from rev-1 S6)*
- **S6** — auto twist calendar *(demoted from rev-1 S5; may slip past pilot start without blocking it)*
- **S7** — badges, crown, recap share variants + recruitment URL + **?ref attribution**
- **S8** — at-risk list + PIN adoption counter + pilot baseline queries
- **PILOT** — §10.2; live by Aug 15; decision Oct 1

Hard rules: S4 before any public link exists anywhere. S5 before pilot recruitment begins. S6 is the only package allowed to slip past Aug 15.

## 2. S1 — IDENTITY LAYER (Phase 1, with the demotion enforced)

### 2.1 Exact scope — what users/{userId} IS and IS NOT (this list enforces the "plumbing" demotion; anything not listed here is not built, even if ARCHITECTURE.md describes it)

**BUILD — the users doc contains exactly:**
`name, nameLower, pinHash, createdAt, migratedFrom, knownDeviceUids[], memberships{}, lastActiveAt, stats:{seasonsPlayed, badgeCounts{}, totalWorkouts}` — and the `users/{userId}/seasons/{code}_{sid}` archive subcollection (written only by the S2 snapshot writer).

**Write paths:** one users-doc merge-update per log submit (`lastActiveAt` + `stats.totalWorkouts` increment — a single write, fire-and-forget), one at login (`lastActiveAt`, knownDeviceUids arrayUnion), snapshot writer updates stats at rollover. That is all.

**DO NOT BUILD (cut from ARCHITECTURE.md Phase 1/§D/§1.4 — listed so habit can't restore them):**
- `users/{userId}/activity/{YYYY-MM}` subcollection — does not exist.
- Cross-group streak computation, `stats.currentStreak`, `stats.bestStreak` — do not exist. "The Heat" on Home remains exactly the current group-scoped streak from `score()`. No streak logic changes anywhere.
- `gender`, `genderVisible` — do not exist.
- `analytics/{code}/heatmap/*` writes — do not exist.
- Any per-log write beyond the single users-doc merge above.

Migration, login resolution, merge policy, and the three standing traps (userId ≠ auth uid; uid-equality-only auto-merge; scoring stays name-keyed) are exactly as ARCHITECTURE.md Phase 1 + rev-1 §2 specified.

## 3. S2 — SELF-RUNNING SEASON CORE
Unchanged from rev 1 §3 in full: snapshot writer (standings, tie rules, badges, per-user season docs, skip-if-exists idempotence), auto-rollover (snapshot-first ordering, all-reads-before-writes transaction, days always computed, 20-day minimum season age clock guard, repair path, single code path shared with the manual fallback), pledge auto-settlement (only fully-ended weeks, month-boundary guard reused, deterministic `{groupCode}_{player}_{week}` bonus IDs as the idempotence mechanism, manual Calculate button removed, admin table becomes read-only status).

## 4. S3 — SELF-SERVE OPERATIONS

### 4.1 Per-group admin + PIN reset — unchanged from rev 1 §4.1/4.3 (roster `isAdmin`, creator gets it, last-admin guard, ADMIN_PIN stays as master key, PIN reset clears BOTH roster.pin and users.pinHash in one operation).

### 4.2 Self-serve group creation — built DARK
All of rev 1 §4.2 stands (defaults: roles OFF, minWorkouts 8, 2 teams, days computed; collision-checked code; wa.me share message; creator flow) with ONE structural change: **S3 ships the flow reachable only via a `?create` URL parameter for staging testing. No visible entry point — not on onboarding, not on updates.html — exists in any promotable file.** The visible CTAs are authored inside S4's promotion commit (§5.3). Rationale: given this project's batch-promotion history, any visible funnel that can reach prod before the gate is a live window; the coupling is structural, not procedural.

Addition for the pilot: `createGroup` reads `?ref=<CODE>` from the URL (or the create form's hidden field) and stores `referredBy: <CODE|null>` + `createdVia:'self-serve'` on the group doc. Attribution is how pilot groups are distinguished from founder-adjacent groups; without it the pilot is unmeasurable.

## 5. S4 — STRANGERS SECURITY GATE
Items 1–5 unchanged from rev 1 §5 (pinHash-first login with lazy backfill; uid+userId on new logs; **tombstone rules** — update restricted to `voided/voidedBy/voidedAt` via `affectedKeys().hasOnly()`, delete:false, ingestion-point filtering, export schema forge-v3; the five-site XSS handler cleanup; the separately-triggered roster plaintext scrub after a week of verified staging login).

**5.3 (new) — Funnel activation is this package's final commit:** wire "Start a new group →" on onboarding step 1 and "Start your own group →" on updates.html, in the same commit that accompanies the prod rules deploy. The prod promotion checklist line is: rules deployed → verified live via hostile-console check → THEN the CTA commit pushes. A visible funnel with an open gate is the one sequencing failure this document exists to prevent.

**Gate-passed definition (unchanged):** hostile console session on staging can read no plaintext PIN, delete no one's log, edit no log content. Garbage logs in a chosen name remain possible until real auth — accepted; flags are the social answer.

## 6. S6 — AUTO TWIST CALENDAR *(demoted; may slip past pilot start)*
Unchanged from rev 1 §6 (twistPlan at season creation; boss w2 / underdog w4 with cross-month + roster-size guards; fire-at-trigger via the client pattern; underdog frozen at FIRE time never plan time; admin cancel rows; Iron Pledge never auto-enabled). If the sprint runs long, this package slips — pilot groups then simply run twist-less months, which matches the flagship group's observed reality anyway.

## 7. S5 — REACTIONS + WITNESS STRIP *(promoted; pre-pilot, mandatory)*

### 7.1 Reactions — unchanged mechanics from rev 1 §7: 🔥 only; top-level `reactions` collection, deterministic `{logId}_{sanitizedPlayer}` IDs; read/create/delete authed, update never; scoped listener like flags; count chip + my-state on feed rows; hidden on own logs; counts from an ingestion map, never per-row queries; no notifications; orphaned reactions on voided logs are invisible and stay unbuilt.

### 7.2 Witness strip (new): the top of Home, above the hero, gets a single-line "Today in {group}" strip: the avatars/initials of everyone who logged today (the `todayPlayers` set renderFeed already computes — reuse, don't recompute), a count ("4 of 12 showed up today"), and nothing else. Tapping it opens the Feed tab. No new data, no new listeners — it renders from `allLogs` inside `renderHome()` as the FIRST card. This is the down payment on witness-first hierarchy at near-zero scope.

### 7.3 Home reorganization (feed-first) — DEFERRED with a named trigger: if pilot day-8 telemetry shows activation without social artifacts (people log but never react/flag/co-log — §10.2 signal table), the witness loop isn't visible enough and the reorg becomes the next package after the pilot. Until that trigger, Home's structure doesn't change beyond the strip. Do not restructure renderHome this sprint.

## 8. S7 — STATUS ARTIFACTS + RECRUITMENT LOOP
Rev 1 §8 stands (Phase 3 profile/badges/crown as ARCHITECTURE specifies, minus anything §2.1 cut; recap 1080×1920 variant + Web Share; updates.html CTA — which now lands via §5.3). Extended: the recap share images render the start-URL **with the group's ref code** (`…/forge/?create&ref={CODE}`), and the wa.me share message from group creation carries it too. The recap is the recruitment poster; the ref code is how we know it worked.

## 9. S8 — MEASUREMENT (final build package)
1. At-risk list and PIN adoption counter — unchanged from rev 1 §9.
2. **Pilot baselines (new, one-time):** from a schema-v3 export, compute BR0RRU's and IPJEGE's historical curves — week-1 active %, week-2 active %, month-2 start rate — and record them in PILOT_LOG.md (§10.4). Pilot groups are judged against the survival floor, not against founder-group numbers (which are obligation-inflated by construction; that inflation is the whole point of the pilot).
3. No pilot dashboard. Five groups' worth of analysis is a JSON export and a spreadsheet. Do not build UI for it.

## 10. DEFINITION OF DONE — GATE, THEN PILOT

### 10.1 Launch gate (the rev-1 "Stranger Rehearsal," demoted to precondition)
The nine mechanical steps from rev 1 §10 (fresh-profile create → multi-player joins → auto-settlement → auto-twist fire [skip if S6 slipped] → auto-rollover with badge/recap → reaction round-trip → hostile-console checks → zero errors, zero founder touches). Passing this means the pilot CAN launch. It proves nothing about whether Forge works — a scripted walkthrough has no social capital to lack.

### 10.2 The Stranger Pilot (the actual test)
**Hypothesis:** Forge's retention survives the removal of the founder's social gravity — i.e., the ritual is the product's, not Nirag's.

**Unit:** a pre-existing friend group in which **zero members know Nirag**, seeded by one WhatsApp forward from an existing user. (True cold-traffic strangers are the WRONG first pilot — that tests acquisition, a different problem. The product is for friend groups; the variable being isolated is Nirag, not friendship.)

**Recruitment:** ask each of the ~28 active BR0RRU/IPJEGE members to forward the recap/start link to exactly one group chat that would actually do this. The ask comes from the member, phrased as "an app my friends use" — **never "my friend built this."** Target 5 live pilot groups (≥5 members each) by Aug 15; expect ~20% forward→group conversion, so ~25 forwards. Groups identified by `referredBy` + `createdVia:'self-serve'` + no roster name matching any known contact.

**Hands-off protocol (contamination control):** Nirag never joins, messages, or is introduced to a pilot group. No surveys during the run. Bugs are fixed by shipping code to everyone, never by white-glove intervention (no manual rollovers, no console repairs on pilot data). The only permitted contact is ONE exit conversation per group after Day 30 — relayed through the seed member — run for dead groups just as much as surviving ones; **the dead groups' exits are the most valuable data collected all year.**

**Signal table — read at each checkpoint, judged per group:**
| Day | "This is real" looks like | "Obligation with better UI" looks like |
|---|---|---|
| **3** | ≥60% of joined members have logged ≥1 workout | Members joined but never logged — onboarding/first-ritual failure, not retention failure; fix funnel, recruit replacements |
| **8** | ≥50% logged in week 1 AND ≥1 organic social artifact (a reaction, a flag, or 3+ members logging the same day) | Solo-logging into a void — witness loop invisible → trips the §7.3 Home-reorg trigger |
| **15** | Week-2 actives ≥40% of members AND the group's admin still active AND ≥1 unprompted admin action (any admin-tab write) | The industry-standard week-2 collapse; admin gone dark = group is dead walking |
| **30** | **Auto-rollover fires; ≥3 members log in the new season's first 4 days** (the month-2 start — THE survival event); bonus: recap shared, or a ref-attributed grandchild group appears | Month boundary is where obligation-free groups quietly die; a group that doesn't start month 2 is a churned group regardless of month-1 stats |

**Decision rule (pre-registered now so October can't rationalize):** ≥2 of 5 groups start month 2 with ≥40% active ⇒ the bet holds; scale recruitment (October plan). Exactly 1 ⇒ ambiguous; recruit a second cohort of 5 immediately, no product pivots yet. 0 of 5 ⇒ the product does not work without Nirag — stop feature work, run all five exit interviews, and treat the witness-loop findings (§7.3) as the surgery site. A clean 0/5 is worth more than a year of building on the unfalsified assumption.

**Timing:** recruit Aug 1–15; run Aug 15–Sep 30 (covers one full month boundary for every group); exits by Oct 1; decision Oct 1.

### 10.4 PILOT_LOG.md
Created at pilot start in the repo root: group codes, seed attribution, weekly signal-table readings, interventions (should be an empty section — if it isn't, the pilot is contaminated and the log says so), exit notes, and the Oct 1 decision with reasoning. The log is append-only by convention; it is the pilot's lab notebook.

## 11. STANDING ORDERS FOR SONNET (consolidated, rev 2)
1. Firestore transactions: ALL reads before ANY writes.
2. Idempotence = deterministic doc IDs + create-only rules; never client-side flags alone.
3. Never settle, snapshot, or score a period that hasn't fully ended in local time.
4. Cross-month Mon–Sun weeks are excluded from every weekly mechanic; reuse the Batch-1 guard.
5. `userId` is identity; `request.auth.uid` is a device. Never interchangeable.
6. Scoring stays keyed by player name; roster arrays only rewritten inside transactions on fresh reads.
7. Rules deploy staging-first; prod rules deploy is a named checklist item — and the public funnel CTA ships only in the same promotion as the prod gate (§5.3).
8. New listeners go in `unsub`; new writes get `logErr`; ambient writes are fire-and-forget and never block a user action.
9. Precedence: this document > ARCHITECTURE.md > CLAUDE.md. Both silent ⇒ stop and ask.
10. Do not build: coins, gender, corporate features, Global-tab changes, push notifications, heatmap writes or UI, `users/*/activity` docs, cross-group streaks, Home reorganization (until §7.3's trigger), pilot dashboards. If asked, cite §0/§2.1 and surface the conflict instead of complying.
11. During the pilot window (Aug 15–Sep 30): bug fixes ship freely; **no new user-facing features ship mid-pilot** — they contaminate the cohort. Queue them.
