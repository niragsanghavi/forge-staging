/* Approved Soft Sculpt sport artwork. Presentation-only: saved workout names stay untouched. */
(() => {
  'use strict';

  const labels=Object.freeze(['Gym','Padel','Walk','Run','Yoga','Volleyball','Cricket','Swimming','Cycling','Pickleball','Pilates','Football','Basketball','Badminton','Weight training','Cardio','HIIT','Strength training','Zumba','Boxing','Stretching','Hiking','Dance','Rowing','Spinning','Tennis','Crossfit','Steps','Other','Muay Thai','Frisbee','Skipping','Softball','Spikeball','Squash','Stair climb','Physio','Hyrox SIM','Legs','Upper body','Core','Full body workout','Arms','Back','Chest','Calisthenics','Meditation','Golf']);
  const normalize=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const indexes=new Map(labels.map((label,i)=>[normalize(label),i]));
  const aliases={
    '10k steps':'Steps','16k steps':'Steps','active day':'Other',
    'bicep shoulder tricep':'Arms','biceps and back':'Back','chest shoulder tricep':'Chest',
    'core training':'Core','leg day':'Legs','physio therapy':'Physio',
    'physuitherapy':'Physio','physiotherapy':'Physio','pickle':'Pickleball',
    'workout':'Other','running':'Run','walking':'Walk','stairs':'Stair climb',
    'stair climbing':'Stair climb','hyrox':'Hyrox SIM','cross fit':'Crossfit',
    'strength':'Strength training','swim':'Swimming','jump rope':'Skipping'
  };
  for(const [alias,label] of Object.entries(aliases))indexes.set(alias,indexes.get(normalize(label)));

  function index(name){
    const normalized=normalize(name);
    if(indexes.has(normalized))return indexes.get(normalized);
    if(/^\d+\s*k?\s*steps?$/.test(normalized))return 27;
    return 28;
  }
  function coordinates(i){return `--sport-x:${i%6*20}%;--sport-y:${Math.floor(i/6)*100/7}%`;}
  function icon(name,mono=false){
    const i=index(name);
    return `<span class="forge-sport${mono?' forge-sport-mono':''}" aria-hidden="true" data-sport-index="${i}" style="${coordinates(i)}"></span>`;
  }
  function flame(cls=''){return `<span class="forge-fire${cls?' '+cls:''}" aria-hidden="true"></span>`;}
  function markup(id){
    if(id==='g-flame'||id==='g-flame-line')return flame();
    if(/^forge-sport-\d+$/.test(id)){
      const i=Number(id.slice(12));
      return icon(labels[i]||'Other');
    }
    return null;
  }

  window.ForgeSports=Object.freeze({labels,index,icon,flame,markup});
})();
