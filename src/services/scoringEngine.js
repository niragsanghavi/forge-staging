// Season-only config + roster accessors, now context-aware so the global
// leaderboard can score players in OTHER groups by passing their data in.
// Default (no ctx) reads the live globals exactly as before — so every existing
// score(name) / teamTotal(team) call is unchanged.
function _seasonOf(ctx){ return (ctx && ctx.season) || window.season || {}; }
function _logsOf(ctx){ return (ctx && ctx.logs) || (typeof allLogs!=='undefined' ? allLogs : []) || []; }
function _twistsOf(ctx){ return (ctx && ctx.twists) || (typeof activeTwists!=='undefined' ? activeTwists : {}) || {}; }
function _bonusesOf(ctx){ return (ctx && ctx.bonuses) || (typeof bonus30!=='undefined' ? bonus30 : []) || []; }
function _rosterOf(ctx){ const s=_seasonOf(ctx); return (s && Array.isArray(s.roster)) ? s.roster : []; }
function _jackAwardsOf(ctx){ return (ctx&&ctx.jackAwards)||(typeof jackAwards!=='undefined'?jackAwards:[])||[]; }
function _ironPledgeBonusesOf(ctx){ return (ctx&&ctx.ironPledgeBonuses)||(typeof ironPledgeBonuses!=='undefined'?ironPledgeBonuses:[])||[]; }
function _twistWindowsOf(ctx){ return (ctx&&ctx.twistWindows)||(typeof twistWindows!=='undefined'?twistWindows:[])||[]; }
function _activeGroupCode(ctx){ return (ctx&&ctx.groupCode)||groupCode||''; }

const _EMPTY_SET = new Set();

// ── TEAM DISTANCE GOAL ───────────────────────────────────────────────────────
// A season with `kmTarget` set opts its group in: members log distance on
// distance-type workouts, the team's total is pooled, and when the pool reaches
// the target every member who actually contributed earns a one-off bonus.
// With kmTarget unset (every season before Aug 2026) NOTHING here can fire —
// the bonus is 0, no capture UI appears, and scores are bit-identical to before.
// The bonus is COMPUTED from logs, never stored, so a miscount self-heals the
// moment the underlying logs change.
const KM_CONTRIBUTOR_BONUS = 15;   // per qualifying member, once per season
const KM_MIN_CONTRIBUTION  = 1;    // km — stops a 0.1km tap from claiming 15 pts
const KM_MAX_PER_LOG       = 200;  // km — clamps typos (a "500km walk") per log

// Hard ceiling on what ONE resolved step-week can pay a member. The default is
// 5 (STEP_WIN_BONUS) and even a very generous admin override would not exceed a
// handful. This is a SECURITY clamp, not a config: a step_week window lives in
// twistWindows, which `create: if isAuthed()` leaves open to any anonymous
// client (proven 18 Aug 2026 — a forged window with bonus:1,000,000 was
// accepted by the deployed rules). Reading that value straight into a score
// would let anyone award anyone unlimited points. Clamping on READ means even a
// forged window can move a board by at most this much — the same belt-and-braces
// shape as KM_MAX_PER_LOG. The real fix is locking down the twistWindows create
// rule; this is the floor that holds until it ships.
const STEP_BONUS_MAX_PER_WEEK = 25;

// ── PERSONAL STREAK MILESTONE ───────────────────────────────────────────────
// Every unbroken week of logging pays this, to the person who did it. Sized
// deliberately against the alternatives: two days of base (+10), the same as a
// perfect week, and half a Jack of All Trades. Big enough to notice on the
// board, small enough that consistency still beats it over a month.
const STREAK_MILESTONE_DAYS  = 7;
const STREAK_MILESTONE_BONUS = 10;

// ── SNAPSHOT CACHE ──────────────────────────────────────────────────────────
// score() used to re-scan the whole log array per call, and the team-streak /
// underdog sections re-scanned it per roster entry per call — one leaderboard
// render cost O(P² · N). All of that work depends only on the current data
// snapshot, so it's built once per snapshot below and each player's final
// score object is memoised. Keyed by the logs array reference (the app always
// REPLACES these arrays on Firestore snapshots, never mutates them in place)
// and revalidated against the other data refs + scalar config + today's date.
const _scoreCache = new WeakMap();

