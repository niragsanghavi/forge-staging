'use strict';
module.exports=function({db,FieldValue,HttpsError,identity,now=Date.now}){
  const twists=require('./twist-admin-service')({db,FieldValue,HttpsError,now});
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  function scope(data){
    const code=data?.groupCode,sid=data?.seasonId;
    if(typeof code!=='string'||!/^[A-Z0-9]{4,10}$/.test(code)||typeof sid!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(sid))fail('invalid-argument','Invalid group season.');
    return {code,sid};
  }
  async function authorize(tx,request){
    const actor=identity.actor(request,false),{code,sid}=scope(request.data),groupRef=db.collection('groups').doc(code),seasonRef=groupRef.collection('seasons').doc(sid);
    const group=await tx.get(groupRef),season=await tx.get(seasonRef);
    if(!group.exists||!season.exists||!Array.isArray(season.data().roster))fail('not-found','Group season unavailable.');
    const superadmin=request.auth.token.forgeAdmin===true;
    if(!superadmin){
      const index=await tx.get(db.collection('authIdentities').doc(actor.uid)),id=index.exists&&index.data().userId;
      const profile=id&&await tx.get(db.collection('users').doc(id));
      const entries=season.data().roster.filter(p=>p&&p.userId===id&&!p.departed);
      if(!profile||!profile.exists||profile.data().authUid!==actor.uid||profile.data().deleted||profile.data().deletionRequestedAt||entries.length!==1||entries[0].isAdmin!==true)fail('permission-denied','Group admin access is required.');
    }
    return {actor,superadmin,group:group.data(),season:season.data(),groupRef,seasonRef,code,sid};
  }
  async function access(request){
    identity.actor(request,false);
    if(!request.data?.groupCode)return {superadmin:request.auth.token.forgeAdmin===true};
    return db.runTransaction(async tx=>{const a=await authorize(tx,request);return {superadmin:a.superadmin,groupAdmin:true};});
  }
  const safeRoster=roster=>roster.map(p=>{if(!p)return p;const {pin,pinHash,...safe}=p;return safe;});
  async function flags(request){
    return db.runTransaction(async tx=>{const a=await authorize(tx,request);const rows=await tx.get(db.collection('flags').where('groupCode','==',a.code).where('month','==',a.season.month).where('year','==',a.season.year));return {ok:true,flags:rows.docs.filter(d=>!d.data().resolved).map(d=>({id:d.id,...d.data()}))};});
  }
  function settings(patch,season){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))fail('invalid-argument','Invalid settings.');
    const out={};
    for(const [key,value] of Object.entries(patch)){
      const limits={days:[1,new Date(Date.UTC(season.year,season.month,0)).getUTCDate()],capTarget:[0,31],vcTarget:[0,31],minWorkouts:[0,31],numTeams:[1,26],foundryGoal:[1,100000]};
      if(Object.hasOwn(limits,key)){const [min,max]=limits[key];if(key==='foundryGoal'&&value===null){out[key]=FieldValue.delete();continue;}if(!Number.isInteger(value)||value<min||value>max)fail('invalid-argument','Invalid '+key);}
      else if(['rolesEnabled','scoringV2','rebalanceDismissed'].includes(key)){if(typeof value!=='boolean')fail('invalid-argument','Invalid '+key);}
      else if(key==='teamStreakThreshold'){if(typeof value!=='number'||!Number.isFinite(value)||value<0.3||value>1)fail('invalid-argument','Invalid team threshold.');}
      else if(key==='kmTarget'){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>10000))fail('invalid-argument','Invalid distance goal.');}
      else if(key==='stepRounds'){
        if(!value||typeof value.enabled!=='boolean'||Object.keys(value).some(k=>k!=='enabled'))fail('invalid-argument','Only the challenge toggle can be changed here.');
        out[key]={...season.stepRounds,enabled:value.enabled};continue;
      }else fail('invalid-argument','Unsupported setting.');
      out[key]=value;
    }
    return out;
  }
  async function change(request){
    return db.runTransaction(async tx=>{
      const a=await authorize(tx,request),d=request.data;
      if(a.group.currentSeasonId!==a.sid||['closed','archived','deleted'].includes(a.season.status))fail('failed-precondition','This season is no longer open.');
      if(d.action==='survey'){
        if(!a.superadmin)fail('permission-denied','Superadmin access required.');
        if(typeof d.enabled!=='boolean')fail('invalid-argument','Invalid survey setting.');
        tx.update(a.groupRef,{surveyAsk:d.enabled?'wa_vs_forge':FieldValue.delete()});return {ok:true};
      }
      if(['twistToggle','twistConfig','twistWindow'].includes(d.action))return twists(tx,a,d);
      if(d.action==='resolveFlag'){
        if(typeof d.logId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(d.logId)||!['keep','remove'].includes(d.resolution))fail('invalid-argument','Invalid moderation action.');
        const ref=db.collection('logs').doc(d.logId),log=await tx.get(ref);
        if(!log.exists||log.data().groupCode!==a.code||log.data().year!==a.season.year||log.data().month!==a.season.month)fail('permission-denied','Workout belongs to a different season.');
        const flags=await tx.get(db.collection('flags').where('groupCode','==',a.code).where('logId','==',d.logId));
        if(flags.size>450)fail('failed-precondition','This queue needs server maintenance.');
        if(d.resolution==='remove'&&!log.data().voided)tx.update(ref,{voided:true,voidedBy:a.actor.uid,voidedAt:FieldValue.serverTimestamp()});
        for(const flag of flags.docs)tx.update(flag.ref,{resolved:true,resolution:d.resolution,resolvedBy:a.actor.uid,resolvedAt:FieldValue.serverTimestamp()});return {ok:true};
      }
      if(d.action==='rename'){
        const old=d.oldName,name=typeof d.newName==='string'?d.newName.trim().replace(/\s+/g,' '):'';
        if(typeof old!=='string'||name.length<2||name.length>24||/[^\p{L}\p{N} .\-]/u.test(name))fail('invalid-argument','Enter a valid name.');
        const rows=a.season.roster.filter(p=>p&&!p.departed&&p.name===old);
        if(rows.length!==1||a.season.roster.some(p=>p&&p.name!==old&&String(p.name).toLowerCase()===name.toLowerCase()))fail('failed-precondition','Name is unavailable or the roster changed.');
        const row=rows[0],userRef=row.userId?db.collection('users').doc(row.userId):null,user=userRef?await tx.get(userRef):null;
        const logs=await tx.get(db.collection('logs').where('groupCode','==',a.code).where('year','==',a.season.year).where('month','==',a.season.month));
        if(logs.docs.some(doc=>doc.data().player===name&&doc.data().userId&&doc.data().userId!==row.userId))fail('failed-precondition','That spelling belongs to another profile’s workouts.');
        const roster=a.season.roster.map(p=>p===row?{...p,name}:p);
        tx.update(a.seasonRef,{roster});tx.update(a.groupRef,{players:(a.group.players||[]).map(p=>p?.name===old?{...p,name}:p)});
        if(user?.exists&&!user.data().deleted&&!user.data().deletionRequestedAt&&String(user.data().name||'').toLowerCase()===old.toLowerCase())tx.update(userRef,{name,nameLower:name.toLowerCase()});
        return {ok:true,roster:safeRoster(roster)};
      }
      if(d.action==='settings'){
        const patch=settings(d.patch,a.season),groupPatch={};
        if(Object.hasOwn(patch,'scoringV2')&&!a.superadmin)fail('permission-denied','Superadmin access required for scoring changes.');
        if(patch.numTeams>1&&a.season.roster.some(p=>p&&!p.departed&&(!/^[A-Z]$/.test(p.team)||p.team.charCodeAt(0)-65>=patch.numTeams)))fail('failed-precondition','Move players into the remaining teams before reducing the team count.');
        if(d.groupName!==undefined){if(!a.superadmin)fail('permission-denied','Superadmin access required.');if(typeof d.groupName!=='string'||d.groupName.trim().length<2||d.groupName.length>80)fail('invalid-argument','Invalid group name.');groupPatch.name=d.groupName.trim();}
        if(d.demo!==undefined){if(!a.superadmin||typeof d.demo!=='boolean')fail('permission-denied','Superadmin access required.');groupPatch.demo=d.demo;}
        if(patch.numTeams===1)patch.roster=a.season.roster.map(p=>({...p,team:'A'}));
        if(Object.keys(patch).length)tx.update(a.seasonRef,patch);
        if(Object.keys(groupPatch).length)tx.update(a.groupRef,groupPatch);
        return {ok:true};
      }
      if(d.action==='award30'){
        if(typeof d.name!=='string'||a.season.roster.filter(p=>p&&!p.departed&&p.name===d.name).length!==1)fail('invalid-argument','Choose an active player.');
        const existing=await tx.get(db.collection('bonuses_30day').where('groupCode','==',a.code).where('year','==',a.season.year).where('month','==',a.season.month));
        if(existing.docs.some(doc=>doc.data().player===d.name))return {ok:true,already:true};
        const player=a.season.roster.find(p=>p&&!p.departed&&p.name===d.name);
        const id=require('node:crypto').createHash('sha256').update(JSON.stringify([a.code,a.sid,d.name])).digest('hex');
        tx.set(db.collection('bonuses_30day').doc(id),{groupCode:a.code,year:a.season.year,month:a.season.month,player:d.name,...(player.userId?{userId:player.userId}:{}),awardedAt:FieldValue.serverTimestamp(),awardedBy:a.actor.uid});
        return {ok:true,already:false};
      }
      if(d.action==='roles'||d.action==='rebalance'){
        if(!Array.isArray(d.changes)||d.changes.length>500)fail('invalid-argument','Invalid roster changes.');
        const updates=new Map();
        for(const change of d.changes){
          if(d.action==='rebalance'&&Object.keys(change||{}).some(k=>!['name','team'].includes(k)))fail('invalid-argument','Rebalancing only changes teams.');
          if(!change||typeof change.name!=='string'||updates.has(change.name)||Object.keys(change).some(k=>!['name','team','role','isAdmin'].includes(k)))fail('invalid-argument','Invalid player changes.');
          if(change.team!==undefined&&(typeof change.team!=='string'||!/^[A-Z]$/.test(change.team)||change.team.charCodeAt(0)-65>=(a.season.numTeams||1)))fail('invalid-argument','Invalid team.');
          if(change.role!==undefined&&!['Player','Vice Captain','Captain'].includes(change.role))fail('invalid-argument','Invalid role.');
          if(change.isAdmin!==undefined&&typeof change.isAdmin!=='boolean')fail('invalid-argument','Invalid admin selection.');
          if(a.season.roster.filter(p=>p&&p.name===change.name&&!p.departed).length!==1)fail('failed-precondition','Roster changed. Refresh first.');
          updates.set(change.name,change);
        }
        const roster=a.season.roster.map(p=>p&&!p.departed&&updates.has(p.name)?{...p,...updates.get(p.name)}:p);
        if(a.season.roster.some(p=>p?.isAdmin&&!p.departed)&&!roster.some(p=>p?.isAdmin&&!p.departed))fail('failed-precondition','Keep at least one group admin.');
        tx.update(a.seasonRef,{roster,...(d.action==='rebalance'?{rebalancedAt:FieldValue.serverTimestamp()}: {})});return {ok:true,roster:safeRoster(roster)};
      }
      fail('invalid-argument','Unsupported admin action.');
    });
  }
  return {access,change,settings,flags};
};
