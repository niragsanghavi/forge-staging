// Season-only config + roster accessors, now context-aware so the global
// leaderboard can score players in OTHER groups by passing their data in.
// Default (no ctx) reads the live globals exactly as before — so every existing
// score(name) / teamTotal(team) call is unchanged.
function _seasonOf(ctx){ return (ctx && ctx.season) || window.season || {}; }
function _logsOf(ctx){ return (ctx && ctx.logs) || (typeof allLogs!=='undefined' ? allLogs : []) || []; }
function _twistsOf(ctx){ return (ctx && ctx.twists) || (typeof activeTwists!=='undefined' ? activeTwists : {}) || {}; }
function _bonusesOf(ctx){ return (ctx && ctx.bonuses) || (typeof bonus30!=='undefined' ? bonus30 : []) || []; }
function _rosterOf(ctx){ const s=_seasonOf(ctx); return (s && Array.isArray(s.roster)) ? s.roster : []; }

function score(playerName, ctx){
  const roster = _rosterOf(ctx);
  const p = roster.find(x => x.name === playerName);
  if(!p) return {wo:0,base:0,sb:0,wb:0,rb:0,tb:0,b30:0,pen:0,bossBonus:0,total:0,streak:0,days:new Set()};

  const cfg = _seasonOf(ctx);
  const allLogsLocal = _logsOf(ctx);
  const twists = _twistsOf(ctx);
  const bonuses = _bonusesOf(ctx);
  const {month, year, days:DAYS=31, capTarget=16, vcTarget=20, minWorkouts=12} = cfg;
  const rolesEnabled = cfg.rolesEnabled !== false;

  const logs = allLogsLocal.filter(l=>l.player===playerName);
  const days = new Set(logs.map(l=>l.day));
  const wo = days.size;

  const bonusWT = twists['bonus_workout'];
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

  const today = new Date();
  const todayDay = today.getMonth()+1===month && today.getFullYear()===year ? today.getDate() : DAYS;
  const checkUpTo = days.has(todayDay) ? todayDay : todayDay - 1;
  let cur = 0;
  for(let d=1; d<=checkUpTo; d++){ if(days.has(d)) cur++; else cur=0; }
  const streak = cur;
  const sb = 0;

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

  const isEnd = (today.getMonth()+1>month && today.getFullYear()>=year) ||
                (today.getMonth()+1===month && today.getFullYear()===year && today.getDate()===DAYS);
  let rb = 0;
  if(isEnd && rolesEnabled){
    if(p.role==='Captain') rb = wo>=capTarget ? 10 : -10;
    else if(p.role==='Vice Captain') rb = wo>=vcTarget ? 15 : -10;
  }

  const pen = isEnd && wo<minWorkouts ? (wo-minWorkouts)*5 : 0;
  const b30 = bonuses.find(b=>b.player===playerName) ? 50 : 0;

  const bossWT = twists['boss_week'];
  let bossBonus = 0;
  if(bossWT?.enabled){
    const bw = parseInt(bossWT.week||3);
    const bossWeek = fullWeeks[bw-1];
    if(bossWeek){
      let bossWO = 0;
      for(let d=bossWeek[0]; d<=bossWeek[1]; d++){ if(days.has(d)) bossWO++; }
      bossBonus = bossWO * 5;
    }
  }

  const total = base+sb+wb+rb+tb+b30+bossBonus+pen;
  return {wo,base,sb,wb,rb,tb,b30,pen,bossBonus,total,streak,days,fullWeeks};
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