function _ctxEntry(ctx){
  const cfg=_seasonOf(ctx), logs=_logsOf(ctx), roster=_rosterOf(ctx);
  const twists=_twistsOf(ctx), bonuses=_bonusesOf(ctx);
  const jacks=_jackAwardsOf(ctx), ips=_ironPledgeBonusesOf(ctx);
  const tw=_twistWindowsOf(ctx);
  const myGC=_activeGroupCode(ctx);
  const today=new Date();
  // kmTarget is part of the stamp: the km bonus below reads it, so without it an
  // admin raising or lowering the target would leave every cached score stale
  // until the logs array happened to be replaced.
  // scoringV2 is part of the stamp: flipping the flag mutates the same season
  // object in place, so identity checks alone would serve stale cached scores.
  const stamp=[cfg.month,cfg.year,cfg.days,cfg.capTarget,cfg.vcTarget,cfg.minWorkouts,
               cfg.rolesEnabled,cfg.teamStreakThreshold,cfg.kmTarget,cfg.scoringV2===true,
               myGC,today.toDateString()].join('|');
  const hit=_scoreCache.get(logs);
  if(hit && hit.cfg===cfg && hit.rosterRef===roster && hit.twists===twists &&
     hit.bonuses===bonuses && hit.jacks===jacks && hit.ips===ips && hit.tw===tw && hit.stamp===stamp) return hit;

  const {month, year} = cfg;
  const DAYS = cfg.days ?? 31;

  // Per-player log/day indexes — one O(N) pass over the logs.
  const rosterByName=new Map(roster.map(p=>[p.name,p]));
  const teamOf=new Map(roster.map(p=>[p.name,p.team]));
  const logsByPlayer=new Map(), daysByPlayer=new Map();
  const teamDayLog=new Map();                        // team → Map(day → Set(player))
  // ── DISTANCE (km) ──────────────────────────────────────────────────────────
  // Accumulated in this same O(N) pass. l.km is whatever the client wrote, so it
  // is coerced and validated here rather than trusted: a string, a NaN, a
  // negative or an absurd value must never be able to move a score.
  const kmByPlayer=new Map(), kmByTeam=new Map();
  for(const l of logs){
    let arr=logsByPlayer.get(l.player); if(!arr) logsByPlayer.set(l.player,arr=[]);
    arr.push(l);
    let ds=daysByPlayer.get(l.player); if(!ds) daysByPlayer.set(l.player,ds=new Set());
    ds.add(l.day);
    if(teamOf.has(l.player)){                        // roster's CURRENT team, not the log's stored team
      const t=teamOf.get(l.player);
      let td=teamDayLog.get(t); if(!td) teamDayLog.set(t,td=new Map());
      let s=td.get(l.day); if(!s) td.set(l.day,s=new Set());
      s.add(l.player);
      const k=Number(l.km);
      if(Number.isFinite(k) && k>0){
        const capped=Math.min(k, KM_MAX_PER_LOG);
        kmByPlayer.set(l.player,(kmByPlayer.get(l.player)||0)+capped);
        kmByTeam.set(t,(kmByTeam.get(t)||0)+capped);
      }
    }
  }

  // Team-streak qualifying days, resolved once per team instead of per player.
  const thrFactor=cfg.teamStreakThreshold ?? 0.6;
  // SCORING V2 — the September switch. Two scoring changes (the personal
  // streak milestone bonus and the rolling 14-day team denominator) shipped
  // on 25 Aug 2026 without sign-off, changed live standings mid-month, and
  // were reverted the next day. Both now sit behind this per-season flag,
  // OFF by default: absent or false reproduces the pre-25-Aug arithmetic
  // exactly (verified against the App Store 1.0 engine on live data).
  // Super admin writes {scoringV2:true} onto a season; rollover carries it.
  const scoringV2 = cfg.scoringV2 === true;
  const teamCount=new Map();
  // Departed players (deleted accounts, kept on the roster under a Hall of the
  // Departed name so the group's history survives) must NOT count toward the
  // threshold denominator. They can never log again, so leaving them in would
  // permanently raise the bar for everyone still playing — one person quitting
  // would quietly break their team's streak. Their PAST logs still score; only
  // the forward-looking headcount changes.
  //
  // THE SAME ARGUMENT APPLIES TO THE LIVING. A member who has not logged once
  // all month is, for the purposes of "did enough of us train today", exactly
  // as absent as a deleted account — but they were still inflating the bar for
  // everyone who did show up. Measured on live data 22 Aug 2026: Squad +1s
  // Team A needed 3 of a roster of 4 when only 2 people were still playing, so
  // its two loyal members could log perfectly every day and never once earn a
  // streak. Vandrao Team B needed 6 with 5 playing. Both were unreachable, and
  // silently so — nothing on screen said the mechanic was off.
  //
  // Counting only the people who are actually playing this month fixes that
  // without labelling anyone as gone. Nobody is removed from the roster, nobody
  // loses points, and a dormant member rejoins the denominator the moment they
  // log again.
  //
  // THE BAR IS PER DAY, AND THE PAST IS FIXED. A member counts toward the
  // denominator from the day of their FIRST log that month, and every day after
  // it. Not before.
  //
  // The naive version — one denominator for the whole month, counting anyone who
  // logged at any point — silently rewrites history. Every day is re-scored with
  // today's bar, so one dormant member returning on the 25th raises the bar for
  // the 1st through the 24th as well. Measured on live data 22 Aug 2026, a
  // single returner would have cost Ghadiyali B 9 of its 17 qualifying days,
  // HardCore A 9 of 12, and Vandrao A all 4 of 4. The loyal members would open
  // the app to find a streak they had already been shown was gone, because
  // somebody else came back. That is the opposite of what a comeback should do.
  //
  // Anchoring each day's denominator to who was playing BY THAT DAY makes the
  // past immutable: a return can only ever affect today and the days after it.
  // The residual is the ~8-day backlog window — logging for a past day does
  // move that day's denominator — which is narrow, rare, and self-correcting.
  // A ROLLING WINDOW, so the bar adapts in BOTH directions. You are counted on
  // day D if you logged at any point in the previous ACTIVE_WINDOW days. Not
  // "ever this month" — that let a single log on the 6th hold the bar up for
  // the remaining 25 days, which is the same unfairness pointing forwards.
  //
  // Two properties this buys, and both matter:
  //   · The past cannot be rewritten. Day D's bar depends only on logs up to
  //     day D, so a comeback on the 25th can never un-qualify the 5th.
  //   · A member who stops drifts back out on their own after two weeks, with
  //     no admin action and nobody marked as departed.
  //
  // Two weeks because it is the shortest window that survives a holiday or a
  // work trip without dropping someone who is still committed, and the measured
  // return cliff sits at 8 days — past that, two thirds never come back, so
  // fourteen is comfortably beyond the point where absence is usually real.
  const ACTIVE_WINDOW=14;
  const dayListOf=new Map();
  for(const l of logs){
    if(!l || !l.player || !l.day) continue;
    if(!dayListOf.has(l.player)) dayListOf.set(l.player,[]);
    dayListOf.get(l.player).push(l.day);
  }
  const teamMembers=new Map();
  roster.forEach(p=>{ if(p && p.departed===true) return;
                      if(!teamMembers.has(p.team)) teamMembers.set(p.team,[]);
                      teamMembers.get(p.team).push(p.name);
                      teamCount.set(p.team,(teamCount.get(p.team)||0)+1); });
  const qualByTeam=new Map();
  for(const [t,names] of teamMembers){
    const td=teamDayLog.get(t);
    if(!scoringV2){
      // LEGACY DENOMINATOR (the live default): the bar is a fixed fraction of
      // the FULL roster, all month — byte-for-byte the pre-25-Aug behaviour.
      const thr=Math.ceil((teamCount.get(t)||0)*thrFactor);
      const qual=[]; let run=0;
      for(let d=1; d<=DAYS; d++){
        const s=(td && td.get(d)) || _EMPTY_SET;
        if(s.size>=thr){ run++; qual.push({set:s, streakLen:run}); }
        else run=0;
      }
      qualByTeam.set(t,qual);
      continue;
    }
    // Per-day headcount via a difference array: each logged day marks its owner
    // present for the next ACTIVE_WINDOW days. O(logs + DAYS) per member rather
    // than scanning the window per day — this runs on every render.
    const present=new Array(DAYS+2).fill(0);
    for(const n of names){
      const ds=dayListOf.get(n); if(!ds || !ds.length) continue;
      const cover=new Array(DAYS+2).fill(0);
      for(const d of ds){
        const a=Math.max(1,d), b=Math.min(DAYS,d+ACTIVE_WINDOW-1);
        if(a<=b){ cover[a]++; cover[b+1]--; }
      }
      let acc=0;
      for(let d=1; d<=DAYS; d++){ acc+=cover[d]; if(acc>0) present[d]++; }
    }
    const qual=[]; let run=0;
    for(let d=1; d<=DAYS; d++){
      // Floor of 1: a denominator of 0 would make the bar 0, and "at least 0
      // people trained" is true every day — a free streak for a team where
      // nobody has logged.
      const thr=Math.max(1, Math.ceil(present[d]*thrFactor));
      const s=(td && td.get(d)) || _EMPTY_SET;
      if(s.size>=thr){ run++; qual.push({set:s, streakLen:run}); }
      else run=0;
    }
    qualByTeam.set(t,qual);
  }

  // Twist + bonus lookups.
  const bonusWT=twists['bonus_workout'];
  const bonusWord=bonusWT?.enabled ? (bonusWT.workout||'').toLowerCase() : null;
  const friOn=!!twists['freaky_fridays']?.enabled;
  const monOn=!!twists['monday_motivation']?.enabled;

  // ── WEEK-BOUND WINDOWS (Boss Week + Underdog Week) ──
  // Scoring reads PERMANENT window docs, never the live toggle — so toggling a
  // twist on/off can never retroactively change a past window's effect.
  const seasonWindows=tw.filter(w=>w && w.month===month && w.year===year);
  // A window that starts near a month end runs into the next month, and it is
  // stamped with its MONDAY's month — so 31 Aug – 6 Sep is stored under August
  // with monDate 31, sunDate 6. Read literally that is an empty range, and both
  // twists below silently did nothing for the whole week. The old comment called
  // that "safe"; it is not, it is a twist the admin switched on, was told had
  // been set, and which then paid nobody.
  //
  // Clamping the end to the last day of THIS season is the only coherent reading:
  // scoring is season-scoped, the window doc lives under August, and September's
  // engine filters it out by month above — so the September half of that week can
  // never be doubled from here no matter what this returns. The August half can,
  // and now is. Non-spanning windows are untouched.
  const endOf=w=>(w.sunDate>=w.monDate ? w.sunDate : DAYS);
  // Boss Week: any day-of-month inside a boss_week window's [monDate, end] is doubled.
  const bossDays=new Set();
  for(const w of seasonWindows){
    if(w.twist!=='boss_week') continue;
    for(let d=w.monDate; d<=endOf(w); d++) bossDays.add(d);
  }
  // Underdog Week: each window froze its last-place players at activation time.
  const underdogWindows=seasonWindows
    .filter(w=>w.twist==='underdog_week')
    .map(w=>({monDate:w.monDate, sunDate:endOf(w), frozen:new Set(w.frozenPlayers||[])}));

  // Step Challenge: a RESOLVED week froze three things at resolution time — who
  // won, who was on that team, and what the bonus was worth. Scoring reads only
  // those frozen fields and never recomputes from step data, for the same
  // reason Underdog Week freezes its players: a roster edit on Tuesday must not
  // rewrite who won last week, and turning the challenge off must not silently
  // claw back points people were already told they had.
  //
  // An UNRESOLVED window (no `awarded`) pays nothing. That is what makes the
  // week live on the board but worth zero until it is settled.
  const stepAwards=new Map();
  for(const w of seasonWindows){
    if(w.twist!=='step_week' || !Array.isArray(w.awarded)) continue;
    // The frozen per-week value. Absent on a doc written before the field
    // existed — pay nothing rather than guess a number that moves a score.
    // Clamp on READ. The window is a twistWindows doc, a collection any
    // anonymous client can write to — so `bonus` is attacker-controllable and
    // must be treated as hostile input, not trusted config. STEP_BONUS_MAX_PER_WEEK
    // turns a forged 1,000,000 into at most the cap; a legitimate 5 is untouched.
    // Validate the RAW value first, THEN clamp — clamping first would turn a
    // forged Infinity into a passing `min(Infinity,cap)=cap` and pay it.
    const raw=Number(w.bonus);
    if(!Number.isFinite(raw) || raw<=0) continue;
    const pts=Math.min(raw, STEP_BONUS_MAX_PER_WEEK);
    // The winning set is attacker-controllable too, but it can only ADD names to
    // a payout the cap already bounds — so a forged window's worst case is
    // "everyone named gets at most the cap", not "one person gets millions".
    for(const name of w.awarded) stepAwards.set(name,(stepAwards.get(name)||0)+pts);
  }

  const b30Set=new Set(bonuses.map(b=>b.player));
  const jackCnt=new Map();
  jacks.forEach(a=>{ if(!a.groupCode||a.groupCode===myGC) jackCnt.set(a.player,(jackCnt.get(a.player)||0)+1); });
  const ipSum=new Map();
  ips.forEach(b=>{ if(b.groupCode===myGC) ipSum.set(b.player,(ipSum.get(b.player)||0)+(b.type==='double'?+b.rawPoints:-b.rawPoints)); });

  // Date math, computed once per snapshot.
  const dowBase=new Date(year,month-1,1).getDay();   // dow of day d = (dowBase+d-1)%7
  const todayInSeason=today.getMonth()+1===month && today.getFullYear()===year;
  const todayDay=todayInSeason ? today.getDate() : DAYS;
  const seasonPast=(today.getFullYear()>year) || (today.getFullYear()===year && today.getMonth()+1>month);
  const isEnd=seasonPast || (todayInSeason && today.getDate()===DAYS);

  const entry={
    cfg, rosterRef:roster, twists, bonuses, jacks, ips, tw, stamp,
    DAYS, capTarget:cfg.capTarget??16, vcTarget:cfg.vcTarget??20, minWorkouts:cfg.minWorkouts??12,
    rolesEnabled:cfg.rolesEnabled!==false,
    rosterByName, logsByPlayer, daysByPlayer, qualByTeam,
    // Distance goal: null target = feature dormant (see KM_CONTRIBUTOR_BONUS).
    // Coerced here so a stringly-typed admin value can't poison comparisons.
    kmTarget: (Number.isFinite(Number(cfg.kmTarget)) && Number(cfg.kmTarget)>0) ? Number(cfg.kmTarget) : null,
    kmByPlayer, kmByTeam, teamOf,
    bonusWord, friOn, monOn, bossDays, underdogWindows, stepAwards,
    b30Set, jackCnt, ipSum,
    dowBase, todayDay, isEnd, rosterLen:roster.length, scoringV2,
    results:new Map()
  };
  _scoreCache.set(logs, entry);
  return entry;
}

