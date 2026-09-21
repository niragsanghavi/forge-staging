'use strict';
// Called only inside the canonical group-admin authorization transaction.
module.exports=function({db,FieldValue,HttpsError,now=Date.now}){
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  const ordinary=new Set(['double_points_day','comeback_bonus','bonus_workout','elimination','stakes_mode','freaky_fridays','monday_motivation','jack_of_all_trades','double_or_nothing']);
  const dayOne=new Set(['freaky_fridays','monday_motivation']);
  const {isoWeek}=require('./season-dates');
  return async function change(tx,a,d){
    const today=new Date(now()+19800000),id=d.twistId;
    if(today.getUTCFullYear()!==a.season.year||today.getUTCMonth()+1!==a.season.month)fail('failed-precondition','Only the current calendar season can be changed.');
    if(d.action==='twistWindow'){
      if(!['boss_week','underdog_week'].includes(id))fail('invalid-argument','Invalid weekly twist.');
      if(today.getUTCDay()!==0)fail('failed-precondition','Activate next week’s twist on Sunday.');
      const mon=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()+1));
      if(mon.getUTCMonth()+1!==a.season.month)fail('failed-precondition','Next week belongs to the next season.');
      const week=isoWeek(mon),ref=a.seasonRef.collection('twistWindows').doc(id+'_'+week),existing=await tx.get(ref);
      if(existing.exists)return {ok:true,already:true,window:existing.data()};
      const value={twist:id,week,monDate:mon.getUTCDate(),sunDate:Math.min(new Date(Date.UTC(a.season.year,a.season.month,0)).getUTCDate(),mon.getUTCDate()+6),month:a.season.month,year:a.season.year,activatedAt:FieldValue.serverTimestamp(),activatedBy:a.actor.uid};
      if(id==='underdog_week'){
        const snap=await tx.get(db.collection('logs').where('groupCode','==',a.code).where('year','==',a.season.year).where('month','==',a.season.month));
        const logs=snap.docs.map(doc=>doc.data()).filter(l=>!l.voided&&Number.isInteger(l.day)&&l.day>=1&&l.day<=today.getUTCDate());
        const counts=a.season.roster.filter(p=>p&&!p.departed).map(p=>({name:p.name,n:new Set(logs.filter(l=>l.player===p.name).map(l=>l.day)).size}));
        const min=Math.min(...counts.map(p=>p.n));value.frozenPlayers=counts.filter(p=>p.n===min).map(p=>p.name);
      }
      tx.set(ref,value);return {ok:true,already:false,window:value};
    }
    if(!ordinary.has(id))fail('invalid-argument','Invalid twist.');
    const ref=a.seasonRef.collection('twists').doc(id),snap=await tx.get(ref),old=snap.exists?snap.data():{};
    if(d.action==='twistToggle'){
      if(typeof d.enabled!=='boolean')fail('invalid-argument','Invalid toggle.');
      if(dayOne.has(id)){
        if(old.enabled===true&&d.enabled===true)return {ok:true,already:true};
        if(old.enabled===true||!d.enabled||today.getUTCDate()!==1)fail('failed-precondition','Enable on day one; this twist stays active for the month.');
      }
      if(id==='stakes_mode'&&d.enabled&&new Set(a.season.roster.filter(p=>p&&!p.departed).map(p=>p.team)).size<2)fail('failed-precondition','This twist needs competing teams.');
      const value={enabled:d.enabled};
      if(id==='double_points_day')value.day=Number.isInteger(Number(old.day))&&Number(old.day)>=1&&Number(old.day)<=7?Number(old.day):3;
      if(id==='bonus_workout')value.workout=typeof old.workout==='string'&&old.workout.length<=60?old.workout:'Run';
      tx.set(ref,value);return {ok:true};
    }
    if(d.action==='twistConfig'){
      let value;
      if(id==='double_points_day'&&d.key==='day'){
        value=typeof d.value==='string'&&/^[1-7]$/.test(d.value)?Number(d.value):d.value;
        if(!Number.isInteger(value)||value<1||value>7)fail('invalid-argument','Choose a day from one to seven.');
      }else if(id==='bonus_workout'&&d.key==='workout'){
        if(typeof d.value!=='string'||!d.value.trim()||d.value.length>60||/[\x00-\x1f]/.test(d.value))fail('invalid-argument','Choose a valid workout.');value=d.value.trim();
      }else fail('invalid-argument','Unsupported twist setting.');
      if(!snap.exists)fail('failed-precondition','Enable the twist before configuring it.');
      tx.update(ref,{[d.key]:value});return {ok:true};
    }
    fail('invalid-argument','Unsupported twist action.');
  };
};
