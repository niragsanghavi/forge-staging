import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css=fs.readFileSync(new URL('../src/style/sports-icons.css',import.meta.url),'utf8');
test('calendar artwork is larger at small, regular and wide phone sizes',()=>{
 assert.match(css,/\.mir-day \.forge-sport\{width:24px;height:24px/);
 assert.match(css,/@media\(min-width:390px\)\{\.mir-day \.forge-sport\{width:28px;height:28px/);
 assert.match(css,/@media\(max-width:360px\)\{\.mir-day \.forge-sport\{width:22px;height:22px/);
 assert.match(css,/margin-top:10px/);
 assert.doesNotMatch(css,/\.forge-sport\+\.forge-sport/);
});
test('calendar still displays only the first sport plus the remaining count',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/woCount>1\?[\s\S]{0,100}\+\$\{woCount-1\}/);
});
test('calendar labels use readable theme text, separate from sport icon color',()=>{
 assert.match(css,/\.mir-day.hit \.n,\.mir-day-more\{color:var\(--today-text,var\(--text\)\)!important\}/);
 const theme=fs.readFileSync(new URL('../src/style/today.css',import.meta.url),'utf8');
 const luminance=h=>{const rgb=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
 for(const [fg,bg] of [['#202620','#e9eddf'],['#f4f1e8','#333d32']]){assert.ok(theme.includes(fg)&&theme.includes(bg));const a=luminance(fg),b=luminance(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);}
 assert.match(css,/:root\[data-theme=light\] \.mir-day \.forge-sport\{filter:brightness\(\.85\)\}/);
});
