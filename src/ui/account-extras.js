/* Explicit current-month imports and account-owned device preferences. */
(()=>{
 'use strict';
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const button=(text,fn)=>{const b=node('button',text);b.type='button';b.className='today-button';b.onclick=fn;return b;};
 const dialog=title=>{const body=node('div');body.className='today-dialog-body';ForgeToday.openDialog(title,body);return body;};
 const uid=()=>window.auth?.currentUser&&!auth.currentUser.isAnonymous?auth.currentUser.uid:null;
 async function copyMonth(groupCode){
  const id=uid();if(!id){toast('Sign in with your linked Google or Apple account first.','error');return;}
  const body=dialog('Bring this month’s workouts'),status=node('p','Checking your existing group workouts…');status.setAttribute('role','status');body.append(status);
  const current=()=>body.isConnected&&uid()===id;
  try{
   const review=await callFunction('previewGroupImport',{groupCode});if(!current())return;
   status.textContent=review.groupName+' · '+review.seasonId+'. Only your saved group workouts from this month. Your original records stay unchanged.';
   body.append(node('p','Matching shared copies count once. Workouts already in this group are skipped. No previous month or Solo workout is copied. This can change this group’s points and team streaks.'));
   const choices=[];
   for(const row of review.rows){const label=node('label'),check=node('input');check.type='checkbox';check.checked=!row.already;check.disabled=row.already;label.style.cssText='display:flex;gap:12px;padding:12px;align-items:center';label.append(check,node('span',review.seasonId+'-'+String(row.day).padStart(2,'0')+' · '+row.workouts.join(', ')+' · from '+row.sourceGroup+(row.already?' · already here':'')));body.append(label);choices.push({row,check});}
   if(!review.rows.some(r=>!r.already)){body.append(node('p','Nothing new to copy. Your group history is unchanged.'));return;}
   let busy=false;
   const save=button('Copy selected workouts',async()=>{
    if(busy||!current())return;
    const keys=choices.filter(x=>x.check.checked&&!x.row.already).map(x=>x.row.key);
    if(!keys.length){status.textContent='Choose at least one workout, or close without copying.';return;}
    busy=true;save.disabled=true;choices.forEach(x=>x.check.disabled=true);status.textContent='Copying your reviewed workouts…';
    try{
     const result=await callFunction('copyCurrentMonthWorkouts',{groupCode,operationId:review.operationId,keys});if(!current())return;
     status.textContent=result.created+' copied; '+result.skipped+' skipped. Original workouts are unchanged. Reopen the group to refresh its points.';
     save.remove();window.ForgeExperience?.invalidateHistory?.();
     if(window.groupCode===groupCode)window.loadGroup?.(groupCode,true);
    }catch(e){if(current()){status.textContent=e.message||'Copying was not confirmed. Retry this review; confirmed copies will not duplicate.';save.disabled=false;choices.forEach(x=>x.check.disabled=x.row.already);}}
    finally{busy=false;}
   });body.append(save);
  }catch(e){if(current())status.textContent=e.message||'Could not check your history. No workouts were copied. Try again.';}
 }
 const tokens=new Map();
 function notifications(){
  const id=uid(),body=dialog('Notifications for this device'),status=node('p');status.setAttribute('role','status');
  body.append(node('p','Solo members can register for Forge notifications too. Registration does not switch on daily reminders. Scheduled reminders are currently held; in-app announcements work without push.'),status);
  if(!id){status.textContent='Sign in before registering this device.';return;}
  if(!window.FEATURE_PUSH){status.textContent='Notifications are not enabled in this build.';return;}
  if(!window.pushSupported?.()){status.textContent='This browser cannot receive Forge notifications. On iPhone, use the phone app or add Forge to your Home Screen and open it there.';return;}
  const current=()=>body.isConnected&&uid()===id;
  let busy=false,token=tokens.get(id);
  const controls=node('div');body.append(controls);
  function render(registered){
   controls.replaceChildren(button(registered?'Turn off on this device':'Turn on notifications',async()=>{
    if(busy||!current())return;busy=true;controls.querySelector('button').disabled=true;
    try{
     if(registered){
      await callFunction('manageDeviceRegistration',{mode:'disable',token});if(!current())return;
      tokens.delete(id);token=null;status.textContent='Notifications off for this device.';render(false);
     }else{
      status.textContent='Waiting for notification permission…';
      token=await window.enablePush(text=>{if(current())status.textContent=text;});if(!current())return;
      if(!token){status.textContent='Permission was not granted. Notifications remain off.';render(false);return;}
      const platform=window.Capacitor?.isNativePlatform?.()?Capacitor.getPlatform():'web';
      const result=await callFunction('manageDeviceRegistration',{mode:'enable',token,platform});if(!current())return;
      if(result.registered!==true)throw Error('Registration was not confirmed.');
      tokens.set(id,token);status.textContent='Notifications on for this device. Daily reminders have not been activated.';
      window.startForegroundPush?.(d=>{if(d?.body)toast(d.body);});render(true);
     }
    }catch(e){window.logErr?.('notifications dialog key='+String(window.FCM_VAPID_KEY||'').slice(0,6),e);if(current()){status.textContent=window.ForgeFeedback?.notification(e)||'Could not confirm registration. Try again.';render(registered);}}
    finally{busy=false;}
   }));
  }
  render(false);
  if(token)callFunction('manageDeviceRegistration',{mode:'status',token}).then(r=>{if(current()){status.textContent=r.registered?'Notifications on for this device.':'This device is not registered.';render(r.registered);}}).catch(()=>{if(current())status.textContent='Could not check this device. Try registering again.';});
  else status.textContent='Turn on notifications to request permission and confirm registration.';
 }
 window.ForgeAccountExtras={copyMonth,notifications};
})();

