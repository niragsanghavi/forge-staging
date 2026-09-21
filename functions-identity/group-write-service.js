'use strict';
const crypto=require('node:crypto');
// Verified account -> server identity -> canonical season roster. Client names,
// teams, roles and userIds are never authority for a group write.
module.exports=({db,FieldValue,HttpsError,identity,now=Date.now})=>{
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
  const codeOf=x=>{if(typeof x!=='string'||!/^[A-Z0-9]{4,10}$/.test(x))fail('invalid-argument','Invalid group.');return x;};
  function period(d){
    const {year,month,day}=d,today=new Date(now()+19800000);
    if(!Number.isInteger(year)||!Number.isInteger(month)||!Number.isInteger(day)||year!==today.getUTCFullYear()||month!==today.getUTCMonth()+1||day<Math.max(1,today.getUTCDate()-7)||day>today.getUTCDate())fail('invalid-argument','Choose a day within the current logging window.');
    return year+'-'+String(month).padStart(2,'0');
  }
  async function owner(tx,request){
    const a=identity.actor(request,false),index=await tx.get(db.collection('authIdentities').doc(a.uid));
    const id=index.exists&&index.data().userId;
    if(!validId(id))fail('permission-denied','Link your Forge profile first.');
    const user=await tx.get(db.collection('users').doc(id));
    if(!user.exists||user.data().authUid!==a.uid||user.data().deleted||user.data().deletedAt||user.data().deletionRequestedAt)fail('permission-denied','Profile unavailable.');
    return {...a,userId:id};
  }
  async function membership(tx,a,code,sid,current=true){
    const gRef=db.collection('groups').doc(code),group=await tx.get(gRef),sRef=gRef.collection('seasons').doc(sid),season=await tx.get(sRef);
    if(!group.exists||!season.exists)fail('not-found','Group season unavailable.');
    const s=season.data();
    if(current&&(group.data().currentSeasonId!==sid||['closed','archived','deleted'].includes(s.status)))fail('failed-precondition','This season is no longer open.');
    if(!Array.isArray(s.roster))fail('failed-precondition','Group roster needs repair.');
    const matches=s.roster.filter(p=>p&&p.userId===a.userId&&p.departed!==true);
    if(matches.length!==1||typeof matches[0].name!=='string'||!matches[0].name||typeof matches[0].team!=='string')fail('permission-denied','You are not an active member of this season.');
    return {player:matches[0],season:s,group:group.data(),ref:sRef};
  }
  async function save(request){
    identity.actor(request,false);
    const d=request.data||{},sid=period(d),workouts=d.workouts;
    if(!Array.isArray(workouts)||!workouts.length||workouts.length>20||workouts.some(w=>typeof w!=='string'||!w.trim()||w.length>200))fail('invalid-argument','Choose valid workouts.');
    if(d.note!=null&&(typeof d.note!=='string'||d.note.length>200))fail('invalid-argument','Note is too long.');
    if(d.km!=null&&(typeof d.km!=='number'||!Number.isFinite(d.km)||d.km<0||d.km>1000))fail('invalid-argument','Invalid distance.');
    if(!Array.isArray(d.targets)||!d.targets.length||d.targets.length>7)fail('invalid-argument','Choose one to seven groups.');
    const targets=d.targets.map(t=>{if(!t||!validId(t.logId))fail('invalid-argument','Invalid submission.');return {code:codeOf(t.code),logId:t.logId};});
    if(new Set(targets.map(t=>t.code)).size!==targets.length||new Set(targets.map(t=>t.logId)).size!==targets.length)fail('invalid-argument','Duplicate destination.');
    return db.runTransaction(async tx=>{
      period(d); // Revalidate after transaction retries across an IST day boundary.
      const a=await owner(tx,request),writes=[];
      // Read every destination before writing any. A bad destination cannot
      // leave a partially successful broadcast masquerading as a full save.
      for(const target of targets){
        const m=await membership(tx,a,target.code,sid),ref=db.collection('logs').doc(target.logId),old=await tx.get(ref);
        const submissionId=crypto.createHash('sha256').update(JSON.stringify([a.userId,...targets.map(t=>t.code+':'+t.logId).sort()])).digest('hex');
        const payload={submissionId,groupCode:target.code,player:m.player.name,team:m.player.team,role:m.player.role||'Player',userId:a.userId,uid:a.uid,workouts:[...new Set(workouts.map(w=>w.trim()))],year:d.year,month:d.month,day:d.day,...(d.note?{note:d.note}:{}),...(d.km!=null?{km:d.km}:{}),...(m.group.demo===true?{demo:true}:{})};
        if(old.exists){
          const previous=old.data();
          if(previous.voided||Object.keys(payload).some(k=>JSON.stringify(previous[k])!==JSON.stringify(payload[k]))||['note','km','demo'].some(k=>!(k in payload)&&k in previous))fail('already-exists','Submission identifier already used. Start a new log.');
        }else writes.push({ref,payload});
      }
      for(const {ref,payload} of writes)tx.set(ref,{...payload,timestamp:FieldValue.serverTimestamp()});
      return {ok:true,logIds:targets.map(t=>t.logId),created:writes.length};
    });
  }
  async function voidLog(request){
    identity.actor(request,false);
    const id=request.data?.logId;if(!validId(id))fail('invalid-argument','Invalid workout.');
    return db.runTransaction(async tx=>{
      const a=await owner(tx,request),ref=db.collection('logs').doc(id),snap=await tx.get(ref);
      if(!snap.exists)fail('not-found','Workout not found.');
      const log=snap.data();
      if(log.userId!==a.userId)fail('permission-denied','You can remove only your own workouts.');
      const sid=period(log);await membership(tx,a,codeOf(log.groupCode),sid);
      if(!log.voided)tx.update(ref,{voided:true,voidedBy:a.userId,voidedAt:FieldValue.serverTimestamp()});
      return {ok:true,already:log.voided===true};
    });
  }
  async function saveSteps(request){
    identity.actor(request,false);
    const d=request.data||{},code=codeOf(d.groupCode),sid=d.seasonId;
    if(typeof sid!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(sid)||!Number.isInteger(d.round)||d.round<1||d.round>4)fail('invalid-argument','Invalid step round.');
    if(!d.days||typeof d.days!=='object'||Array.isArray(d.days)||!Object.keys(d.days).length||Object.keys(d.days).length>8)fail('invalid-argument','Invalid step readings.');
    if(!['healthkit','healthconnect'].includes(d.source))fail('invalid-argument','Unsupported step source.');
    return db.runTransaction(async tx=>{
      const a=await owner(tx,request),m=await membership(tx,a,code,sid,false),s=m.season;
      const [year,month]=sid.split('-').map(Number);
      if(s.year!==year||s.month!==month||s.stepRounds?.enabled!==true)fail('failed-precondition','This challenge is not enabled.');
      const length=new Date(Date.UTC(year,month,0)).getUTCDate(),base=Math.floor(length/4),extra=length%4;
      const start=1+(d.round-1)*base+Math.min(d.round-1,extra),end=start+base+(d.round<=extra?1:0)-1;
      const cutoff=Date.UTC(year,month-1,end+1)-19800000+(d.round===4?18:36)*3600000;
      if(now()>=cutoff)fail('failed-precondition','Step syncing has closed for this round.');
      const incoming={};
      for(const [key,value] of Object.entries(d.days)){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(key))fail('invalid-argument','Invalid step date.');
        const [y,mo,day]=key.split('-').map(Number);
        if(y!==year||mo!==month||day<start||day>end||Date.UTC(y,mo-1,day+1)-19800000>now()||!Number.isInteger(value)||value<0||value>100000)fail('invalid-argument','Only completed days in this round are accepted.');
        incoming[key]=value;
      }
      const week=sid+'-r'+d.round,win=await tx.get(m.ref.collection('twistWindows').doc('step_week_'+week));
      if(win.exists)fail('failed-precondition','This round has already been settled.');
      // Keep the existing document identity so upgrade cannot duplicate players.
      const docId=week+'__'+m.player.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),ref=m.ref.collection('stepWeeks').doc(docId),old=await tx.get(ref);
      if(old.exists&&((old.data().userId&&old.data().userId!==a.userId)||old.data().player!==m.player.name))fail('failed-precondition','Step record identity needs repair.');
      const days={};
      for(const [key,value] of Object.entries(old.exists&&old.data().days||{})){
        const [y,mo,day]=key.split('-').map(Number);
        if(/^\d{4}-\d{2}-\d{2}$/.test(key)&&y===year&&mo===month&&day>=start&&day<=end&&Date.UTC(y,mo-1,day+1)-19800000<=now()&&Number.isInteger(value)&&value>=0&&value<=100000)days[key]=value;
      }
      Object.assign(days,incoming);
      tx.set(ref,{player:m.player.name,userId:a.userId,team:m.player.team,week,weekStart:sid+'-'+String(start).padStart(2,'0'),days,total:Object.values(days).reduce((a,b)=>a+b,0),source:d.source,updatedAt:FieldValue.serverTimestamp()});
      return {ok:true,week,days:Object.keys(days).length};
    });
  }
  async function setConsent(request){
    identity.actor(request,false);
    const d=request.data||{},code=codeOf(d.groupCode),sid=d.seasonId;
    if(typeof sid!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(sid)||typeof d.visible!=='boolean')fail('invalid-argument','Choose a valid visibility setting.');
    return db.runTransaction(async tx=>{
      const a=await owner(tx,request),m=await membership(tx,a,code,sid);
      const roster=m.season.roster.map(p=>p&&p.userId===a.userId?{...p,globalConsent:d.visible}:p);
      tx.update(m.ref,{roster});
      // Remove an existing public entry immediately on opt-out. A later
      // authoritative score refresh may add an opted-in member, never before.
      if(!d.visible&&m.group.globalStats){
        const stats=m.group.globalStats;
        tx.update(db.collection('groups').doc(code),{globalStats:{...stats,players:(Array.isArray(stats.players)?stats.players:[]).filter(p=>p&&p.userId!==a.userId&&p.name!==m.player.name)}});
      }
      return {ok:true,visible:d.visible};
    });
  }
  async function checkJack(request){
    identity.actor(request,false);
    const d=request.data||{},sid=period(d),code=codeOf(d.groupCode);
    return db.runTransaction(async tx=>{
      period(d);
      const a=await owner(tx,request),m=await membership(tx,a,code,sid);
      const enabled=await tx.get(m.ref.collection('twists').doc('jack_of_all_trades'));
      if(!enabled.exists||enabled.data().enabled!==true)return {ok:true,awarded:false};
      const date=new Date(Date.UTC(d.year,d.month-1,d.day)),dow=(date.getUTCDay()+6)%7,mon=d.day-dow,end=mon+6;
      const thursday=new Date(date);thursday.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));
      const week=thursday.getUTCFullYear()+'-W'+Math.ceil((((thursday-Date.UTC(thursday.getUTCFullYear(),0,1))/86400000)+1)/7);
      const awards=await tx.get(m.ref.collection('jackAwards'));
      if(awards.docs.some(doc=>doc.data().player===m.player.name&&doc.data().week===week))return {ok:true,awarded:false,already:true};
      const logs=await tx.get(db.collection('logs').where('groupCode','==',code).where('year','==',d.year).where('month','==',d.month));
      const today=new Date(now()+19800000).getUTCDate(),types=new Set();
      for(const doc of logs.docs){
        const l=doc.data();if(l.voided||l.player!==m.player.name||(l.userId&&l.userId!==a.userId)||!Number.isInteger(l.day)||l.day<Math.max(1,mon)||l.day>Math.min(today,end))continue;
        for(const type of Array.isArray(l.workouts)?l.workouts:[l.workout])if(typeof type==='string'&&type.trim())types.add(type.trim());
      }
      if(types.size<4)return {ok:true,awarded:false};
      const id=crypto.createHash('sha256').update(JSON.stringify([a.userId,week])).digest('hex');
      tx.set(m.ref.collection('jackAwards').doc(id),{userId:a.userId,player:m.player.name,week,groupCode:code,workoutTypes:[...types].sort(),awardedAt:FieldValue.serverTimestamp()});
      return {ok:true,awarded:true};
    });
  }
  async function flag(request){
    const logId=request.data?.logId;if(!validId(logId))fail('invalid-argument','Invalid workout.');
    return db.runTransaction(async tx=>{
      const a=await owner(tx,request),log=await tx.get(db.collection('logs').doc(logId));
      if(!log.exists||log.data().voided)fail('not-found','Workout unavailable.');
      const l=log.data(),sid=l.year+'-'+String(l.month).padStart(2,'0'),m=await membership(tx,a,codeOf(l.groupCode),sid);
      const ref=db.collection('flags').doc(crypto.createHash('sha256').update(JSON.stringify([a.userId,logId])).digest('hex')),old=await tx.get(ref);
      if(old.exists)return {ok:true,already:true};
      tx.set(ref,{groupCode:l.groupCode,logId,player:l.player,userId:a.userId,flaggedBy:m.player.name,month:l.month,year:l.year,timestamp:FieldValue.serverTimestamp()});return {ok:true,already:false};
    });
  }
  async function survey(request){
    const d=request.data||{};
    if(!['all_forge','keep_whatsapp','both'].includes(d.choice)||typeof d.note!=='string'||d.note.length>300)fail('invalid-argument','Invalid survey response.');
    const code=codeOf(d.groupCode);
    return db.runTransaction(async tx=>{
      const a=await owner(tx,request),g=await tx.get(db.collection('groups').doc(code));
      if(!g.exists||g.data().surveyAsk!=='wa_vs_forge')fail('failed-precondition','This survey is closed.');
      const m=await membership(tx,a,code,g.data().currentSeasonId);
      const ref=db.collection('survey').doc(require('node:crypto').createHash('sha256').update(JSON.stringify([a.userId,code,'wa_vs_forge'])).digest('hex'));
      if((await tx.get(ref)).exists)return {ok:true,already:true};
      tx.set(ref,{groupCode:code,version:'inapp-wa_vs_forge',answers:{choice:d.choice,note:d.note||null,player:m.player.name},userId:a.userId,completedAt:new Date(now()).toISOString()});
      return {ok:true,already:false};
    });
  }
  async function trackTab(request){
    const d=request.data||{},code=codeOf(d.groupCode);
    if(!['home','lb','feed','global','admin','pledge'].includes(d.tab))fail('invalid-argument','Unknown tab.');
    return db.runTransaction(async tx=>{
      const a=await owner(tx,request),group=await tx.get(db.collection('groups').doc(code));
      if(!group.exists)fail('not-found','Group unavailable.');
      const sid=group.data().currentSeasonId;await membership(tx,a,code,sid);
      if(group.data().demo===true)return {ok:true,counted:false};
      const throttle=db.collection('tabRateLimits').doc(crypto.createHash('sha256').update(JSON.stringify([a.userId,code])).digest('hex')),last=await tx.get(throttle);
      const at=now(),prior=last.exists?last.data().at:null;
      if(Number.isFinite(prior)&&at-prior<1000)return {ok:true,counted:false};
      const ref=db.collection('analytics').doc(code).collection('tabClicks').doc(sid),snap=await tx.get(ref),data=snap.exists?snap.data():{};
      tx.set(ref,{...data,[d.tab]:(Number.isSafeInteger(data[d.tab])?data[d.tab]:0)+1});tx.set(throttle,{at});
      return {ok:true,counted:true};
    });
  }
  return {save,voidLog,saveSteps,setConsent,checkJack,owner,membership,flag,survey,trackTab};
};
