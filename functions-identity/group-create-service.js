'use strict';
const crypto=require('node:crypto');
module.exports=function({db,FieldValue,HttpsError,identity,now=Date.now}){
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  const reserved=new Set(['FORGE1','ADMIN','STAGING','GULLYG','GHADIY','VANDRA','SQUAD1']);
  const blocked=['FUCK','SHIT','CUNT','DICK','COCK','PISS','PORN','SEXY','NAZI','RAPE','ANAL','TITS','SLUT','WHORE','BOOB'];
  return async function create(request){
    const actor=identity.actor(request),d=request.data||{},admin=d.admin===true;
    if(admin&&request.auth.token.forgeAdmin!==true)fail('permission-denied','Superadmin access required.');
    const name=typeof d.groupName==='string'?d.groupName.trim():'';
    const player=typeof d.name==='string'?d.name.trim():'';
    if(name.length<2||name.length>40)fail('invalid-argument','Group name must be 2–40 characters.');
    if(!admin&&(player.length<2||player.length>24||/[^\p{L}\p{N} .\-]/u.test(player)))fail('invalid-argument','Enter a valid player name.');
    if(typeof d.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(d.requestId))fail('invalid-argument','Refresh and try again.');
    const custom=typeof d.code==='string'?d.code.trim().toUpperCase():'';
    if(custom&&(!/^[A-Z0-9]{6}$/.test(custom)||reserved.has(custom)||blocked.some(word=>custom.includes(word))))fail('invalid-argument','Choose another six-character group code.');
    const at=now(),stamp=FieldValue.serverTimestamp(),date=new Date(at+19800000),year=date.getUTCFullYear(),month=date.getUTCMonth()+1;
    const sid=year+'-'+String(month).padStart(2,'0'),day=date.toISOString().slice(0,10);
    const settings={month,year,days:new Date(Date.UTC(year,month,0)).getUTCDate(),capTarget:16,vcTarget:20,minWorkouts:0,numTeams:1,teamStreakThreshold:0.6,rolesEnabled:false};
    if(admin){
      const patch=d.settings||{};
      if(Object.keys(patch).some(k=>!['capTarget','vcTarget','numTeams','teamStreakThreshold','rolesEnabled'].includes(k)))fail('invalid-argument','Unsupported creation setting.');
      for(const k of ['capTarget','vcTarget'])if(patch[k]!==undefined&&(!Number.isInteger(patch[k])||patch[k]<0||patch[k]>31))fail('invalid-argument','Invalid target.');
      if(patch.numTeams!==undefined&&(!Number.isInteger(patch.numTeams)||patch.numTeams<1||patch.numTeams>26))fail('invalid-argument','Invalid team count.');
      if(patch.teamStreakThreshold!==undefined&&(!Number.isFinite(patch.teamStreakThreshold)||patch.teamStreakThreshold<0.3||patch.teamStreakThreshold>1))fail('invalid-argument','Invalid threshold.');
      if(patch.rolesEnabled!==undefined&&typeof patch.rolesEnabled!=='boolean')fail('invalid-argument','Invalid role setting.');
      Object.assign(settings,patch);
    }
    const digest=crypto.createHash('sha256').update(JSON.stringify([actor.uid,d.requestId])).digest('hex');
    const receiptRef=db.collection('groupCreationReceipts').doc(digest);
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([name,player,custom,admin,settings,d.demo===true])).digest('hex');
    const code=custom||crypto.randomBytes(5).toString('hex').slice(0,6).toUpperCase(),newId=crypto.randomUUID();
    return db.runTransaction(async tx=>{
      const receipt=await tx.get(receiptRef);
      if(receipt.exists){if(receipt.data().fingerprint!==fingerprint)fail('failed-precondition','This request was already used. Start a new creation.');return receipt.data().result;}
      const groupRef=db.collection('groups').doc(code),group=await tx.get(groupRef),alias=await tx.get(db.collection('codeAliases').doc(code));
      if(group.exists||alias.exists)fail('already-exists','That group code is taken. Try another.');
      let userRef,user,indexRef,id,limitRef,limit;
      if(!admin){
        indexRef=db.collection('authIdentities').doc(actor.uid);
        const index=await tx.get(indexRef),legacy=await tx.get(db.collection('users').where('authUid','==',actor.uid).limit(2));
        if(legacy.docs.length>1)fail('failed-precondition','Account recovery required.');
        id=index.exists?index.data().userId:legacy.docs[0]?.id||newId;
        if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)||legacy.docs.some(x=>x.id!==id))fail('failed-precondition','Account recovery required.');
        userRef=db.collection('users').doc(id);const snap=await tx.get(userRef);user=snap.exists?snap.data():null;
        if((index.exists&&!user)||(user&&(user.authUid!==actor.uid||user.deleted||user.deletedAt||user.deletionRequestedAt)))fail('permission-denied','Account unavailable.');
        if(Object.keys(user?.memberships||{}).length>=7)fail('failed-precondition','You already belong to seven groups.');
        limitRef=db.collection('groupCreationLimits').doc(actor.uid);const l=await tx.get(limitRef);limit=l.exists&&l.data().day===day?Number(l.data().count)||0:0;
        if(limit>=2)fail('resource-exhausted','Two groups in one day is plenty. Try tomorrow.');
      }
      const roster=admin?[]:[{name:player,userId:id,uid:actor.uid,team:'A',role:'Player',isAdmin:true}];
      tx.set(groupRef,{name,players:roster.map(p=>({name:p.name})),currentSeasonId:sid,createdAt:stamp,...(admin&&d.demo===true?{demo:true}:{})});
      tx.set(groupRef.collection('seasons').doc(sid),{...settings,roster,credentialSchema:2,status:'active',startedAt:stamp,endedAt:null});
      if(!admin){
        tx.set(userRef,{...(user||{name:player,nameLower:player.toLowerCase(),authUid:actor.uid,email:actor.email,authProvider:actor.provider,authLinkedAt:stamp,createdAt:stamp,migratedFrom:'provider-signup',stats:{}}),memberships:{...user?.memberships,[code]:{joinedAt:stamp,groupName:name}}});
        // refreshIdentity reconstructs the complete, canonical read directory.
        tx.set(indexRef,{userId:id,groupCodes:[code]});
        tx.set(limitRef,{day,count:limit+1});
      }
      const result={ok:true,groupCode:code,seasonId:sid,...(!admin?{userId:id}:{})};
      tx.set(receiptRef,{fingerprint,result,createdAt:stamp});return result;
    });
  };
};
