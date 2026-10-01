import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {createServer} from 'vite';
import {fingerprintImportFile} from '../src/import-file-fingerprint.js';
import {importCheckpointKey,saveImportCheckpoint,readImportCheckpoint} from '../src/import-checkpoint.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
const button=(renderer,label)=>renderer.root.find(n=>n.type==='button'&&text(n)===label);
const preview={import:{id:'receipt-1',status:'preview'},candidates:[{id:'candidate-1',candidate_type:'memory',title:'Synthetic',content:'Synthetic content'}]};

test('lost commit receipt prevents another POST, then GET confirmation unlocks the page',async()=>{
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
  const previousWindow=globalThis.window;let events=0,posts=0;
  globalThis.window={dispatchEvent:()=>events++};
  const api={apiRequest:async(path)=>{
    if(path==='/api/v2/imports/')return{imports:[]};
    if(path.endsWith('/preview'))return{result:preview};
    if(path.endsWith('/commit')){posts++;throw Object.assign(new Error('private upstream text'),{code:'request_timeout',status:504});}
    if(path.endsWith('/receipt-1'))return{result:{import:{id:'receipt-1',status:'committed',accepted_count:1}}};
    throw Error('unexpected endpoint');
  }};
  let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api}));});
    await act(async()=>renderer.root.find(n=>n.type==='select'&&n.props['aria-label']==='输入方式').props.onChange({target:{value:'paste'}}));
    await act(async()=>renderer.root.find(n=>n.type==='textarea'&&n.props['aria-label']==='粘贴导入内容').props.onChange({target:{value:'Synthetic'}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    await act(async()=>button(renderer,'全选接受').props.onClick());
    await act(async()=>button(renderer,'确认并提交').props.onClick());
    assert.equal(posts,1);assert.equal(events,0);
    assert.equal(button(renderer,'确认并提交').props.disabled,true);
    assert.equal(button(renderer,'全选接受').props.disabled,true);
    assert.equal(button(renderer,'生成导入预览').props.disabled,true);
    assert.equal(text(renderer.toJSON()).includes('private upstream text'),false);
    await act(async()=>button(renderer,'查看日志').props.onClick());
    assert.match(text(renderer.toJSON()),/提交回执未确认时，先检查提交结果/);
    await act(async()=>button(renderer,'确认并提交').props.onClick());assert.equal(posts,1);
    await act(async()=>button(renderer,'检查提交结果').props.onClick());
    assert.match(text(renderer.toJSON()),/导入完成/);assert.equal(posts,1);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.window=previousWindow;}
});
test('same source restores a pending page and confirms a previously committed page without creating another preview',async()=>{
  const values=new Map(),store={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const previousStorage=globalThis.localStorage;globalThis.localStorage=store;
  const file=new File(['Synthetic\n'.repeat(120000)],'synthetic.txt');
  const key=importCheckpointKey('a','c','world_book',await fingerprintImportFile(file));
  saveImportCheckpoint(key,{version:1,totalBytes:file.size,nextByte:100,pending:{importId:'receipt-1',startByte:100,endByte:500,commitAttempted:true}},store);
  let previews=0;
  const api={apiRequest:async path=>{if(path==='/api/v2/imports/')return{imports:[]};if(path.endsWith('/receipt-1'))return{result:{import:{id:'receipt-1',status:'committed',accepted_count:1}}};previews++;throw Error('unexpected write');}};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:'a',companionScope:'c'}));});
    await act(async()=>renderer.root.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    // The click handler intentionally returns immediately; wait for background hashing and receipt lookup.
    for(let i=0;i<30&&!text(renderer.toJSON()).includes('无需重复写入');i++)await act(async()=>{await new Promise(r=>setTimeout(r,20));});
    assert.match(text(renderer.toJSON()),/无需重复写入/);assert.equal(previews,0);
    assert.equal(readImportCheckpoint(key,file.size,store).nextByte,500);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;}
});

test('unmount cancels an outstanding commit and prevents an old companion refresh event',async()=>{
  const previousWindow=globalThis.window;let events=0,resolveCommit,signal;
  globalThis.window={dispatchEvent:()=>events++};
  const api={apiRequest:async(path,options)=>{
    if(path==='/api/v2/imports/')return{imports:[]};
    if(path.endsWith('/preview'))return{result:preview};
    signal=options.signal;return new Promise(resolve=>{resolveCommit=resolve;});
  }};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api}));});
    await act(async()=>renderer.root.find(n=>n.type==='select'&&n.props['aria-label']==='输入方式').props.onChange({target:{value:'paste'}}));
    await act(async()=>renderer.root.find(n=>n.type==='textarea'&&n.props['aria-label']==='粘贴导入内容').props.onChange({target:{value:'Synthetic'}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    await act(async()=>button(renderer,'全选接受').props.onClick());
    await act(async()=>button(renderer,'确认并提交').props.onClick());
    await act(async()=>renderer.unmount());renderer=null;assert.equal(signal.aborted,true);
    await act(async()=>resolveCommit({result:{import:{id:'receipt-1',status:'committed'}}}));
    assert.equal(events,0);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.window=previousWindow;}
});
