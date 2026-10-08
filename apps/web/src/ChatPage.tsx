import { Checkbox } from './components/ui/checkbox';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Textarea } from './components/ui/textarea';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ChevronDown,MessageSquare,Plus,Send,Square,SlidersHorizontal,X} from 'lucide-react';
import type {ChatSession,ChatMessage,ChatToolCall,ChangeProposal,WorkspaceState} from '@workbench/contracts';
import {api,apiPath} from './api';
import {ProposalReview} from './ProposalReview';
import './studio.css';
import './chat-panel-content.css';

type Detail={session:ChatSession;messages:ChatMessage[];toolCalls:ChatToolCall[];proposals:ChangeProposal[];totalMessages:number;offset:number;nextOffset:number|null};
type Catalog={capabilities:{connectionId:string;supported:boolean;detail:string}[]};
type Attachment={unitIds:string[];token:number};
type ScrollPosition={top:number;bottom:boolean};
export type ChatPageProps={state:WorkspaceState;sessionId:string;onSession(id:string):void;onSource(id:string):void;onKnowledge(id:string):void;onSettings():void;onClose():void;attachment?:Attachment;currentSource?:{label:string;unitIds:string[]};visible?:boolean};
const toolNames:Record<string,string>={project_overview:'프로젝트 개요',search_script:'원문 검색',read_script:'원문 읽기',search_materials:'작품 자료 검색',read_material:'자료 읽기',list_terms:'용어집 조회',run_progress:'실행 현황',change_history:'변경 이력',list_characters:'인물 찾기',read_character:'인물 프로필',list_relationships:'관계 조회',studio_status:'상태·라벨 조회',web_search:'웹 검색',web_read_page:'웹 자료 읽기',draft_proposal:'초안 생성',revise_proposal:'초안 수정',read_proposal:'제안 확인'};
const merge=<T extends {id:string}>(a:T[],b:T[])=>[...new Map([...a,...b].map(item=>[item.id,item])).values()];
function storedRecord<T>(key:string,valid:(value:unknown)=>value is T):Record<string,T>{
 try{const parsed:unknown=JSON.parse(sessionStorage.getItem(key)??'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};return Object.fromEntries(Object.entries(parsed).filter(([,value])=>valid(value)));}catch{return {};}
}
function storeRecord(key:string,value:unknown){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{/* Storage may be disabled. In-memory drafts remain available. */}}

export function ChatPage({state,sessionId,onSession,onSource,onKnowledge,onSettings,onClose,attachment,currentSource,visible=true}:ChatPageProps){
 const query=`?projectId=${encodeURIComponent(state.project.id)}`,base='/studio/sessions';
 const storageKey=`${apiPath('/chat')}:${state.project.id}:drafts`,scrollKey=`${storageKey}:scroll`;
 const [sessions,setSessions]=useState<ChatSession[]>([]),[details,setDetails]=useState<Record<string,Detail>>({}),[catalog,setCatalog]=useState<Catalog>();
 const [error,setError]=useState(''),[loadError,setLoadError]=useState(''),[listError,setListError]=useState(''),[listLoaded,setListLoaded]=useState(false);
 const [busy,setBusy]=useState(false),[settings,setSettings]=useState(false),[history,setHistory]=useState(false),[sourceQuery,setSourceQuery]=useState(''),[failedAttachment,setFailedAttachment]=useState<Attachment>();
 const [drafts,setDrafts]=useState<Record<string,string>>(()=>storedRecord(storageKey,(value):value is string=>typeof value==='string'));
 const draftsRef=useRef(drafts),messagePane=useRef<HTMLDivElement>(null),alive=useRef(true),activeSession=useRef(sessionId),pendingCount=useRef(0);
 const actionQueue=useRef(Promise.resolve()),saveQueue=useRef(Promise.resolve()),attachmentToken=useRef<number|undefined>(undefined),queuedAttachment=useRef<number|undefined>(undefined);
 const scrollPositions=useRef(storedRecord(scrollKey,(value):value is ScrollPosition=>!!value&&typeof value==='object'&&'top' in value&&typeof value.top==='number'&&'bottom' in value&&typeof value.bottom==='boolean'));
 const atBottom=useRef(true),displayedSession=useRef(''),restoreScroll=useRef(true);
 activeSession.current=sessionId;
 const detail=details[sessionId],session=detail?.session,running=session?.status==='running';
 const profile=state.studio?.profiles.find(item=>item.id===session?.profileId),capability=catalog?.capabilities.find(item=>item.connectionId===profile?.connectionId);
 const unitsById=useMemo(()=>new Map(state.units.map(unit=>[unit.id,unit])),[state.units]);
 const attached=new Set(session?.unitIds??[]),selectedIds=[...new Set(currentSource?.unitIds??[])];
 const search=sourceQuery.trim().toLowerCase(),matches=search?state.units.filter(unit=>[unit.id,unit.source,unit.speaker??''].some(value=>value.toLowerCase().includes(search))):[];
 const runningTool=detail?[...detail.toolCalls].reverse().find(call=>call.status==='running'):undefined;
 const rememberScroll=useCallback((id:string,node:HTMLDivElement)=>{
  const position={top:node.scrollTop,bottom:node.scrollHeight-node.scrollTop-node.clientHeight<60};
  scrollPositions.current[id]=position;atBottom.current=position.bottom;storeRecord(scrollKey,scrollPositions.current);
 },[scrollKey]);
 const refresh=useCallback(async(id=sessionId,offset?:number)=>{
  const [list,result,capabilities]=await Promise.allSettled([api<ChatSession[]>(base+query),id?api<Detail>(`${base}/${encodeURIComponent(id)}${query}${offset!==undefined?`&offset=${offset}`:''}`):Promise.resolve(undefined),api<Catalog>('/studio'+query)]);
  if(!alive.current)return;
  if(list.status==='fulfilled'){setSessions(list.value);setListLoaded(true);setListError('');}else setListError((list.reason as Error).message);
  if(capabilities.status==='fulfilled')setCatalog(capabilities.value);
  if(result.status==='fulfilled'){
   setLoadError('');const value=result.value;
   if(value)setDetails(previous=>{const existing=previous[id];return {...previous,[id]:{...value,messages:merge(existing?.messages??[],value.messages).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),toolCalls:merge(existing?.toolCalls??[],value.toolCalls),proposals:merge(existing?.proposals??[],value.proposals),offset:Math.min(existing?.offset??value.offset,value.offset)}};});
  }else setLoadError((result.reason as Error).message);
  if(capabilities.status==='rejected')setLoadError((capabilities.reason as Error).message);
 },[sessionId,query]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!visible)return;let stopped=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{await refresh();if(!stopped)timer=setTimeout(poll,running?1000:1500);};void poll();
  return()=>{stopped=true;clearTimeout(timer);};
 },[refresh,visible,running]);
 useEffect(()=>{
  if(!session||Object.hasOwn(draftsRef.current,session.id))return;
  const next={...draftsRef.current,[session.id]:session.draft};draftsRef.current=next;setDrafts(next);
 },[session?.id,session?.draft]);
 useLayoutEffect(()=>{
  if(displayedSession.current!==sessionId){displayedSession.current=sessionId;restoreScroll.current=true;}
  if(!visible||!messagePane.current)return;const node=messagePane.current;
  if(restoreScroll.current){const position=scrollPositions.current[sessionId];atBottom.current=position?.bottom??true;node.scrollTop=atBottom.current?node.scrollHeight:position?.top??0;restoreScroll.current=false;}
  else if(atBottom.current)node.scrollTop=node.scrollHeight;
 },[sessionId,visible,detail?.messages.length,detail?.messages.at(-1)?.content.length,detail?.toolCalls.length,detail?.proposals.length]);
 useEffect(()=>{if(!visible)restoreScroll.current=true;},[visible]);
 const perform=useCallback((action:()=>Promise<unknown>)=>{
  pendingCount.current++;setBusy(true);
  const task=actionQueue.current.catch(()=>{}).then(async()=>{if(!alive.current)return;setError('');try{await action();}catch(error){if(alive.current)setError((error as Error).message);}}).finally(()=>{pendingCount.current--;if(alive.current)setBusy(pendingCount.current>0);});
  actionQueue.current=task;return task;
 },[]);
 const newSession=async(unitIds:string[]=[])=>{
  const currentCatalog=catalog??await api<Catalog>('/studio'+query);
  if(!alive.current)return;
  const available=state.studio?.profiles.find(profile=>currentCatalog.capabilities.find(item=>item.connectionId===profile.connectionId)?.supported);
  const created=await api<ChatSession>(base+query,{profileId:available?.id,unitIds});
  if(!alive.current)return;activeSession.current=created.id;onSession(created.id);setHistory(false);setSettings(false);await refresh(created.id);
 };
 const addSources=async(unitIds:string[])=>{
  if(!unitIds.length)return;const id=activeSession.current;
  if(!id){await newSession([...new Set(unitIds)]);return;}
  const current=await api<Detail>(`${base}/${encodeURIComponent(id)}${query}`);
  if(!alive.current)return;
  const next=[...new Set([...current.session.unitIds,...unitIds])];
  if(next.length!==current.session.unitIds.length)await api(`${base}/${encodeURIComponent(id)}${query}`,{unitIds:next,expectedVersion:current.session.version},'PATCH');
  await refresh(id);
 };
 // Attach only for an explicit request token. Changing the main page never attaches sources.
 const attachmentAction=useRef(addSources);attachmentAction.current=addSources;
 const requestAttachment=useCallback((request:Attachment)=>{
  queuedAttachment.current=request.token;
  return perform(async()=>{try{await attachmentAction.current(request.unitIds);attachmentToken.current=request.token;setFailedAttachment(undefined);}catch(error){setFailedAttachment(request);throw error;}finally{if(queuedAttachment.current===request.token)queuedAttachment.current=undefined;}});
 },[perform]);
 useEffect(()=>{if(attachment&&attachment.token!==attachmentToken.current&&attachment.token!==queuedAttachment.current)void requestAttachment(attachment);},[attachment?.token,requestAttachment]);
 const persistDraft=useCallback((id:string,value:string)=>{
  saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{if(alive.current)await api(`${base}/${encodeURIComponent(id)}${query}`,{draft:value},'PATCH');}).catch(error=>{if(alive.current)setError((error as Error).message);});return saveQueue.current;
 },[query]);
 const draft=drafts[sessionId]??session?.draft??'';
 useEffect(()=>{if(!session||draft===session.draft)return;const timer=setTimeout(()=>void persistDraft(session.id,draft),500);return()=>clearTimeout(timer);},[session?.id,draft,persistDraft]);
 const setDraft=(value:string,id=sessionId)=>{const next={...draftsRef.current,[id]:value};draftsRef.current=next;setDrafts(next);storeRecord(storageKey,next);};
 const send=async(content=draft)=>{
  if(!session||!content.trim())return;const id=session.id,clearsDraft=content===draft;await saveQueue.current;if(!alive.current)return;
  await api(`${base}/${encodeURIComponent(id)}/messages${query}`,{content});
  if(!alive.current)return;if(clearsDraft&&draftsRef.current[id]===content)setDraft('',id);
  if(activeSession.current===id)atBottom.current=true;await refresh(id);
 };
 const patchSession=async(patch:Partial<ChatSession>)=>{if(!session)return;const id=session.id;await api(`${base}/${encodeURIComponent(id)}${query}`,patch,'PATCH');await refresh(id);};
 const selectSession=(id:string)=>{if(messagePane.current&&sessionId)rememberScroll(sessionId,messagePane.current);activeSession.current=id;onSession(id);setHistory(false);setSettings(false);};
 const retry=()=>void perform(()=>refresh());

 return <section className="project-chat chat-dock-content" aria-label="프로젝트 채팅">
  <header className="chat-dock-header">
   <Button className="chat-history-toggle" aria-label="대화 목록" aria-expanded={history} aria-controls="chat-history-list" onClick={()=>{setHistory(value=>!value);setSettings(false);}} variant="ghost"><MessageSquare size={17}/><strong>{session?.title??'프로젝트 채팅'}</strong><ChevronDown size={15}/></Button>
   <Button aria-label="새 채팅" title="새 채팅" disabled={busy} onClick={()=>void perform(()=>newSession())} variant="ghost" size="icon-sm"><Plus size={18}/></Button>
   <Button aria-label="대화 설정" title="대화 설정" aria-expanded={settings} onClick={()=>{setSettings(value=>!value);setHistory(false);}} variant="ghost" size="icon-sm"><SlidersHorizontal size={17}/></Button>
   <Button aria-label="채팅 닫기" title="채팅 닫기" onClick={onClose} variant="ghost" size="icon-sm"><X size={18}/></Button>
  </header>
  {history?<section className="chat-history-overlay" id="chat-history-list" aria-label="대화 목록"><div className="chat-overlay-heading"><strong>대화 {sessions.length}개</strong><Button aria-label="대화 목록 접기" onClick={()=>setHistory(false)} variant="ghost" size="icon-sm"><X size={15}/></Button></div>{listError?<div className="chat-load-error"><p role="alert">{listError}</p><Button onClick={retry} disabled={busy} variant="outline">다시 읽기</Button></div>:null}<nav aria-label="채팅 세션">{sessions.map(item=><Button key={item.id} className={item.id===sessionId?'selected':''} aria-current={item.id===sessionId?'true':undefined} onClick={()=>selectSession(item.id)} variant="ghost"><span>{item.title}</span><small>{item.status==='running'?'응답 중':new Date(item.updatedAt).toLocaleDateString('ko-KR')}</small></Button>)}</nav>{!sessions.length&&!listError?<p className="chat-list-empty">{listLoaded?'저장된 대화가 없습니다.':'대화를 불러오는 중…'}</p>:null}</section>:null}
  {settings?<section className="chat-options" aria-label="대화 설정"><div className="chat-overlay-heading"><strong>대화 설정</strong><Button aria-label="대화 설정 접기" onClick={()=>setSettings(false)} variant="ghost" size="icon-sm"><X size={15}/></Button></div>{session?<><label>이름<Input defaultValue={session.title} key={`${session.id}:title`} disabled={running||busy} onBlur={event=>{if(event.target.value!==session.title)void perform(()=>patchSession({title:event.target.value}));}}/></label><label>AI 프로필<NativeSelect value={session.profileId??''} disabled={running||busy} onChange={event=>void perform(()=>patchSession({profileId:event.target.value}))}><NativeSelectOption value="">선택</NativeSelectOption>{state.studio?.profiles.map(profile=><NativeSelectOption key={profile.id} value={profile.id}>{profile.name} · {profile.model}</NativeSelectOption>)}</NativeSelect></label><label>최대 AI 호출<Input type="number" min={1} max={100} key={`${session.id}:turns`} disabled={running||busy} defaultValue={session.maxTurns??12} onBlur={event=>{const value=Number(event.target.value);if(value!==(session.maxTurns??12))void perform(()=>patchSession({maxTurns:value}));}}/></label><label>최대 도구 호출<Input type="number" min={1} max={100} key={`${session.id}:tools`} disabled={running||busy} defaultValue={session.maxToolCalls??40} onBlur={event=>{const value=Number(event.target.value);if(value!==(session.maxToolCalls??40))void perform(()=>patchSession({maxToolCalls:value}));}}/></label></>:null}<Button onClick={onSettings} variant="ghost">프로필 관리</Button></section>:null}
  {loadError?<div className="chat-load-error"><p role="alert">{loadError}</p><Button onClick={retry} disabled={busy} variant="outline">다시 읽기</Button></div>:null}
  {!session?<div className="chat-empty"><p>{sessionId&&!loadError?'대화를 불러오는 중…':'새 대화를 시작하세요.'}</p>{listError?<p role="alert">{listError}</p>:null}{error?<p role="alert">{error}</p>:null}<Button disabled={busy} onClick={()=>void perform(()=>newSession())} variant="default"><Plus size={15}/>새 채팅</Button>{selectedIds.length?<Button title={currentSource?.label} disabled={busy} onClick={()=>void perform(()=>addSources(selectedIds))} variant="outline">선택 원문 첨부 · {selectedIds.length}개</Button>:null}{failedAttachment?<Button disabled={busy} onClick={()=>void requestAttachment(failedAttachment)} variant="outline">원문 첨부 재시도</Button>:null}</div>:<section className="chat-conversation">
   <div className="chat-message-list" ref={messagePane} onScroll={event=>rememberScroll(session.id,event.currentTarget)}>
    {detail.offset>0?<Button disabled={busy} onClick={()=>void perform(async()=>{const node=messagePane.current,top=node?.scrollTop??0,height=node?.scrollHeight??0;atBottom.current=false;await refresh(session.id,Math.max(0,detail.offset-50));requestAnimationFrame(()=>{if(node&&activeSession.current===session.id)node.scrollTop=top+node.scrollHeight-height;});})} variant="ghost">이전 메시지 {Math.min(50,detail.offset)}개</Button>:null}
    {!detail.messages.length?<p className="chat-first-message">무엇을 살펴볼까요?</p>:null}
    {detail.messages.filter(message=>message.role!=='tool').map(message=><article key={message.id} className={`chat-message ${message.role}`}><header>{message.role==='user'?'나':message.role==='assistant'?'AI':'안내'}{message.reportedModel?<small>{message.reportedModel}</small>:null}{message.streamStatus&&message.streamStatus!=='completed'?<small role={message.streamStatus==='streaming'?'status':undefined}>{message.streamStatus==='streaming'?'응답 중':message.streamStatus==='stopped'?'중단된 응답':'미완료 응답'}</small>:null}</header><div className="chat-message-text">{message.content}</div>{(message.toolCallIds??[]).map(id=>{const call=detail.toolCalls.find(item=>item.id===id);return call?<ToolTrace key={id} call={call} onSource={onSource}/>:null;})}{message.usage?.totalTokens?<small>{message.usage.totalTokens.toLocaleString()} 토큰</small>:null}</article>)}
    {detail.proposals.map(proposal=><ProposalReview key={proposal.id} proposal={proposal} state={state} onRefresh={()=>void refresh()} onFeedback={send} onSource={onSource} onKnowledge={onKnowledge}/>)}
    {running&&!detail.messages.some(message=>message.streamStatus==='streaming')?<div className="chat-working" role="status">{runningTool?`${toolNames[runningTool.name]??'도구'} 실행 중…`:'응답을 기다리는 중…'}</div>:null}
    {session.error?<p role="alert" className="studio-error">{session.error}</p>:null}
   </div>
   <div className="chat-compose">
    <div className="chat-context-toolbar">{selectedIds.length?<Button title={currentSource?.label} disabled={busy||running} onClick={()=>void perform(()=>addSources(selectedIds))} variant="ghost">선택 원문 첨부 · {selectedIds.length}개</Button>:null}<details className="chat-source-search"><summary>원문 검색</summary><div><Input aria-label="첨부할 원문 검색" placeholder="원문·화자·ID 검색" value={sourceQuery} onChange={event=>setSourceQuery(event.target.value)}/>{matches.length>30?<small>{matches.length}개 중 30개 · 검색어를 좁혀 주세요</small>:null}{matches.slice(0,30).map(unit=><Button key={unit.id} disabled={busy||running||attached.has(unit.id)} onClick={()=>void perform(()=>addSources([unit.id]))} variant="ghost"><span>{unit.speaker||unit.id}</span>{unit.source.slice(0,120)}</Button>)}{search&&!matches.length?<p>일치하는 원문이 없습니다.</p>:null}</div></details>{session.unitIds.length?<details className="chat-attached-sources"><summary>첨부 {session.unitIds.length}개</summary><div className="chat-attachment-list">{session.unitIds.map(id=><span key={id}><Button className="text-button" title={id} onClick={()=>onSource(id)} variant="ghost">{unitsById.get(id)?.speaker||id}<small>{id}</small></Button><Button disabled={busy||running} aria-label={`${id} 첨부 해제`} onClick={()=>void perform(()=>patchSession({unitIds:session.unitIds.filter(value=>value!==id)}))} variant="ghost" size="icon-sm"><X size={13}/></Button></span>)}</div></details>:null}</div>
    {error?<p role="alert" className="studio-error">{error}</p>:null}{failedAttachment?<Button disabled={busy||running} onClick={()=>void requestAttachment(failedAttachment)} variant="outline">원문 첨부 재시도</Button>:null}{capability&&!capability.supported?<p className="studio-error">{capability.detail}</p>:null}
    <Textarea aria-label="채팅 메시지" placeholder="메시지 입력" rows={3} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!running&&!busy&&profile&&capability?.supported){event.preventDefault();void perform(()=>send());}}}/>
    <div className="chat-compose-actions"><div className="chat-composer-tools"><label><Checkbox checked={session.webEnabled} disabled={busy} onCheckedChange={event =>void perform(()=>patchSession({webEnabled:(event === true)}))}/>웹</label><span title={profile?.model}>{profile?.name??'프로필 미선택'}</span></div>{running?<Button disabled={busy} onClick={()=>void perform(async()=>{await api(`${base}/${encodeURIComponent(session.id)}/stop${query}`,{});await refresh(session.id);})} variant="outline"><Square size={14}/>중지</Button>:<Button title="Ctrl + Enter" disabled={busy||!draft.trim()||!profile||!capability?.supported} onClick={()=>void perform(()=>send())} variant="default"><Send size={14}/>보내기</Button>}</div>
   </div>
  </section>}
 </section>;
}

function ToolTrace({call,onSource}:{call:ChatToolCall;onSource(id:string):void}){
 const output=call.output as {data?:{items?:{id?:string;source?:string;url?:string;title?:string;excerpt?:string}[];results?:{url?:string;title?:string;snippet?:string}[]}}|undefined;
 const items=output?.data?.items??output?.data?.results??[];
 return <details className="chat-tool"><summary>{toolNames[call.name]??call.name} · {call.status==='completed'?'완료':call.status==='running'?'실행 중':call.status==='stopped'?'중지':'실패'}</summary>{call.error?<p role="alert">{call.error}</p>:null}<pre>{JSON.stringify(call.input,null,2)}</pre>{items.map((item,index)=><p key={index}>{'source' in item&&item.source&&item.id?<Button className="text-button" onClick={()=>onSource(item.id!)} variant="ghost">{item.source.slice(0,200)}</Button>:item.url&&/^https?:\/\//i.test(item.url)?<a href={item.url} target="_blank" rel="noreferrer">{item.title||item.url}</a>:null}</p>)}<details><summary>조회 결과</summary><pre>{JSON.stringify(call.output,null,2)}</pre></details></details>;
}
