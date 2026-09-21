'use strict';
const OFFSET=19800000,DAY=86400000;
const wall=at=>new Date(at+OFFSET);
const sidOf=d=>d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
function isoWeek(date){const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const y=d.getUTCFullYear();return y+'-W'+Math.ceil((((d-Date.UTC(y,0,1))/DAY)+1)/7);}
function monday(week){
 if(typeof week!=='string'||!/^20\d{2}-W(0?[1-9]|[1-4]\d|5[0-3])$/.test(week))return null;
 const [year,n]=week.split('-W').map(Number),d=new Date(Date.UTC(year,0,4));
 d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)+(n-1)*7);
 return isoWeek(d)===year+'-W'+n?d:null;
}
module.exports={OFFSET,DAY,wall,sidOf,isoWeek,monday};
