/* Action-first Today surface. Existing logging, scoring and Health handlers remain authoritative. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=(label,fn,cls='today-button')=>{const b=node('button',cls,label);b.type='button';b.addEventListener('click',fn);return b;};
  const sport=name=>{const wrap=node('span','today-sport');wrap.innerHTML=ForgeSports.icon(name);return wrap.firstElementChild;};
  let dialog=null,shownReceiptId=null;

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
    if(!window.me)return ['Walk','Gym','Yoga'];
    const last={};(window.allLogs||[]).filter(l=>!l.voided&&l.player===me.name).forEach(l=>(l.workouts||[]).forEach(w=>{last[w]=Math.max(last[w]||0,l.day||0);}));
    const values=Object.keys(last).sort((a,b)=>last[b]-last[a]).slice(0,3);
    for(const fallback of ['Walk','Gym','Yoga'])if(values.length<3&&!values.includes(fallback))values.push(fallback);
    return values.slice(0,3);
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
    body.append(list,actions);
    openDialog('Your groups',body);
  }
  function receiptCurrent(r){return r&&window._forgeLogReceipt===r&&typeof _isSubmissionViewCurrent==='function'&&_isSubmissionViewCurrent(r);}
  function renderReceipt(receipt=window._forgeLogReceipt){
    const host=$('forgeTodayReceipt');if(!host)return;
    if(!receiptCurrent(receipt)){host.hidden=true;host.replaceChildren();return;}
    const waiting=['checking','pending'].includes(receipt.state);
    document.querySelectorAll('[data-today-workout]').forEach(b=>{b.disabled=waiting;b.setAttribute('aria-label',waiting?`${b.dataset.todayWorkout} unavailable while the current workout is sending`:`Log ${b.dataset.todayWorkout} now`);const hint=b.querySelector('small');if(hint)hint.textContent=waiting?'Waiting for confirmation':'Tap to log now';});
    const full=document.querySelector('[data-today-full-picker]');if(full){full.disabled=waiting;full.textContent=waiting?'Waiting for confirmation':'Choose another workout';}
    host.hidden=false;host.dataset.receiptState=receipt.state;host.replaceChildren();
    const copy={checking:['Checking destinations…','Nothing has been confirmed yet.'],pending:['Still sending.','Keep Forge open. Don’t log it again while this is pending.'],confirmed:['Logged. That counts.','Every confirmed destination is listed below.'],failed:['This one didn’t land.','Review the details, then log it again when you’re ready.']}[receipt.state]||['Save update',''];
    host.append(node('p','today-kicker','SAVE STATUS'),node('h2','',copy[0]),node('p','today-muted',copy[1]));
    const workoutDate=new Date(receipt.year,receipt.month-1,receipt.day).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'long',year:'numeric'});
    host.append(node('p','today-receipt-workout',`${receipt.workouts.join(' + ')||'Workout'} · ${workoutDate}`));
    const list=node('div','today-receipt-list');
    receipt.groups.forEach(g=>{const row=node('div','today-receipt-row');row.dataset.status=g.status;const label={checking:'Checking',pending:'Sending',confirmed:'Confirmed',failed:'Failed',skipped:'Skipped'}[g.status]||g.status;row.append(node('span','',g.name),node('strong','',label+(g.reason?' · '+g.reason:'')));list.append(row);});
    host.append(list);
    const actions=node('div','today-receipt-actions');
    if(receipt.state==='confirmed'&&receipt.report)actions.append(button('View points report',()=>openConfirmedReport(),'today-button today-button-secondary'));
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
    const details=node('details','today-details');details.id='forgeTodayDetails';details.append(node('summary','','Season points & all-time trends'));
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
    const mascot=node('img','today-forgeling');mascot.src='assets/forgeling.webp';mascot.alt='Forgeling, Forge’s quiet workout companion';hero.append(words,mascot);host.append(hero);
    const actions=node('div','today-workouts');recent().forEach(w=>{const b=button('',()=>start(w),'today-workout');b.dataset.todayWorkout=w;b.disabled=pending;b.setAttribute('aria-label',pending?`${w} unavailable while the current workout is sending`:`Log ${w} now`);b.append(sport(w),node('span','today-workout-label',w));actions.append(b);});actionsHost.append(actions);
    const full=button(pending?'Waiting for confirmation':'Choose another workout',()=>start(),'today-button today-button-primary');full.dataset.todayFullPicker='';full.disabled=pending;actionsHost.append(full);
    const destination=button(`${sessions().length} log destination${sessions().length===1?'':'s'} · review`,openDestinations,'today-link');destination.dataset.todayDestinations='';actionsHost.append(destination);
    const scope=node('section','today-scope');const sc=score(me.name);scope.append(node('p','today-kicker',`${(groupData&&groupData.name)||groupCode} · ${MIR_MONTHNAMES[season.month-1]}`),node('p','today-scope-label','In this group'));
    const stats=node('div','today-stats');[[sc.streak,'day streak'],[sc.total,'points']].forEach(([v,l])=>{const x=node('div','');x.append(node('strong','',String(v)),node('span','',l));stats.append(x);});scope.append(stats);actionsHost.append(scope);
    arrangeDetails();renderReceipt();
  }
  function clear(){
    const host=$('forgeToday'),actions=$('forgeTodayActions'),receipt=$('forgeTodayReceipt');if(!host)return;
    host.replaceChildren();host.append(node('p','today-kicker','TODAY'),node('h1','today-loading','Loading your group…'));
    if(actions)actions.replaceChildren();
    if(receipt){receipt.hidden=true;receipt.replaceChildren();}
  }
  function init(){enhanceSheet();arrangeDetails();render();}
  window.ForgeToday={render,clear,renderReceipt,openDestinations,openGroups,openConfirmedReport,openDialog};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* Shared experience: factual month history, accessible chrome and field guide.
   Does not fetch, write, score or request permissions. */
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
    theme:'M12 3a9 9 0 1 0 0 18z M12 3v18'
  };
  const icon=key=>`<svg class="forge-ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[key]||paths.home}"/></svg>`;
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
  function renderMonth(M){
    const host=$('forgeMonthStory');if(!host)return;
    const data=monthStats(M),label=`${M.label} ${M.year}`;
    const scope=`${window.groupCode}|${window.me?.userId||window.me?.name}|${M.year}-${M.month}`;
    const fingerprint=scope+JSON.stringify({data,byDay:M.byDay,readonly:M.readonly});
    if(host._forgeFingerprint===fingerprint)return;
    const same=host._forgeScope===scope,expanded=same&&host.querySelector('.forge-gym-details')?.open;
    const active=document.activeElement,focused=same&&host.contains(active)?{day:active.dataset.day,activity:active.dataset.activity}:null;
    host._forgeFingerprint=fingerprint;host._forgeScope=scope;
    host.innerHTML=`<div class="forge-section-head"><div><p class="today-kicker">YOUR MONTH · ${esc(label)}</p><h2>Small efforts. Added up.</h2></div>${ForgeSports.icon('Gym')}</div>
      <div class="forge-month-numbers"><div><b>${data.days.length}</b><span>days with a workout</span></div><div><b>${data.count}</b><span>recorded activities</span></div><div><b>${data.activities.length}</b><span>ways you moved</span></div></div>
      <p class="forge-explainer">${M.readonly?'Past month · read-only. ':'Month in progress. '}For the selected group only. Two activities on one day still count as one workout day.</p>
      <h3>Workout breakdown</h3><div class="forge-activity-bars">${data.activities.length?data.activities.map((a,i)=>`<button type="button" class="forge-activity-row" data-activity="${i}" aria-label="Show ${esc(a.label)} dates in ${esc(label)}">${ForgeSports.icon(a.label)}<span><strong>${esc(a.label)}</strong><span class="forge-bar"><i style="width:${Math.round(a.count/data.count*100)}%"></i></span></span><b>${a.count}<small>${Math.round(a.count/data.count*100)}%</small></b></button>`).join(''):'<p class="today-muted">No recorded workouts for this month. Earlier months are available with the arrows above.</p>'}</div>
      <details class="forge-gym-details"><summary>Gym & strength journal <span>${data.gym.length} ${data.gym.length===1?'entry':'entries'}</span></summary><p class="forge-explainer">Your logged sessions and optional notes—not inferred sets, reps or muscle groups.</p>${data.gym.length?data.gym.map(g=>`<button type="button" class="forge-journal-row" data-day="${g.day}"><b>${esc(M.label.slice(0,3))} ${g.day}</b><span>${esc(g.note)}</span><span aria-hidden="true">↗</span></button>`).join(''):'<p class="today-muted">No strength sessions recorded this month. Choose Gym when logging to add an optional muscle-group note.</p>'}</details>`;
    host.querySelector('.forge-gym-details').open=!!expanded;
    host.querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>openDay(M,Number(b.dataset.day))));
    host.querySelectorAll('[data-activity]').forEach(b=>b.addEventListener('click',()=>{
      const a=data.activities[Number(b.dataset.activity)],body=document.createElement('div');body.className='today-dialog-body';
      const copy=document.createElement('p');copy.className='today-muted';copy.textContent=`${a.count} recorded ${a.label} activities across ${a.days.length} days in ${label}.`;body.append(copy);
      a.days.forEach(day=>{const row=document.createElement('button');row.type='button';row.className='today-button today-button-secondary';row.textContent=`${M.label} ${day} · view recorded workouts`;row.onclick=()=>openDay(M,day);body.append(row);});
      ForgeToday.openDialog(`${a.label} · ${M.label}`,body);
    }));
    if(focused){const selector=focused.day?`[data-day="${Number(focused.day)}"]`:focused.activity!=null?`[data-activity="${Number(focused.activity)}"]`:'.forge-gym-details summary';host.querySelector(selector)?.focus({preventScroll:true});}
  }
  function healthName(){
    const c=window.Capacitor,platform=c&&(typeof c.getPlatform==='function'?c.getPlatform():c.platform);
    return platform==='android'?'Health Connect':platform==='ios'?'Apple Health':'Apple Health / Health Connect';
  }
  function renderFAQ(){
    const host=$('forgeFAQ');if(!host||host.dataset.ready)return;host.dataset.ready='true';
    const items=[
      ['Log without the homework','Walk','Tap a calendar day or a workout icon. A confirmed receipt lists the groups that received it. “Sending” does not mean saved. Add another activity only if you actually did it.'],
      ['Where are previous months?','Yoga','Use the labelled arrows above your calendar. The workout breakdown follows the month you are viewing. Tap a logged past day to read its activities and notes; closed months cannot be edited.'],
      ['What does the month graph mean?','Run','The cumulative chart counts workout days, not calories, steps or fitness improvement. Multiple activities on one day still count as one day. Its heading identifies the active season; calendar history has its own monthly breakdown.'],
      ['Where is my gym breakdown?','Gym','Open Gym & strength journal below the calendar. Optional muscle-group notes are recorded when you log. Forge cannot reconstruct sets, reps or unrecorded body parts. Notes on shared workouts are visible to your groups.'],
      ['How do points and ranks work?','Trophy','The group board uses your season’s scoring rules. Tap a person for the points breakdown. Teams and People are different views. A log only gets a rank animation when a confirmed save actually changes your rank.'],
      ['One workout, several groups?','Team sport','Forge checks each linked group when you save. Groups in another season or that cannot be reached are identified in the receipt. Group-specific bonuses mean the same workout can lead to different point totals.'],
      ['Connect your phone health app','Walk',`${healthName()} is optional in the phone app. Forge suggests recorded workouts for you to confirm. Confirmed logs are shared to your groups; enabled step challenges also upload daily step totals. Browser staging cannot read phone health data.`],
      ['Notifications, on your terms','Other','Open Settings & devices in Profile to choose reminders. You can say “not now” and return later. The tour never grants a permission or turns notifications on for you.'],
      ['Who can see me on All Forge?','Team sport','The People board uses explicit visibility consent. Your best group score is used rather than adding all your memberships. Group averages are labelled; different group rules mean this is not a universal fitness ranking.'],
      ['Need a hand?','Other','Replay the Forgeling tour below, or contact team@goforge.in. If data looks stale, use Refresh group first. Connection repair is a separate troubleshooting action, not the normal refresh button.']
    ];
    host.innerHTML=`<div class="forge-guide-heading"><img src="assets/forgeling.webp" alt="Forgeling"><div><p class="today-kicker">THE FIELD GUIDE</p><h2>A little help. Whenever.</h2><p class="today-muted">The answers stay here after Forgeling hops off.</p></div></div>`+items.map(([title,art,copy])=>`<details class="forge-faq-item"><summary>${ForgeSports.icon(art)}<span>${title}</span></summary><p>${esc(copy)}</p></details>`).join('')+'<div class="forge-help-actions"><button type="button" class="today-button" onclick="startTour(true)">Walk me through Forge</button><button type="button" class="today-link" onclick="confirmConnReset()">Connection troubleshooting</button></div>';
  }
  function enhanceShell(){
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
      if(window._forgeLogReceipt&&['checking','pending'].includes(window._forgeLogReceipt.state)){toast('Let the current workout finish sending first.');return;}
      if(!window.groupCode)return;refresh.disabled=true;
      toast('Checking your group for updates…');
      try{await loadGroup(groupCode,true,{manual:true});}catch(e){toast('Could not refresh. Check your connection.','error');}finally{refresh.disabled=false;}
    };}
    const theme=$('themeToggle');if(theme){theme.innerHTML=icon('theme');theme.setAttribute('aria-label','Switch light or dark theme');}
    renderFAQ();
  }
  window.ForgeExperience={monthStats,renderMonth,openDay,healthName,renderFAQ,enhanceShell,icon};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhanceShell);else enhanceShell();
})();
