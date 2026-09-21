import test from 'node:test';
import assert from 'node:assert/strict';
import {planSecurityMigration,buildReviewedMigration} from '../build/plan-security-migration.mjs';
const fixture=()=>({groups:[{id:'TEST',currentSeasonId:'2026-09',seasons:[{id:'2026-09',roster:[{name:'A',uid:'one',isAdmin:true}]}]}],users:[{id:'one'}],logs:[{id:'log',groupCode:'TEST',year:2026,month:9,player:'A'}]});
test('migration planner is read-only and resolves only explicit profile anchors',()=>{const d=fixture(),before=structuredClone(d),r=planSecurityMigration(d);assert.deepEqual(d,before);assert.equal(r.counts.blockers,0);assert.equal(r.counts.logBackfills,1);assert.equal(r.adminReview[0].requiresReview,true);});
test('missing profile identity is not guessed by a matching display name',()=>{const d=fixture();d.groups[0].seasons[0].roster[0].uid='device';d.users[0].name='A';assert.ok(planSecurityMigration(d).blockers.some(b=>b.reason==='CURRENT_MEMBER_OWNERSHIP_UNRESOLVED'));});
test('duplicate current identities and ambiguous logs block promotion',()=>{const d=fixture();d.groups[0].seasons[0].roster.push({name:'A',userId:'one'});const r=planSecurityMigration(d);assert.ok(r.blockers.some(b=>b.reason==='DUPLICATE_PROFILE'));assert.ok(r.blockers.some(b=>b.reason==='LOG_OWNERSHIP_UNRESOLVED'));});
test('planner never copies credential or profile content into its output',()=>{const d=fixture();d.users[0].pinHash='synthetic-secret';d.groups[0].seasons[0].roster[0].pin='synthetic-secret';assert.equal(JSON.stringify(planSecurityMigration(d)).includes('synthetic-secret'),false);});
test('reviewed manifest requires explicit admin decisions and strips credentials without changing source',()=>{
 const d=fixture();d.groups[0].seasons[0].roster[0].pin='synthetic-secret';const before=structuredClone(d);
 assert.equal(buildReviewedMigration(d).readyForHumanReview,false);
 const m=buildReviewedMigration(d,{adminDecisions:{'groups/TEST/seasons/2026-09#0':true}});
 assert.equal(m.readyForHumanReview,true);assert.equal(m.writes.length,2);assert.equal(m.writes[0].patch.roster[0].userId,'one');assert.equal(m.writes[0].patch.credentialSchema,2);assert.deepEqual(m.writes[1].patch,{userId:'one'});assert.equal(JSON.stringify(m).includes('synthetic-secret'),false);assert.deepEqual(d,before);
 assert.equal(buildReviewedMigration(d,{adminDecisions:{'groups/TEST/seasons/2026-09#0':false}}).writes[0].patch.roster[0].isAdmin,false);
});
test('reviewed owner decisions must name real active profiles and target real entries',()=>{
 const d=fixture();delete d.groups[0].seasons[0].roster[0].uid;
 const review={assignments:{'groups/TEST/seasons/2026-09#0':'one'},adminDecisions:{'groups/TEST/seasons/2026-09#0':true}};
 assert.equal(buildReviewedMigration(d,review).readyForHumanReview,true);
 review.assignments['logs/typo']='one';assert.equal(buildReviewedMigration(d,review).readyForHumanReview,false);
 delete review.assignments['logs/typo'];d.users[0].deleted=true;assert.equal(buildReviewedMigration(d,review).readyForHumanReview,false);
});
