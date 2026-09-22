/* Solo uses Forge's shared artwork, tokens, gym map, support and scoring.
   Only solo callables may save here. No group globals are impersonated. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const node=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const button=(text,fn,cls='today-button')=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
  const image=(src,cls='')=>{const el=node('img','',cls);el.src=src;el.alt='';return el;};
  const icon=key=>window.ForgeExperience.icon(key);
  const actor=()=>window.auth?.currentUser&&!auth.currentUser.isAnonymous?auth.currentUser.uid:null;
  const monthName=p=>new Date(Date.UTC(p.year,p.month-1,1)).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
  const dateName=(p,day)=>new Date(Date.UTC(p.year,p.month-1,day)).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'long',timeZone:'UTC'});
  const key=p=>`${p.year}-${String(p.month).padStart(2,'0')}`;
  const currentPeriod=()=>{const d=new Date(Date.now()+19800000);return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1};};
  let epoch=0,owner=null,model=null,scope={},tab='today',saving=false,receipt=null,filter='',dialog=null;
  let historyCache=new Map(),recommendations=[],allTime=null;
  const alive=(ticket,id)=>ticket===epoch&&id===actor()&&$('screen-solo')?.classList.contains('active');
  const status=(text,bad=false)=>{const el=$('soloStatus');if(el){el.textContent=text;el.classList.toggle('solo-error',bad);}};
  function art(name,mono=false){const el=node('span');el.innerHTML=ForgeSports.icon(name,mono);return el;}
  function action(text,key,fn,cls='today-button solo-action'){const b=button('',fn,cls);b.innerHTML=icon(key);b.append(node('span',text));return b;}
  function content(){return $('soloContent');}
  function closeDialog(){if(dialog?.open)dialog.close();}
  function openDialog(title){
    closeDialog();const d=node('dialog','','today-dialog solo-dialog'),opener=document.activeElement,head=node('div','','today-dialog-head');
    const h=node('h2',title);h.id='soloDialogTitle';d.setAttribute('aria-labelledby',h.id);
    const close=button('×',()=>d.close(),'today-dialog-close');close.setAttribute('aria-label','Close dialog');head.append(h,close);
    const body=node('div','','today-dialog-body');d.append(head,body);document.body.append(d);dialog=d;
    d.addEventListener('cancel',e=>{if(saving)e.preventDefault();});d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=null;if(opener?.isConnected)opener.focus();});
    close.onclick=()=>{if(!saving)d.close();};d.showModal();close.focus();return {body,dialog:d,close};
  }
  function goGroup(){
    if(saving)return;epoch++;closeDialog();
    if(actor()&&model?.hasGroups){window.restoreIdentityFromGoogle({uid:actor()});}
    else{showScreen('onboard');showObStep(1);window.ForgeWelcome?.choose('group');}
  }
  function shell(){
    const root=$('soloRoot');root.replaceChildren();
    const header=node('header','','nav solo-nav'),brand=node('div','','nav-logo');brand.append(image('assets/icons/forge-f.svg'),node('span','FORGE'));
    const controls=node('div','','solo-chrome');
    const refresh=action('Refresh','refresh',()=>open(scope,tab),'solo-icon-button');refresh.setAttribute('aria-label','Refresh solo calendar');refresh.hidden=!model?.enrolled;refresh.disabled=saving;
    const theme=action('Appearance','theme',()=>window.toggleTheme?.(),'solo-icon-button');theme.setAttribute('aria-label','Switch light or dark theme');
    const profile=action('Profile','profile',()=>selectTab('profile'),'solo-icon-button');profile.setAttribute('aria-label','Profile, history and help');profile.setAttribute('aria-pressed',String(tab==='profile'));profile.id='soloProfileButton';profile.hidden=!model?.enrolled;
    controls.append(refresh,theme,profile);header.append(brand,controls);root.append(header);
    const mode=button('',modePicker,'solo-mode-picker');mode.append(image('assets/modes/solo.webp'),node('span','Solo'),node('small','Change mode ›'));root.append(mode);
    const nav=node('nav','','tabs solo-tabs');nav.setAttribute('aria-label','Solo destinations');
    for(const [id,label,mark]of [['today','Today','home'],['board','Leaderboard','board'],['history','History','feed']]){
      const b=action(label,mark,()=>selectTab(id),'tab');b.dataset.soloTab=id;b.classList.toggle('active',id===tab);if(id===tab)b.setAttribute('aria-current','page');nav.append(b);
    }nav.hidden=!model?.enrolled;root.append(nav);
    const body=node('section','','solo-content');body.id='soloContent';
    const msg=node('p','','solo-status');msg.id='soloStatus';msg.setAttribute('role','status');root.append(msg,body);return body;
  }
  async function open(nextScope={},nextTab='today'){
    if(saving)return;
    if(!window.ForgeWelcome.allowSolo())return;
    closeDialog();scope={...nextScope};tab=['today','history','board','profile'].includes(nextTab)?nextTab:'today';filter='';
    const id=actor();if(owner!==id){owner=id;historyCache.clear();recommendations=[];allTime=null;receipt=null;model=null;}
    model=null;const ticket=++epoch;showScreen('solo');shell();window.scrollTo(0,0);
    if(!window.FEATURE_GOOGLE_AUTH){content().append(node('h1','Solo is not available in this build.'),button('Open my group',goGroup));return;}
    if(!id){signedOut();return;}
    status('Opening your Forge…');
    try{
      const result=await callFunction('getSolo',scope);if(!alive(ticket,id))return;status('');
      model=result;
      if(!result.enrolled){enrollment();return;}
      validate(result);historyCache.set(key(result.period),result);scope={year:result.period.year,month:result.period.month};
      shell();render();warmRecommendations(ticket,id);
    }catch(e){if(alive(ticket,id)){status('Your calendar could not load. Your workouts have not changed.',true);content().append(button('Try again',()=>open(scope,tab)),button('Use a different sign-in',signOut,'today-button today-button-quiet'));}}
  }
  function validate(data){
    if(!data.period||!Number.isInteger(data.period.year)||!Number.isInteger(data.period.month)||!Array.isArray(data.logs)||!Number.isFinite(data.score?.total))throw Error('Incomplete solo response');
  }
  function signedOut(){
    const el=content();el.append(node('h1','Your pace. Still Forge.'),node('p','The same calendar, gym diary and workout history. Your own leaderboard.','today-muted'));
    el.append(window.ForgeWelcome.providers(signIn));
    el.append(button('Bring back my existing profile',()=>window.ForgeWelcome.recover(),'today-button today-button-quiet'));
  }
  async function signIn(provider){
    const ticket=epoch;
    const result=await ForgeWelcome.authenticate(provider,text=>{if(ticket===epoch)status(text);},{action:ForgeWelcome.recoveryRequested()?'recover':'solo'});
    if(!result||ticket!==epoch)return;
    if(result.uid!==actor()){status('Your sign-in changed. Please try again.',true);return;}
    await open();
    if(window.ForgeWelcome.recoveryRequested())recoverGroup();
  }
  function enrollment(){
    const el=content();el.append(node('h1','Make room for your own pace.'));
    if(model.hasGroups){
      el.append(companion('Your group profile is already linked. Opening solo keeps it on the same account. Group history and group points stay unchanged.'));
    }else{
    const recovery=node('section','','solo-recovery-callout');
    recovery.append(image('assets/modes/group.webp'),node('h2','Already have Forge workouts?'),node('p','Bring back your existing profile first. Keep your group history and solo space in one account.'),button('Recover my group profile',recoverGroup));el.append(recovery);
    }
    el.append(node('h2',model.hasGroups?'Add your solo space':'Starting fresh?'),node('p','Create a solo space only when you’re ready. Signing in alone does not create one.','today-muted'));
    const form=node('form'),label=node('label','Your name'),name=node('input');name.required=true;name.minLength=2;name.maxLength=24;name.autocomplete='nickname';name.value=model.name||'';label.append(name);
    const consent=node('label','','solo-checkbox'),check=node('input');check.type='checkbox';consent.append(check,node('span','Show my name, workout-day count and points on the solo leaderboard. Optional.'));
    const save=button('Start my solo calendar',()=>{});save.type='submit';form.append(label,consent,node('p','4 base points per workout day. Daily streak bonus: +1, +2, then +3 max. Group points stay separate.','today-muted'),save);el.append(form);
    form.onsubmit=async event=>{
      event.preventDefault();if(saving)return;const id=actor(),ticket=epoch;saving=true;save.disabled=true;status('Creating your solo space…');
      try{const r=await callFunction('enrollSolo',{name:name.value.trim(),publicRanking:check.checked});if(r?.ok!==true)throw Error('Enrollment not confirmed');if(alive(ticket,id)){saving=false;await open();}}
      catch(e){if(alive(ticket,id))status('Could not start solo. Check your name and connection, then try again. You may need to sign in again.',true);}
      finally{saving=false;if(save.isConnected)save.disabled=false;}
    };
  }
  function selectTab(next){
    if(saving||!model?.enrolled)return;
    closeDialog();tab=next;filter='';epoch++;shell();render();
    content().setAttribute('tabindex','-1');content().focus({preventScroll:true});
    window.scrollTo(0,0);
  }
  function render(){
    if(!model?.enrolled)return;content().replaceChildren();
    if(tab==='today')today();else if(tab==='history')history();else if(tab==='board')board();else profile();
  }
  function monthNav(el){
    const row=node('div','','solo-month-nav');const p=model.period;
    const move=delta=>{const d=new Date(Date.UTC(p.year,p.month-1+delta,1));receipt=null;open({year:d.getUTCFullYear(),month:d.getUTCMonth()+1},tab);};
    const prev=button('‹',()=>move(-1),'solo-month-arrow');prev.setAttribute('aria-label','Previous month');prev.disabled=p.year===2020&&p.month===1;
    const next=button('›',()=>move(1),'solo-month-arrow');next.setAttribute('aria-label','Next month');next.disabled=p.current;
    row.append(prev,node('h2',monthName(p)),next);el.append(row);return row;
  }
  function stat(value,label){const el=node('div','','solo-stat');el.append(node('strong',String(value)),node('span',label));return el;}
  function companion(text){const el=node('div','','solo-companion');el.append(image('assets/forgeling.webp?v=f026-1'),node('p',text));return el;}
  function today(){
    const el=content(),p=model.period,s=model.score;
    const hero=node('div','','today-hero');const words=node('div');words.append(node('p',model.name+' · YOUR OWN LANE','today-kicker'),node('h1','Your month. Your pace.'));hero.append(words,image('assets/forgeling.webp?v=f026-1','today-forgeling'));el.append(hero);
    const stats=node('div','','solo-metrics');stats.append(stat(s.days,'workout days'),stat(s.total,'solo points'),stat(s.currentStreak,p.current?'day streak':'end-of-month streak'));el.append(stats);
    if(receipt&&receipt.sid===p.sid)renderReceipt(el);
    const card=node('section','','solo-calendar-card');monthNav(card);
    card.append(node('p',`${s.days} of ${new Date(Date.UTC(p.year,p.month,0)).getUTCDate()} days marked`,'today-muted'));
    calendar(card);el.append(card);
    const shortcuts=node('div','','today-workouts');shortcuts.id='soloShortcuts';el.append(shortcuts);renderShortcuts();
    if(p.current){el.append(button(model.logs.some(l=>l.day===p.throughDay)?'Edit today’s workouts':'Log today’s workout',()=>edit(p.throughDay),'today-button solo-primary'));}
    else el.append(node('p','Previous months are read-only. Your history stays here.','today-muted'));
    breakdown(el);gym(el);
    el.append(action(window.isNative?.()?ForgeExperience.healthName():'Health connections','health',health));
    const points=node('details','','solo-details');points.append(node('summary','Season points & trends · view breakdown'),node('p','Solo: 4 base points per workout day, plus +1 / +2 / +3 daily streak bonus. A missed day resets the bonus. Each month starts fresh. Multiple activities never multiply daily points.','today-muted'));
    const lines=node('div');for(const [name,value]of [['Workout points',s.base],['Streak points',s.bonus],['Total',s.total]]){const row=node('div','','today-points-line');row.append(node('span',name),node('strong',String(value)));lines.append(row);}points.append(lines);el.append(points);
  }
  function calendar(el){
    const p=model.period,grid=node('div','','solo-calendar'),count=new Date(Date.UTC(p.year,p.month,0)).getUTCDate();grid.setAttribute('aria-label',monthName(p)+' workout calendar');
    for(const day of ['M','T','W','T','F','S','S']){const item=node('span',day,'solo-weekday');item.setAttribute('aria-hidden','true');grid.append(item);}
    for(let i=0;i<(new Date(Date.UTC(p.year,p.month-1,1)).getUTCDay()+6)%7;i++)grid.append(node('span'));
    for(let day=1;day<=count;day++){
      const log=model.logs.find(l=>l.day===day),b=button('',()=>edit(day),'solo-day');b.disabled=day>p.throughDay;b.classList.toggle('logged',!!log);b.classList.toggle('is-today',p.current&&day===p.throughDay);
      b.setAttribute('aria-label',dateName(p,day)+(log?': '+log.workouts.join(', '):day>p.throughDay?': future day':': no workout'));
      b.append(node('span',String(day),'solo-day-number'));
      if(log){const marks=node('span','','solo-day-marks');marks.append(art(log.workouts[0],true));if(log.workouts.length>1)marks.append(node('small','+'+(log.workouts.length-1)));b.append(marks);}
      else if(p.current&&day===p.throughDay)b.append(node('span','+','solo-day-plus'));
      grid.append(b);
    }el.append(grid);
  }
  function renderShortcuts(){
    const host=$('soloShortcuts');if(!host||!model?.period.current)return;host.replaceChildren();
    const picks=recommendations.length?recommendations:ForgeExperience.rankWorkouts(model.logs,new Date());
    for(const name of picks.slice(0,3)){const b=button('',()=>edit(model.period.throughDay,name),'today-workout');b.append(art(name),node('span',name,'today-workout-label'));host.append(b);}
    if(!picks.length)host.append(node('p','Your most-used workouts will appear here after you start logging.','today-muted'));
  }
  async function warmRecommendations(ticket,id){
    if(!model?.period.current)return;
    const base=currentPeriod(),results=[model];
    for(const offset of [-1,-2]){const d=new Date(Date.UTC(base.year,base.month-1+offset,1)),p={year:d.getUTCFullYear(),month:d.getUTCMonth()+1};
      try{let result=historyCache.get(key(p));if(!result){result=await callFunction('getSolo',p);if(!alive(ticket,id))return;if(result.enrolled)historyCache.set(key(p),result);}if(result?.enrolled)results.push(result);}catch(e){/* Current-month choices remain useful if older months fail. */}}
    if(!alive(ticket,id))return;recommendations=ForgeExperience.rankWorkouts(results.flatMap(x=>x.logs),new Date());renderShortcuts();
  }
  function breakdown(el){
    const counts=new Map();for(const log of model.logs)for(const name of new Set(log.workouts))counts.set(name,(counts.get(name)||0)+1);
    const section=node('section','','solo-section');section.append(node('h2','Your month in movement'));
    if(!counts.size)section.append(node('p','No workouts recorded this month yet. Your calendar is ready when you are.','today-muted'));
    const list=node('div','','solo-breakdown');
    for(const [name,count]of [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))){const b=button('',()=>{selectTab('history');filter=name;history();},'solo-activity-row');b.append(art(name),node('span',name),node('strong',`${count} ${count===1?'day':'days'}`));list.append(b);}section.append(list);el.append(section);
  }
  function gym(el){
    const section=node('details','','solo-details');section.append(node('summary','Gym & strength journal · open calendar'));
    const p=model.period,byDay={};for(const log of model.logs)byDay[log.day]=[log];
    const data={year:p.year,month:p.month,days:new Date(Date.UTC(p.year,p.month,0)).getUTCDate(),label:monthName(p).split(' ')[0],byDay};
    const body=node('div');body.innerHTML=ForgeExperience.gymJournal(data,false);body.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>edit(Number(b.dataset.day)));
    section.append(body);el.append(section);
  }
  function history(){
    const el=content();el.replaceChildren(node('p','SOLO · YOUR WORKOUT DIARY','today-kicker'),node('h1','The work you put in.'));monthNav(el);
    const label=node('label','Activity'),select=node('select');select.setAttribute('aria-label','Filter workout history by activity');
    const names=[...new Set(model.logs.flatMap(l=>l.workouts))].sort();for(const name of ['All workouts',...names]){const option=node('option',name);option.value=name==='All workouts'?'':name;select.append(option);}select.value=filter;select.onchange=()=>{filter=select.value;history();content().querySelector('select').focus();};label.append(select);el.append(label);
    const logs=model.logs.filter(l=>!filter||l.workouts.includes(filter)).slice().sort((a,b)=>b.day-a.day);
    if(!logs.length)el.append(companion(filter?'No '+filter+' recorded in this month. Clear the filter to see the rest.':'Nothing recorded this month. No judgement. Your next workout starts the story.'));
    for(const log of logs){const row=button('',()=>edit(log.day),'solo-history-row'),copy=node('div');copy.append(node('small',dateName(model.period,log.day)),node('strong',log.workouts.join(' + ')));if(log.note)copy.append(node('p',log.note));row.append(art(log.workouts[0]),copy,node('span','›'));el.append(row);}
    gym(el);
  }
  async function board(){
    const el=content(),ticket=epoch,id=actor();el.append(node('p','SOLO LEAGUE · NO TEAM SCORES','today-kicker'),node('h1','Your own lane. Good company.'));monthNav(el);
    const personal=node('div','','solo-your-score');personal.append(image('assets/modes/solo.webp'),node('strong',model.name),node('span',model.score.total+' pts'));el.append(personal);
    el.append(node('p','4 base + capped streak bonuses. Only public solo records appear here. Tied scores share a rank.','today-muted'));
    const result=node('div');el.append(result);result.append(node('p','Loading the solo leaderboard…','today-muted'));
    try{
      const r=await callFunction('soloBoard',scope);if(!alive(ticket,id)||tab!=='board'||!result.isConnected)return;result.replaceChildren();
      if(!r.entries.length)result.append(companion('No public workouts this month yet. Quiet leaderboard. Plenty of room.'));
      for(const entry of r.entries){const row=node('div','','solo-board-row');row.classList.toggle('is-you',entry.isYou===true);row.dataset.rank=String(entry.rank);
        const name=node('div');name.append(node('strong',entry.name+(entry.isYou?' · You':'')),node('small',entry.days+' workout days'));
        row.append(node('span',String(entry.rank),'solo-rank-number'),name,node('strong',entry.total+' pts'));result.append(row);}
      result.append(node('p',`Top ${r.limit||100} public records · ${monthName(r.period)}. ${model.publicRanking?'Your rank appears when your entry is in this list.':'You are browsing privately.'}`,'today-muted'));
      result.append(button('Manage leaderboard visibility',()=>selectTab('profile'),'today-button today-button-quiet'));
    }catch(e){if(alive(ticket,id)&&result.isConnected)result.replaceChildren(node('p','Rankings could not load. Your workouts are safe.','today-muted'),button('Retry leaderboard',()=>selectTab('board')));}
  }
  function profile(){
    const el=content(),p=model.period,s=model.score;
    const heading=node('div','','solo-profile-heading');heading.append(image('assets/modes/solo.webp'),node('h1',model.name));el.append(heading,node('p','One Forge account. Your solo space and your groups.','today-muted'));monthNav(el);
    const stats=node('div','','solo-profile-stats');stats.append(stat(s.days,'workout days'),stat(s.currentStreak,p.current?'current streak':'closing streak'),stat(s.longestStreak,'longest this month'),stat(s.total,'solo points'));el.append(stats);
    const recaps=node('div','','solo-two-actions');recaps.append(button('Weekly recap',()=>recap('week')),button('Monthly recap',()=>recap('month')));el.append(recaps,button('All-time solo record',allTimeRecord,'today-button today-button-quiet'));
    el.append(companion('Need a hand? Talk to Forge below. Your message goes privately to Nirag—not into a group feed.'));
    el.append(action('Talk to Forge · private support','feed',()=>window.ForgeSupport.open()),action('Solo field guide','home',guide),action(window.isNative?.()?ForgeExperience.healthName():'Health connections','health',health));
    const settings=node('details','','solo-details');settings.append(node('summary','Account & privacy'));
    const provider=auth.currentUser.providerData?.map(x=>x.providerId==='apple.com'?'Apple':x.providerId==='google.com'?'Google':null).filter(Boolean).join(' + ')||'provider';
    settings.append(node('p','Signed in with '+provider+'. Your group history stays with this account.','today-muted'),button('Recover my group profile',recoverGroup),button(model.hasGroups?'Open my groups':'Join a group',goGroup));
    const visibility=node('label','','solo-checkbox'),check=node('input');check.type='checkbox';check.checked=!!model.publicRanking;visibility.append(check,node('span','Show my name, workout-day count and points on the solo leaderboard.'));settings.append(visibility);
    check.onchange=async()=>{
      if(saving)return;const desired=check.checked,ticket=epoch,id=actor();saving=true;check.disabled=true;
      try{const r=await callFunction('setSoloVisibility',{publicRanking:desired});if(r?.ok!==true||r.publicRanking!==desired)throw Error('Visibility not confirmed');if(alive(ticket,id)){model.publicRanking=desired;status(desired?'Your solo totals are now public.':'Your solo record is now private.');}}
      catch(e){if(alive(ticket,id)){check.checked=!!model.publicRanking;status('Visibility was not confirmed. Try again when connected.',true);}}
      finally{saving=false;if(check.isConnected)check.disabled=false;}
    };
    settings.append(button('Sign out',signOut,'today-button today-button-quiet'),button('Delete my account',remove,'today-button today-button-quiet solo-danger'));el.append(settings);
  }
  function recap(range){
    const {body}=openDialog(range==='week'?'Your weekly recap':'Your monthly recap'),p=model.period;
    const today=p.throughDay,weekday=new Date(Date.UTC(p.year,p.month-1,today)).getUTCDay(),start=range==='week'?Math.max(1,today-((weekday+6)%7)):1;
    const logs=model.logs.filter(l=>l.day>=start&&l.day<=today),score=model.score.breakdown.filter(d=>d.day>=start&&d.day<=today);
    body.append(node('p',dateName(p,start)+' – '+dateName(p,today),'today-kicker'),node('h3',logs.length?'You made time. It counts.':'A new page, not a verdict.'));
    const stats=node('div','','solo-metrics');stats.append(stat(logs.length,'workout days'),stat(new Set(logs.flatMap(l=>l.workouts)).size,'activities'),stat(score.reduce((sum,d)=>sum+d.total,0),'points earned'));body.append(stats,node('p','Only confirmed solo workouts in these dates. No group scores and no invented comparisons.','today-muted'));
    for(const log of logs){const line=node('div','','solo-recap-line');line.append(node('span',dateName(p,log.day)),node('strong',log.workouts.join(' + ')));body.append(line);}
  }
  async function allTimeRecord(){
    const {body}=openDialog('Your all-time solo record'),id=actor(),ticket=epoch;body.append(node('p','Checking your recorded months…'));
    try{
      const months=model.months;
      if(!Array.isArray(months))throw Error('History inventory unavailable');
      const results=[];for(const sid of [...new Set([...months,model.period.sid])]){
        if(!/^\d{4}-\d{2}$/.test(sid))continue;
        let value=historyCache.get(sid);if(!value){const [year,month]=sid.split('-').map(Number);value=await callFunction('getSolo',{year,month});}
        if(!alive(ticket,id)||!body.isConnected)return;validate(value);historyCache.set(sid,value);results.push(value);
      }
      const summary={days:0,longest:0,months:0,points:0};for(const item of results){summary.days+=item.score.days;summary.longest=Math.max(summary.longest,item.score.longestStreak);summary.months+=item.score.days>0?1:0;summary.points+=item.score.total;}allTime=summary;
      body.replaceChildren();const grid=node('div','','solo-profile-stats');grid.append(stat(summary.days,'workout days'),stat(summary.longest,'longest monthly streak'),stat(summary.months,'months logged'),stat(summary.points,'solo points'));body.append(grid,node('p','Solo streaks restart each month. These totals never change a group leaderboard.','today-muted'));
    }catch(e){if(alive(ticket,id)&&body.isConnected)body.replaceChildren(node('p','Could not check every month. No incomplete total is being shown.'),button('Try again',allTimeRecord));}
  }
  function renderReceipt(el){
    const r=receipt,box=node('section','','today-receipt solo-receipt');box.dataset.receiptState='confirmed';
    box.append(node('p','SAVED TO YOUR SOLO CALENDAR','today-kicker'),node('h2',r.delta>0?`+${r.delta} points. That counts.`:'Workout updated.'),node('p',dateName(model.period,r.day)+' · '+r.workouts.join(' + ')));
    const details=node('details','','today-points-details');details.append(node('summary','View points breakdown'));
    for(const [label,value]of [['Month before',r.before],['Month now',r.after],['Change',r.delta]]){const line=node('div','','today-points-line');line.append(node('span',label),node('strong',String(value)));details.append(line);}
    details.append(node('p','Editing an earlier day can also change later streak bonuses. Multiple workouts on one day still earn one daily base.','today-muted'));box.append(details,button('Got it',()=>{receipt=null;render();},'today-button today-button-quiet'));el.append(box);
  }
  function edit(day,initial){
    if(saving||!model?.enrolled||!Number.isInteger(day)||day<1||day>model.period.throughDay)return;
    const log=model.logs.find(l=>l.day===day),p={...model.period},ticket=epoch,id=actor(),selected=new Set(log?.workouts||[]);if(initial)selected.add(initial);
    const {body,dialog:d,close}=openDialog(dateName(p,day)),form=node('form'),current=()=>alive(ticket,id)&&d.isConnected;
    if(!p.current||day<Math.max(1,p.throughDay-7)){body.append(node('p',(log?.workouts||[]).join(' + ')||'No workout recorded.'),node('p',log?.note||'','today-muted'),node('p',!p.current?'Previous months are read-only.':'This day is read-only. You can log today and the previous seven days.','today-muted'));return;}
    const searchLabel=node('label','Find a workout'),search=node('input');search.type='search';search.placeholder='Search all workouts';searchLabel.append(search);form.append(searchLabel);
    const choices=node('div','','solo-workouts'),chosen=node('p','','today-muted');chosen.setAttribute('role','status');form.append(choices,chosen);
    const tags=new Set(ForgeExperience.muscleTags(log?.note)),muscles=node('fieldset','','solo-muscles');muscles.append(node('legend','Gym details · optional'));
    const badge=node('div','','solo-body-map');muscles.append(badge);const muscleChoices=node('div','','solo-muscle-choices');muscles.append(muscleChoices);
    const noteLabel=node('label','Workout note'),note=node('textarea');note.rows=3;note.maxLength=500;note.value=(log?.note||'').split(',').map(x=>x.trim()).filter(x=>!ForgeExperience.muscleOptions.includes(x)).join(', ');noteLabel.append(note);form.append(muscles,noteLabel);
    const isLift=()=>[...selected].some(w=>window.isLiftWorkout?.(w));
    function drawTags(){badge.innerHTML=ForgeExperience.gymBadge([...tags]);muscles.hidden=!isLift();muscleChoices.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(tags.has(b.dataset.muscle))));}
    for(const muscle of ForgeExperience.muscleOptions){const b=button('',()=>{tags.has(muscle)?tags.delete(muscle):tags.add(muscle);drawTags();},'solo-muscle-choice');b.dataset.muscle=muscle;b.innerHTML=ForgeExperience.muscleIcon(muscle);b.append(node('span',muscle));muscleChoices.append(b);}
    function drawChoices(){
      choices.replaceChildren();const labels=[...new Set([...recommendations,...selected,...ForgeSports.labels])].filter(name=>name.toLowerCase().includes(search.value.toLowerCase()));
      if(!labels.length)choices.append(node('p','No matching workout. Try another name.','today-muted'));
      for(const name of labels){const b=button('',()=>{selected.has(name)?selected.delete(name):selected.add(name);drawChoices();drawTags();},'solo-workout-choice');b.setAttribute('aria-pressed',String(selected.has(name)));b.append(art(name),node('span',name));choices.append(b);}
      chosen.textContent=selected.size?[...selected].join(' + '):'Choose the activities you did. One day still earns one base score.';
    }
    search.oninput=drawChoices;drawChoices();drawTags();
    const result=node('p');result.setAttribute('role','status');const save=button(log?'Save workout changes':'Log workout',()=>{});save.type='submit';save.classList.add('solo-primary');form.append(result,save);body.append(form);
    form.onsubmit=async event=>{
      event.preventDefault();if(saving||!current())return;
      if(!selected.size||selected.size>12){result.textContent='Choose between 1 and 12 activities.';return;}
      const text=[...(isLift()?[...tags]:[]),note.value.trim()].filter(Boolean).join(', ');if(text.length>500){result.textContent='Keep the note and gym details together under 500 characters.';return;}
      saving=true;save.disabled=true;close.disabled=true;result.textContent='Saving your workout…';const before=model.score.total,workouts=[...selected];
      try{
        const response=await callFunction('saveSolo',{year:p.year,month:p.month,day,workouts,note:text});
        if(!current())return;if(!response?.ok||!Number.isFinite(response.score?.total))throw Error('Save not confirmed');
        receipt={sid:p.sid,day,workouts,before,after:response.score.total,delta:response.score.total-before};historyCache.delete(p.sid);allTime=null;
        saving=false;d.close();await open({year:p.year,month:p.month});
      }catch(e){if(current())result.textContent='Save not confirmed. Close and refresh this month to check before retrying. Your entry is kept here.';}
      finally{saving=false;if(save.isConnected)save.disabled=false;if(close.isConnected)close.disabled=false;}
    };
  }
  function modePicker(){
    if(saving)return;const {body}=openDialog('Your Forge');
    body.append(button('Solo · your calendar and leaderboard',()=>{closeDialog();if(model?.enrolled)selectTab('today');else open();}),button(model?.hasGroups?'My groups':'Join a group',goGroup),button('Recover my group profile',()=>{closeDialog();recoverGroup();}));
    if(actor())body.append(button('Sign out',signOut,'today-button today-button-quiet'));
  }
  async function signOut(){
    if(saving)return;
    if(typeof window.signOutForgeDevice==='function'){await window.signOutForgeDevice();return;}
    epoch++;closeDialog();
    try{await auth.signOut();owner=null;model=null;historyCache.clear();receipt=null;recommendations=[];showScreen('onboard');showObStep(1);ForgeWelcome.syncGroupChoices();}
    catch(e){status('Sign-out did not finish. Please try again.',true);}
  }
  async function remove(){
    if(saving)return;
    if(model.hasGroups){status('This account also belongs to groups. Open your group Profile → Delete account to remove the shared account together.');return;}
    if(!confirm('Permanently delete your Forge account, solo workouts and leaderboard entries? This cannot be undone.'))return;
    const ticket=epoch,id=actor();saving=true;
    try{await confirmForgeAccountDeletion(id);if(!alive(ticket,id))return;const result=await callFunction('deleteSoloAccount',{});
      if(!alive(ticket,id))return;
      if(result?.ok!==true)throw Error('Deletion not confirmed');
      if(result.complete!==true){status('Deletion is still being processed. Do not create another account; check again or contact support.');return;}
      saving=false;await signOut();
    }catch(e){if(alive(ticket,id))status('Deletion did not finish. Contact support if retrying does not complete it.',true);}
    finally{saving=false;}
  }
  function guide(){
    const {body}=openDialog('Your solo field guide');body.append(companion('Same Forge. Your own rhythm. Here’s where everything lives.'));
    const items=[['Your calendar','Walk','Tap a current-month day to log or edit. The arrows take you to previous months, which are read-only.'],['Your points','Trophy','4 base points per workout day, plus a +1, +2, then +3 streak bonus. It caps at 3. Missing a day or starting a new month resets the run.'],['Your gym diary','Gym','Tag the muscle groups you trained. Your body map fills in and the gym calendar keeps the detail. Tags never add points.'],['Your history','Run','History is your private workout timeline—not a social feed. Filter by activity and browse previous months.'],['Your leaderboard','Team sport','Only solo points compete here. Publishing your name and monthly totals is optional; you can browse privately.'],['Your groups','Other','Use Change mode to switch. Solo logs do not automatically post to groups. Use recovery to bring an old group profile into this account.'],['Need help?','Other','Talk to Forge in Profile sends a private message to Nirag. You can see acknowledgement, progress and resolution in the same conversation.']];
    for(const [title,sport,text]of items){const d=node('details','','forge-faq-item'),s=node('summary');s.append(art(sport),node('span',title));d.append(s,node('p',text));body.append(d);}
    body.append(button('Talk to Forge',()=>{closeDialog();ForgeSupport.open();}));
  }
  function health(){
    const {body}=openDialog(window.isNative?.()?ForgeExperience.healthName():'Health connections'),id=actor(),ticket=epoch;
    body.append(node('p','Phone health is optional. Nothing is logged without your confirmation. Solo confirmations stay in solo.','today-muted'));
    if(!window.isNative?.()){body.append(companion('Apple Health is available in the iPhone app. Health Connect is available in the Android app. This browser cannot read phone health data.'));return;}
    const state=node('p');state.setAttribute('role','status');body.append(state);
    const connect=button(window.healthEnabled?.()?'Disconnect health suggestions':'Connect '+ForgeExperience.healthName(),async()=>{
      connect.disabled=true;try{
        if(window.healthEnabled()){window.setHealthEnabled(false);state.textContent='Health suggestions are off. Saved workouts are unchanged.';connect.textContent='Connect '+ForgeExperience.healthName();}
        else{const result=await window.healthConnect();if(!alive(ticket,id)||!body.isConnected)return;if(result==='granted'){window.setHealthEnabled(true);connect.textContent='Disconnect health suggestions';state.textContent='Connection request completed. Review workouts below.';}else state.textContent='Access is unavailable or declined. Review permissions in your phone’s health app.';}
      }catch(e){if(body.isConnected)state.textContent='Could not connect. Try again.';}finally{if(connect.isConnected)connect.disabled=false;}
    });body.append(connect);
    const list=node('div');body.append(button('Review recorded workouts',async()=>{
      list.replaceChildren(node('p','Checking this phone…'));try{const workouts=await window.healthRecentWorkouts();if(!alive(ticket,id)||!body.isConnected)return;list.replaceChildren();
        const valid=workouts.filter(w=>w.year===model.period.year&&w.month===model.period.month&&w.day<=model.period.throughDay);
        if(!valid.length)list.append(node('p','No matching workouts returned. Check permissions, or log manually. This does not mean you did no exercise.','today-muted'));
        for(const w of valid)list.append(button(`${dateName(model.period,w.day)} · ${w.label} · ${w.minutes} min`,()=>{closeDialog();edit(w.day,w.label);}));
      }catch(e){if(body.isConnected)list.replaceChildren(node('p','Could not read workouts. You can still log manually.'));}
    }),list);
  }
  // Existing PIN-verified recovery is inserted below. It never creates an
  // account, bypasses proof, or detaches a provider to make a merge succeed.
  function recoverGroup(){
    if(saving)return;
    if(!actor()){window.ForgeWelcome.recover();return;}
    const token=++epoch,identity=actor(),el=shell(),form=node('form');
    el.append(node('h2','Bring your group history with you'),node('p','Use the details you used before Google or Apple sign-in. If you do not know your group code or profile name, ask someone in that group. Nothing changes until you confirm.'));
    function field(title,options){const label=node('label',title),input=node('input');Object.assign(input,options);label.append(input);form.append(label);return input;}
    const code=field('Group code',{required:true,maxLength:10,autocomplete:'off'});
    const name=field('Your name in that group',{required:true,maxLength:24,autocomplete:'off'});
    const pin=field('Your existing Forge PIN',{required:true,type:'password',inputMode:'numeric',maxLength:4,autocomplete:'off',pattern:'[0-9]{4}'});
    const review=button('Review recovery',()=>{});review.type='submit';form.append(review);
    const back=button(model?.enrolled?'Back to my solo calendar':'Back',()=>{if(saving)return;pin.value='';open(scope);});form.append(back);el.append(form);
    form.onsubmit=e=>{
      e.preventDefault();if(saving||!alive(token,identity))return;
      const group=code.value.trim().toUpperCase(),person=name.value.trim();
      if(!/^[A-Z0-9]{4,10}$/.test(group)||!person||!/^\d{4}$/.test(pin.value)){status('Enter your group code, profile name and four-digit Forge PIN.');return;}
      review.disabled=true;code.disabled=true;name.disabled=true;pin.disabled=true;
      const confirm=node('section','','today-card');
      confirm.append(node('h3','Recover '+person+' in '+group+'?'),node('p','After checking your PIN, Forge will bring this group profile and its recorded history into your current signed-in account. Your solo calendar stays. This can include other groups linked to that profile. A profile already linked to another sign-in cannot be recovered this way.'));
      const change=button('Change details',()=>{if(saving)return;confirm.remove();review.disabled=false;code.disabled=false;name.disabled=false;pin.disabled=false;code.focus();});
      const submit=button('Verify sign-in and recover profile',async()=>{
        if(saving||window._forgeProviderBusy||!alive(token,identity))return;
        saving=true;window._forgeProviderBusy=true;submit.disabled=true;change.disabled=true;back.disabled=true;status('Confirm your sign-in to continue…');
        let linked=false;
        try{
          const provider=auth.currentUser.providerData?.some(p=>p.providerId==='apple.com')?'apple.com':'google.com';
          const signed=await startForgeProviderSignIn(provider);
          if(!alive(token,identity)||signed.uid!==identity){pin.value='';return;}
          status('Checking your group profile…');
          // Recheck ownership after reauthentication. Never create an empty
          // solo profile as a prerequisite for recovering an existing one.
          const ownership=await callFunction('getSolo',{});
          if(!alive(token,identity))return;
          let result;
          if(ownership.hasProfile===true){
            result=await callFunction('linkLegacyGroup',{groupCode:group,name:person,pin:pin.value});
          }else if(ownership.hasProfile===false){
            const groupRef=db.collection('groups').doc(group),g=await groupRef.get();
            if(!alive(token,identity))return;
            if(!g.exists||g.data().demo||!g.data().currentSeasonId)throw Error('Group unavailable');
            const season=await groupRef.collection('seasons').doc(g.data().currentSeasonId).get();
            if(!alive(token,identity))return;
            const matches=(season.data()?.roster||[]).filter(p=>!p.departed&&!p.deleted&&String(p.name||'').trim().toLowerCase()===person.toLowerCase());
            if(!season.exists||season.data().credentialSchema!==2||matches.length!==1||!matches[0].userId)throw Error('Profile requires support');
            result=await callFunction('claimIdentity',{userId:matches[0].userId,pin:pin.value});
          }else throw Error('Ownership could not be confirmed');
          linked=result?.ok===true;
          if(!linked)throw Error('Recovery was not confirmed.');
          pin.value='';if(!alive(token,identity))return;
          status('Profile linked. Opening your group…');
          await restoreIdentityFromGoogle({uid:identity,preferredCode:group});
          if(alive(token,identity))status('Your profile is linked. Use Group mode to open your group, or retry sign-in. Do not repeat recovery.');
        }catch(error){
          if(alive(token,identity)){
            pin.value='';
            status(linked?'Your profile is linked, but the group could not open. Use Group mode to continue.':String(error.code||'').endsWith('resource-exhausted')?'Too many PIN attempts. Wait an hour before trying again.':'Recovery did not finish. Check your group details and PIN. If this profile already has a linked sign-in, use that account.');
            if(!linked){confirm.remove();review.disabled=false;code.disabled=false;name.disabled=false;pin.disabled=false;pin.focus();}
          }
        }finally{
          pin.value='';
          saving=false;window._forgeProviderBusy=false;
          if(back.isConnected)back.disabled=false;
          if(!alive(token,identity)&&actor()!==identity)await open(scope);
        }
      });
      confirm.append(change,submit);el.append(confirm);submit.focus();
    };
    code.focus();
  }
  window.ForgeSolo={open,recoverGroup,selectTab,edit,close:()=>{epoch++;closeDialog();}};
})();
