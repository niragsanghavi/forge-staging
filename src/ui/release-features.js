/* Shared web/native release controls. No push dependency, HTML from users, or
   client-side admin authority. Reading announcements also works without OAuth. */
(() => {
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,fn)=>{const b=node('button',text,'today-button');b.type='button';b.onclick=fn;return b;};
 const message=e=>e?.message||'Request not confirmed. Check your connection and retry.';
 const actor=()=>window.auth?.currentUser?.uid||null;
 const storeUrl=a=>{
  const native=window.Capacitor?.isNativePlatform?.()===true,platform=native?window.Capacitor.getPlatform?.():'web';
  const store=platform==='ios'?'apple':platform==='android'?'play':a.webStore;
  return store==='apple'?'https://apps.apple.com/app/id6802334800':store==='play'?'https://play.google.com/store/apps/details?id=in.goforge.app':null;
 };
 let cached=null,loadedAt=0,pending=null,remembered=new Set();
 const key=a=>'forgeAnnounce:'+a.id+':'+(window.me?.userId||actor()||'device');
 const seen=a=>{try{return remembered.has(key(a))||localStorage.getItem(key(a))==='seen';}catch{return remembered.has(key(a));}};
 const visible=a=>a&&a.expiresAt>Date.now()&&!seen(a);
 async function read(force=false){
  if(pending)return pending;
  if(!force&&Date.now()-loadedAt<120000)return cached;
  pending=callFunction('getPublishedAnnouncement',{}).then(r=>{cached=r.announcement||null;loadedAt=Date.now();return cached;}).finally(()=>pending=null);
  return pending;
 }
 function dismiss(a){remembered.add(key(a));try{localStorage.setItem(key(a),'seen');}catch{}renderAll();window.renderPromptDock?.();}
 function card(a,preview=false){
  const box=node('section',null,'card'),kicker=node('p',preview?'PREVIEW · NOT PUBLISHED':'A NOTE FROM FORGE','today-kicker');
  box.append(kicker,node('h2',a.title),node('p',a.message,'forge-announcement-copy'));
  if(a.action==='store'){const url=storeUrl(a);if(url){const link=node('a','Open the app store','today-button');link.href=url;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}}
  else if(a.action==='guide')box.append(button('Show me around',()=>{if(!preview)dismiss(a);window.startTour?.(true);}));
  else if(a.action==='log')box.append(button('Help me log',()=>{if(!preview)dismiss(a);window.ForgeExperience?.loggingHelp();}));
  if(!preview)box.append(button('Got it',()=>dismiss(a)));
  return box;
 }
 async function render(host=document.getElementById('announceCard')){
  if(!host)return;host.replaceChildren();
  try{const a=await read();if(host.isConnected&&visible(a))host.replaceChildren(card(a));}
  catch{/* Announcement outages do not block logging or leave an empty card. */}
 }
 function renderAll(){for(const h of document.querySelectorAll('#announceCard,[data-solo-announcement]'))render(h);}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderAll();});
 setInterval(()=>{if(!document.hidden)renderAll();},120000);
 function composer(){
  const body=node('div',null,'today-dialog-body'),uid=actor();let draft={title:'A little more Forge',message:'See what is new this week.',action:'guide',webStore:'none',days:7},busy=false;
  ForgeToday.openDialog('Publish an in-app update',body);
  const current=()=>body.isConnected&&actor()===uid;
  const status=node('p');status.setAttribute('role','status');
  function edit(){
   body.replaceChildren(node('p','All Forge users · in-app only. This never sends push notifications.'),status);
   const fields={};
   for(const [name,label,options] of [['title','Title'],['message','Message'],['action','Action',['none','guide','log','store']],['webStore','Store link for web users',['none','apple','play']],['days','Days before expiry']]){
    const l=node('label',label),input=node(options?'select':name==='message'?'textarea':'input');
    if(options)for(const value of options){const o=node('option',value);o.value=value;input.append(o);}
    else if(name==='days'){input.type='number';input.min=1;input.max=31;}
    else input.maxLength=name==='title'?60:500;
    input.value=draft[name];l.append(input);body.append(l);fields[name]=input;
   }
   body.append(button('Preview before publishing',async()=>{
    if(busy)return;busy=true;status.textContent='Checking your permission and preparing the preview…';
    for(const [k,v] of Object.entries(fields))draft[k]=k==='days'?Number(v.value):v.value;
    try{const p=await callFunction('previewAnnouncement',{draft});if(current())review(p);}
    catch(e){if(current())status.textContent=message(e);}finally{busy=false;}
   }));
   const control=node('div');body.append(control);
   read(true).then(a=>{if(!current()||!a||!control.isConnected)return;control.append(node('p','Currently published: '+a.title),button('Unpublish this announcement',()=>{
    control.replaceChildren(node('p','Hide “'+a.title+'” from everyone? Other devices refresh within two minutes while using the app.'),button('Confirm unpublish',async()=>{
     if(busy)return;busy=true;
     try{await callFunction('unpublishAnnouncement',{id:a.id});cached=null;loadedAt=0;if(current()){status.textContent='Unpublished.';edit();}renderAll();}
     catch(e){if(current())status.textContent=message(e);}finally{busy=false;}
    }));
   }));}).catch(e=>{if(current())status.textContent=message(e);});
  }
  function review(p){
   status.textContent='Review the message, then confirm publication.';
   body.replaceChildren(card({...p.draft,expiresAt:Date.now()+p.draft.days*86400000},true),node('p','Publish to everyone for '+p.draft.days+' days? This replaces the current announcement.'),status);
   const publish=button('Publish this announcement',async()=>{
    if(busy)return;busy=true;publish.disabled=true;
    try{await callFunction('publishAnnouncement',{reviewId:p.reviewId});cached=null;loadedAt=0;if(current()){status.textContent='Published. Everyone can see it in Forge; no push was sent.';edit();}renderAll();}
    catch(e){if(current())status.textContent=message(e);}finally{busy=false;publish.disabled=false;}
   });
   body.append(button('Back to draft',()=>{if(!busy)edit();}),publish);
  }
  edit();
 }
 async function removal(logId){
  const body=node('div',null,'today-dialog-body'),uid=actor(),profile=window.me?.userId;let busy=false;
  ForgeToday.openDialog('Remove your mistaken workout',body);
  const current=()=>body.isConnected&&actor()===uid&&window.me?.userId===profile;
  const status=node('p');status.setAttribute('role','status');
  body.append(node('p','Remove this entry here, or review matching copies in your other groups. Nothing is removed until you confirm.'),status,
   button('Remove only from this group',async()=>{
    if(busy||!current())return;busy=true;
    try{await window.voidLogDoc(logId,window.me?.name);if(current()){body.replaceChildren(node('p','Removed from this group.'));window.mirCloseSheet?.();}}
    catch(e){if(current())status.textContent=message(e);}finally{busy=false;}
   }),button('Review all my groups',async()=>{
    if(busy||!current())return;busy=true;status.textContent='Finding your matching workouts…';
    try{const p=await callFunction('previewWorkoutRemoval',{logId});if(current())review(p);}
    catch(e){if(current())status.textContent=message(e);}finally{busy=false;}
   }));
  function review(p){
   status.textContent='Nothing has been removed. Check each entry before confirming.';
   body.replaceChildren(node('h2','Review '+p.rows.length+' matching entries'),node('p',p.mode==='inferred'?'These older entries were matched by your profile, date and workout set—not a shared submission ID. Separate sessions can match. Deselect anything you want to keep.':'These entries share the same original submission.'),status);
   const choices=[];
   for(const row of p.rows){
    const label=node('label'),input=node('input');input.type='checkbox';input.checked=true;
    label.style.cssText='display:grid;grid-template-columns:24px 1fr;gap:10px;padding:14px 0;min-height:44px;font-size:14px;line-height:1.5;overflow-wrap:anywhere;border-bottom:1px solid var(--border)';
    input.style.cssText='width:20px;height:20px;margin:2px 0';
    label.append(input,node('span',row.groupName+' ('+row.groupCode+') · '+row.year+'-'+String(row.month).padStart(2,'0')+'-'+String(row.day).padStart(2,'0')+' · '+row.workouts.join(' + ')+' · Entry '+row.logId+(row.note?' · '+row.note:'')+(row.km!=null?' · '+row.km+' km':'')+(row.demo?' · Demo':'')));
    body.append(label);choices.push({input,row});
   }
   for(const excluded of p.unavailable||[])body.append(node('p',excluded.groupCode+': not included — '+excluded.reason));
   const submit=button('Confirm removal of selected entries',async()=>{
    if(busy||!current())return;const logIds=choices.filter(x=>x.input.checked).map(x=>x.row.logId);
    if(!logIds.length){status.textContent='Select at least one entry.';return;}
    busy=true;submit.disabled=true;choices.forEach(x=>x.input.disabled=true);status.textContent='Removing '+logIds.length+' entries…';
    try{
     const response=await callFunction('removeWorkoutsEverywhere',{operationId:p.operationId,logIds});if(!current())return;
     const summary=node('div');summary.setAttribute('role','status');
     for(const g of response.results)summary.append(node('p',g.groupCode+': '+(g.ok?g.logs.length+' entries removed or already removed.':g.message)));
     status.replaceChildren(summary);submit.textContent=response.ok?'Confirmed · removed':'Retry unconfirmed groups';
     const done=new Set(response.results.filter(g=>g.ok).flatMap(g=>g.logs.map(l=>l.logId)));
     for(const x of choices)if(done.has(x.row.logId)){x.input.checked=false;x.input.disabled=true;x.done=true;}
     window.ForgeExperience?.invalidateHistory?.();window.mirCloseSheet?.();
     if(response.ok){submit.remove();body.append(node('p','History and points refresh when you reopen the affected groups.'));}
    }catch(e){if(current())status.textContent='Removal not confirmed. Retry this same review to check safely. '+message(e);}
    finally{busy=false;submit.disabled=false;choices.forEach(x=>{if(!x.done)x.input.disabled=false;});}
   });
   body.append(submit,button('Close review',()=>{if(!busy)ForgeToday.closeDialog();}));
  }
 }
 window.ForgeAnnouncements={render,composer,storeUrl,hasVisible:()=>visible(cached)};
 window.ForgeRemoval={open:removal};
})();
