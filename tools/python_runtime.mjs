import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// Some build images still alias `python` to 2.7. Never start our tools before
// checking the interpreter; PYTHON is an executable path, not shell arguments.
export function findPython({env=process.env,platform=process.platform,spawn=spawnSync}={}) {
  const candidates=env.PYTHON ? [[env.PYTHON,[]]] : platform==='win32'
    ? [['python',[]],['py',['-3']],['python3',[]]]
    : [['python3',[]],['python',[]]];
  for(const [command,prefix] of candidates) {
    const probe=spawn(command,[...prefix,'-c','import sys; print("%s.%s" % sys.version_info[:2])'],{encoding:'utf8',timeout:10000});
    const version=/^(\d+)\.(\d+)\s*$/.exec(probe.stdout??'');
    if(!probe.error && probe.status===0 && version && Number(version[1])===3 && Number(version[2])>=10) return {command,prefix};
  }
  throw new Error('Python >=3.10 is required. Install Python 3 or set PYTHON to its executable path; Python 2 is not supported.');
}

export function runPython(args,{cwd=process.cwd(),env=process.env,...selection}={}) {
  const {command,prefix}=findPython({env,...selection});
  const result=spawnSync(command,[...prefix,...args],{cwd,env,stdio:'inherit'});
  if(result.error) throw result.error;
  return result.status??1;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {process.exitCode=runPython(process.argv.slice(2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
