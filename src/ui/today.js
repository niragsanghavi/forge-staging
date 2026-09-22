/* Action-first Today surface. Existing logging, scoring and Health handlers remain authoritative. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=(label,fn,cls='today-button')=>{const b=node('button',cls,label);b.type='button';b.addEventListener('click',fn);return b;};
  const sport=name=>{const wrap=node('span','today-sport');wrap.innerHTML=ForgeSports.icon(name);return wrap.firstElementChild;};
  let dialog=null,shownReceiptId=null,refreshedReceiptId=null;

  function sessions(){return typeof getSessions==='function'?getSessions().filter(s=>s&&s.player&&s.player.name):[];}
  function closeDialog(){if(dialog&&dialog.open)dialog.close();}
  function openDialog(title,content){
    closeDialog();
    const opened=node('dialog','today-dialog'),opener=document.activeElement;dialog=opened;opened.id='forgeTodayDialog';opened.setAttribute('aria-labelledby','forgeTodayDialogTitle');
    const head=node('div','today-dialog-head');head.append(node('h2','',title));head.firstChild.id='forgeTodayDialogTitle';
    const close=button('×',()=>opened.close(),'today-dialog-close');close.setAttribute('aria-label','Close dialog');head.append(close);
    opened.append(head,content);opened.addEventListener('close',()=>{opened.remove();if(dialog===opened)dialog=null;if(opener&&opener.isConnected)opener.focus();});
    document.body.append(opened);opened.showModal();close.focus();return opened;
  }
  function start(type){
    if(!window.season)return;
    if(window._forgeLogReceipt&&receiptCurrent(window._forgeLogReceipt)&&['checking','pending'].includes(window._forgeLogReceipt.state))return;
    const now=new Date();
    if(season.month!==now.getMonth()+1||season.year!==now.getFullYear()){toast('Choose a group in the current season before logging.','error');return;}
    _mirPendingDay=now.getDate();_mirPendingMonth=season.month;_mirPendingYear=season.year;
    if(type)mirLogQuick(type);else{mirOpenLogSheet(now.getDate());mirOpenFull();}
  }
  function recent(){
    if(!window.me)return [];
    return window.ForgeExperience?.recommendedWorkouts?.()||[];
  }
  function openDestinations(){
    const body=node('div','today-dialog-body');
    body.append(node('p','today-muted','Forge checks every group when you log. Groups in another season, or groups that cannot be reached, are skipped and named in the receipt.'));
    sessions().forEach(s=>{const row=node('div','today-destination');row.append(node('span','',s.name||s.code),node('strong','','Checked on save'));body.append(row);});
    openDialog('Where this workout goes',body);
  }
  function openGroups(){
    const body=node('div','today-dialog-body');
    const list=node('div','today-group-list');
    sessions().forEach(s=>{const b=button('',()=>{closeDialog();switchGroup(s.code);},'today-group-row');b.dataset.groupCode=s.code;b.setAttribute('aria-current',String(s.code===window.groupCode));b.append(node('span','',s.name||s.code),node('small','',s.code===window.groupCode?'Selected group':s.code));list.append(b);});
    const selected=sessions().find(s=>s.code===window.groupCode)||(window.groupCode?{code:window.groupCode,name:window.groupData&&groupData.name}:null);
    const actions=node('div','today-group-actions');
    if(selected){const share=button(`Share ${selected.name||selected.code}`,()=>{closeDialog();shareInvite(selected.code);},'today-button today-button-quiet today-share-group');share.dataset.shareGroup=selected.code;actions.append(share);}
    actions.append(button('Join another group',()=>{closeDialog();joinAnotherGroup();},'today-button today-button-secondary'));
    if(selected&&window.FEATURE_GOOGLE_AUTH)actions.append(button('Bring this month’s workouts',()=>{closeDialog();window.ForgeAccountExtras?.copyMonth(selected.code);},'today-button today-button-quiet'));
    body.append(list,actions);
    openDialog('Your groups',body);
  }
  function receiptCurrent(r){return r&&window._forgeLogReceipt===r&&typeof _isSubmissionViewCurrent==='function'&&_isSubmissionViewCurrent(r);}
  function groupPoints(receipt,group){
    const details=node('details','today-points-details'),summary=node('summary','',group.name),body=node('div','today-points-body');
    const cached=receipt.report?.cache?.[group.code];
    summary.append(node('span','',cached?.kind==='ready'?`${cached.data.delta>0?'+':''}${cached.data.delta} pts`:'Confirmed'));
    details.append(summary,body);let busy=false;
    const current=()=>receiptCurrent(receipt)&&details.isConnected;
    async function load(retry=false){
      if(busy)return;busy=true;body.replaceChildren(node('p','','Checking this group’s points…'));
      try{
        const entry=await _mirLoadRewardGroup(receipt,group.code,{retry});
        if(!current())return;body.replaceChildren();
        if(entry.kind!=='ready'){
          body.append(node('p','',entry.message||'Points details are unavailable. Your saved workout is unchanged.'));
          if(entry.kind==='error')body.append(button('Retry points',()=>load(true),'today-button today-button-quiet'));
          return;
        }
        const r=entry.data;
        body.append(node('p','today-points-total',`${r.delta>0?'+':''}${r.delta} points`));
        if(r.zeroMessage)body.append(node('p','',r.zeroMessage));
        for(const c of r.components||[]){const line=node('div','today-points-line');line.append(node('span','',c.label),node('strong','',`${c.value>0?'+':''}${c.value}`));body.append(line);}
        body.append(node('p','',`Group total: ${r.totalBefore} → ${r.totalAfter} · ${Number(r.afterScore?.streak)||0}-day streak`));
        if(r.rank)body.append(node('p','',r.rank.moved?`Moved from #${r.rank.before} to #${r.rank.after}`:`Position #${r.rank.after} in this score snapshot`));
        if(r.latest)body.append(node('small','today-muted','Calculated from the latest available group records.'));
      }catch(e){if(current())body.replaceChildren(node('p','','Points could not be checked. Your saved workout is unchanged.'),button('Retry points',()=>load(true)));}
      finally{busy=false;}
    }
    details.addEventListener('toggle',()=>{if(details.open)load();});
    return details;
  }
  function renderReceipt(receipt=window._forgeLogReceipt){
    const host=$('forgeTodayReceipt');if(!host)return;
    if(!receiptCurrent(receipt)){host.hidden=true;host.replaceChildren();return;}
    const waiting=['checking','pending'].includes(receipt.state);
    if(receipt.state==='confirmed'&&refreshedReceiptId!==receipt.id){refreshedReceiptId=receipt.id;window.ForgeExperience?.invalidateHistory?.();window.ForgeExperience?.warmRecommendations?.();}
    document.querySelectorAll('[data-today-workout]').forEach(b=>{b.disabled=waiting;b.setAttribute('aria-label',waiting?`${b.dataset.todayWorkout} unavailable while the current workout is sending`:`Log ${b.dataset.todayWorkout} now`);const hint=b.querySelector('small');if(hint)hint.textContent=waiting?'Waiting for confirmation':'Tap to log now';});
    const full=document.querySelector('[data-today-full-picker]');if(full){full.disabled=waiting;full.textContent=waiting?'Waiting for confirmation':'Choose another workout';}
    host.hidden=false;host.dataset.receiptState=receipt.state;host.replaceChildren();
    const copy={checking:['Checking destinations…','Nothing has been confirmed yet.'],pending:['Still sending.','Keep Forge open. Don’t log it again while this is pending.'],confirmed:['Logged. That counts.','Every confirmed destination is listed below.'],failed:['This one didn’t land.','Review the details, then log it again when you’re ready.']}[receipt.state]||['Save update',''];
    host.append(node('p','today-kicker','SAVE STATUS'),node('h2','',copy[0]),node('p','today-muted',copy[1]));
    const workoutDate=new Date(receipt.year,receipt.month-1,receipt.day).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'long',year:'numeric'});
    host.append(node('p','today-receipt-workout',`${receipt.workouts.join(' + ')||'Workout'} · ${workoutDate}`));
    const list=node('div','today-receipt-list');
    receipt.groups.forEach(g=>{if(receipt.state==='confirmed'&&receipt.report&&g.status==='confirmed'){list.append(groupPoints(receipt,g));return;}const row=node('div','today-receipt-row');row.dataset.status=g.status;const label={checking:'Checking',pending:'Sending',confirmed:'Confirmed',failed:'Failed',skipped:'Skipped'}[g.status]||g.status;row.append(node('span','',g.name),node('strong','',label+(g.reason?' · '+g.reason:'')));list.append(row);});
    host.append(list);
    const actions=node('div','today-receipt-actions');
    if(receipt.state==='confirmed'&&receipt.report)host.append(node('p','today-muted','Tap a group above to see its points, streak and position.'));
    actions.append(button('Back to Today',()=>{$('forgeToday')?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},'today-button today-button-quiet'));host.append(actions);
    if(receipt.state==='checking'&&shownReceiptId!==receipt.id){
      shownReceiptId=receipt.id;
      requestAnimationFrame(()=>host.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
    }
  }
  function openConfirmedReport(options={}){
    const receipt=window._forgeLogReceipt;
    if(!receiptCurrent(receipt)||receipt.state!=='confirmed'||!receipt.report)return;
    return _openConfirmedReward(receipt,options.initial===true);
  }
  function arrangeDetails(){
    const home=$('page-home'),mount=$('forgeToday'),actions=$('forgeTodayActions');if(!home||!mount||!actions)return;
    const cal=home.querySelector('.mir-calcard');
    if(cal&&cal.nextElementSibling!==actions)home.insertBefore(cal,actions);
    const story=$('forgeMonthStory');if(story&&actions.nextElementSibling!==story)home.insertBefore(story,actions.nextElementSibling);
    const scope=$('forgeTrendScope');if(scope&&window.season)scope.textContent=`Active season: ${MIR_MONTHNAMES[season.month-1]} ${season.year}. Calendar history above has its own month breakdown.`;
    if($('forgeTodayDetails'))return;
    const details=node('details','today-details');details.id='forgeTodayDetails';
    const summary=node('summary','','Season points & all-time trends');
    summary.append(node('span','forge-expand-open','Explore +'),node('span','forge-expand-close','Close −'));details.append(summary);
    const trendScope=node('p','today-muted','Active-season charts and all-time workout tools. Calendar history above has its own month breakdown.');trendScope.id='forgeTrendScope';details.append(trendScope);
    ['goalRingCard','mirChartCard','mirCaptionCard','mirMixCard','mirLiftCard'].forEach(id=>{const el=$(id);if(el)details.append(el);});
    home.append(details);
  }
  function enhanceSheet(){
    const sheet=$('mirSheet');if(!sheet||sheet.dataset.todayAccessible)return;
    sheet.dataset.todayAccessible='';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-labelledby','mirSheetTitle');sheet.setAttribute('aria-hidden','true');sheet.inert=true;
    const close=button('×',()=>mirCloseSheet(),'today-sheet-close');close.setAttribute('aria-label','Close workout picker');sheet.prepend(close);
    sheet.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();mirCloseSheet();return;}
      if(e.key!=='Tab')return;
      const focusable=[...sheet.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(n=>!n.disabled&&!n.inert&&n.getClientRects().length>0);
      const first=focusable[0],last=focusable[focusable.length-1];if(!first)return;
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    });
    let opener=null;const open=window.mirOpenSheet,shut=window.mirCloseSheet;
    window.mirOpenSheet=function(...args){if(!sheet.classList.contains('on'))opener=document.activeElement;sheet.inert=false;sheet.removeAttribute('aria-hidden');const result=open.apply(this,args);requestAnimationFrame(()=>close.focus());return result;};
    window.mirCloseSheet=function(...args){const result=shut.apply(this,args);sheet.setAttribute('aria-hidden','true');sheet.inert=true;if(opener&&opener.isConnected)opener.focus();opener=null;return result;};
  }
  function render(){
    const host=$('forgeToday'),actionsHost=$('forgeTodayActions');if(!host||!actionsHost)return;
    if(!window.me||!window.season){clear();return;}
    document.body.classList.add('forge-today-v1');host.replaceChildren();actionsHost.replaceChildren();
    const now=new Date(),current=season.month===now.getMonth()+1&&season.year===now.getFullYear();
    const myToday=current&&(allLogs||[]).filter(l=>!l.voided&&l.player===me.name&&l.day===now.getDate());
    const pending=window._forgeLogReceipt&&receiptCurrent(window._forgeLogReceipt)&&['checking','pending'].includes(window._forgeLogReceipt.state);
    const groups=button(`Viewing ${(groupData&&groupData.name)||groupCode}`,openGroups,'today-button today-group-control');groups.dataset.todayGroups='';host.append(groups);
    host.append(node('p','today-kicker',now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})));
    const hero=node('div','today-hero'),words=node('div','');words.append(node('h1','',pending?'Sending your workout.':myToday.length?'Already moved today?':'What moved you today?'),node('p','today-lede',pending?'Waiting for confirmation. Your receipt is just below.':myToday.length?'A workout is showing here for today. Add another if it happened.':'A walk, a lift, ten quiet minutes. It all counts.'));
    const mascot=node('img','today-forgeling');mascot.src='assets/forgeling.webp?v=f026-1';mascot.alt='Forgeling, Forge’s quiet workout companion';hero.append(words,mascot);host.append(hero);
    const actions=node('div','today-workouts');recent().forEach(w=>{const b=button('',()=>start(w),'today-workout');b.dataset.todayWorkout=w;b.disabled=pending;b.setAttribute('aria-label',pending?`${w} unavailable while the current workout is sending`:`Log ${w} now`);b.append(sport(w),node('span','today-workout-label',w));actions.append(b);});actionsHost.append(actions);
    const full=button(pending?'Waiting for confirmation':recent().length?'Choose another workout':'Choose your workout',()=>start(),'today-button today-button-primary');full.dataset.todayFullPicker='';full.disabled=pending;actionsHost.append(full);
    if(!recent().length)actionsHost.append(node('p','today-muted','Your usual workouts will find their way here as you log.'));
    if(window.ForgeExperience){const health=button('',()=>ForgeExperience.openHealth(),'today-button forge-health-shortcut');health.innerHTML=ForgeExperience.icon('health')+`<span>${typeof isNative==='function'&&isNative()?ForgeExperience.healthName():'Health connections'}<small>${typeof isNative==='function'&&isNative()?(healthEnabled()?'Review connection & workout suggestions':'Connect for workout suggestions'):'Apple Health / Health Connect · phone app only'}</small></span>`;actionsHost.append(health);}
    const destination=button(`${sessions().length} log destination${sessions().length===1?'':'s'} · review`,openDestinations,'today-link');destination.dataset.todayDestinations='';actionsHost.append(destination);
    if(window.ForgeExperience){const steps=button('',()=>{showTab('lb');$('stepChallengeCard')?.scrollIntoView({block:'start',behavior:'auto'});},'today-button forge-steps-button');steps.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="10" cy="11" rx="4" ry="7" transform="rotate(-20 10 11)"/><ellipse cx="11" cy="23" rx="3" ry="4" transform="rotate(-20 11 23)"/><ellipse cx="23" cy="8" rx="4" ry="7" transform="rotate(20 23 8)"/><ellipse cx="22" cy="20" rx="3" ry="4" transform="rotate(20 22 20)"/></svg><span>Steps Challenge</span><span aria-hidden="true">→</span>';actionsHost.append(steps);}
    const scope=node('section','today-scope');const sc=score(me.name);scope.append(node('p','today-kicker',`${(groupData&&groupData.name)||groupCode} · ${MIR_MONTHNAMES[season.month-1]}`),node('p','today-scope-label','In this group'));
    const stats=node('div','today-stats');[[sc.streak,'day streak'],[sc.total,'points']].forEach(([v,l])=>{const x=node('div','');x.append(node('strong','',String(v)),node('span','',l));stats.append(x);});scope.append(stats);actionsHost.append(scope);
    arrangeDetails();renderReceipt();window.ForgeExperience?.warmRecommendations?.();window.ForgeSupport?.refresh();
  }
  function clear(){
    closeDialog();
    window.ForgeExperience?.cancelHistory?.();
    const story=$('forgeMonthStory');if(story){story.replaceChildren();story._forgeFingerprint=null;story._forgeScope=null;}
    const host=$('forgeToday'),actions=$('forgeTodayActions'),receipt=$('forgeTodayReceipt');if(!host)return;
    host.replaceChildren();host.append(node('p','today-kicker','TODAY'),node('h1','today-loading','Loading your group…'));
    if(actions)actions.replaceChildren();
    if(receipt){receipt.hidden=true;receipt.replaceChildren();}
  }
  function init(){enhanceSheet();arrangeDetails();render();}
  window.ForgeToday={render,clear,renderReceipt,openDestinations,openGroups,openConfirmedReport,openDialog,closeDialog};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* Shared experience: personal month history, accessible chrome and field guide.
   History reads are identity/month scoped. No writes or permission requests. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const paths={
    home:'M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 17h2',
    board:'M4 20V11h5v9 M9 20V5h6v15 M15 20V9h5v11 M2 20h20',
    feed:'M4 5h16v12H9l-5 4z M8 9h8 M8 13h5',
    global:'M12 3l3 6 6 3-6 3-3 6-3-6-6-3 6-3z M12 9v6 M9 12h6',
    admin:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
    profile:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
    refresh:'M20 7a9 9 0 1 0 1 8 M20 3v5h-5',
    theme:'M12 6a6 6 0 0 0 0 12 M12 3v18 M7 4l-1-2 M4 7L2 6 M3 12H1 M4 17l-2 1 M7 20l-1 2 M16 4a8 8 0 0 0 5 14 8 8 0 0 1-5-14',
    health:'M12 21S3 15 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 13-9 13 M5 11h4l2-4 3 8 2-4h3'
  };
  const icon=key=>key==='theme'?'<span class="forge-day-night" aria-hidden="true"><span>🌞</span><span>🌚</span></span>':key==='health'?'<span class="forge-health-heart" aria-hidden="true">♥</span>':`<svg class="forge-ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[key]||paths.home}"/></svg>`;
  // Use only existing approved artwork; adjacent text differentiates muscles
  // that share an Arms/Upper body illustration. Tags never change scoring.
  const muscleOptions=['Chest','Back','Shoulders','Arms','Biceps','Triceps','Legs','Core','Glutes','Full body'];
  const muscleArt={Shoulders:'Upper body',Biceps:'Arms',Triceps:'Arms',Glutes:'Legs','Full body':'Full body workout'};
  function muscleTags(note){
    const aliases={bicep:'Biceps',tricep:'Triceps',shoulder:'Shoulders','full body workout':'Full body'};
    return [...new Set(String(note||'').split(',').map(s=>s.trim().toLowerCase()).map(s=>muscleOptions.find(m=>m.toLowerCase()===s)||aliases[s]).filter(Boolean))];
  }
  function muscleIcon(name){return ForgeSports.icon(muscleArt[name]||name);}
  function gymBadge(tags){
    const unique=[...new Set(tags)].filter(t=>muscleOptions.includes(t)),tier=Math.min(unique.length,3);
    const active=name=>unique.includes('Full body')||unique.includes(name)||(['Biceps','Triceps'].includes(name)&&unique.includes('Arms'));
    const region=(name,d)=>`<path data-muscle="${name}" class="forge-body-region${active(name)?' is-trained':''}" d="${d}"/>`;
    const body='<circle class="forge-body-base" cx="50" cy="15" r="10"/><path class="forge-body-base" d="M39 29 Q50 25 61 29 L70 34 Q74 37 76 46 L85 77 Q86 83 81 85 Q76 87 73 80 L63 53 L63 77 L67 130 Q67 137 60 137 Q55 137 54 130 L50 95 L46 130 Q45 137 40 137 Q33 137 33 130 L37 77 L37 53 L27 80 Q24 87 19 85 Q14 83 15 77 L24 46 Q26 37 30 34 Z"/>';
    const front=region('Chest','M38 37 Q43 33 49 35 L49 49 Q42 51 37 47 Z M51 35 Q57 33 62 37 L63 47 Q58 51 51 49 Z')+region('Core','M40 53 L60 53 L59 74 Q50 80 41 74 Z')+region('Biceps','M28 46 L35 49 L30 64 L24 62 Z M65 49 L72 46 L76 62 L70 64 Z');
    const back=region('Back','M38 37 Q50 32 62 37 L60 67 L50 75 L40 67 Z')+region('Glutes','M39 78 L49 78 L49 91 L37 92 Z M51 78 L61 78 L63 92 L51 91 Z')+region('Triceps','M28 46 L35 49 L30 64 L24 62 Z M65 49 L72 46 L76 62 L70 64 Z');
    const shared=region('Shoulders','M30 35 L37 33 L36 45 L27 43 Z M63 33 L70 35 L73 43 L64 45 Z')+region('Legs','M38 95 L47 95 L43 129 Q41 134 37 130 Z M53 95 L62 95 L63 130 Q59 134 57 129 Z');
    return `<span class="forge-gym-badge forge-gym-tier-${tier} forge-anatomy" aria-hidden="true">${[['Front',front],['Back',back]].map(([view,parts])=>`<svg viewBox="0 0 100 154" data-body-view="${view.toLowerCase()}">${body}${parts}${shared}<text x="50" y="151" text-anchor="middle">${view}</text></svg>`).join('')}</span>`;
  }
  function gymModel(M){
    const byDay={},groups=new Map();
    for(const [key,logs] of Object.entries(M.byDay||{})){
      const day=Number(key);if(!Number.isInteger(day)||day<1||day>M.days)continue;
      const lifts=logs.filter(l=>!l.voided&&(l.workouts||[]).some(w=>window.isLiftWorkout?.(w)));
      if(!lifts.length)continue;
      const tags=[...new Set(lifts.flatMap(l=>muscleTags(l.note)))];byDay[day]={tags,sessions:lifts.length};
      for(const tag of tags){const g=groups.get(tag)||{name:tag,days:[],last:day};g.days.push(day);g.last=Math.max(g.last,day);groups.set(tag,g);}
    }
    return {byDay,groups:[...groups.values()].sort((a,b)=>b.days.length-a.days.length||a.name.localeCompare(b.name))};
  }
  let gymRequest=0;
  async function openGymHistory(month,year,body){
    const now=new Date(),date=new Date(Number(year),Number(month)-1,1),latest=new Date(now.getFullYear(),now.getMonth(),1);
    if(!Number.isFinite(date.getTime())||date>latest)return;
    if(!body){body=document.createElement('div');body.className='today-dialog-body';ForgeToday.openDialog('Your gym calendar',body);}
    const request=++gymRequest,version=personalVersion,context=personalContext();
    const current=()=>request===gymRequest&&version===personalVersion&&context.key===personalContext().key&&body.isConnected;
    const nav=`<div class="forge-recap-nav"><button type="button" class="today-link" data-gym-prev aria-label="Previous gym month">← Previous month</button><strong>${esc(date.toLocaleDateString('en-GB',{month:'long',year:'numeric'}))}</strong><button type="button" class="today-link" data-gym-next ${+date===+latest?'disabled':''} aria-label="Next gym month">Next →</button></div>`;
    const bind=()=>{body.querySelector('[data-gym-prev]').onclick=()=>openGymHistory(month-1,year,body);body.querySelector('[data-gym-next]').onclick=()=>openGymHistory(month+1,year,body);};
    body.innerHTML=nav+'<p role="status">Loading your gym diary…</p>';bind();
    try{
      const result=await loadPersonalMonth(context,date.getMonth()+1,date.getFullYear());if(!current())return;
      if(result.unavailable)throw Error('History unavailable');
      const M=mirMonthDesc(date.getMonth()+1,date.getFullYear(),true,result.logs);
      body.innerHTML=nav+gymJournal(M,result.partial)+(result.partial?'<p class="forge-history-warning">Some records could not be checked. This calendar is incomplete.</p>':'')+'<p class="today-muted">Across your linked groups. Tap a recorded day for its workouts. Empty months remain browsable.</p>';bind();
      body.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>openDay(M,Number(b.dataset.day)));
    }catch(e){if(!current())return;body.innerHTML=nav+'<p>History could not be loaded—not zero workouts.</p><button type="button" class="today-button" data-gym-retry>Try again</button>';bind();body.querySelector('[data-gym-retry]').onclick=()=>{invalidateHistory();openGymHistory(month,year,body);};}
  }
  function gymJournal(M,partial){
    const model=gymModel(M),offset=(new Date(M.year,M.month-1,1).getDay()+6)%7;
    const days=Array.from({length:M.days},(_,i)=>i+1);
    const today=new Date(),current=M.year===today.getFullYear()&&M.month===today.getMonth()+1;
    const oldest=model.groups.slice().sort((a,b)=>a.last-b.last)[0];
    const gap=oldest?today.getDate()-oldest.last:0;
    const reminder=!partial&&current&&model.groups.length>1&&gap>=4?`<p class="forge-gym-nudge">${esc(oldest.name)} last appeared ${gap} days ago. Still in the rotation? <small>Based on this month’s tags, not a training recommendation.</small></p>`:'';
    return `${reminder}<p class="forge-explainer">Your training diary. More tagged groups build a fuller badge—not extra points or a workout rating.</p><div class="forge-muscle-summary">${model.groups.map(g=>`<span>${muscleIcon(g.name)}<b>${esc(g.name)}</b><small>${g.days.length} ${g.days.length===1?'day':'days'}</small></span>`).join('')}</div><div class="forge-gym-calendar" aria-label="Gym calendar for ${esc(M.label)} ${M.year}">${['M','T','W','T','F','S','S'].map(d=>`<span class="forge-gym-weekday" aria-hidden="true">${d}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(offset)}${days.map(day=>{const entry=model.byDay[day];return entry?`<button type="button" data-day="${day}" aria-label="${esc(M.label)} ${day}: ${entry.sessions} strength ${entry.sessions===1?'session':'sessions'}; ${esc(entry.tags.join(', ')||'muscles not tagged')}"><b>${day}</b>${gymBadge(entry.tags)}</button>`:`<span class="forge-gym-empty"><b>${day}</b><span aria-hidden="true">·</span></span>`;}).join('')}</div>`;
  }
  function monthStats(M){
    const activities=new Map(),gym=[];let count=0;
    const days=Object.keys(M.byDay||{}).map(Number).filter(d=>Number.isInteger(d)&&d>=1&&d<=M.days).sort((a,b)=>a-b);
    for(const day of days)for(const log of M.byDay[day]||[]){
      for(const raw of log.workouts||[]){
        const name=String(raw).trim();if(!name)continue;
        const key=name.toLowerCase(),item=activities.get(key)||{label:name,count:0,days:[]};
        item.count++;if(!item.days.includes(day))item.days.push(day);activities.set(key,item);count++;
      }
      if((log.workouts||[]).some(w=>typeof window.isLiftWorkout==='function'&&window.isLiftWorkout(w)))gym.push({day,note:log.note||'No muscle-group note recorded',workouts:log.workouts});
    }
    return {days,count,activities:[...activities.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label)),gym};
  }
  function openDay(M,day){
    const body=document.createElement('div');body.className='today-dialog-body';
    const note=document.createElement('p');note.className='today-muted';note.textContent='Recorded workouts · read-only history';body.append(note);
    for(const log of M.byDay[day]||[]){const row=document.createElement('div');row.className='forge-history-row';
      const art=document.createElement('span');art.innerHTML=ForgeSports.icon((log.workouts||[])[0]||'Other');
      const words=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('p');
      name.textContent=(log.workouts||[]).join(' + ')||'Workout';detail.textContent=log.note||'No extra note recorded.';
      words.append(name,detail);row.append(art,words);body.append(row);
    }
    ForgeToday.openDialog(`${M.label} ${day}, ${M.year}`,body);
  }
  const personalCache=new Map(),personalPending=new Map();
  let personalVersion=0,monthRequest=0;
  const recommendationCache=new Map();
  function rankWorkouts(logs,now=new Date(),limit=3){
    const end=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()),start=end-59*86400000,items=new Map();
    for(const log of logs){
      const day=Date.UTC(log.year,log.month-1,log.day);
      if(log.voided||log.demo||!Number.isInteger(log.day)||!Number.isInteger(log.month)||!Number.isInteger(log.year)||log.month<1||log.month>12||log.day<1||log.day>new Date(log.year,log.month,0).getDate()||!Number.isFinite(day)||day<start||day>end)continue;
      for(const raw of log.workouts||[]){
        const label=String(raw).trim();if(!label)continue;
        const key=label.toLowerCase(),item=items.get(key)||{label,days:new Set(),last:0};
        item.days.add(day);item.last=Math.max(item.last,day);items.set(key,item);
      }
    }
    const ranked=[...items.values()].sort((a,b)=>b.days.size-a.days.size||b.last-a.last||a.label.localeCompare(b.label));
    const favourites=ranked.slice(0,2),recent=ranked.filter(x=>!favourites.includes(x)).sort((a,b)=>b.last-a.last||a.label.localeCompare(b.label))[0];
    const chosen=[...favourites,...(recent?[recent]:[])];
    return [...chosen,...ranked.filter(x=>!chosen.includes(x))].slice(0,Math.max(0,Math.min(5,limit))).map(x=>x.label);
  }
  function recommendedWorkouts(limit=3){
    const context=personalContext(),cached=recommendationCache.get(context.key);
    if(cached?.values)return cached.values.slice(0,limit);
    const logs=(window.allLogs||[]).filter(l=>context.uid?l.userId===context.uid||(!l.userId&&l.player===context.name):l.player===context.name);
    return rankWorkouts(logs.map(l=>({...l,month:l.month||window.season?.month,year:l.year||window.season?.year})),new Date(),limit);
  }
  function warmRecommendations(){
    const context=personalContext(),version=personalVersion,existing=recommendationCache.get(context.key);
    if(existing?.version===version)return;
    const entry={version,values:existing?.values};recommendationCache.set(context.key,entry);
    const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-59),months=[];
    for(let d=new Date(start.getFullYear(),start.getMonth(),1);d<=now;d=new Date(d.getFullYear(),d.getMonth()+1,1))months.push([d.getMonth()+1,d.getFullYear()]);
    Promise.all(months.map(([m,y])=>loadPersonalMonth(context,m,y))).then(results=>{
      if(version!==personalVersion||context.key!==personalContext().key)return;
      if(results.every(r=>r.unavailable))return;
      entry.values=rankWorkouts(results.flatMap(r=>r.logs),now,5);
      if(!document.getElementById('mirSheet')?.classList.contains('on')&&!['checking','pending'].includes(window._forgeLogReceipt?.state))window.ForgeToday?.render();
    }).catch(()=>{});
  }
  function personalContext(){
    const actor=window.me||{},uid=actor.userId||null,code=window.groupCode,name=actor.name;
    const linked=(typeof getSessions==='function'?getSessions():[]).filter(s=>s?.player?.name&&(uid?s.player.userId===uid:s.code===code&&s.player.name===name));
    if(!linked.some(s=>s.code===code))linked.push({code,player:{name,userId:uid}});
    const sources=[...new Map(linked.filter(s=>s.code&&s.player.name).map(s=>[s.code,{code:s.code,name:s.player.name}])).values()].sort((a,b)=>a.code.localeCompare(b.code));
    return {uid,code,name,sources,key:JSON.stringify([uid||[code,name],sources])};
  }
  // Fan-out copies have the same date/activity set. Keep multiple records
  // within one group, but not extra copies merely because more groups exist.
  function personalSessions(logs){
    const buckets=new Map(),seen=new Set();
    for(const log of logs){
      if(log.voided||log.demo===true||log.groupCode==='FORGE1'||!Number.isInteger(log.day)||log.day<1||log.day>new Date(log.year,log.month,0).getDate())continue;
      const id=log.id&&`${log.groupCode}|${log.id}`;if(id&&seen.has(id))continue;if(id)seen.add(id);
      const workouts=(Array.isArray(log.workouts)?log.workouts:log.workout?[log.workout]:[]).map(w=>String(w).trim()).filter(Boolean);
      if(!workouts.length)continue;
      const key=JSON.stringify([log.year,log.month,log.day,workouts.map(w=>w.toLowerCase()).sort()]);
      const groups=buckets.get(key)||new Map(),code=log.groupCode||'unknown';
      const copies=groups.get(code)||[];copies.push({...log,workouts});groups.set(code,copies);buckets.set(key,groups);
    }
    const out=[];
    for(const groups of buckets.values()){
      const rows=[...groups.values()].sort((a,b)=>b.length-a.length||b.reduce((n,l)=>n+String(l.note||'').length,0)-a.reduce((n,l)=>n+String(l.note||'').length,0));
      const chosen=rows[0].map(l=>({...l}));
      const notes=new Set(chosen.map(l=>String(l.note||'').trim()).filter(Boolean));
      for(const copy of rows.slice(1).flat()){
        const note=String(copy.note||'').trim();if(!note||notes.has(note))continue;
        const bare=chosen.find(l=>!String(l.note||'').trim());if(bare){bare.note=copy.note;notes.add(note);}
      }
      out.push(...chosen);
    }
    return out;
  }
  async function loadPersonalMonth(context,month,year){
    const key=`${personalVersion}|${context.key}|${year}-${month}`,cached=personalCache.get(key);
    if(cached&&Date.now()-cached.at<(cached.value.partial?10000:120000))return cached.value;
    if(personalPending.has(key))return personalPending.get(key);
    const p=(async()=>{
      const all=[],failures=[];
      const take=(snap,canonical=false)=>{for(const d of snap.docs){const l={id:d.id,...d.data()};if(l.year===year&&l.month===month&&!l.voided&&(!canonical||l.userId===context.uid))all.push(l);}};
      if(context.uid){try{take(await db.collection('logs').where('userId','==',context.uid).where('year','==',year).where('month','==',month).get(),true);}catch(e){failures.push('profile');}}
      await Promise.all(context.sources.map(async s=>{try{
        const snap=await db.collection('logs').where('groupCode','==',s.code).where('player','==',s.name).where('year','==',year).where('month','==',month).get();
        take({docs:snap.docs.filter(d=>{const l=d.data();return l.player===s.name&&l.groupCode===s.code&&(!l.userId||l.userId===context.uid);})});
      }catch(e){failures.push(s.code);}}));
      const value={logs:personalSessions(all),partial:failures.length>0||!context.uid,unavailable:failures.length===context.sources.length+(context.uid?1:0)};
      personalCache.set(key,{at:Date.now(),value});
      return value;
    })();
    personalPending.set(key,p);try{return await p;}finally{personalPending.delete(key);}
  }
  function invalidateHistory(){personalVersion++;personalCache.clear();monthRequest++;}
  function cancelHistory(){monthRequest++;gymRequest++;cancelRecap();}
  async function renderMonth(M){
    const host=$('forgeMonthStory');if(!host)return;
    const context=personalContext(),request=++monthRequest,scope=`${context.key}|${M.year}-${M.month}`;
    if(host._forgeScope!==scope){host._forgeScope=scope;host._forgeFingerprint=null;host.innerHTML='<p class="today-kicker">YOUR MONTH · ACROSS YOUR GROUPS</p><p class="today-muted" role="status">Gathering your workouts…</p>';}
    try{
      const result=await loadPersonalMonth(context,M.month,M.year);
      if(request!==monthRequest||context.key!==personalContext().key||!host.isConnected)return;
      if(result.unavailable)throw Error('PERSONAL_HISTORY_UNAVAILABLE');
      const personal=mirMonthDesc(M.month,M.year,M.readonly,result.logs);
      paintMonth(personal,scope,result.partial);
    }catch(e){if(request!==monthRequest)return;host._forgeFingerprint=null;host.replaceChildren();const msg=document.createElement('p');msg.className='today-muted';msg.textContent='Your month could not be loaded. This does not mean zero workouts.';host.append(msg);const retry=document.createElement('button');retry.type='button';retry.className='today-button';retry.textContent='Retry personal history';retry.onclick=()=>{invalidateHistory();renderMonth(M);};host.append(retry);}
  }
  function paintMonth(M,scope,partial){
    const host=$('forgeMonthStory');if(!host)return;
    const data=monthStats(M),label=`${M.label} ${M.year}`;
    const fingerprint=scope+JSON.stringify({data,byDay:M.byDay,readonly:M.readonly,partial});
    if(host._forgeFingerprint===fingerprint)return;
    const same=host._forgeScope===scope,expanded=same&&host.querySelector('.forge-gym-details')?.open;
    const active=document.activeElement,focused=same&&host.contains(active)?{day:active.dataset.day,activity:active.dataset.activity}:null;
    host._forgeFingerprint=fingerprint;host._forgeScope=scope;
    host.innerHTML=`<div class="forge-section-head"><div><p class="today-kicker">YOUR MONTH · ${esc(label)}</p><h2>Small efforts. Added up.</h2></div>${ForgeSports.icon('Gym')}</div>
      <div class="forge-month-numbers"><div><b>${data.days.length}</b><span>days with a workout</span></div><div><b>${data.count}</b><span>recorded activities</span></div><div><b>${data.activities.length}</b><span>ways you moved</span></div></div>
      <p class="forge-explainer">${M.readonly?'Past month · read-only. ':'Month in progress. '}Your personal workouts across groups linked to this profile. Matching same-day activity entries shared to several groups count once; separate entries within a group remain separate.</p>
      ${partial?'<p class="forge-history-warning" role="status">Partial history: some records could not be checked, or your profile is not linked yet. These are not complete monthly totals.</p><button type="button" class="today-button" data-history-retry>Retry personal history</button>':''}
      <h3>Workout breakdown</h3><div class="forge-activity-bars">${data.activities.length?data.activities.map((a,i)=>`<button type="button" class="forge-activity-row" data-activity="${i}" aria-label="Show ${esc(a.label)} dates in ${esc(label)}">${ForgeSports.icon(a.label)}<span><strong>${esc(a.label)}</strong><span class="forge-bar"><i style="width:${Math.round(a.count/data.count*100)}%"></i></span></span><b>${a.count}<small>${Math.round(a.count/data.count*100)}%</small></b></button>`).join(''):'<p class="today-muted">No recorded workouts for this month. Earlier months are available with the arrows above.</p>'}</div>
      <details class="forge-gym-details"><summary>Gym & strength calendar <span>${data.gym.length} ${data.gym.length===1?'entry':'entries'} · open calendar</span></summary>${gymJournal(M,partial)}<button type="button" class="today-button today-button-secondary" data-gym-history>Browse previous months →</button>${data.gym.length?'':'<p class="today-muted">No strength sessions recorded this month. Choose Gym when logging to add optional muscle tags.</p>'}</details>`;
    host.querySelector('.forge-gym-details').open=!!expanded;
    host.querySelector('[data-gym-history]')?.addEventListener('click',()=>openGymHistory(M.month,M.year));
    host.querySelector('[data-history-retry]')?.addEventListener('click',()=>{invalidateHistory();renderMonth(M);});
    host.querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>openDay(M,Number(b.dataset.day))));
    host.querySelectorAll('[data-activity]').forEach(b=>b.addEventListener('click',()=>{
      const a=data.activities[Number(b.dataset.activity)],body=document.createElement('div');body.className='today-dialog-body';
      const copy=document.createElement('p');copy.className='today-muted';copy.textContent=`${a.count} recorded ${a.label} ${a.count===1?'activity':'activities'} across ${a.days.length} ${a.days.length===1?'day':'days'} in ${label}.`;body.append(copy);
      a.days.forEach(day=>{const row=document.createElement('button');row.type='button';row.className='today-button today-button-secondary';row.textContent=`${M.label} ${day} · view recorded workouts`;row.onclick=()=>openDay(M,day);body.append(row);});
      ForgeToday.openDialog(`${a.label} · ${M.label}`,body);
    }));
    if(focused){const selector=focused.day?`[data-day="${Number(focused.day)}"]`:focused.activity!=null?`[data-activity="${Number(focused.activity)}"]`:'.forge-gym-details summary';host.querySelector(selector)?.focus({preventScroll:true});}
  }
  function recapRange(kind,offset=0,now=new Date()){
    offset=Math.min(0,Math.trunc(Number(offset)||0));
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    let start,end;
    if(kind==='week'){
      start=new Date(today);start.setDate(start.getDate()-(start.getDay()+6)%7+offset*7);
      end=new Date(start);end.setDate(end.getDate()+6);
    }else{start=new Date(today.getFullYear(),today.getMonth()+offset,1);end=new Date(start.getFullYear(),start.getMonth()+1,0);}
    return {start,end,through:end>today?today:end,kind:kind==='week'?'week':'month',offset};
  }
  function recapSummary(logs,range){
    const dayKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const byDay=new Map(),types=new Map();let sessions=0;
    for(const log of personalSessions(logs)){
      const date=new Date(log.year,log.month-1,log.day);if(date<range.start||date>range.through)continue;
      sessions++;const key=dayKey(date);byDay.set(key,(byDay.get(key)||0)+1);
      for(const w of log.workouts||[])types.set(w,(types.get(w)||0)+1);
    }
    const days=[];
    for(let d=new Date(range.start);d<=range.end;d.setDate(d.getDate()+1))days.push({key:dayKey(d),day:d.getDate(),weekday:d.toLocaleDateString('en-GB',{weekday:'short'}),count:byDay.get(dayKey(d))||0,future:d>range.through});
    return {sessions,activeDays:byDay.size,days,types:[...types].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))};
  }
  let recapRequest=0;
  function cancelRecap(){recapRequest++;}
  async function openRecap(kind,offset=0){
    const host=$('forgePersonalRecap');if(!host)return;
    const request=++recapRequest,version=personalVersion,context=personalContext(),range=recapRange(kind,offset);
    const current=()=>request===recapRequest&&version===personalVersion&&context.key===personalContext().key&&host.isConnected;
    host.innerHTML='<p class="today-muted" role="status">Gathering your personal recap…</p>';
    const fmt=d=>d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    document.querySelectorAll('[data-recap-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.recapKind===range.kind)));
    try{
      const months=[];for(let d=new Date(range.start.getFullYear(),range.start.getMonth(),1);d<=range.through;d.setMonth(d.getMonth()+1))months.push({month:d.getMonth()+1,year:d.getFullYear()});
      const results=await Promise.all(months.map(m=>loadPersonalMonth(context,m.month,m.year)));if(!current())return;
      if(results.every(r=>r.unavailable))throw Error('History unavailable');
      const partial=results.some(r=>r.partial||r.unavailable),data=recapSummary(results.flatMap(r=>r.logs),range);
      host.innerHTML=`<div class="forge-recap-heading"><div><p class="today-kicker">${range.kind==='week'?'WEEKLY':'MONTHLY'} RECAP · ${offset===0?'SO FAR':'PAST PERIOD'}</p><h3>${esc(fmt(range.start))} – ${esc(fmt(range.end))}</h3></div>${ForgeSports.icon(data.types[0]?.[0]||'Gym')}</div><div class="forge-month-numbers"><div><b>${data.activeDays}</b><span>days you moved</span></div><div><b>${data.sessions}</b><span>workout entries</span></div><div><b>${data.types.length}</b><span>activity types</span></div></div><p class="forge-explainer">Across groups linked to your profile. Shared copies count once. ${partial?'Some history is unavailable; these totals are incomplete.':'Based on recorded workouts—not a fitness score.'}</p><div class="forge-recap-days">${data.days.map(d=>`<span class="${d.count?'is-recorded':''} ${d.future?'is-future':''}" title="${esc(d.key)}: ${d.future?'upcoming':d.count+' workout entries'}"><small>${esc(d.weekday)}</small><b>${d.day}</b><span>${d.future?'–':d.count?'●':'·'}</span></span>`).join('')}</div><div class="forge-recap-mix">${data.types.map(([name,n])=>`<span>${ForgeSports.icon(name)}<b>${esc(name)}</b><small>${n}</small></span>`).join('')||'<p class="today-muted">No workouts recorded in this period. That is a record, not a verdict.</p>'}</div><div class="forge-recap-nav"><button type="button" class="today-link" data-recap-prev>← Previous ${range.kind}</button><button type="button" class="today-link" data-recap-next ${range.offset===0?'disabled':''}>Next ${range.kind} →</button>${partial?'<button type="button" class="today-link" data-recap-retry>Retry missing history</button>':''}</div>`;
      host.querySelector('[data-recap-prev]').onclick=()=>openRecap(range.kind,range.offset-1);
      host.querySelector('[data-recap-next]').onclick=()=>openRecap(range.kind,range.offset+1);
      host.querySelector('[data-recap-retry]')?.addEventListener('click',()=>{invalidateHistory();openRecap(range.kind,range.offset);});
    }catch(e){if(!current())return;host.innerHTML='<p class="today-muted">The recap could not be loaded. This does not mean zero workouts.</p><button type="button" class="today-link" data-recap-retry>Try again</button>';host.querySelector('[data-recap-retry]').onclick=()=>{invalidateHistory();openRecap(kind,offset);};}
  }
  function profileStats(stats,streak,name){
    const n=v=>Number.isFinite(Number(v))?Math.max(0,Math.trunc(Number(v))):0;
    return `<div class="forge-profile-heading"><div><p class="today-kicker">YOUR TRAINING RECORD</p><h2>${esc(name||'Your Forge')}</h2><p class="today-muted">Small efforts. A growing story.</p></div><img src="assets/forgeling.webp?v=f026-1" alt="Happy Forgeling"></div><div class="forge-profile-record"><div class="forge-profile-total">${ForgeSports.icon('Gym')}<b>${n(stats.totalWorkouts)}</b><span>workouts logged</span><small>Lifetime profile total</small></div><div class="forge-profile-streak">${ForgeSports.flame()}<b>${n(streak)} <small>days</small></b><span>current streak</span><p>${streak?'One day at a time.':'Your next chapter can start any day.'}</p></div><div class="forge-profile-milestone"><b>${n(stats.longestStreak)} <small>days</small></b><span>longest streak</span></div><div class="forge-profile-milestone"><b>${n(stats.monthsLogged)}</b><span>months with a workout</span></div></div>`;
  }
  function soloSummary(logs,range){
    const end=range.through;
    return {...window.scoreSoloDays(personalSessions(logs),range.start.getFullYear(),range.start.getMonth()+1,end.getDate()),rank:null};
  }
  let soloRequest=0;
  async function openSolo(offset=0,body){
    if(window.ForgeWelcome&&!ForgeWelcome.allowSolo())return;
    if(window.FEATURE_GOOGLE_AUTH&&window.ForgeSolo)return window.ForgeSolo.open();
    if(!body){body=document.createElement('div');body.className='today-dialog-body';ForgeToday.openDialog('Solo · your own lane',body);}
    const request=++soloRequest,version=personalVersion,context=personalContext(),range=recapRange('month',offset);
    const current=()=>request===soloRequest&&version===personalVersion&&context.key===personalContext().key&&body.isConnected;
    body.innerHTML='<p role="status">Gathering your personal workout days…</p>';
    try{
      const result=await loadPersonalMonth(context,range.start.getMonth()+1,range.start.getFullYear());if(!current())return;
      if(result.unavailable)throw Error('History unavailable');
      const data=soloSummary(result.logs,range);
      body.innerHTML=`<p class="today-kicker">SOLO · ${esc(range.start.toLocaleDateString('en-GB',{month:'long',year:'numeric'}))}</p><h2>Your effort. Your own lane.</h2><div class="forge-month-numbers"><div><b>${data.days}</b><span>workout days</span></div><div><b>${data.base}</b><span>base points · 4 per day</span></div><div><b>${data.bonus}</b><span>streak points · +1, +2, +3 max</span></div></div><p class="forge-history-warning">Personal rules preview · ${data.total} points. Not an active competition or published rank. This never changes your group points and never enters a group leaderboard.${result.partial?' Some history is missing; the score is incomplete.':''}</p><p class="today-muted">4 base points per workout day, plus a daily streak bonus of 1, 2, then 3 (capped). A missed day resets the run; each month starts a new run. Uses your existing personal workout history. Standalone solo enrolment and its separate leaderboard are not enabled yet.</p><div class="forge-recap-nav"><button type="button" class="today-link" data-solo-prev>← Previous month</button><button type="button" class="today-link" data-solo-next ${range.offset===0?'disabled':''}>Next month →</button></div>`;
      body.querySelector('[data-solo-prev]').onclick=()=>openSolo(range.offset-1,body);body.querySelector('[data-solo-next]').onclick=()=>openSolo(range.offset+1,body);
    }catch(e){if(!current())return;body.innerHTML='<p>Personal history is unavailable—not zero effort.</p><button class="today-button" data-solo-retry>Try again</button>';body.querySelector('[data-solo-retry]').onclick=()=>{invalidateHistory();openSolo(offset,body);};}
  }
  function loggingHelp(){
    const body=document.createElement('div');body.className='today-dialog-body forge-companion';
    body.innerHTML='<img src="assets/forgeling.webp?v=f026-1" alt="Happy Forgeling"><h2>One workout. Less paperwork.</h2><ol><li>Pick the day you actually moved.</li><li>Choose your activities. For Gym, add optional muscle tags—the body fills in as you choose.</li><li>Review the destination groups, then save once.</li><li>Wait for the confirmed receipt. Pending means still sending; it is not a second workout.</li></ol><p>Health suggestions follow the same review-and-confirm rule. A connection alone does not prove a workout was logged.</p><button type="button" class="today-button" data-log-guide-close>Got it · back to logging</button>';
    ForgeToday.openDialog('Forgeling’s logging guide',body);body.querySelector('[data-log-guide-close]').onclick=()=>ForgeToday.closeDialog();
  }
  function announcementPreview(){ return announcementComposer(); }
  function announcementComposer(){ return window.ForgeAnnouncements?.composer(); }
  function healthName(){
    const c=window.Capacitor,platform=c&&(typeof c.getPlatform==='function'?c.getPlatform():c.platform);
    return platform==='android'?'Health Connect':platform==='ios'?'Apple Health':'Apple Health / Health Connect';
  }
  function openHealth(){
    showTab('profile');const settings=document.querySelector('#page-profile .pfold');if(settings)settings.open=true;
    renderHealthCard();requestAnimationFrame(()=>{$('healthCard')?.scrollIntoView({block:'start',behavior:'auto'});$('healthCard')?.focus({preventScroll:true});});
  }
  function renderFAQ(){
    const host=$('forgeFAQ');if(!host||host.dataset.ready)return;host.dataset.ready='true';
    const items=[
      ['Keep your workout history with you','Other',window.FEATURE_GOOGLE_AUTH?'In Profile, link Google'+(window.FEATURE_APPLE_AUTH?' or Apple':'')+' and confirm your existing Forge PIN once. Linking helps protect access to your history and recover it on another phone. Your groups and workouts stay in place. New members start with provider sign-in. Choose your own account; do not share your PIN.':'Google and Apple linking is being prepared. When available, it will help protect access to your workout history and recover it on another phone. Keep using your existing sign-in for now.'],
      ['Log without the homework','Walk','Tap a calendar day or a workout icon. A confirmed receipt lists the groups that received it. “Sending” does not mean saved. Add another activity only if you actually did it.'],
      ['Where are previous months?','Yoga','Use the labelled arrows above your calendar. The workout breakdown follows the month you are viewing. Tap a logged past day to read its activities and notes; closed months cannot be edited.'],
      ['What does the month graph mean?','Run','The cumulative chart counts workout days, not calories, steps or fitness improvement. Multiple activities on one day still count as one day. Its heading identifies the active season; calendar history has its own monthly breakdown.'],
      ['Where is my gym breakdown?','Gym','Open Gym & strength journal below the calendar. Optional muscle-group notes are recorded when you log. Forge cannot reconstruct sets, reps or unrecorded body parts. Notes on shared workouts are visible to your groups.'],
      ['How do points and ranks work?','Trophy','The group board uses your season’s scoring rules. Tap a person for the points breakdown. Teams and People are different views. A log only gets a rank animation when a confirmed save actually changes your rank.'],
      ['One workout, several groups?','Team sport','Forge checks each linked group when you save. Groups in another season or that cannot be reached are identified in the receipt. Group-specific bonuses mean the same workout can lead to different point totals.'],
      ['How do I add another group?','Team sport','On Today, tap Change beside your group name, then Join another group. Enter the group code and use the same linked Google or Apple account. After joining, review and copy your saved group workouts from this month. Existing copies are skipped. Previous months, Solo workouts and other people’s records stay unchanged. You can reopen the review from Change → Bring this month’s workouts.'],
      ['Connect your phone health app','Walk',`${healthName()} is optional in the phone app. Forge suggests recorded workouts for you to confirm. Confirmed logs are shared to your groups; enabled step challenges also upload daily step totals. Browser staging cannot read phone health data.`],
      ['Notifications, on your terms','Other','Open Settings & devices in Profile to choose reminders. You can say “not now” and return later. The tour never grants a permission or turns notifications on for you.'],
      ['Who can see me on All Forge?','Team sport','The People board uses explicit visibility consent. Your best group score is used rather than adding all your memberships. Group averages are labelled; different group rules mean this is not a universal fitness ranking.'],
      ['Need a hand?','Other','Open Talk to Forge in Profile to message Nirag privately. You can see when he acknowledges it, starts working and resolves it. Google or Apple linking keeps the conversation with your account. Email team@goforge.in if you cannot sign in.']
    ];
    host.innerHTML=`<div class="forge-guide-heading"><img src="assets/forgeling.webp?v=f026-1" alt="Forgeling"><div><p class="today-kicker">THE FIELD GUIDE</p><h2>A little help. Whenever.</h2><p class="today-muted">The answers stay here after Forgeling hops off.</p></div></div>`+items.map(([title,art,copy])=>`<details class="forge-faq-item"><summary>${ForgeSports.icon(art)}<span>${title}</span></summary><p>${esc(copy)}</p></details>`).join('')+'<div class="forge-help-actions"><button type="button" class="today-button" onclick="startTour(true)">Walk me through Forge</button><button type="button" class="today-link" onclick="confirmConnReset()">Connection troubleshooting</button></div>';
  }
  function enhanceShell(){
    if(window.IS_STAGING)document.body.classList.add('forge-staging-ui');
    const labels=['Today','Board','Feed','All Forge','Admin'],keys=['home','board','feed','global','admin'];
    document.querySelectorAll('#screen-app .tabs .tab').forEach((old,i)=>{
      if(i>=5)return;
      let el=old;
      if(old.tagName!=='BUTTON'){
        el=document.createElement('button');for(const a of old.attributes)el.setAttribute(a.name,a.value);el.type='button';old.replaceWith(el);
      }
      el.innerHTML=icon(keys[i])+`<span>${labels[i]}</span>`;el.setAttribute('aria-label',labels[i]);
    });
    const profile=$('profileBtn');if(profile){profile.innerHTML=icon('profile');profile.setAttribute('aria-label','Profile, history and help');}
    const refresh=$('connResetBtn');if(refresh){refresh.innerHTML=icon('refresh');refresh.style.opacity='1';refresh.title='Refresh group';refresh.setAttribute('aria-label','Refresh group');refresh.onclick=async()=>{
      if(window._forgeLogReceipt&&typeof _isSubmissionViewCurrent==='function'&&_isSubmissionViewCurrent(window._forgeLogReceipt)&&['checking','pending'].includes(window._forgeLogReceipt.state)){toast('Let the current workout finish sending first.');return;}
      if(!window.groupCode)return;refresh.disabled=true;
      invalidateHistory();toast('Checking your group for updates…');
      try{await loadGroup(groupCode,true,{manual:true});}catch(e){toast('Could not refresh. Check your connection.','error');}finally{refresh.disabled=false;}
    };}
    const theme=$('themeToggle');if(theme){theme.innerHTML=icon('theme');theme.setAttribute('aria-label','Switch light or dark theme');}
    renderFAQ();
  }
  window.ForgeExperience={monthStats,renderMonth,openDay,healthName,openHealth,renderFAQ,enhanceShell,icon,personalSessions,personalContext,loadPersonalMonth,invalidateHistory,cancelHistory,muscleOptions,muscleTags,muscleIcon,gymBadge,gymModel,gymJournal,openGymHistory,recapRange,recapSummary,openRecap,cancelRecap,profileStats,soloSummary,openSolo,loggingHelp,announcementPreview,announcementComposer};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhanceShell);else enhanceShell();
  Object.assign(window.ForgeExperience,{rankWorkouts,recommendedWorkouts,warmRecommendations});
})();

/* Solo mode is implemented in solo.js using the shared Forge components. */

