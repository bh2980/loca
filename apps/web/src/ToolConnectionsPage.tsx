import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import {useEffect,useRef,useState} from 'react';
import {Plus,RefreshCw,Save,Trash2,Undo2} from 'lucide-react';
import {isLocalApiHost,type WorkflowToolConnection,type WorkspaceState} from '@workbench/contracts';
import {api,apiPath} from './api';
import {equalSettings} from './workflow-state';
import './tool-connections.css';

type Fields=Pick<WorkflowToolConnection,'name'|'baseUrl'|'auth'|'headerName'>;
interface Saved extends WorkflowToolConnection {hasCredential?:boolean}
interface Entry {base:Saved|null;value:Fields}
interface Cache {projectId:string;selected:string;query:string;entries:Record<string,Entry>}
const fields=(tool:WorkflowToolConnection):Fields=>({name:tool.name,baseUrl:tool.baseUrl,auth:tool.auth,headerName:tool.auth==='header'?tool.headerName:undefined});
const safeSaved=(tool:Saved):Saved=>({id:tool.id,version:tool.version,...fields(tool),hasCredential:tool.hasCredential});
const changed=(entry:Entry)=>!entry.base||!equalSettings(entry.value,fields(entry.base));
const cacheKey=(id:string)=>`workbench:tool-connections:v1:${apiPath('')}:${id}`;
function initial(state:WorkspaceState):Cache {
 const tools=state.workflow?.toolConnections??[];
 try{
  const stored=JSON.parse(sessionStorage.getItem(cacheKey(state.project.id))??'null') as Cache|null;
  if(stored?.projectId===state.project.id&&typeof stored.selected==='string'&&typeof stored.query==='string'&&stored.entries&&Object.values(stored.entries).every(entry=>entry?.value&&typeof entry.value.name==='string'&&typeof entry.value.baseUrl==='string'&&['none','bearer','header'].includes(entry.value.auth)))return {projectId:stored.projectId,selected:stored.selected,query:stored.query,entries:Object.fromEntries(Object.entries(stored.entries).map(([id,entry])=>[id,{base:entry.base?safeSaved(entry.base):null,value:fields(entry.value as WorkflowToolConnection)}]))};
 }catch{/* Storage is optional; credentials are never stored here. */}
 return {projectId:state.project.id,selected:tools[0]?.id??'',query:'',entries:Object.fromEntries(tools.map(tool=>[tool.id,{base:safeSaved(tool),value:fields(tool)}]))};
}
function merge(current:Cache,tools:Saved[]):Cache {
 const entries={...current.entries};for(const tool of tools){const entry=entries[tool.id];if(entry?.base&&entry.base.version>tool.version)continue;
  const next=safeSaved({...tool,hasCredential:tool.hasCredential??entry?.base?.hasCredential});
  if(!entry||!changed(entry))entries[tool.id]={base:next,value:fields(tool)};
 }
 return {...current,entries,selected:entries[current.selected]?current.selected:tools[0]?.id??''};
}
function validate(value:Fields){
 if(!value.name.trim()||value.name.length>200)throw new Error('도구 연결 이름을 입력하세요.');
 let url:URL;try{url=new URL(value.baseUrl);}catch{throw new Error('도구 API 주소를 확인하세요.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.search||url.protocol==='http:'&&!isLocalApiHost(url.hostname))throw new Error('HTTPS 또는 로컬·사설망 HTTP 주소를 입력하세요.');
 if(value.auth==='header'&&(!value.headerName||!/^X-[A-Za-z0-9-]+$/i.test(value.headerName)||value.headerName.length>128||/^x-(?:forwarded(?:-|$)|real-ip$|http-method(?:-|$)|method-override$|host$|authorization$)/i.test(value.headerName)))throw new Error('인증 헤더는 안전한 X- 접두사 사용자 헤더여야 합니다.');
}
const authLabels={none:'인증 없음',bearer:'Bearer 토큰',header:'사용자 헤더'};

export function ToolConnectionsPage({state,onDirtyChange}:{state:WorkspaceState;onDirtyChange?:(dirty:boolean)=>void}){
 const projectId=state.project.id,projectRef=useRef(projectId);projectRef.current=projectId;
 const [cache,setCache]=useState(()=>initial(state)),[remote,setRemote]=useState<Saved[]>([]),[keys,setKeys]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(true),operation=useRef(false),refreshId=useRef(0);
 const entry=cache.projectId===projectId?cache.entries[cache.selected]:undefined,value=entry?.value,key=keys[cache.selected]??'';
 const saved=[...remote,...(state.workflow?.toolConnections??[])].filter(tool=>tool.id===cache.selected).sort((a,b)=>b.version-a.version)[0],conflict=!!entry?.base&&!!saved&&saved.version>entry.base.version;
 const dirty=Object.values(cache.entries).some(changed)||Object.values(keys).some(Boolean);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setCache(initial(state));setRemote([]);setKeys({});setError('');setMessage('');},[projectId]);
 useEffect(()=>{if(state.workflow)setCache(current=>merge(current,state.workflow!.toolConnections??[]));},[state.workflow?.toolConnections]);
 useEffect(()=>{if(cache.projectId!==projectId)return;try{sessionStorage.setItem(cacheKey(projectId),JSON.stringify(cache));}catch{/* Nonsecret editing still works without storage. */}},[cache,projectId]);
 useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
 useEffect(()=>{setError('');setMessage('');},[cache.selected]);
 const refresh=async()=>{
  const capturedProject=projectId,token=++refreshId.current;
  try{const result=await api<{connections:Saved[]}|Saved[]>(`/studio/tool-connections?projectId=${encodeURIComponent(projectId)}`);if(mounted.current&&projectRef.current===capturedProject&&token===refreshId.current){const tools=(Array.isArray(result)?result:result.connections).map(safeSaved);setRemote(tools);setCache(current=>merge(current,tools));}}
  catch(caught){if(mounted.current&&projectRef.current===capturedProject&&token===refreshId.current)setError((caught as Error).message);}
 };
 useEffect(()=>{void refresh();},[projectId]);
 const patch=(update:Partial<Fields>)=>{setCache(current=>({...current,entries:{...current.entries,[current.selected]:{...current.entries[current.selected],value:{...current.entries[current.selected].value,...update}}}}));setError('');setMessage('');};
 const create=()=>{const id=`new:${crypto.randomUUID()}`;setCache(current=>({...current,selected:id,entries:{...current.entries,[id]:{base:null,value:{name:'새 도구 연결',baseUrl:'',auth:'none'}}}}));};
 const reset=()=>{
  if(!entry)return;setKeys(current=>({...current,[cache.selected]:''}));setError('');setMessage('');
  if(!entry.base){setCache(current=>{const entries={...current.entries};delete entries[current.selected];return {...current,entries,selected:Object.keys(entries)[0]??''};});return;}
  const latest=safeSaved(saved??entry.base);setCache(current=>({...current,entries:{...current.entries,[latest.id]:{base:latest,value:fields(latest)}}}));
 };
 const save=async()=>{
  if(!entry||!value||operation.current)return;setError('');setMessage('');try{validate(value);if(key&&(/[\r\n\0]/.test(key)||!key.trim()))throw new Error('인증 값에 빈 값이나 줄바꿈을 사용할 수 없습니다.');}catch(caught){setError((caught as Error).message);return;}
  operation.current=true;refreshId.current++;setBusy(true);const selected=cache.selected,capturedProject=projectId,capturedValue=fields(value as WorkflowToolConnection),capturedKey=key;
  try{
   const input={...capturedValue,...(capturedKey&&value.auth!=='none'?{apiKey:capturedKey}:{}),...(entry.base?{expectedVersion:entry.base.version}:{})};
   const next=safeSaved(await api<Saved>(`/studio/tool-connections${entry.base?`/${encodeURIComponent(selected)}`:''}?projectId=${encodeURIComponent(projectId)}`,input,entry.base?'PATCH':'POST'));
   if(mounted.current&&projectRef.current===capturedProject){setKeys(current=>{const nextKeys={...current};delete nextKeys[selected];return nextKeys;});setRemote(current=>[...current.filter(tool=>tool.id!==next.id),next]);setCache(current=>{const entries={...current.entries};delete entries[selected];entries[next.id]={base:next,value:fields(next)};return {...current,entries,selected:current.selected===selected?next.id:current.selected};});setMessage('도구 연결을 저장했습니다.');}
  }catch(caught){if(mounted.current&&projectRef.current===capturedProject){const text=(caught as Error).message;setError(capturedKey?text.split(capturedKey).join('[인증 값 숨김]'):text);}}
  finally{operation.current=false;if(mounted.current)setBusy(false);}
 };
 const removeKey=async()=>{
  if(!entry?.base||operation.current)return;operation.current=true;refreshId.current++;setBusy(true);setError('');const id=entry.base.id,capturedProject=projectId;
  try{await api(`/studio/tool-connections/${encodeURIComponent(id)}/credential?projectId=${encodeURIComponent(projectId)}`,{},'DELETE');if(mounted.current&&projectRef.current===capturedProject){setKeys(current=>({...current,[id]:''}));setRemote(current=>current.map(tool=>tool.id===id?{...tool,hasCredential:false}:tool));setCache(current=>({...current,entries:{...current.entries,[id]:{...current.entries[id],base:{...current.entries[id].base!,hasCredential:false}}}}));setMessage('저장한 인증을 삭제했습니다.');}}
  catch(caught){if(mounted.current&&projectRef.current===capturedProject)setError((caught as Error).message);}finally{operation.current=false;if(mounted.current)setBusy(false);}
 };
 const listed=Object.entries(cache.entries).filter(([,entry])=>`${entry.value.name} ${entry.value.baseUrl}`.toLocaleLowerCase().includes(cache.query.toLocaleLowerCase()));
 return <section className="tool-connections-page">
  <div className="tool-connections-heading"><h2>도구 연결</h2><div className="button-row"><Button disabled={busy} onClick={()=>void refresh()} variant="outline" size="sm"><RefreshCw size={14}/>목록 새로고침</Button><Button disabled={busy} onClick={create} variant="outline" size="sm"><Plus size={14}/>연결 추가</Button></div></div>
  <div className="tool-connections-layout">
   <aside className="tool-connections-list"><label className="field"><span>연결 검색</span><Input value={cache.query} onChange={event=>setCache(current=>({...current,query:event.target.value}))}/></label><div className="tool-connections-table"><table><thead><tr><th>연결</th><th>인증</th></tr></thead><tbody>{listed.map(([id,item])=><tr key={id} className={id===cache.selected?'selected':''}><td><Button onClick={()=>setCache(current=>({...current,selected:id}))} variant="ghost">{item.value.name||'이름 없음'}</Button><small>{item.value.baseUrl||'주소 미입력'}</small>{changed(item)||keys[id]?<small>미저장</small>:null}</td><td>{authLabels[item.value.auth]}<small>{item.value.auth==='none'?'인증 미사용':item.base?.hasCredential?'인증 저장됨':'인증 미저장'}</small></td></tr>)}</tbody></table></div>{!listed.length?<p className="subtext">{cache.query?'검색 결과가 없습니다.':'등록한 도구 연결이 없습니다.'}</p>:null}</aside>
   <div className="tool-connection-editor">{value&&entry?<>
    <div className="tool-connections-heading"><h3>{entry.base?'도구 연결 편집':'새 도구 연결'}</h3><div className="button-row"><Button disabled={busy} onClick={reset} variant="outline" size="sm"><Undo2 size={14}/>되돌리기</Button><Button disabled={busy||!changed(entry)&&!key} onClick={()=>void save()} variant="default" size="sm"><Save size={14}/>{busy?'저장 중':'저장'}</Button></div></div>
    {conflict?<p className="notice">다른 곳에서 변경한 연결입니다. 입력은 보존했습니다. 되돌리기로 최신 설정을 불러오세요.</p>:null}
    {error?<p className="notice" role="alert">{error}</p>:null}{message?<p className="notice success" role="status">{message}</p>:null}
    <fieldset disabled={busy} className="tool-connection-fields">
     <label className="field"><span>연결 이름</span><Input value={value.name} maxLength={200} onChange={event=>patch({name:event.target.value})}/></label>
     <label className="field"><span>API 기본 주소</span><Input value={value.baseUrl} type="url" placeholder="https://… 또는 사설망 HTTP 주소" onChange={event=>patch({baseUrl:event.target.value})}/></label>
     <label className="field"><span>인증 방식</span><NativeSelect value={value.auth} onChange={event=>{const auth=event.target.value as Fields['auth'];patch({auth,headerName:auth==='header'?value.headerName??'X-API-Key':undefined});if(auth==='none')setKeys(current=>({...current,[cache.selected]:''}));}}><NativeSelectOption value="none">인증 없음</NativeSelectOption><NativeSelectOption value="bearer">Bearer 토큰</NativeSelectOption><NativeSelectOption value="header">사용자 헤더</NativeSelectOption></NativeSelect></label>
     {value.auth==='header'?<label className="field"><span>인증 헤더 이름</span><Input value={value.headerName??''} placeholder="X-API-Key" onChange={event=>patch({headerName:event.target.value})}/></label>:null}
     {value.auth!=='none'?<div className="tool-connection-credential"><label className="field"><span>{entry.base?.hasCredential?'인증 값 교체':'인증 값'}</span><Input type="password" autoComplete="new-password" value={key} placeholder={entry.base?.hasCredential?'비워 두면 저장한 인증 유지':'토큰 또는 API 키'} onChange={event=>{setKeys(current=>({...current,[cache.selected]:event.target.value}));setError('');setMessage('');}}/></label><p className="subtext">인증 값은 저장 후 표시하지 않습니다.</p>{entry.base?.hasCredential?<Button onClick={()=>void removeKey()} variant="destructive" size="sm"><Trash2 size={14}/>저장한 인증 삭제</Button>:null}</div>:null}
    </fieldset>
    {entry.base?<p className="subtext tool-connection-version">버전 {entry.base.version} · {entry.base.id}</p>:null}
   </>:<p className="subtext">도구 연결을 선택하거나 추가하세요.</p>}</div>
  </div>{!entry&&error?<p className="notice" role="alert">{error}</p>:null}
 </section>;
}
