// npm test — real DOM, fictional data, no Firebase/network or real credentials.
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
export const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
export function runtime({enrolled=true,hasProfile=true,call,signIn,logs,months=['2026-09']}={}){
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];
 Object.defineProperty(d,'readyState',{value:'loading'});
 const add=d.addEventListener.bind(d);d.addEventListener=(type,...args)=>{if(type!=='DOMContentLoaded')add(type,...args);};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.scrollTo=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.FEATURE_GOOGLE_AUTH=true;w.FEATURE_APPLE_AUTH=true;w.auth={currentUser:{uid:'owner',isAnonymous:false,providerData:[{providerId:'google.com'}]},signOut:async()=>{w.auth.currentUser=null;}};
 w.showScreen=id=>{d.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id==='screen-'+id));};
 w.showObStep=()=>{};w.isLiftWorkout=x=>/gym|strength|weight|chest|back|leg/i.test(x);w.isNative=()=>false;
 w.esc=value=>{const span=d.createElement('span');span.textContent=String(value??'');return span.innerHTML;};
 w.eval(fs.readFileSync(new URL('../src/services/scoringEngine.js',import.meta.url),'utf8'));
 const records=logs||[{year:2026,month:9,day:20,workouts:['Walk','Yoga'],note:''},{year:2026,month:9,day:21,workouts:['Gym'],note:'Chest, Back'}];
 const data=p=>{const year=p.year||2026,month=p.month||9,throughDay=month===9?22:new Date(Date.UTC(year,month,0)).getUTCDate(),list=records.filter(l=>l.year===year&&l.month===month);return {enrolled,hasProfile,name:'Test Athlete',hasGroups:false,publicRanking:false,months,period:{year,month,sid:year+'-'+String(month).padStart(2,'0'),current:year===2026&&month===9,throughDay},logs:structuredClone(list),score:w.scoreSoloDays(list,year,month,throughDay)};};
 w.callFunction=async(name,input={})=>{
  calls.push({name,data:structuredClone(input)});
  if(call){const result=await call(name,input,w);if(result!==undefined)return result;}
  if(name==='getSolo')return data(input);
  if(name==='soloBoard')return {period:data(input).period,limit:100,entries:[{name:'Test Athlete',rank:1,total:50,days:8,isYou:false},{name:'Test Athlete',rank:2,total:11,days:2,isYou:true}]};
  if(name==='saveSolo'){const i=records.findIndex(l=>l.year===input.year&&l.month===input.month&&l.day===input.day);if(i>=0)records.splice(i,1);records.push({...input});return {ok:true,score:data(input).score};}
  if(name==='setSoloVisibility')return {ok:true,publicRanking:input.publicRanking};
  if(['claimIdentity','linkLegacyGroup','enrollSolo'].includes(name))return {ok:true};
  throw Error('Unexpected callable '+name);
 };
 w.startForgeProviderSignIn=async provider=>{calls.push({name:'signIn',provider});return signIn?signIn(w):{uid:w.auth.currentUser.uid};};
 w.restoreIdentityFromGoogle=async r=>{calls.push({name:'restore',...r});};
 w.db={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({currentSeasonId:'2026-09'})}),collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({credentialSchema:2,roster:[{name:'Legacy',userId:'legacy-profile'}]})})})})})})};
 for(const file of ['sports-icons.js','today.js','welcome.js','solo.js','account-feedback.js','account-recovery.js','group-cleanup.js'])w.eval(fs.readFileSync(new URL('../src/ui/'+file,import.meta.url),'utf8'));
 w.ForgeWelcome.mount();
 const button=(text,root=d)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);assert.ok(b,'Missing button: '+text);return b;};
 return {w,d,calls,records,data,button,close:()=>{w.ForgeSolo.close();w.close();}};
}
