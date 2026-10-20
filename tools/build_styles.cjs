'use strict';
const fs=require('node:fs'),postcss=require('postcss');
// Historical migration only. app/app.css and library.css are the maintained runtime sources.
if(!process.argv.includes('--from-legacy')){
  console.log('No files written. Maintain app/app.css and app/library.css directly. To regenerate the historical four-layer cascade explicitly, run npm run styles:sync -- --from-legacy (overwrites app.css).');
  process.exit(0);
}
const inputs=['style.css','navigation.css','budget.css','editorial.css'];
const root=postcss.parse(inputs.map(f=>fs.readFileSync('app/'+f,'utf8')).join('\n'));
const before={bytes:Buffer.byteLength(root.toString()),declarations:0,important:0};root.walkDecls(d=>{before.declarations++;if(d.important)before.important++});
const seen=new Map();let removed=0;
function context(node){let out=[];for(let p=node.parent;p&&p.type!=='root';p=p.parent)if(p.type==='atrule')out.unshift('@'+p.name+' '+p.params);return out.join('|')}
const rules=[];root.walkRules(r=>rules.push(r));
for(const rule of rules.reverse()){
 const selectors=rule.selectors,scope=context(rule);
 for(const decl of [...(rule.nodes||[])].reverse())if(decl.type==='decl'){
  const keys=selectors.map(s=>scope+'|'+s.trim()+'|'+decl.prop);
  if(keys.every(k=>seen.has(k)&&(seen.get(k)||!decl.important))){decl.remove();removed++;continue}
  keys.forEach(k=>{if(!seen.has(k)||decl.important)seen.set(k,!!decl.important)});
 }
}
root.walkComments(c=>c.remove());root.walkRules(r=>{if(!r.nodes.length)r.remove()});
root.walk(n=>{n.raws.before=n.type==='decl'?'':'\n';if(n.type==='decl')n.raws.between=':';else{n.raws.between='';n.raws.after='';}});
const output='/* Migrated legacy cascade; maintain this component stylesheet directly. Historical selectors retained. */\n'+root.toString().trim()+'\n';
fs.writeFileSync('app/app.css',output);const after={bytes:Buffer.byteLength(output),declarations:0,important:0};root.walkDecls(d=>{after.declarations++;if(d.important)after.important++});
console.log(JSON.stringify({before,after,removedSupersededDeclarations:removed}));
