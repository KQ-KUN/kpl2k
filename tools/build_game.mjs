import {cp,mkdir} from 'node:fs/promises';
import {runPython} from './python_runtime.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const check=runPython(['tools/consumption_manifest.py','--check'],{cwd:root});
if(check!==0)process.exit(check);
const output=path.join(root,'dist/kpl2k');await mkdir(output,{recursive:true});await cp(path.join(root,'app'),output,{recursive:true});
console.log('2K generated snapshots copied to dist/kpl2k; no legacy Guessing input or generation.');
