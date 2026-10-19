const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app/js/data.js','utf8');
const bootstrap=fs.readFileSync('app/js/bootstrap.js','utf8');
const base={players:{p:{name:'P'}},franchises:[{id:'t'}],narrative:{templates:{}}};
const manifest={seasons:[{season_id:'s',name:'S'}],teams2026:[{id:'t',name:'T'}]};
const fixtures={'data/base.json':base,'data/manifest.json':manifest,'data/team_icons.json':{icons:{t:'icon.png'}},'data/dynasties.json':{dynasties:[]}};
function dataFixture(fetcher) {
  const window={};
  vm.runInNewContext(source,{window,AbortSignal,KPL_ENGINE:{franchiseNames:()=>({t:'T'})},fetch:fetcher});
  return window.KPL_DATA;
}
const response=value=>({ok:true,json:async()=>structuredClone(value)});
test('core JSON failure does not publish partial state and next retry succeeds',async()=>{
  let failed=true;
  const api=dataFixture(async path=>{if(failed && path==='data/base.json') throw Error('offline');return response(fixtures[path]);});
  await assert.rejects(api.loadBase(),/offline/);
  assert.equal(api.DATA.manifest,null);assert.equal(api.DATA.base,null);
  failed=false;await api.loadBase();assert.equal(api.DATA.franchises[0].id,'t');
});
test('optional icon and dynasty metadata failures permit core entry',async()=>{
  const api=dataFixture(async path=>{if(['data/team_icons.json','data/dynasties.json'].includes(path)) throw Error('offline');return response(fixtures[path]);});
  await api.loadBase();assert.equal(api.DATA.base.players.p.name,'P');assert.equal(Object.keys(api.DATA.teamIcons).length,0);
});
test('malformed successful JSON is rejected before any state is published',async()=>{
  const api=dataFixture(async path=>response(path==='data/base.json'?{}:fixtures[path]));
  await assert.rejects(api.loadBase(),/格式不完整/);assert.equal(api.DATA.manifest,null);
});
test('parallel retries share one core request',async()=>{
  let calls=0;
  const api=dataFixture(async path=>{calls++;return response(fixtures[path]);});
  const a=api.loadBase(),b=api.loadBase();assert.equal(a,b);await a;assert.equal(calls,4);
});
function bootstrapFixture(load,initialize) {
  const listeners=new Map();
  const elements=Object.fromEntries(['core-load-status','core-load-message','core-load-retry'].map(id=>[id,{hidden:false,setAttribute(){},addEventListener:(type,fn)=>listeners.set(`${id}:${type}`,fn)}]));
  const entry={},page={},body={dataset:{}};
  const document={body,getElementById:id=>elements[id],querySelectorAll:selector=>selector==='[data-core-entry]'?[entry]:[page]};
  const window={};vm.runInNewContext(bootstrap,{window,document});
  const api=window.KPL_BOOTSTRAP.mount({load,initialize});
  return {api,body,entry,page,elements,listeners};
}
const settle=()=>new Promise(setImmediate);
test('retry is single-flight and initializes listeners/router only once',async()=>{
  let calls=0,initialized=0,resolve;
  const f=bootstrapFixture(()=>{calls++;if(calls===1) throw Error('offline');return new Promise(r=>{resolve=r;});},()=>initialized++);
  await settle();assert.equal(f.body.dataset.loadState,'error');assert.equal(f.entry.disabled,true);assert.equal(f.page.inert,true);
  const a=f.api.retry(),b=f.api.retry();assert.equal(a,b);await settle();assert.equal(calls,2);
  resolve();await a;await f.api.retry();assert.equal(initialized,1);assert.equal(calls,2);assert.equal(f.entry.disabled,false);assert.equal(f.page.inert,false);
  assert.equal(f.listeners.size,1);
});
test('partial initialization is terminal until refresh so listeners are not rebound',async()=>{
  let initialized=0;
  const f=bootstrapFixture(async()=>{},()=>{initialized++;throw Error('DOM issue');});
  await settle();await f.api.retry();assert.equal(initialized,1);assert.equal(f.body.dataset.loadState,'error');assert.equal(f.elements['core-load-retry'].hidden,true);
});
