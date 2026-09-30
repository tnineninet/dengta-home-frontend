import assert from 'node:assert/strict';
import test from 'node:test';
import { previewContentImportPage, validateImportFile } from '../src/content-import-api.js';

test('paged previews cover a large text without committing, dropping or repeating byte ranges', async()=>{
  const text='星灯：我喜欢看星星。\n'.repeat(5000);
  const file=new File([text],'fixture.txt');
  let startByte=0,joined='',requests=0;
  const client={apiFetch:async(path,options)=>{
    assert.equal(path,'/api/v2/imports/preview'); assert.equal(options.retry,false);
    joined+=await options.body.get('file').text(); requests++;
    return {ok:true,json:async()=>({ok:true,result:{id:'preview-'+requests,candidates:[]}})};
  }};
  while(startByte<file.size) {
    const {page}=await previewContentImportPage({file,kind:'world_book',startByte},client);
    assert.equal(page.startByte,startByte); assert.ok(page.endByte>startByte); startByte=page.endByte;
  }
  assert.equal(joined,text); assert.ok(requests>1);
  validateImportFile({name:'large.md',size:1024**3});
  assert.throws(()=>validateImportFile({name:'large.md',size:1024**3+1}),{code:'import_paged_file_too_large'});
});
test('CSV quoted multiline record is not split across previews',async()=>{
  const csv='role,text\nassistant,"'+('星灯\n'.repeat(23000))+'"\nuser,你好\n';
  const file=new File([csv],'fixture.csv'); let submitted='';
  const client={apiFetch:async(_path,options)=>{submitted=await options.body.get('file').text();return {ok:true,json:async()=>({ok:true})};}};
  const {page}=await previewContentImportPage({file,kind:'chat_history'},client);
  assert.equal(page.endByte,file.size); assert.equal(submitted,csv);
});
