import test from 'node:test';
import assert from 'node:assert/strict';
import {findPython} from './python_runtime.mjs';

test('Linux build image chooses Python 3 while python remains 2.7',()=>{
  const calls=[];
  const selected=findPython({env:{},platform:'linux',spawn:(command,args)=>{
    calls.push([command,args]);return {status:0,stdout:command==='python3'?'3.11\n':'2.7\n'};
  }});
  assert.deepEqual(selected,{command:'python3',prefix:[]});
  assert.equal(calls.length,1);
});
test('Python 2 or an absent Python 3 produces an actionable error',()=>{
  assert.throws(()=>findPython({env:{},platform:'linux',spawn:command=>command==='python3'
    ? {status:null,error:new Error('ENOENT')}: {status:0,stdout:'2.7\n'}}),/Python >=3.10/);
});
test('Windows launcher supports Python 3 when python is old',()=>{
  assert.deepEqual(findPython({env:{},platform:'win32',spawn:command=>({status:0,stdout:command==='py'?'3.13\n':'2.7\n'})}),{command:'py',prefix:['-3']});
});
test('Explicit executable paths are preserved and old overrides fail',()=>{
  const executable='C:/Python Tools/python.exe';
  assert.deepEqual(findPython({env:{PYTHON:executable},spawn:(command,args)=>{
    assert.equal(command,executable);assert.equal(args[0],'-c');return {status:0,stdout:'3.12\n'};
  }}),{command:executable,prefix:[]});
  assert.throws(()=>findPython({env:{PYTHON:executable},spawn:()=>({status:0,stdout:'2.7\n'})}),/Python >=3.10/);
});
