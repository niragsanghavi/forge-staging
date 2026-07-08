# MODULE 4 — SOLO-FOUNDER PAYMENT AUTOMATION (`MONETIZATION_ENGINE.md`)
_Execution contract. Build lane: Feb–Mar 2027 ONLY IF the manual Founding-Group-Pro experiment converts (year plan; STRATEGY_PACK §4). Hard dependencies: Module 1 (custom-token rules — payments infrastructure on an openly-writable database is malpractice) and the S2 archived-immutability rule. NORTHSTAR §0's "zero monetization build before stranger-proof" still governs: this file existing is not authorization to build it._

## 0. Design stance
Zero-ops means: money moves → group upgrades → nobody DMs Nirag. Razorpay **Payment Pages/Links** (hosted checkout — no PCI surface, no client SDK integration) + one webhook function + per-season entitlements. Manual anything (except refund decisions) is a design failure.

## 1. Entitlement model (per-season, not boolean)
On `groups/{code}`:
```
proSeasons: { "2027-02": {paymentId, amount, paidAt, contact}, ... }   // map, append-only via function
tier: 'free' | 'pro'         // DERIVED convenience field, recomputed by the webhook + rollover:
                             // tier = proSeasons contains currentSeasonId ? 'pro' : 'free'
```
A "lapsed" group is simply one whose current sid has no proSeasons entry — no cron, no expiry job; the rollover that creates the new season recomputes `tier` (one line added to the S2 writer). Annual prepay = the function writing 12 forward entries from one payment (plan id in notes).