/* Private, provider-owned support. No client PIN can open the admin inbox. */
(() => {
  'use strict';
  const labels={sent:'Sent',acknowledged:'Acknowledged',working:'Working on it',resolved:'Resolved'};
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
  const button=(text,fn)=>{const b=node('button',text,'today-button');b.type='button';b.onclick=fn;return b;};
  const actor=()=>window.auth?.currentUser&&!auth.currentUser.isAnonymous?auth.currentUser.uid:null;
  let refreshKey='',refreshedAt=0,noticeKey='';
  function badge(count){const el=document.getElementById('forgeSupportUnread');if(el)el.textContent=count?'· New reply or update':'';const profile=document.getElementById('profileBtn');if(profile){profile.classList.toggle('forge-has-update',!!count);profile.setAttribute('aria-label',count?'Profile — new support update':'Profile, history and help');}}
  async function refresh(force=false){
    const uid=actor();if(!uid||!window.FEATURE_GOOGLE_AUTH){badge(0);refreshKey='';return;}
    if(!force&&refreshKey===uid&&Date.now()-refreshedAt<60000)return;
    if(refreshKey!==uid)badge(0);
    refreshKey=uid;refreshedAt=Date.now();
    try{const result=await callFunction('supportGet',{summary:true});if(actor()!==uid)return;const t=result.thread,unread=t&&t.sequence>(t.memberRead||0);badge(unread);const key=uid+'|'+t?.sequence;if(unread&&noticeKey!==key){noticeKey=key;window.toast?.('Nirag has a support update for you. Open Profile → Talk to Forge.');}}catch(e){/* A failed check never claims there are no unread messages. */}
  }
  function open(threadId=null,asAdmin=false){
    const uid=actor(),body=node('div',null,'today-dialog-body forge-support');
    ForgeToday.openDialog(asAdmin?'Support inbox':'Talk to Forge',body);
    const current=()=>body.isConnected&&actor()===uid;
    let loadEpoch=0,inFlightSend=false;
    if(!uid||!window.FEATURE_GOOGLE_AUTH){body.append(node('p','Link Google or Apple in Profile first so your private conversation stays with you. If sign-in is the problem, email team@goforge.in.'),email());return;}
    body.append(node('p','Opening your conversation…','today-muted'));
    async function load(before,afterSend=false){
      if(inFlightSend&&!afterSend)return;
      const token=++loadEpoch;
      try{const data=await callFunction('supportGet',{...(threadId?{threadId}:{}),...(before?{before}:{})});if(!current()||token!==loadEpoch)return;paint(data,before);}
      catch(e){if(!current()||token!==loadEpoch)return;body.replaceChildren(node('p',e.code?.includes('permission-denied')?'This sign-in cannot open that conversation.':e.code?.includes('failed-precondition')?'Link your Forge profile to Google or Apple before opening private support.':'Could not open support. Check your connection, or email us.'),button('Try again',()=>load()),email());}
    }
    function paint(data,before){
      body.replaceChildren();const t=data.thread,context=t||data.context;
      const guide=node('div',null,'forge-support-guide'),mascot=node('img');mascot.src='assets/forgeling.webp?v=f026-1';mascot.alt='Forgeling';guide.append(mascot,node('p',asAdmin?'Reply as Nirag. Status changes are visible to this member.':'“Tell Nirag what happened. I’ll keep your conversation here, away from the group feed.”'));body.append(guide);
      body.append(node('p',`${context?.name||'Your linked account'} · ${(context?.groups||[]).join(', ')||'Solo / no groups'}`,'today-muted'));
      body.append(node('p',labels[t?.status]||'Start a conversation','forge-support-status'));
      const messages=node('div',null,'forge-support-messages');messages.setAttribute('aria-label','Private conversation');
      if(data.messages.length===50)body.append(button('Earlier messages',()=>load(data.messages[0].sequence)));
      for(const m of data.messages){const row=node('article',null,'forge-support-message '+(m.role==='admin'?'from-admin':'from-member'));row.append(node('strong',m.role==='admin'?'Nirag':'You'),node('p',m.text||`Status changed to ${labels[m.status]||m.status}`),node('small',new Date(m.at).toLocaleString('en-IN')+' · '+(labels[m.status]||m.status)));messages.append(row);}
      body.append(messages);
      if(before)body.append(button('Latest messages',()=>load()));
      const form=node('form'),label=node('label','Your message'),input=node('textarea');input.maxLength=2000;input.rows=4;input.required=!asAdmin;label.append(input);form.append(label);
      let select=null;
      if(asAdmin){const statusLabel=node('label','Progress');select=node('select');for(const [value,text]of Object.entries(labels)){const option=node('option',text);option.value=value;select.append(option);}select.value=t?.status||'acknowledged';statusLabel.append(select);form.append(statusLabel);}
      else form.append(node('p','Shared with Nirag: the profile name and group codes shown above, plus what you type. No Health records, PIN or workout history are attached. Don’t send passwords or medical details.','today-muted'));
      const error=node('p','','today-muted');error.setAttribute('role','status');
      const send=button(t?.status==='resolved'&&!asAdmin?'Reply and reopen':'Send message',()=>{});send.type='submit';form.append(send,error);body.append(form);
      let sending=false,attempt=null;
      form.onsubmit=async event=>{event.preventDefault();if(sending||!current())return;const text=input.value.trim(),status=select?.value;if(!text&&!asAdmin)return;
        const fingerprint=JSON.stringify([text,status]);if(!attempt||attempt.fingerprint!==fingerprint)attempt={fingerprint,id:crypto.randomUUID()};
        sending=true;inFlightSend=true;send.disabled=true;error.textContent='Sending…';
        try{await callFunction('supportPost',{threadId:threadId||uid,asAdmin,text,...(status?{status}:{}),operationId:attempt.id});if(!current())return;attempt=null;await load(undefined,true);}
        catch(e){if(current())error.textContent=e.code?.includes('resource-exhausted')?'Please wait a few seconds, then send again.':e.code?.includes('permission-denied')?'This sign-in does not have access. Your message was not sent.':'Could not confirm sending. Your text is still here; retry uses the same message ID.';}
        finally{sending=false;inFlightSend=false;if(current())send.disabled=false;}
      };
      body.append(button('Refresh conversation',()=>{if(!sending)load();}),email());
      if(data.isAdmin&&!asAdmin)body.append(button('Open support inbox',inbox));
      if(t&&!before)callFunction('supportSeen',{threadId:t.id,asAdmin,sequence:t.sequence}).then(()=>{if(current()&&!asAdmin)refresh(true);}).catch(()=>{});
    }
    load();
  }
  function email(){const a=node('a','Email team@goforge.in','today-link');a.href='mailto:team@goforge.in';return a;}
  async function inbox(){
    const uid=actor(),body=node('div',null,'today-dialog-body');ForgeToday.openDialog('Private support inbox',body);body.append(node('p','Checking admin access…'));
    try{const result=await callFunction('supportInbox',{});if(!body.isConnected||actor()!==uid)return;body.replaceChildren(node('p','Most recently updated conversations · up to 100. Only an authorised sign-in can read these.','today-muted'));for(const t of result.threads)body.append(button(`${t.name} · ${labels[t.status]}${t.sequence>(t.adminRead||0)?' · New message':''}`,()=>open(t.id,true)));if(!result.threads.length)body.append(node('p','No support conversations yet.'));}
    catch(e){if(body.isConnected&&actor()===uid)body.replaceChildren(node('p','Support admin access is not available for this sign-in. The superadmin PIN does not grant private inbox access.'),email());}
  }
  window.ForgeSupport={open,refresh,inbox};
  if(typeof window.addEventListener==='function')window.addEventListener('focus',()=>refresh());
})();
