import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.KPL_PLAYWRIGHT_PATH || 'playwright');
const workspace=process.cwd();
const artifact=path.resolve(workspace,'../verification/kpl2k');fs.mkdirSync(artifact,{recursive:true});
const roots={before:path.resolve(workspace,'../../push-first-batch-20261018/kpl2k/app'),after:path.resolve(workspace,'app')};
const mime={'.js':'application/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.m4a':'audio/mp4'};
const port=4267,origin=`http://127.0.0.1:${port}`;
const server=http.createServer((req,res)=>{const [kind,...parts]=decodeURIComponent(new URL(req.url,origin).pathname).split('/').filter(Boolean);const root=roots[kind];if(!root){res.writeHead(404).end();return}const file=path.resolve(root,parts.join('/')||'index.html');if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res)});
const report={testedAt:new Date().toISOString(),browser:'Microsoft Edge headless via Playwright',statisticsForwarded:0,scenarios:[]};let browser;
try{await new Promise(r=>server.listen(port,'127.0.0.1',r));browser=await chromium.launch({channel:process.env.KPL_BROWSER_CHANNEL || 'msedge',headless:true});
for(const kind of (process.argv.includes('--baseline')?['before']:['after']))for(const file of ['index.html','player_library.html']){
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const page=await context.newPage();const errors=[],requests=[],responses=[],pendingSizes=[];
 await page.addInitScript(()=>{localStorage.setItem('kpl2k_disclaimer_v1','1');navigator.sendBeacon=()=>true;});
 await page.route('**/*',r=>{const u=new URL(r.request().url());return u.origin!==origin||u.pathname.includes('__event')?r.abort():r.continue()});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 page.on('requestfinished',request=>pendingSizes.push(request.sizes().then(size=>responses.push({url:new URL(request.url()).pathname,status:request.response().then(r=>r?.status()),responseHeaderBytes:size.responseHeadersSize,responseBodyBytes:size.responseBodySize})).catch(()=>{})));
 const start=performance.now();await page.goto(`${origin}/${kind}/${file}`,{waitUntil:'networkidle'});
 const measured=await page.evaluate(()=>({dom:document.querySelectorAll('*').length,cards:document.querySelectorAll('.card[data-player-id]').length,versions:document.querySelectorAll('.ver').length,metadata:document.querySelector('#meta')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth,resources:performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,bytes:r.transferSize,duration:r.duration})),load:performance.getEntriesByType('navigation')[0]?.loadEventEnd}));
 await Promise.allSettled(pendingSizes);for(const response of responses)response.status=await response.status;
 report.scenarios.push({kind,file,measurement:'Windows localhost HTTP without compression or throttling; response bytes exclude TCP/TLS; elapsed includes networkidle and is not first-load time',responseHeaderAndBodyBytes:responses.reduce((sum,r)=>sum+r.responseHeaderBytes+r.responseBodyBytes,0),encodedResponseBodyBytes:responses.reduce((sum,r)=>sum+r.responseBodyBytes,0),responses,elapsedMs:performance.now()-start,requests:requests.length,errors,...measured});await page.screenshot({path:path.join(artifact,`${kind}-${file}-390.png`),fullPage:false});await context.close();
}
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(artifact,process.argv.includes('--baseline')?'before-final.json':'after-final.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.scenarios.map(({kind,file,dom,cards,versions,metadata,requests,elapsedMs,load,errors})=>({kind,file,dom,cards,versions,metadata,requests,elapsedMs,load,errors})),null,2));
