# FORGE STRATEGY PACK — Landing Contract · 0/5 Pivot Runbook · Amnesty Logic · SME Tier
_8 July 2026. Four execution contracts for Sonnet. Precedence: FORGE_NORTHSTAR.md > this pack > ARCHITECTURE.md. Build-now vs build-later is explicit per section: §1 builds with/after the S4 gate; §2 is a CONTINGENCY runbook (activates only on a 0/5 pilot result — building it early is a violation); §3 builds on the NORTHSTAR schedule (design now, ship October); §4 authorizes ZERO product build pre-pilot-proof — it is sales collateral plus a tier spec for the Feb-2027 lane._

**Voice note for all copy in this pack:** the positioning pivot ("Fitness is faster with friends" — validation over trash-talk) governs OUTWARD surfaces: landing, pitch, share artifacts. The in-app dry-witty voice is not retrofitted in this pass; don't "warm up" existing app strings as a side effect.

---

# SECTION 1 — `landing.html` IMPLEMENTATION CONTRACT

## 1.0 Ground rules (violating any of these is a failed build)
1. **Zero Firebase.** No SDK scripts, no reads, no writes. A cold-acquisition page must cost kilobytes and load on 3G in under 2s. Attribution instead of analytics: every outbound CTA carries `?src=landing`; conversion is measured where the create-flow already records `createdVia`/`referredBy`. (updates.html keeps its Firestore counters; landing does not copy that pattern.)
2. **Tokens only from `main.css`** — link it, use `--bg, --bg-card, --bg-card-2, --glass, --hairline, --gold, --gold-l, --green, --orange, --text, --text-muted, --r, --font`. No hex values in landing CSS except the flame/spark palette already canonized in main.css (`#ff5a1f, #ffb01f, #ffe89a`) and the btn gradients. Dark is the only theme: add the same "dark by design" comment updates.html carries; the page does not read `data-theme`.
3. **Structure:** single-column, `max-width:480px` centered (matches updates.html), `env(safe-area-inset-*)` padded, document-level scrolling (copy the updates.html body scroll block verbatim — it exists because of a shipped iPhone bug; do not re-derive).
4. **Performance budget:** ≤150KB total transfer excluding main.css; no external fonts (system stack is a ratified decision — PLAN.md), no images except one OG asset (1.6), no video. All motion is CSS/DOM in the patterns below; everything honors the `prefers-reduced-motion` kill-switch block (copy from updates.html).
5. **Ship gating:** the "Start Your Group" CTA targets `index.html?create&src=landing` — a funnel surface. Per NORTHSTAR §5.3, landing.html may exist on staging any time but its prod promotion rides WITH or AFTER the S4 security-gate promotion, never before. This is structural: put the page's prod debut in the S4 promotion checklist.
6. **Accessibility:** every interactive element is a real `<button>` or `<a>`; the page-wide gold `:focus-visible` rule from updates.html is copied in; the emoji animation layer is `aria-hidden="true"`; headings are a real h1→h2 hierarchy.

## 1.1 THE INTERACTIVE GATE (hero)
**Concept:** the visitor performs the product's core action before reading a word about it. The hero IS the demo.

