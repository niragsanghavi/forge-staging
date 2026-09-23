'use strict';
// Whether a season's roster is in the reviewed, migrated shape.
//
// The marker is credentialSchema:2, written by the reviewed migration and by
// every server-side season write. But the apps already in people's hands roll
// a group into the next month themselves, and they create that month without
// the marker while copying the migrated roster as-is. Without a fallback, every
// month boundary one of those apps wins would block legacy linking and the
// next server rollover for the whole group until someone patched the data.
//
// So an unmarked season still counts when an unbroken run of consecutive
// earlier months leads back to a marked one, and no roster along the way holds
// a credential (a plaintext pin or a stored pin hash — rosters carry only the
// non-secret pinSet flag once migrated). Anything else stays blocked.
const MAX_MONTHS_BACK = 12;

function previousSid(sid){
 const [year,month]=sid.split('-').map(Number);
 return month===1?(year-1)+'-12':year+'-'+String(month-1).padStart(2,'0');
}
function rosterIsClean(roster){
 return Array.isArray(roster)&&roster.every(p=>!p||((p.pin===undefined||p.pin===null||p.pin==='')&&(p.pinHash===undefined||p.pinHash===null)));
}
// Reads only; safe before any transaction write.
async function seasonMigrated(tx,groupRef,sid,season){
 let data=season,id=sid;
 for(let back=0;back<=MAX_MONTHS_BACK;back++){
  if(!data||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(id))return false;
  if(data.credentialSchema===2)return true;
  if(!rosterIsClean(data.roster))return false;
  id=previousSid(id);
  const snap=await tx.get(groupRef.collection('seasons').doc(id));
  data=snap.exists?snap.data():null;
 }
 return false;
}
module.exports={seasonMigrated,rosterIsClean,previousSid,MAX_MONTHS_BACK};