function score(playerName, ctx){
  const E=_ctxEntry(ctx);
  let r=E.results.get(playerName);
  if(r) return r;

  const p=E.rosterByName.get(playerName);
  if(!p){
    r={wo:0,base:0,sb:0,wb:0,rb:0,tb:0,b30:0,pen:0,bossBonus:0,dayBonuses:0,underdogBonus:0,jackBonus:0,ipBonus:0,kmBonus:0,stepBonus:0,myKm:0,teamKm:0,total:0,streak:0,days:_EMPTY_SET};
    E.results.set(playerName,r);
    return r;
  }

  const ownLogs=E.logsByPlayer.get(playerName)||[];
  const days=E.daysByPlayer.get(playerName)||_EMPTY_SET;
  const wo=days.size;

  // ── BASE (per logged day: +5, or +6 on a bonus_workout day, ×2 inside a Boss Week window) ──
  const bonusDaySet=new Set();
  if(E.bonusWord!==null){
    for(const l of ownLogs){
      if(Array.isArray(l.workouts) && l.workouts.some(w=>w.toLowerCase().includes(E.bonusWord))) bonusDaySet.add(l.day);
    }
  }
  // Boss Week doubles a day's base when that day-of-month falls inside a boss_week
  // window. Because scoring keys off the log's `day` integer (never its timestamp),
  // a backlogged workout dated inside a window automatically earns the bonus.
  const dayBaseOf = d => (bonusDaySet.has(d)?6:5) * (E.bossDays.has(d)?2:1);
  let base=0;
  for(const d of days) base += dayBaseOf(d);

  // ── STREAK ── consecutive run ending today (or yesterday), for display
  const checkUpTo=days.has(E.todayDay) ? E.todayDay : E.todayDay-1;
  let streak=0;
  for(let d=checkUpTo; d>=1 && days.has(d); d--) streak++;

  // ── STREAK MILESTONE BONUS ──────────────────────────────────────────────
  // `sb` has been in the return shape and summed into `total` since the
  // beginning, hardcoded to 0 — the slot was designed for and never filled.
  //
  // WHY THIS EXISTS. The personal streak was display-only: the one thing a
  // member controls entirely on their own paid nothing, while the team streak
  // — which depends on five other people showing up — was the only streak that
  // scored. For anyone drifting, that is exactly backwards.
  //
  // Awarded per COMPLETED WEEK of an unbroken run, not once per run: 7 days
  // pays 10, 14 pays 20, 21 pays 30. Continuing is worth as much as starting.
  // A broken run resets the count, so the bonus can never be farmed by
  // alternating days.
  //
  // Scoped to the season month like everything else here, so a run spanning a
  // month boundary is counted within each month separately. That is the same
  // rule perfect-week already uses, and keeping them consistent matters more
  // than catching the handful of runs that straddle the 1st.
  let sb=0;
  if(E.scoringV2){
    const sorted=[...days].sort((a,b)=>a-b);
    let run=0;
    for(let i=0;i<sorted.length;i++){
      run = (i>0 && sorted[i]===sorted[i-1]+1) ? run+1 : 1;
      if(run%STREAK_MILESTONE_DAYS===0) sb += STREAK_MILESTONE_BONUS;
    }
  }

  // ── PERFECT WEEK ──
  // Rolling non-overlapping 7-day windows within the month.
  // Slides forward one day at a time; when a complete window is found,
  // awards +10 and jumps 7 days so no day counts toward two windows.
  let wb=0, winStart=1;
  while(winStart<=E.DAYS-6){
    let complete=true;
    for(let i=0;i<7;i++){ if(!days.has(winStart+i)){ complete=false; break; } }
    if(complete){ wb+=10; winStart+=7; } else { winStart+=1; }
  }

  // ── TEAM STREAK ── cumulative +1/+2/+3 on qualifying days the player logged
  let tb=0;
  for(const q of (E.qualByTeam.get(p.team)||[])){
    if(q.set.has(playerName)) tb+=Math.min(3,q.streakLen);
  }

  // ── ROLE BONUS / PENALTY (last day or after season end only) ──
  let rb=0;
  if(E.isEnd && E.rolesEnabled){
    if(p.role==='Captain') rb=wo>=E.capTarget?10:-10;
    else if(p.role==='Vice Captain') rb=wo>=E.vcTarget?15:-10;
  }
  const pen=E.isEnd && wo<E.minWorkouts ? (wo-E.minWorkouts)*5 : 0;
  const b30=E.b30Set.has(playerName)?50:0;

  // bossBonus kept in return shape for backward compat (value now always 0;
  // the doubling is folded into base above)
  const bossBonus=0;

  // ── DAY-OF-WEEK BONUSES (Freaky Fridays, Monday Motivation) ──
  // Stacks with Boss Week: if boss_week is also on, base is already doubled,
  // then day bonuses add an extra +5 per qualifying day (net ×4 on that day).
  let dayBonuses=0;
  if(E.friOn||E.monOn){
    for(const d of days){
      const dow=(E.dowBase+d-1)%7;                   // 0=Sun,1=Mon,...,5=Fri,6=Sat
      if(E.friOn&&dow===5) dayBonuses+=5;
      if(E.monOn&&dow===1) dayBonuses+=5;
    }
  }

  // ── UNDERDOG WEEK (week-bound, frozen identity, capped at first 3 workouts) ──
  // A player frozen in a window doubles the base of their FIRST 3 logged days
  // inside that window's Mon–Sun range (by day-of-month, ascending); workouts 4+
  // score normally. Identity was frozen at activation — never recomputed here, so
  // toggling the twist later can't change who qualified. Cap is per window.
  let underdogBonus=0;
  for(const w of E.underdogWindows){
    if(!w.frozen.has(playerName)) continue;
    const inWin=[...days].filter(d=>d>=w.monDate && d<=w.sunDate).sort((a,b)=>a-b).slice(0,3);
    for(const d of inWin) underdogBonus += dayBaseOf(d);   // +1 extra copy of the (Boss-aware) day base = doubled
  }

  // ── JACK OF ALL TRADES (+20 per awarded week, scoped to this group) ──
  const jackBonus=(E.jackCnt.get(playerName)||0)*20;

  // ── IRON PLEDGE ──
  // type='double' → +rawPoints added (effectively doubles raw workout pts that week)
  // type='zero'   → -rawPoints subtracted (forfeits raw workout pts that week)
  // Streaks, role bonuses, and all other points are untouched.
  const ipBonus=E.ipSum.get(playerName)||0;

  // ── TEAM DISTANCE BONUS ──────────────────────────────────────────────────
  // Collective goal, individual reward: the whole team pools distance, and once
  // the pool clears the target every member who put in at least
  // KM_MIN_CONTRIBUTION km takes the bonus. Someone who logged nothing gets
  // nothing, so the bar can't be farmed by one person carrying passengers.
  // Awarded once — it is a threshold, not a per-km rate.
  let kmBonus=0, myKm=0, teamKm=0;
  if(E.kmTarget!==null){
    myKm   = E.kmByPlayer.get(playerName)||0;
    teamKm = E.kmByTeam.get(p.team)||0;
    if(teamKm>=E.kmTarget && myKm>=KM_MIN_CONTRIBUTION) kmBonus=KM_CONTRIBUTOR_BONUS;
  }

  // Step Challenge: whatever this player's resolved weeks froze for them. Zero
  // for everyone until a week is actually settled, and zero forever in a season
  // where the challenge was never switched on.
  const stepBonus=E.stepAwards.get(playerName)||0;
  const total=Math.max(0, base+sb+wb+rb+tb+b30+bossBonus+pen+dayBonuses+underdogBonus+jackBonus+ipBonus+kmBonus+stepBonus);
  r={wo,base,sb,wb,rb,tb,b30,pen,bossBonus,dayBonuses,underdogBonus,jackBonus,ipBonus,kmBonus,stepBonus,myKm,teamKm,total,streak,days};
  E.results.set(playerName,r);
  return r;
}