**Layout, top to bottom (first viewport, `min-height:100dvh`, flex column, content vertically centered):**
- Eyebrow, micro-scale (11px/700/.18em/uppercase, `--gold`): `FORGE`
- H1, display treatment cloned from `.ob-logo` (font-weight 900, the gold gradient text `linear-gradient(180deg,#f2d384 10%,#c9962f 90%)` with background-clip, drop-shadow as in main.css; size 44px mobile): **`Fitness is faster with friends.`**
- Sub (15px/24, `--text-muted`, max-width 300px, centered): `Log your workout. Your whole group sees it, cheers it, and counts on it.`
- **The Gate button** — a faithful clone of the app's sticky FAB, in-flow (not fixed): class `.landing-fab`, styled exactly as `#subBtn` + `.btn-green` compose in the app: width `calc(100% - 48px)` max 400px, `border-radius:16px`, padding 15px, font 16px/600, the `.btn-green` gradient `linear-gradient(180deg,#3ddb63,#27c04f)` with its inset highlight + green glow shadow, press transition `transform .18s cubic-bezier(.34,1.56,.64,1)` and `:active{transform:scale(.95)}`. Label: **`Log Today's Workout`**.
- Below it, ghost-quiet (12px, `--text-muted`): `Go on. Tap it.`

**Micro-interaction sequence on tap (the load-bearing moment — implement exactly):**
1. `navigator.vibrate(200)` (guarded by existence check, like the app).
2. **Spark burst — DOM pattern, not canvas** (the app has never used canvas for this; replicate `fireSparks()` from index.html): spawn 22 `div.spark` elements (the `.spark` class + `sparkFly` keyframes already exist in main.css — reuse, don't redefine). Origin: the button's center via `getBoundingClientRect()`, NOT the viewport-center the app uses. Angle `(-Math.PI/2) + (Math.random()-0.5)*1.8`, distance `70+Math.random()*120`, duration `0.6+0.6*Math.random()`s, colors 50% `#ffb01f` / 35% `#ff5a1f` / 15% `#ffe89a`, remove each node after 1300ms.
3. Button label swaps with a 150ms crossfade to: **`Logged. That's the whole app. 🔥`** and the button locks (`disabled` visual state NOT applied — keep full color; just ignore re-taps for 1200ms).
4. At +600ms: `scrollIntoView({behavior:'smooth'})` to §1.2. At +1400ms the label restores so a returning scroll-up visitor can play it again (every tap re-fires sparks; scroll only fires if the pitch section isn't already in view).
5. Reduced-motion: no sparks, no smooth scroll (instant jump), label swap still happens (it's the message, not decoration).

## 1.2 THE 10-SECOND PITCH + SOCIAL PROOF
- H2 (20px/26/800, `--text`): `One log a day. Everyone sees it.`
- Body (15px/24, `--text-muted`, ≤2 sentences): `Forge is a monthly season with your friends: log your workout, light up the group's feed, keep the shared goal moving. No coaches, no content, no noise — just your people showing up for each other.`
- **Counters row:** reuse the app's stat-tile system verbatim — `.srow` grid of three `.sc` tiles, values in `.sv` (26px/800/`--gold`/tabular-nums), labels in `.sl`. Tiles: `[X]+ · GROUPS FORGED`, `[Y]+ · WORKOUTS WITNESSED`, `[Z]+ · STREAKS KEPT ALIVE`.
- **Counter data contract:** values are BAKED at deploy time as literals with `data-metric` attributes, rounded DOWN to honest round numbers (never inflate). Definitions for whoever bakes them: X = groups with ≥2 members and ≥10 lifetime logs; Y = total non-voided log docs; Z = count of player-months containing a streak ≥7 days. Recompute from the schema-v3 export at each promotion; a `<!-- COUNTERS BAKED: {date} from export {file} -->` comment is mandatory. **No live Firestore counters — a public page must not read collections.**
- Count-up on first scroll-into-view: IntersectionObserver (once), animate 0→value over 900ms with the app's ease-out cubic pattern; reduced-motion shows final values immediately.

## 1.3 THE VALIDATION ENGINE (show, don't tell)
- H2: `Every workout gets witnessed.` Sub (muted): `This is what your group's feed feels like.`
- **The stage:** a `.card` containing a mock feed built from the app's real feed classes (`.fi`, `.fav`, `.fn`, `.fw`, `.ft`) so it is pixel-honest. Five fictional entries, exactly these (Indian names, deliberately mixed activity types and times — inclusivity is the message; a Walk belongs next to a Gym PR):
  1. `Priya` — `💪 Gym — leg day` — `6:12 am`
  2. `Arjun` — `💪 Run — 5k before work` — `7:30 am`
  3. `Meera` — `💪 Yoga` — `12:45 pm`
  4. `Kabir` — `💪 Walk — 40 min` — `6:20 pm`
  5. `Ananya` — `💪 Badminton` — `8:05 pm`
  Avatar circles use the team tints (`--Al/--A`, `--Bl/--B`, `--Cl/--C` rotating).
- **The loop (JS timeline, ~9s cycle, only runs while on-screen via IntersectionObserver, fully disabled under reduced-motion with a static fallback showing fixed `🔥 3`-style count chips):**
  - t=0: entries cascade in (opacity 0→1, translateY 12px→0, 360ms `cubic-bezier(.22,1,.36,1)`, 450ms stagger).
  - As each entry lands +400ms: 2–4 reaction emoji (`🔥` 60% / `👍` 40%) spawn at the row's right edge and float up-and-away — reuse the `sparkFly` mechanics (`--sx` random ±14px, `--sy` −60 to −90px, `--sdur` 1.2–1.6s, scale 1→0 fade). Simultaneously a small count chip on the row (`.pill` style, `--gold-l` bg, gold text) ticks up `🔥 1 → 🔥 4`.
  - t≈7s: everything fades (400ms), 1s rest, loop restarts. Keep total spawned nodes ≤30 per cycle; remove nodes on animationend.
- Caption under the card (12px, muted): `No likes from strangers. Fire from people who'll ask where you were tomorrow.`

## 1.4 THE TEAM IMPACT (The Foundry)
- H2: `Your workout moves the whole group.`
- **The stage:** a `.foundry-card` clone using the real classes: `.foundry-head` ("THE FOUNDRY · SEASON GOAL" + `🏆 64%`), a 10-`.ingot` rail at ascending heights (28px + 9px steps, exactly the app's stair formula), `.foundry-bar` + `.foundry-fill`, `.foundry-stat` line `Every log is a strike. 143 / 220 this month.`
- **The loop (offset from 1.3's loop by ~3s so the page never has two crescendos at once):** 6 ingots start `.molten`; a mock mini log-row labeled `Kabir logged · just now` slides in above the card; +600ms the 7th ingot ignites (class flip — main.css's `.ingot` height/glow transitions do all the work), `.foundry-fill` widens 60%→70% (its 1s ease is already in main.css), the trophy % counts 64→70. Rest, revert quietly during the fade, loop.
- Copy line under the card (the section's whole argument, don't bury it): **`When you log, it isn't just your streak. It's ingot #7 of the group's month.`**

## 1.5 THE FINAL CTA
- H2, display-weight (28px/800, `--text`): **`Make fitness a game you win every day.`**
- Sub (muted): `Start a season with your group. Free. Two minutes to set up. First one to log gets bragging rights.`
- Primary button: `.btn.btn-gold` exactly as tokenized (the `linear-gradient(180deg,#e7bf58,#c69d35)` gradient, dark text `#221804`, gold glow shadow), label **`Start Your Group →`**, href **`index.html?create&src=landing`** (the dark create flow — subject to the §1.0.5 gate coupling).
- Secondary text link below (13px, gold): `Already in a group? Open Forge →` → `index.html`. Tertiary (12px muted): `See what's new →` → `updates.html`.
- Footer: `Forged by the group.` (13px, `--text-muted`, centered, generous safe-area bottom padding).

## 1.6 META / SHARE
`<title>Forge — Fitness is faster with friends</title>`; meta description = the 1.2 body line; `og:title`, `og:description`, `og:image` → `assets/og-landing.png` (1200×630, generated ONCE by hand from the recap-card canvas style: bg `#0a0a0d`, gold gradient wordmark, tagline, three counter numbers — a static asset committed to the repo, not runtime-generated); `theme-color #0a0a0d`. WhatsApp link previews are the page's primary distribution surface; the OG image is not optional.

---

# SECTION 2 — THE 0/5 PIVOT: "WITNESS-ONLY ARENA" SURGERY RUNBOOK

**Activation condition (pre-registered, NORTHSTAR §10.2):** 0 of 5 pilot groups start month 2. Not 1 of 5 (that's a second cohort, unchanged product). If this document is being executed, the market has said the game layer isn't the product. Do not build any of this speculatively; do not cherry-pick pieces of it into the main product "because they're nice."

## 2.1 What the pivot claims (so the surgery has a direction)
Groups die at the month boundary because the *game* resets to zero and demands re-buy-in, while the *witnessing* — the only behavior observed at healthy frequency — never needed seasons, points, or winners at all. The pivot: strip Forge to a continuous, identity-driven witness arena: **proof of showing up + instant reactions + visible group pulse.** No points. No winners. No month-boundary cliff.

## 2.2 ENGINE SURGERY — `scoringEngine.js`
**Strip (cease computing; fields return 0 or are removed from the shape):** base points, perfect week (`wb`), team streak points (`tb`), role bonus (`rb`) + capTarget/vcTarget, min-workout penalty (`pen`), 30-day bonus (`b30`), Boss Week/`bossDays`, Underdog (`underdogBonus`), Jack (`jackBonus`), Iron Pledge (`ipBonus`), day bonuses (`dayBonuses`), `teamTotal()` entirely, `total` entirely.
**Keep (the survivors are presence math):** `wo` (days shown up this month), `streak` (the walk-back loop, now the app's most important number — plus §3's amnesty bridging when scheduled), `days` set (calendar), and a NEW `monthsActive` (from users seasonsPlayed — continuity identity).
**Resulting shape:** `score(name) → {wo, streak, days}`. Every render site that read `total`/rank re-reads §2.4. TWIST_LIBRARY, twist listeners, twistWindows/bets/jackAwards/bonuses_* listeners: removed from `subscribe()` (5 of 8 listeners die — the pivot is also a cost cut).

**Write-path strip (STOP WRITING, never delete data):** `bonuses_30day`, `bets`, `twistWindows`, `jackAwards`, `bonuses_iron_pledge`, twist toggle docs. Collections stay in Firestore untouched (history), export keeps exporting them, rules keep their create-only shape (dead rules are harmless; deleting rules is risk without reward). `flags` SURVIVES — witness integrity is the one governance mechanic the arena still needs.

## 2.3 THE NEW CORE: PHOTO PROOF *(new infrastructure — first use of Firebase Storage)*
- Log flow gains an optional third element: day → workouts → **[camera icon] add a photo** → submit. Photo is never mandatory (chai-break gym selfies are a culture, not a requirement).
- Client: compress via canvas to max 1080px long edge, JPEG q0.8, hard-reject >300KB post-compression. Upload to Storage path `photos/{groupCode}/{YYYY-MM}/{logDocId}.jpg` AFTER the log doc commits; then merge `photoPath` onto the log doc (requires widening the tombstone-era update rule to `hasOnly(['voided','voidedBy','voidedAt','photoPath'])` — and photoPath writable only when previously absent: `!('photoPath' in resource.data)`).
- Storage rules (new file, deploy staging-first like all rules): authed create only, `request.resource.size < 300*1024`, `request.resource.contentType.matches('image/jpeg')`, no update, no delete (voiding the log hides the photo; orphaned bytes are accepted at this scale).
- Feed renders the photo as a rounded 4:3 thumb inside the `.fi` row; tap = full-screen overlay (reuse recap-overlay pattern). Moderation = the existing flag system: a voided log hides its photo everywhere. State plainly in code comments: friend-group self-policing is the moderation model; this does NOT scale to strangers-at-large and is acceptable because groups are self-selected.

## 2.4 UI RE-HIERARCHY (the arena)
- **Home = the feed.** The feed moves into Home as the primary surface (the §7.3 NORTHSTAR tripwire, executed fully). Order: Today strip ("6 of 12 showed up" + avatar row) → inline feed with photos/reactions → your calendar → The Foundry. **The Foundry survives** — redefined as logs-this-month vs a group target; it's collective witness, the one "score" that remains, and it never resets identity (target recomputes monthly, the wall of past months lives in the Hall).
- **Board tab → "Presence."** Rank by `wo` (days shown up), ties shared, NO points column. Row meta: streak flame + reactions received. Copy: "days shown up," never "score."
- **Reactions expand to four:** 🔥 👍 💪 😂. Reaction doc gains `type`; doc ID becomes `{logId}_{player}_{type}` (one per type per player; all four rules-compatible with the existing create/delete pattern). Long-press opens the 4-emoji picker; single tap = 🔥.
- **Badges become milestones, not victories:** 7-day flame, 15-day iron, full-month forged, 100 lifetime logs, comeback (logged after 7+ silent days). Written by the (retained) monthly boundary job — seasons stop being competitions but the monthly archive/recap SURVIVES as a "your month, witnessed" artifact: total logs, best streak, most-reacted photo, group photo-grid share card.
- **Removed surfaces:** leaderboard points UI, breakdown card, twists admin card, pledge tab, role guide, role assignment (teams survive only as avatar tint if kept at all — decide: keep teams as cosmetic identity, kill team scoring).
- **Kept infrastructure regardless:** auto-rollover machinery (now writes milestone archives instead of standings), identity/users docs, group creation, PIN system, tombstones, at-risk list.

## 2.5 EXECUTION ORDER (3 weeks)
Week 1: engine strip + listener removals + Presence board (app must be coherent with zero new features). Week 2: photos end-to-end + reaction expansion. Week 3: Home re-hierarchy + milestone badges + revised recap artifact. Comms to existing groups precedes week 1: "Forge is becoming simpler: show up, be seen. Points retire; your history doesn't." Existing points history stays readable in the Hall/archives — nothing anyone earned is deleted.

---

# SECTION 3 — FESTIVAL AMNESTY MODE (STREAK SHELTER)

**Scheduling note:** design is final now; build lands per NORTHSTAR year-plan (design Sep, ship Oct as opt-in beta, live everywhere Nov 1). It must ship BEFORE Diwali week.

## 3.1 Data model + trigger
Season doc gains:
```
amnestyWindows: [ { start: <day-of-month int>, end: <day int>, label: "Diwali",
                    setBy: <player name>, setByUserId, setAt: <server ts>, cancelled: false } ]
```
- **Who:** group admins (roster `isAdmin`) via a new Admin-tab card "Festival Amnesty"; super-admin master key also works. Group-wide ONLY — there is deliberately no per-player shelter (see 3.4).
- **UI trigger:** date-range picker (two day-of-month selects bounded to the season month) + required label (max 20 chars, esc()'d) + a confirm sheet stating the rules in plain words: "From {start}–{end}, missed days won't break anyone's streak. No points are earned for sheltered days. Everyone sees the banner. This can't be edited once it starts."
- **Write validation (client-enforced; note honestly in comments that server-side enforcement waits for real auth):** `start >= today's date` (NO retroactive shelter — the single most important guard); `end >= start`; window length ≤ 7 days; total amnesty days per season (sum of non-cancelled windows) ≤ 10; no overlap with existing windows; windows clamp to the season month (no cross-month windows — a Nov 28–Dec 3 festival needs one window per season, by design, since seasons are month-scoped).
- **Mutability:** a window may be cancelled (`cancelled:true`) ONLY while `today < start`. Once running or past, immutable — edit attempts are refused in UI. All writes via `db.runTransaction` on the season doc (the roster-array pattern).

## 3.2 Engine integration — exact pseudo-code deltas in `scoringEngine.js`
In `_ctxEntry` (snapshot cache build), after the twist lookups:
```
amnestySet = empty Set
for w in (cfg.amnestyWindows or []):
    if w.cancelled: skip
    for d = w.start .. min(w.end, DAYS): amnestySet.add(d)
entry.amnestySet = amnestySet            // and add its size/signature into the cache `stamp`
```
**(a) Individual streak — bridge, never count.** Replace the walk-back loop:
```
d = checkUpTo; streak = 0
while d >= 1:
    if days.has(d):        streak += 1; d -= 1
    elif amnestySet.has(d): d -= 1          // bridge: no break, NO increment
    else: break
```
A sheltered day preserves continuity but is worth nothing. A player at 9 days before a 4-day Diwali window who logs the day after resumes at 10 — the number never inflates, it just survives. Also: `checkUpTo` logic unchanged (today-or-yesterday), the bridge handles a today-is-amnesty start naturally.
**(b) Team streak — pause, don't reset.** In the qualifying-day loop:
```
if s.size >= thr:            run += 1; qual.push(...)
elif amnestySet.has(d):      /* run preserved, nothing pushed, no bonus day */
else:                        run = 0
```
**(c) Min-workout penalty — pro-rate.** `effMin = ceil(minWorkouts * (DAYS - amnestySet.size) / DAYS)`; use `effMin` in the penalty line and every UI warning that says "N more workouts to avoid…".
**(d) Perfect week — void, don't bridge (decided trade-off, keep it):** any 7-day window containing an amnesty day simply cannot complete (the completeness check stays `days.has()` only — no code change needed, document it). Rationale: bridging would award +10 for 5 logged days; the shelter's promise is streak dignity, not points. State this in the amnesty banner fine print.
**(e) Iron Pledge:** `lockInPledge` refuses weeks whose Mon–Sun intersects any amnesty window ("Sheltered week — no pledges"). Auto-settlement SKIPS such weeks entirely — no bonus doc, no zero (an already-locked pledge whose week later gains a window is settled as skip; the deterministic settlement doc is simply never written, and the status card shows "Sheltered — pledge waived").
**(f) 30-day bonus:** admin-awarded; guidance text updates to "all non-sheltered days"; no engine change.

## 3.3 UI surface
- **Banner** (twistBanner slot, gold-bordered): `🪔 {label} Amnesty · {Mon} {start}–{end} — streaks are sheltered. Sheltered days earn no points. Rest easy.`
- **Calendar:** amnesty days get `.cd.amnesty` — `--gold-l` background, dashed gold border, no green; tooltip "Sheltered — streak safe."
- **Heat card during an active window when today isn't logged:** message swaps to `Sheltered until {end}. Your {n}-day flame is safe.` (flame stays lit, not cold — this is the entire emotional point of the feature).

## 3.4 Cheat guards (enumerated; each maps to a mechanism, not a hope)
1. **No retroactive windows** (`start >= today`) — you cannot discover a broken streak on Tuesday and shelter Monday. This kills 90% of gaming on its own.
2. **Group-wide only** — sheltering yourself shelters everyone, visibly. Social transparency is the enforcement: an admin who declares fake festivals answers to their own group's banner.
3. **Sheltered days never earn** — no base points, no perfect weeks, no team bonus days, pledges waived. Amnesty defends dignity, not standings; there is no scoreboard upside to invoking it.
4. **Caps** — ≤7 days/window, ≤10 days/season: a month cannot be majority-shelter.
5. **Immutable once running** — no mid-window extensions; extending requires a new future-dated window inside the caps.
6. **Audit trail** — setBy/setAt on every window; super-admin dashboard lists groups by amnesty days used (outlier groups are a conversation, not a rule).
7. **Points asymmetry accepted:** a rival group using zero amnesty scores more points. Correct and intended — amnesty trades points for continuity; it must never be strictly dominant.

---

# SECTION 4 — THE SME / REGIONAL TRADING-FLOOR TIER (₹499/SEASON, STRESS-TESTED)

**Standing constraint (NORTHSTAR §0, unchanged by this section):** pre-pilot-proof this is SALES-ONLY — pitch with the product as-is; every tier feature below is consumer-shareable and lands in the Feb-2027 build lane. No SSO, no admin analytics consoles, no HR reporting. If a buyer demands those, the answer is no — that's the enterprise product Forge is deliberately not building.

## 4.1 Enterprise flaw vs SME reality — and three honest failure modes
**Why HR wellness dies:** bought top-down by someone who won't use it; motivation is compliance, not connection; hierarchy poisons the social layer (nobody roasts the VP); success is measured in enrollment, not week-6 presence — so week-6 presence is nobody's job. The product is a report; the users are the report's raw material. People can feel that.
**Why the 8–30-person SME floor is different:** the buyer IS a player (owner/team-lead works the floor); the culture is already loud, competitive, peer-policed — Forge's mechanics map onto energy that exists rather than manufacturing it; the sale is one WhatsApp conversation, not procurement; teams already live in a group chat, which is Forge's native distribution and its recap's native destination.
**Stress-test — the three ways this fails, with the guard for each:**
1. *Mandate = Obligation 2.0.* An owner ordering participation recreates exactly the founder-gravity the pilot exists to remove — numbers that look like retention and are actually fear. **Guard: owner pays, workers opt in; the pitch says so; the activation guarantee (below) makes voluntary uptake the seller's own success metric.**
2. *Boss-on-the-board distortion.* If the owner reads the board as a performance review, logging becomes performative. **Guard: no manager-only views exists or ever will — sold as a feature: "you see exactly what they see, on the same board, as a player." Roles off by default.**
3. *Sponsor churn.* The owner IS the group's Nirag; if they cool off, the group dies. **Guard: per-group admin is transferable (S3), and the renewal pitch targets the group's most active player, not necessarily the original payer.**

## 4.2 The pitch copy (verbatim blocks)
**Cold WhatsApp message (≤75 words):**
> Boss, one idea. Your floor runs on competition anyway — point it at fitness for a month. Forge: everyone logs their workout daily, whole team sees it, group target for the month, winners get bragging rights forever. Takes 2 minutes to set up, lives on WhatsApp-shared links, no app store. ₹499 for the season for the whole team. If less than half your floor is in by day 7, I refund it. One month. Watch what happens.

**The 90-second in-person pitch:**
> You already know your floor performs better when there's a number on the wall. Right now the only number is revenue. Give them a second one. Every morning, whoever's worked out logs it — one tap. Everyone sees the feed. Miss a day, your streak dies and the whole floor knows; show up ten days straight, everyone's watching that too. There's a team target for the month — one guy's morning run moves the whole floor's number. Month ends: recap card in the group chat, winners get a crown on their name all next month. It costs less than one team lunch. And you play as a player — same board, same rules, no boss dashboard, because the second it smells like HR surveillance it's dead, and you know that better than I do.

**Objection scripts:** *"They'll quit after two weeks"* → "Most fitness apps die at week two because nobody's watching. Here, week two is when your floor starts roasting whoever's flame went out. And festival weeks get an official amnesty so nobody rage-quits over Diwali." · *"Free apps exist"* → "Free apps are for individuals. You're not buying software, you're buying a month of your team's group chat having a pulse at 6am." · *"WhatsApp group is enough"* → "Your WhatsApp group has no memory. Forge remembers who showed up — forever, on the group's wall."

## 4.3 The ₹499 tier — what makes it undeniable to THIS buyer
| Feature | Why the SME floor pays for it | Note for build lane |
|---|---|---|
| **Group crest + color** (name, emblem pick, accent tint on their boards/recaps) | Floor identity is tribal identity; "Bulls of Andheri" in their own colors is the room's flag | Cosmetic theming over existing tokens; consumer-shared |
| **The Hall** — permanent wall of every season: standings, champions, crowns, photo of the month | Permanence is the product for a competitive room — "Q3 2026 Champion" that never disappears beats any coupon; also the renewal engine (lapse = your Hall freezes) | Renders from S2 snapshot docs; near-free |
| **Named seasons + custom twist skins** ("The Q3 Closer Cup", Boss Week renamed "Crunch Week") | Language ownership; the season becomes THEIR event, not the app's | String fields on season doc; trivial |
| **Roster to 30** (free tier stays ~16) | Whole-floor coverage is the actual unit of sale | Config change + perf sanity check |
| **Year-in-review artifact** (annual mega-recap card) | The January flex in the company group chat | June-2027 build reused |
| **Priority WhatsApp support line** | The buyer is paying ₹499 partly to have a human on the hook | Ops promise, zero code |
**Deliberately excluded (say no in the room):** manager reports, attendance exports, SSO, per-employee analytics. Exclusion IS the positioning: Forge is the floor's game, not management's instrument — the moment it reports upward, engagement dies and the renewal with it.
**Pricing sanity:** ₹499/season at 25 seats ≈ ₹20/head/month — below one chai. Anchor high ("less than a team lunch"), offer ₹4,999 annual prepay (2 months free) only AFTER a first paid season converts. The activation guarantee (<50% opt-in by day 7 = refund) is both the honest guard against failure-mode 1 and the strongest close in the pitch.

---

## STANDING ORDERS FOR SONNET (this pack)
1. §1 is the only section with a build authorization, and its prod debut is chained to the S4 gate promotion (NORTHSTAR §5.3).
2. landing.html: zero Firebase, zero new dependencies, tokens from main.css only, DOM-pattern sparks (never canvas), baked counters (never live reads), reduced-motion honored on every animation in the file.
3. §2 is a sealed contingency: executing any part of it before an official 0/5 pilot verdict — or cherry-picking its features into the live product — is a contract violation. Cite NORTHSTAR §10.2.
4. §3 builds on its schedule (Oct beta / Nov 1 live), engine changes exactly as pseudo-coded; the no-retroactive-window rule and "sheltered days never earn" are load-bearing and non-negotiable.
5. §4 authorizes no code. If asked to build SME features pre-proof, cite §4's standing constraint and surface the conflict.
6. Precedence unchanged: FORGE_NORTHSTAR.md > this pack > ARCHITECTURE.md > CLAUDE.md. Silence everywhere ⇒ stop and ask.
