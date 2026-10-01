import { useMemo, useRef, useState } from 'react';
import ContentImport from '../src/ContentImport.jsx';

export default function Preview() {
  const [mount,setMount]=useState(0), [requests,setRequests]=useState({previews:0,commits:0}), [mode,setMode]=useState('rollback');
  const records=useRef(new Map());
  const api=useMemo(()=>({
    async apiRequest(path,options) {
      if(path==='/api/v2/imports/')return{imports:[...records.current.values()].map(value=>value.import)};
      if(path.endsWith('/preview')) {
        const id=crypto.randomUUID(),body=JSON.parse(options.body);
        const result={import:{id,status:'preview',commit_protocol:'atomic-v1',source_name:'虚构测试文件'},count:1,candidates:[{id:id+'-candidate',candidate_type:'memory',title:'虚构测试候选',content:body.content.slice(0,120)}]};
        records.current.set(id,result);setRequests(value=>({...value,previews:value.previews+1}));return{result};
      }
      if(path.endsWith('/commit')) {
        const id=path.split('/').at(-2),record=records.current.get(id);
        if(mode==='rollback')throw Object.assign(new Error(),{code:'import_commit_rolled_back',status:503});
        if(mode==='legacy')throw Object.assign(new Error(),{code:'import_legacy_preview',status:409});
        if(record.import.status==='committed')throw Object.assign(new Error(),{code:'import_already_committed'});
        record.import={...record.import,status:'committed',accepted_count:1,rejected_count:0};
        setRequests(value=>({...value,commits:value.commits+1}));
        throw Object.assign(new Error('Synthetic timeout'),{code:'request_timeout',status:504});
      }
      const result=records.current.get(path.split('/').at(-1));
      return {result};
    },
    async apiFetch(path,options) {
      if(path!=='/api/v2/imports/preview')throw Error('Unexpected preview route');
      const id=crypto.randomUUID(),file=options.body.get('file');
      const result={import:{id,status:'preview',commit_protocol:'atomic-v1',source_name:'虚构测试文件'},count:1,candidates:[{id:id+'-candidate',candidate_type:'memory',title:'虚构测试候选',content:(await file.text()).slice(0,120)}]};
      records.current.set(id,result);setRequests(value=>({...value,previews:value.previews+1}));
      return{ok:true,json:async()=>({result})};
    },
  }),[mode]);
  return <main className="import-preview-shell"><h1>导入恢复验收</h1><p>本地虚构数据，不连接生产账号。</p><label>测试场景<select aria-label="测试场景" value={mode} onChange={event=>setMode(event.target.value)}><option value="rollback">事务已回滚</option><option value="legacy">旧版部分写入</option><option value="uncertain">写入成功，回执超时</option></select></label><p aria-label="请求统计">预览 {requests.previews} 次 · 写入 {requests.commits} 次</p>
    <button type="button" onClick={()=>setMount(value=>value+1)}>模拟关闭后重开</button>
    <ContentImport key={mount} api={api} accountScope="synthetic-preview" companionScope="synthetic-companion" />
  </main>;
}