## 2. Webhook security handshake — `razorpayWebhook` (HTTPS function, not callable)
Flow, exact:
1. **Raw-body signature first, before ANY parsing/branching:** Razorpay signs with HMAC-SHA256 over the RAW body using the webhook secret (Secret Manager: `RAZORPAY_WEBHOOK_SECRET`). In Firebase Functions use `req.rawBody` (exists on the provided Express req) — computing HMAC over `JSON.stringify(req.body)` is the classic false-negative/false-positive bug. Compare with `crypto.timingSafeEqual`. Fail → 400, log, NO detail in response.
2. Filter events: process `payment.captured` (and `payment.refunded`, §4); everything else → 200 immediately (Razorpay retries non-2xx — returning 200 for ignored events prevents retry storms).
3. **Replay/duplicate guard — deterministic idempotency doc:** transaction on `payments/{razorpay_payment_id}`: exists → exit 200 (already provisioned; webhooks redeliver by design and replays are indistinguishable from redeliveries — idempotency IS the replay defense; timestamp-window checks add nothing once this holds). Not exists → create it INSIDE the same transaction as the provisioning writes (§3), storing `{event_id, amount, contact, groupCode, sid, raw_created_at, processedAt}`.
4. **Payload validation before provisioning (each check → mark payment doc `status:'rejected', reason' and return 200 — captured money with bad metadata is a REFUND QUEUE item, not a crash):** `amount === 49900` (paise; or the annual amount); `notes.groupCode` present, matches `/^[A-Z0-9]{6}$/`, and the group EXISTS; `notes.sid` (the season being bought — defaults to group's current sid if absent) parses as YYYY-MM and is ≥ current sid (no buying the past). Test-mode events (`payload.payment.entity has no live signature match`) never reach prod: separate webhook secrets per environment, separate functions per project — staging pays with test keys only.
5. Respond 200 only after the transaction commits. Function timeout 60s; retries safe by §3's idempotency.
**Where `notes.groupCode` comes from:** the in-app "Go Pro" card links to the Razorpay Payment Page with `?notes[groupCode]={code}&notes[sid]={sid}` prefilled (Payment Pages pass notes through). The buyer never types a code; a hand-typed fallback field on the page is allowed but the validated regexp + existence check above is what makes typos safe (rejected → refund queue, never mis-provisioned).

## 3. Provisioning transaction (inside the §2.3 transaction — ALL reads first)
READS: `payments/{id}` (dedupe), `groups/{code}`. WRITES:
1. `payments/{payment_id}` create (audit record — the append-only money ledger; client rules: no access).
2. `groups/{code}` update: `proSeasons.{sid} = {…}`; `tier = (sid == currentSeasonId) ? 'pro' : tier`; `proProvisionedAt`.
3. NOTHING else. Premium capabilities (crest, Hall styling, named seasons, roster-30, custom twist skins — STRATEGY_PACK §4.3) are FLAGS READ FROM `tier`/`proSeasons` by existing client code — provisioning never writes into season docs, never touches rosters, never "appends twist capabilities" as data. Entitlement is one field; features check it. This is what makes provisioning race-free against concurrent gameplay writes: disjoint documents.
Client UX: the group-doc listener (Batch-1) delivers the tier flip live — buyer sees "⚒️ PRO" appear without refresh; a `tierChangedAt` field lets the client toast it once.

## 4. Refunds & disputes
`payment.refunded` → same idempotent pattern keyed `refund_{refund_id}`: remove `proSeasons.{sid}` entry (map field delete), recompute `tier`, mark the payment doc `status:'refunded'`. History already rendered under pro styling stays rendered (see §5 — the Hall never regresses); only forward entitlement dies. Disputes: Razorpay handles; the payments ledger doc is the evidence bundle.

## 5. The Locked Vault — lapsed-group policy (rules + product truth)
**Product rule stated first because it constrains the tech: lapsing NEVER destroys or hides a group's own history.** Hostage-taking data is brand poison and churn fuel. "The Hall freezes" (STRATEGY_PACK renewal hook) means: no NEW pro-styled seasons accrue, pro cosmetics revert on CURRENT surfaces — but every archived season, snapshot, badge and crown remains readable to members forever.
**Enforcement is already 90% built:** archived seasons are immutable under Module 1's rule (`allow update: if resource.data.status != 'archived'`), delete is denied always, per-user season archives are create-only. The vault's "absolute, un-deletable read-only state" therefore holds for EVERY group, free or pro, lapsed or active — a stronger guarantee than the ask, and simpler: there is no lapsed-specific rules branch to build or get wrong.
**What lapsing changes (client-read flags only):** `tier=='free'` ⇒ Hall renders in standard styling with a quiet "Season not yet on the wall in Pro finish — renew to keep the streak of plaques" upsell on the NEWEST season only; crest/theming reverts to defaults; roster cap enforcement applies to NEW joins only (a 30-member lapsed group loses nobody — cap checks happen at join, never retroactively).
**Rules delta for pro fields:** `proSeasons`, `tier`, `payments/*` are function-written only: group-doc update rule gains `&& !request.resource.data.diff(resource.data).affectedKeys().hasAny(['proSeasons','tier','proProvisionedAt'])` — members can edit their group; nobody but the webhook can edit money truth.

## 6. SONNET TRAPS
1. HMAC over parsed/re-stringified JSON instead of `req.rawBody` — signature verification that "works in testing" and fails on the first real payload with unicode/key-order drift.
2. Idempotency via timestamp windows or in-memory sets — functions are stateless and webhooks redeliver for days; the deterministic payment-id doc inside the provisioning transaction is the only correct guard.
3. Returning 4xx/5xx for ignored event types — triggers Razorpay's retry storm; ignore = 200.
4. Provisioning by writing capabilities INTO season/roster docs — creates race surface with gameplay transactions and un-provision nightmares; entitlement is one group-doc field, features read it.
5. Building expiry crons — per-season entitlement + rollover-time tier recompute makes time-based expiry emergent, not scheduled.
6. Locking lapsed groups OUT of their history — violates the product rule in §5; the renewal hook is aspiration ("keep the wall growing"), never ransom.
7. Sharing one webhook secret across staging/prod, or pointing test-mode Razorpay at the prod function — separate secrets, separate deployments, verified in the deploy checklist.
8. Client-side "verify payment then write tier" fallbacks for UX speed — the client NEVER writes entitlements under any circumstances; slow webhook = show "processing" state, nothing more.
