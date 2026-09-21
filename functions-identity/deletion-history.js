'use strict';

// Pure ownership decisions are separately testable. A matching display name is
// never allowed to override another person's stable identifier.
function belongs(record, userId, legacyUid, names = []) {
  if (!record || typeof record !== 'object') return false;
  if (record.userId) return record.userId === userId;
  if (record.uid) return record.uid === legacyUid;
  return names.includes(record.player || record.name);
}
function seasonNames(roster, userId, legacyUid) {
  const rows = Array.isArray(roster) ? roster.filter(Boolean) : [];
  const own = rows.filter(p => belongs(p, userId, legacyUid));
  // Do not infer ownership of legacy name-only records if a different person
  // shares this label in the same season.
  return [...new Set(own.map(p => p.name).filter(n => typeof n === 'string'))]
    .filter(n => rows.filter(p => p.name === n).every(p => belongs(p, userId, legacyUid)));
}
function departedRow(row, label) {
  return {name: label, team: typeof row.team === 'string' ? row.team : 'A', role: 'Player', departed: true};
}
function scrubLog(log, label, stamp) {
  const kept = {};
  for (const key of ['groupCode','day','month','year','team','role','demo']) {
    if (log[key] !== undefined) kept[key] = log[key];
  }
  return {...kept, player: label, workouts: [], voided: true,
    voidedBy: 'account-deletion', voidedAt: stamp};
}
function scrubStanding(row,label) {
  const result={name:label};
  for(const key of ['team','total','wo','streak','rank','badges']) if(row[key]!==undefined)result[key]=row[key];
  return result;
}

