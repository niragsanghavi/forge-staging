'use strict';
const crypto=require('node:crypto');
const {OFFSET,DAY,wall,sidOf,isoWeek,monday}=require('./season-dates');
module.exports=function({db,FieldValue,HttpsError,groupWrites,now=Date.now}){
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 const scope=d=>{if(!d||typeof d.groupCode!=='string'||!/^[A-Z0-9]{4,10}$/.test(d.groupCode)||typeof d.seasonId!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(d.seasonId))fail('invalid-argument','Invalid season.');return d;};
 const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
 async function lock(request){
  const d=scope(request.data);if(!Number.isInteger(d.pledge)||d.pledge<1||d.pledge>7)fail('invalid-argument','Choose one to seven workout days.');
  return db.runTransaction(async tx=>{
   const today=wall(now()),week=isoWeek(today),mon=monday(week),sun=new Date(mon.getTime()+6*DAY);
   if(sidOf(today)!==d.seasonId||sidOf(mon)!==d.seasonId||sidOf(sun)!==d.seasonId)fail('failed-precondition','Pledges are available for complete Monday–Sunday weeks within this month.');
   const actor=await groupWrites.owner(tx,request),m=await groupWrites.membership(tx,actor,d.groupCode,d.seasonId);
   const twist=await tx.get(m.ref.collection('twists').doc('double_or_nothing'));
   if(!twist.exists||twist.data().enabled!==true)fail('failed-precondition','Iron Pledge is not enabled.');
   const bets=await tx.get(m.ref.collection('bets'));
   const old=bets.docs.filter(doc=>doc.data().player===m.player.name&&doc.data().week===week);
   if(old.length){if(old.length!==1||old[0].data().pledge!==d.pledge)fail('already-exists','Your pledge is already locked for this week.');return {ok:true,already:true,week};}
   const ref=m.ref.collection('bets').doc(hash([actor.userId,week]));
   tx.set(ref,{userId:actor.userId,player:m.player.name,pledge:d.pledge,week,groupCode:d.groupCode,lockedAt:FieldValue.serverTimestamp()});
   return {ok:true,already:false,week};
  });
 }
 // Return pending writes without applying them: rollover can share the same
 // transaction and score these results before freezing the season.
 async function plan(tx,code,sid,season,logs){
  const ref=db.collection('groups').doc(code).collection('seasons').doc(sid);
  const bets=await tx.get(ref.collection('bets'));
  const old=await tx.get(db.collection('bonuses_iron_pledge').where('groupCode','==',code).where('year','==',season.year).where('month','==',season.month));
  const bonuses=old.docs.map(doc=>doc.data()),writes=[],seen=new Set(bonuses.map(b=>JSON.stringify([b.player,b.week])));
  for(const doc of bets.docs){
   const bet=doc.data(),mon=monday(bet.week);if(!mon)continue;
   const sun=new Date(mon.getTime()+6*DAY);
   if(sidOf(mon)!==sid||sidOf(sun)!==sid||sun.getTime()+DAY-OFFSET>now())continue;
   if(typeof bet.player!=='string'||!Number.isInteger(bet.pledge)||bet.pledge<1||bet.pledge>7)fail('failed-precondition','A historical pledge needs review.');
   const key=JSON.stringify([bet.player,bet.week]);if(seen.has(key))continue;
   const matches=(season.roster||[]).filter(p=>p&&p.name===bet.player);
   if(matches.length!==1||(bet.userId&&matches[0].userId!==bet.userId))fail('failed-precondition','Pledge ownership needs review.');
   const player=matches[0],days=new Set(logs.filter(l=>!l.voided&&l.player===bet.player&&(!l.userId||!player.userId||l.userId===player.userId)&&Number.isInteger(l.day)&&l.day>=mon.getUTCDate()&&l.day<=sun.getUTCDate()).map(l=>l.day));
   const value={player:bet.player,...(player.userId?{userId:player.userId}:{}),pledge:bet.pledge,actual:days.size,week:bet.week,groupCode:code,year:season.year,month:season.month,type:days.size>=bet.pledge?'double':'zero',rawPoints:days.size*5,calculatedAt:FieldValue.serverTimestamp()};
   writes.push({ref:db.collection('bonuses_iron_pledge').doc(hash([code,sid,bet.player,bet.week])),value});bonuses.push(value);seen.add(key);
  }
  return {bonuses,writes};
 }
 async function settle(request){
  const d=scope(request.data);
  return db.runTransaction(async tx=>{
   const a=await groupWrites.owner(tx,request),m=await groupWrites.membership(tx,a,d.groupCode,d.seasonId,false);
   if(m.season.snapshotAt)return {ok:true,settled:0};
   const logs=await tx.get(db.collection('logs').where('groupCode','==',d.groupCode).where('year','==',m.season.year).where('month','==',m.season.month));
   const result=await plan(tx,d.groupCode,d.seasonId,m.season,logs.docs.map(doc=>doc.data()));
   for(const w of result.writes)tx.set(w.ref,w.value);return {ok:true,settled:result.writes.length};
  });
 }
 return {lock,settle,plan};
};
