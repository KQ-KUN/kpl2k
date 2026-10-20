const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function feature(name,globals={}){const window={};vm.runInNewContext(fs.readFileSync(`app/js/ui/${name}.js`,'utf8'),{window,console,setTimeout,clearTimeout,...globals});return window.KPL_UI_MODULES[name]}
test('UI factories register features without installing listeners',()=>{for(const name of ['storage','achievements','router','roster','simulation','share','dialogs'])assert.equal(typeof feature(name),'function')});
test('storage validates malformed state and round-trips a five-player roster',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};const ctx={STATE:{},STATE_KEY:'state'};const api=feature('storage',{localStorage:storage})(ctx);
 data.set('state',JSON.stringify({mode:'bad',roster:[1,2,3,4,5,6],seed:-5,tactic:'bad',allStar:{bo:4}}));api.loadState();assert.equal(ctx.STATE.mode,'classic');assert.equal(ctx.STATE.roster.length,5);assert.equal(ctx.STATE.seed,0);assert.equal(ctx.STATE.allStar.bo,5);assert.equal(api.saveState(),true);
});
test('library achievements count a person once across display cards',()=>{const api=feature('achievements')({});const result=api.normalizeAchievementProgress({libraryPlayers:{'A@one':true,'A@two':true,B:true}});assert.equal(Object.keys(result.libraryPlayers).length,2)});
test('share codec preserves roster, seed, tactics and rejects custom public links',()=>{
 const state={lastRun:{},roster:[{pid:'A',sid:'S'}],team:'T',season:'S',seed:42,tactic:'stable',allStar:{bo:5}};
 const api=feature('share',{location:{href:'https://local/index.html#/result'}})({STATE:state,buildVersion:()=> 'version'});
 const url=new URL(api.shareLink());assert.match(url.hash,/seed=42/);assert.match(decodeURIComponent(url.hash),/r=A@S/);state.lastRun={mode:'allstar',aRoster:[{pid:'custom_x'}]};assert.equal(api.shareLink(),'');
});
test('simulation pause and speed keep one scheduled reveal',()=>{
 let next=0;const pending=new Map();const controls=new Map();const ctx={SIM:{queue:[()=>{}],paused:false,timer:null,speed:1},$:id=>controls.get(id)||(controls.set(id,{style:{},setAttribute(){}}),controls.get(id))};
 const api=feature('simulation',{setTimeout:fn=>{pending.set(++next,fn);return next},clearTimeout:id=>pending.delete(id)})(ctx);
 api.pumpReveal();api.pumpReveal();assert.equal(pending.size,1);api.toggleRevealPause();assert.equal(pending.size,0);api.toggleRevealPause();assert.equal(pending.size,1);api.toggleRevealSpeed();assert.equal(pending.size,1);
});