module.exports = function deletionHistory({db, FieldValue}) {
  async function commitChanges(changes) {
    for (let i = 0; i < changes.length; i += 200) {
      const batch = db.batch();
      for (const [ref, value] of changes.slice(i, i + 200)) {
        if (value === null) batch.delete(ref); else batch.set(ref, value);
      }
      await batch.commit();
    }
  }
  async function eraseCollection(collection) {
    // A bounded pass can be resumed by the scheduled worker.
    for (let pass = 0; pass < 5; pass++) {
      const records = await collection.limit(200).get();
      if (!records.docs.length) return true;
      await commitChanges(records.docs.map(d => [d.ref, null]));
    }
    return !(await collection.limit(1).get()).docs.length;
  }
  async function run(uid, id, jobRef, job) {
    const label = job.departedLabel;
    if (typeof label !== 'string' || !/^Departed [a-f0-9]{12}$/.test(label)) throw Error('DELETION_LABEL_REQUIRED');
    // Profiles may have left groups, so current memberships are NOT a complete
    // historical index. Walk every group in pages; never query by name globally.
    let query = db.collection('groups').orderBy('__name__').limit(10);
    if (job.groupCursor) query = query.startAfter(job.groupCursor);
    const groups = job.historyComplete ? {docs: []} : await query.get();
    for (const group of groups.docs) {
      const seasons = await group.ref.collection('seasons').get();
      const namesBySeason = new Map();
      for (const season of seasons.docs) namesBySeason.set(season.id, seasonNames(season.data().roster, id, id));
      // Keep the proven scope privately until this group is fully processed.
      // Otherwise a retry after roster anonymisation would forget old labels.
      if (job.activeGroup === group.id && job.seasonNames) {
        for (const [sid,names] of Object.entries(job.seasonNames)) namesBySeason.set(sid,names);
      }
      await jobRef.update({activeGroup:group.id,seasonNames:Object.fromEntries(namesBySeason)});
      const logs = await db.collection('logs').where('groupCode', '==', group.id).get();
      const changes = [];
      for (const log of logs.docs) {
        const value = log.data(), sid = `${value.year}-${String(value.month).padStart(2,'0')}`;
        if (belongs(value, id, id, namesBySeason.get(sid) || [])) {
          changes.push([log.ref, scrubLog(value, label, FieldValue.serverTimestamp())]);
        }
      }
      await commitChanges(changes);
      for (const season of seasons.docs) {
        const names = namesBySeason.get(season.id) || [];
        // Clear private contributions; retain published result totals, replacing
        // only proven labels in their awarded list.
        for (const collection of ['stepWeeks','bets','jackAwards']) {
          const records = await season.ref.collection(collection).get();
          await commitChanges(records.docs.filter(d => belongs(d.data(), id, id, names)).map(d => [d.ref, null]));
        }
        const windows = await season.ref.collection('twistWindows').get();
        await commitChanges(windows.docs.filter(d => Array.isArray(d.data().awarded) && d.data().awarded.some(n => names.includes(n)))
          .map(d => [d.ref, {...d.data(), awarded: d.data().awarded.map(n => names.includes(n) ? label : n)}]));
        await db.runTransaction(async tx => {
          const fresh = await tx.get(season.ref);
          if (!fresh.exists || !Array.isArray(fresh.data().roster)) return;
          const roster = fresh.data().roster;
          const updates={};
          if(roster.some(p=>belongs(p,id,id)))updates.roster=roster.map(p=>belongs(p,id,id)?departedRow(p,label):p);
          for(const key of ['finalStandings','badgesAwarded']){
            const rows=fresh.data()[key];
            if(Array.isArray(rows)&&rows.some(p=>belongs(p,id,id,names)))updates[key]=rows.map(p=>belongs(p,id,id,names)?scrubStanding(p,label):p);
          }
          if(Object.keys(updates).length)tx.update(season.ref,updates);
        });
      }
      const monthly=await db.collection('analytics').doc('global').collection('monthly').get();
      for(const month of monthly.docs){
        await db.runTransaction(async tx=>{
          const fresh=await tx.get(month.ref),value=fresh.exists&&fresh.data(),slice=value&&value.groups&&value.groups[group.id];
          if(!slice)return;
          const names=namesBySeason.get(month.id)||[],users={...slice.users},days={...slice.days};let changed=false;
          for(const name of Object.keys({...users,...days})){
            if(users[name]===id||(!users[name]&&names.includes(name))){delete users[name];delete days[name];changed=true;}
          }
          if(changed)tx.update(month.ref,{groups:{...value.groups,[group.id]:{...slice,users,days}}});
        });
      }
      // Name-only top-level records cannot be safely assigned across seasons.
      // Stable IDs are authoritative; unowned legacy records require migration.
      for (const collection of ['reactions','flags','bonuses_30day','bonuses_iron_pledge']) {
        const records = await db.collection(collection).where('groupCode','==',group.id).get();
        const allNames = [...new Set([...namesBySeason.values()].flat())];
        const remove = records.docs.filter(d => {
          const v = d.data();
          if (v.userId || v.uid) return belongs(v,id,id);
          const sid = v.seasonId || (v.year && v.month ? `${v.year}-${String(v.month).padStart(2,'0')}` : null);
          if (sid) return belongs(v,id,id,namesBySeason.get(sid) || []);
          if (allNames.includes(v.player || v.name)) throw Error('DELETION_LEGACY_OWNERSHIP_REQUIRED');
          return false;
        });
        await commitChanges(remove.map(d => [d.ref,null]));
      }
      await db.runTransaction(async tx => {
        const fresh = await tx.get(group.ref);
        if (!fresh.exists) return;
        const value = fresh.data(), names = namesBySeason.get(value.currentSeasonId) || [];
        const updates = {};
        if (Array.isArray(value.players)) updates.players = value.players.filter(p => !belongs(p,id,id,names));
        if (value.globalStats && Array.isArray(value.globalStats.players)) updates.globalStats = {
          ...value.globalStats, players: value.globalStats.players.filter(p => !belongs(p,id,id,names))
        };
        if (Object.keys(updates).length) tx.update(group.ref, updates);
      });
      await jobRef.update({groupCursor:group.id,activeGroup:null,seasonNames:null});
    }
    if (!job.historyComplete && groups.docs.length === 10) return false;
    await jobRef.update({historyComplete:true});
    // Stable-ID orphan logs are covered even if their original group is gone.
    for (const key of ['userId','uid']) {
      const records = await db.collection('logs').where(key,'==',id).limit(200).get();
      await commitChanges(records.docs.filter(d => belongs(d.data(),id,id)).map(d => [d.ref,scrubLog(d.data(),label,FieldValue.serverTimestamp())]));
      if (records.docs.length === 200) return false;
    }
    const user = db.collection('users').doc(id);
    if (!await eraseCollection(user.collection('soloLogs'))) return false;
    if (!await eraseCollection(user.collection('seasons'))) return false;
    return true;
  }
  return {run};
};
module.exports.belongs = belongs;
module.exports.seasonNames = seasonNames;
module.exports.departedRow = departedRow;
module.exports.scrubLog = scrubLog;
module.exports.scrubStanding = scrubStanding;
