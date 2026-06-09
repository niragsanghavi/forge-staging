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
function _activeGroupCode(ctx){ return (ctx&&ctx.groupCode)||groupCode||''; }

function score(playerName, ctx){
  const roster = _rosterOf(ctx);
  const p = roster.find(x => x.name === playerName);
  if(!p) return {wo:0,base:0,sb:0,wb:0,rb:0,tb:0,b30:0,pen:0,bossBonus:0,dayBonuses:0,underdogBonus:0,jackBonus:0,ipBonus:0,total:0,streak:0,days:new Set()};

  const cfg = _seasonOf(ctx);
  const allLogsLocal = _logsOf(ctx);
  const twists = _twistsOf(ctx);
  const bonuses = _bonusesOf(ctx);
  const {month, year, days:DAYS=31, capTarget=16, vcTarget=20, minWorkouts=12} = cfg;
  const rolesEnabled = cfg.rolesEnabled !== false;

  const logs = allLogsLocal.filter(l=>l.player===playerName);
  const days = new Set(logs.map(l=>l.day));
  const wo = days.size;

  // ── BASE (bonus_workout and boss_week applied here) ──
  const bonusWT = twists['bonus_workout'];
  const bossWT  = twists['boss_week'];
  let base = wo * 5;
  if(bonusWT?.enabled){
    const bonusDaySet = new Set(
      allLogsLocal.filter(l=>
        l.player===playerName &&
        Array.isArray(l.workouts) &&
        l.workouts.some(w=>w.toLowerCase().includes((bonusWT.workout||'').toLowerCase()))
      ).map(l=>l.day)
    );
    base = (wo - bonusDaySet.size)*5 + bonusDaySet.size*6;
  }
  // Boss Week: ×2 all base points for the entire month
  if(bossWT?.enabled) base = base * 2;

  // ── STREAK ──
  const today = new Date();
  const todayDay = today.getMonth()+1===month && today.getFullYear()===year ? today.getDate() : DAYS;
  const checkUpTo = days.has(todayDay) ? todayDay : todayDay - 1;
  let cur = 0;
  for(let d=1; d<=checkUpTo; d++){ if(days.has(d)) cur++; else cur=0; }
  const streak = cur;
  const sb = 0;

  // ── PERFECT WEEK ──
  const firstDate = new Date(year, month-1, 1);
  const firstDOW = firstDate.getDay()===0 ? 6 : firstDate.getDay()-1;
  const fullWeeks = [];
  let weekStart = 1 + (7-firstDOW)%7;
  while(weekStart+6<=DAYS){ fullWeeks.push([weekStart,weekStart+6]); weekStart+=7; }
  let wb = 0;
  fullWeeks.forEach(([s,e])=>{
    for(let d=s;d<=e;d++){ if(!days.has(d)) return; }
    wb += 10;
  });

  // ── TEAM STREAK ──
  const teamMembers = roster.filter(x=>x.team===p.team);
  const teamThreshold = Math.ceil(teamMembers.length * (cfg.teamStreakThreshold ?? 0.6));
  const teamLogs = allLogsLocal.filter(l=>roster.find(x=>x.name===l.player&&x.team===p.team));
  const dc = {};
  teamLogs.forEach(l=>{ if(!dc[l.day]) dc[l.day]=new Set(); dc[l.day].add(l.player); });
  let tb=0, teamStreak=0;
  for(let d=1; d<=DAYS; d++){
    const pt = dc[d]||new Set();
    if(pt.size >= teamThreshold){
      teamStreak++;
      if(pt.has(playerName)) tb += Math.min(3, teamStreak);
    } else {
      teamStreak = 0;
    }
  }

  // ── ROLE BONUS / PENALTY ──
  const isEnd = (today.getMonth()+1>month && today.getFullYear()>=year) ||
                (today.getMonth()+1===month && today.getFullYear()===year && today.getDate()===DAYS);
  let rb = 0;
  if(isEnd && rolesEnabled){
    if(p.role==='Captain') rb = wo>=capTarget ? 10 : -10;
    else if(p.role==='Vice Captain') rb = wo>=vcTarget ? 15 : -10;
  }

  const pen = isEnd && wo<minWorkouts ? (wo-minWorkouts)*5 : 0;
  const b30 = bonuses.find(b=>b.player===playerName) ? 50 : 0;

  // bossBonus kept in return shape for backward compat (value now always 0;
  // the doubling is folded into base above)
  const bossBonus = 0;

  // ── DAY-OF-WEEK BONUSES (Freaky Fridays, Monday Motivation) ──
  // Stacks with Boss Week: if boss_week is also on, base is already doubled, then
  // day bonuses add an extra +5 per qualifying day (net ×4 on that day).
  const freakFriWT = twists['freaky_fridays'];
  const monMotWT   = twists['monday_motivation'];
  let dayBonuses = 0;
  if(freakFriWT?.enabled || monMotWT?.enabled){
    [...days].forEach(d=>{
      const dow = new Date(year, month-1, d).getDay(); // 0=Sun,1=Mon,...,5=Fri,6=Sat
      if(freakFriWT?.enabled && dow===5) dayBonuses += 5; // +5 extra = effectively ×2 that day
      if(monMotWT?.enabled  && dow===1) dayBonuses += 5;
    });
  }

  // ── UNDERDOG WEEK ──
  // Last place = fewest unique logged days across the whole roster.
  // All players tied at the minimum qualify. Non-circular: uses raw log counts.
  const underdogWT = twists['underdog_week'];
  let underdogBonus = 0;
  if(underdogWT?.enabled && roster.length > 1){
    const allWOs = roster.map(r=>new Set(allLogsLocal.filter(l=>l.player===r.name).map(l=>l.day)).size);
    const minWO = Math.min(...allWOs);
    if(wo <= minWO) underdogBonus = base; // doubles base (add base again)
  }

  // ── JACK OF ALL TRADES (+20 per awarded week) ──
  const jackAwardsArr = _jackAwardsOf(ctx);
  const jackBonus = jackAwardsArr.filter(a=>a.player===playerName).length * 20;

  // ── IRON PLEDGE ──
  // type='double' → +rawPoints added (effectively doubles raw workout pts that week)
  // type='zero'   → -rawPoints subtracted (forfeits raw workout pts that week)
  // Streaks, role bonuses, and all other points are untouched.
  const ipBonuses = _ironPledgeBonusesOf(ctx);
  const myGC = _activeGroupCode(ctx);
  const ipBonus = ipBonuses
    .filter(b=>b.player===playerName && b.groupCode===myGC)
    .reduce((sum,b)=> sum + (b.type==='double' ? +b.rawPoints : -b.rawPoints), 0);

  const total = Math.max(0, base+sb+wb+rb+tb+b30+bossBonus+pen+dayBonuses+underdogBonus+jackBonus+ipBonus);
  return {wo,base,sb,wb,rb,tb,b30,pen,bossBonus,dayBonuses,underdogBonus,jackBonus,ipBonus,total,streak,days,fullWeeks};
}

function teamTotal(team){
  const roster = _rosterOf();
  const players = roster.filter(p=>p.team===team);
  if(players.length===0) return 0;
  const sum = players.reduce((s,p)=>s+score(p.name).total, 0);
  return Math.round(sum/players.length); // average for fair cross-team comparison
}

window.score = score;
window.teamTotal = teamTotal;
