import {cp,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const check=spawnSync(process.env.PYTHON||'python',['tools/consumption_manifest.py','--check'],{cwd:root,stdio:'inherit'});
if(check.status!==0)process.exit(check.status||1);
const output=path.join(root,'dist/kpl2k');await mkdir(output,{recursive:true});await cp(path.join(root,'app'),output,{recursive:true});
console.log('2K generated snapshots copied to dist/kpl2k; no legacy Guessing input or generation.');
