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
    if($('forgeTodayDetails'))return;
    const details=node('details','today-details');details.id='forgeTodayDetails';details.append(node('summary','','Goals & season detail'));
    details.append(node('p','today-muted','These are for the group selected above.'));
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
  window.ForgeToday={render,clear,renderReceipt,openDestinations,openGroups,openConfirmedReport};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