function teamTotal(team){
  const roster=_rosterOf();
  const players=roster.filter(p=>p.team===team);
  if(players.length===0) return 0;
  const sum=players.reduce((s,p)=>s+score(p.name).total,0);
  return Math.round(sum/players.length); // average for fair cross-team comparison
}

// Progress of every team toward the season's distance target, for the bar on the
// leaderboard. Returns null when the season hasn't opted in, so the caller can
// simply render nothing. ctx-aware, unlike teamTotal().
function teamKmProgress(ctx){
  const E=_ctxEntry(ctx);
  if(E.kmTarget===null) return null;
  const teams=[...new Set([...E.rosterByName.values()].map(p=>p.team).filter(Boolean))];
  return {
    target: E.kmTarget,
    teams: teams.map(t=>{
      const km=E.kmByTeam.get(t)||0;
      const members=[...E.rosterByName.values()].filter(p=>p.team===t);
      return {
        team: t,
        km: Math.round(km*10)/10,
        pct: Math.min(100, Math.round((km/E.kmTarget)*100)),
        filled: km>=E.kmTarget,
        contributors: members.filter(p=>(E.kmByPlayer.get(p.name)||0)>=KM_MIN_CONTRIBUTION).length,
        size: members.length
      };
    }).sort((a,b)=>b.km-a.km)
  };
}

window.score = score;
window.teamTotal = teamTotal;
window.teamKmProgress = teamKmProgress;
window.KM_CONSTS = { bonus:KM_CONTRIBUTOR_BONUS, min:KM_MIN_CONTRIBUTION, maxPerLog:KM_MAX_PER_LOG };
