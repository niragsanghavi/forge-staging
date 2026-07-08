# MODULE 1 — SERVERLESS REAL AUTH (`AUTH_UPGRADE.md`)
_Execution contract. Precedence: FORGE_NORTHSTAR.md > this file. Build lane: staging Aug–Sep 2026, prod October (year plan). Prerequisite for Modules 2–4's rules and for any monetization. OPERATIONAL GATE: Cloud Functions require the Blaze plan on forge-25c8c and forge-staging-865ff — Nirag enables billing before any deploy; expected cost at current volume ≈ ₹0 (free tier allowances persist under Blaze)._

## 1. What changes, in one paragraph
Today: every device signs in anonymously; `request.auth.uid` identifies a BROWSER, not a person; PINs are verified client-side; rules can only ask "is anyone signed in." After: the client proves identity to a Cloud Function (groupCode + playerName + PIN), the function mints a **custom token whose uid IS the app-level `userId`**, the client signs in with it, and from that moment `request.auth.uid === userId` — owner-gated rules finally become possible and every client-side trust hack this codebase carries (documented in AUDIT.md #3) gets a real floor under it.

## 2. Cryptographic upgrade (do this or the rest is decorative)
The current `users.pinHash = SHA256(pin)` of a 4-digit PIN has a keyspace of 10,000 — anyone who can read the doc reverses it with a lookup table. The function-verification era fixes this:
- New format: `pinHash2 = HMAC_SHA256(PIN_PEPPER, userId + ':' + pin)` where `PIN_PEPPER` is a server secret (Firebase Secret Manager, never in the repo, never on the client).
- **Migration on first verified login:** function finds legacy `pinHash`, verifies `sha256(entered) === pinHash` (Node: `crypto.createHash('sha256')` — **never `crypto.subtle`, that's browser WebCrypto**), and on success writes `pinHash2` + deletes `pinHash` in the same update. Docs with only `pinHash2` verify via HMAC. One-way, per-user, invisible.
- Post-upgrade rules make `users/{userId}` unreadable by other users, so even legacy hashes stop being enumerable during the transition window.

## 3. The Callable Function — `verifyPin`
HTTPS Callable (region `asia-south1`, Node 20). Input `{groupCode, playerName, pin}`. Steps, exactly:
1. **Shape check:** groupCode matches `/^[A-Z0-9]{6}$/`, pin matches `/^\d{4}$/`, name length ≤ 40. Fail → `invalid-argument` (no detail leakage).
2. **Rate limit BEFORE any lookup** (a 4-digit space dies to brute force without this): transaction on `authAttempts/{groupCode_playerNameSanitized}`: `{fails, windowStart, lockedUntil}`. If `lockedUntil > now` → `resource-exhausted` with retry-after. Policy: 5 fails / 15 min → lock 15 min; 20 fails / 24 h → lock 24 h. Reset `fails` on success.
3. Read `groups/{groupCode}` → active season → roster entry by name (server uses Admin SDK: rules don't apply). No entry → generic `permission-denied` ("name or PIN incorrect" — never distinguish which).
4. Resolve `userId` (roster.userId; if absent, perform the S1 lazy-create server-side: create users doc, write userId back to roster in a transaction — the function becomes the single authoritative resolver).
5. Verify pin per §2 (pinHash2 preferred, legacy fallback + upgrade). Constant-time compare (`crypto.timingSafeEqual`).
6. Build custom claims from `users.memberships`: `{g: [groupCodes], a: [codes where roster.isAdmin]}` (≤3 groups ⇒ well under the 1000-byte claim limit).
7. `admin.auth().createCustomToken(userId, claims)` → return `{token, userId}`. **IAM note:** the functions service account needs `roles/iam.serviceAccountTokenCreator` on itself or minting throws `insufficient-permission` — put this in the deploy checklist, it is the #1 setup failure.

## 4. Frictionless lazy migration (no logout walls)
Client boot order becomes: if a custom-token session exists (`auth.currentUser.uid` matches session.userId) → proceed as today. Else if an anonymous session + saved localStorage session exists → app works EXACTLY as today (anonymous mode remains fully functional during the transition) and the next PIN entry of any kind (login picker, admin unlock, grace-flow set) routes through `verifyPin` and swaps the auth session via `signInWithCustomToken`. Facts Sonnet must respect:
- `signInWithCustomToken` REPLACES the anonymous user in place — no sign-out call, no reload needed; the localStorage session gains `authMode:'verified'`.
- Nothing user-owned is keyed to the anonymous uid except `knownDeviceUids` entries (append-only history — harmless) and S4-era `logs.uid` (device uid). All ownership rules below gate on `userId` FIELDS, never on historical `uid` values, precisely so migration never strands old data.
- PIN-set flows (register/grace/reset) also move server-side: a `setPin` callable (same rate limiter; requires either a valid current session for that userId or an empty-pinHash grace state) writes pinHash2 — after this module, **no plaintext PIN is ever written to Firestore by any path**, and the S4 roster-pin scrub becomes mandatory cleanup.
- Claims staleness: joining a new group mid-session → membership claim missing → rules deny the new group's writes. The join flow therefore ends by calling `verifyPin` again (it re-mints with fresh claims) and re-signing in. Document this as the ONLY sanctioned claims-refresh path.

## 5. Hardened rules (the target posture — deploy staging first, prod via checklist)
Helpers: `signed() = request.auth != null && request.auth.token.g is list` (custom-token users only), `member(c) = signed() && c in request.auth.token.g`, `adminOf(c) = signed() && c in request.auth.token.a`, `self(id) = request.auth.uid == id`.
- `users/{userId}`: read `self(userId) || isSuperFn()`… super admin has no token — Nirag logs in as a player like everyone; super tooling moves to Admin-SDK contexts. So: read/update `self(userId)`, create via function only (deny client create), delete never. Subcollections `seasons/*`: read `self(userId)` OR `member(groupCode-of-doc)` (profile cards) → simplest expressible: read if `signed()`; create only via trusted paths (rollover runs client-side… see Trap 4), update/delete never.
- `groups/{code}`: read `signed()` (join-by-code requires reading before membership → read stays open to signed users); update `member(code)`; create `signed()` (self-serve); delete never.
- `seasons/{sid}`: read `signed()`; update `member(code) && resource.data.status != 'archived'` (**archived seasons become immutable at the rules layer** — this single line is Module 2's and Module 4's vault); create `member(code)`.
- `logs`: create `member(request.resource.data.groupCode) && request.resource.data.userId == request.auth.uid`; update only the tombstone/photo keys AND (`resource.data.userId == request.auth.uid || adminOf(resource.data.groupCode)`); delete never.
- `reactions`: create/delete `member(groupCode)` and `player`-field == own roster name is NOT expressible cheaply — gate on `request.resource.data.userId == request.auth.uid` (add userId to reaction docs when this module lands).
- bets / bonuses_* / twistWindows / jackAwards: create `member(groupCode)`, immutable as today. `authAttempts`, `payments`: client access ALL-DENIED (function-only).
- Anonymous users post-cutover: `signed()` excludes them ⇒ read-only nothing. Transition period runs DUAL rules (`isAuthed() ||` the strict form) for ~4 weeks, then the legacy arm is deleted on a scheduled date. Write both rule files now; the cutover is a one-line deletion.

## 6. SONNET TRAPS
1. `crypto.subtle` in a Function — wrong runtime; use `node:crypto`; use `timingSafeEqual`.
2. Minting tokens without the `serviceAccountTokenCreator` IAM role — deploy checklist item, not code.
3. Rate limiting AFTER the Firestore lookup — inverts the cost and leaks existence timing; limiter runs first, on a deterministic key, in a transaction.
4. The rollover/snapshot writer runs client-side and writes `users/{userId}/seasons` for OTHER users — strict `self()` rules break it. Resolution (decide, don't fudge): move `writeSeasonSnapshot` into a callable (`closeSeason`) in this module. That is the correct target state; rules then deny client writes to per-user season archives entirely.
5. Returning distinct errors for "no such player" vs "wrong PIN" — enumeration oracle; one generic failure message.
6. Forgetting the claims-refresh on group join — "it works for the first group" is the failure signature.
7. Signing out the anonymous user before `signInWithCustomToken` — unnecessary and produces a visible logged-out flash; the swap is atomic without it.
