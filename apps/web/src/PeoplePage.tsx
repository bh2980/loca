import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import {useEffect,useMemo,useRef,useState} from 'react';
import {BookOpen,ChevronLeft,ChevronRight,Search,Users,X} from 'lucide-react';
import type {Character,EvidenceReference,Relationship,WorkspaceState} from '@workbench/contracts';
import {FlowCanvas,type CanvasEdge,type CanvasNode,type CanvasViewport} from './FlowCanvas';
import {apiPath} from './api';
import {validViewport} from './canvas-view';
import './people-page.css';

interface PeopleSnapshot {search:string;branch:string;list:boolean;listType:'characters'|'relationships';page:number;viewport?:CanvasViewport;detailScroll:number}
interface PeoplePayload {projectId:string;characters:Character[];relationships:Relationship[];evidence:EvidenceReference[]}
const defaults:PeopleSnapshot={search:'',branch:'all',list:false,listType:'characters',page:0,detailScroll:0};
const certainty:Record<Relationship['certainty'],string>={confirmed:'확인됨',claimed:'진술',inferred:'추정',unknown:'미확정'};
const branchLabel=(value:string)=>value==='common'?'공통':value==='unknown'?'미분류':value||'미지정';
function readSnapshot(scope:string,state:unknown=window.history.state):PeopleSnapshot|undefined{
 try{const raw=(state as {peopleViews?:Record<string,PeopleSnapshot>}|null)?.peopleViews?.[scope]??JSON.parse(localStorage.getItem('workbench.people.views.v1')??'{}')[scope];
  if(!raw||typeof raw.search!=='string'||typeof raw.branch!=='string')return undefined;
  return {...defaults,...raw,viewport:validViewport(raw.viewport)?raw.viewport:undefined};
 }catch{return undefined;}
}
function evidenceUrl(value?:string){try{const url=new URL(value??'');return url.protocol==='https:'||url.protocol==='http:'?url.href:undefined;}catch{return undefined;}}

export function PeoplePage({state,selectedId,onSelect,onDocuments,onOpenKnowledge,navigateUnit}:{state:WorkspaceState;selectedId:string;onSelect(id:string):void;onDocuments():void;onOpenKnowledge(id:string):void;navigateUnit(id:string):void}){
 const workspace=new URLSearchParams(window.location.search).get('workspace')??'main',scope=`${workspace}:${state.project.id}:people`;
 const [view,setView]=useState<PeopleSnapshot>(()=>readSnapshot(scope)??defaults),viewRef=useRef(view);viewRef.current=view;
 const [viewportToken,setViewportToken]=useState(0),[focus,setFocus]=useState<{id?:string;token:number}>(()=>({token:0,id:view.viewport?undefined:selectedId.startsWith('people:character:')?selectedId.slice('people:character:'.length):state.studio?.relationships.find(item=>`people:relationship:${item.id}`===selectedId)?.fromCharacterId})),[wide,setWide]=useState(true),[retry,setRetry]=useState(0);
 const [evidenceResponse,setEvidenceResponse]=useState<{key:string;data?:EvidenceReference[];error?:string}>();
 const graphSlot=useRef<HTMLDivElement>(null),detail=useRef<HTMLElement>(null),restoreScroll=useRef<number|undefined>(view.detailScroll),restoring=useRef(false);
 const characters=state.studio?.characters??[],relationships=state.studio?.relationships??[],evidence=state.studio?.evidence??[];
 const evidenceKey=JSON.stringify([state.project.id,characters.map(item=>[item.id,item.version]),relationships.map(item=>[item.id,item.version]),evidence.map(item=>[item.id,item.unitId,item.knowledgeId,item.url])]);
 useEffect(()=>{
  const abort=new AbortController();setEvidenceResponse(previous=>previous?.key===evidenceKey?previous:{key:evidenceKey});
  void fetch(apiPath(`/studio/people?projectId=${encodeURIComponent(state.project.id)}`),{signal:abort.signal}).then(async response=>{
   const data=await response.json();if(!response.ok)throw new Error(typeof data.error==='string'?data.error:`근거 조회 실패 (${response.status})`);
   return data as PeoplePayload;
  }).then(data=>{if(!abort.signal.aborted&&data.projectId===state.project.id)setEvidenceResponse({key:evidenceKey,data:data.evidence});}).catch(error=>{if(!abort.signal.aborted)setEvidenceResponse({key:evidenceKey,error:error instanceof Error?error.message:'근거를 불러오지 못했습니다.'});});
  return()=>abort.abort();
 },[evidenceKey,retry,state.project.id]);
 const evidenceLookup=useMemo(()=>new Map([...(evidenceResponse?.key===evidenceKey?evidenceResponse.data??[]:[]),...evidence].reverse().map(item=>[item.id,item])),[evidenceResponse,evidenceKey,evidence]);
 const characterLookup=useMemo(()=>new Map(characters.map(item=>[item.id,item])),[characters]);
 const unitLookup=useMemo(()=>new Map(state.units.map(item=>[item.id,item])),[state.units]);
 const knowledgeLookup=useMemo(()=>new Map(state.knowledge.map(item=>[item.id,item])),[state.knowledge]);
 const selectedCharacter=selectedId.startsWith('people:character:')?characterLookup.get(selectedId.slice('people:character:'.length)):undefined;
 const selectedRelationship=selectedId.startsWith('people:relationship:')?relationships.find(item=>item.id===selectedId.slice('people:relationship:'.length)):undefined;
 const selected=selectedCharacter??selectedRelationship;
 const branches=[...new Set(relationships.map(item=>item.branch))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const scopedRelationships=useMemo(()=>relationships.filter(item=>view.branch==='all'||item.branch===view.branch),[relationships,view.branch]);
 const graphRelationships=scopedRelationships.filter(item=>characterLookup.has(item.fromCharacterId)&&characterLookup.has(item.toCharacterId));
 const nodes:CanvasNode[]=characters.map((item,order)=>({id:item.id,title:item.name,subtitle:item.aliases.join(' · '),kind:'인물',shape:'person',active:false,order}));
 const edges:CanvasEdge[]=graphRelationships.map(item=>({id:item.id,from:item.fromCharacterId,to:item.toCharacterId,label:item.kind,arrow:item.direction,conditions:item.condition}));
 const search=view.search.trim().toLocaleLowerCase(),includes=(value:string)=>value.toLocaleLowerCase().includes(search);
 const matches=useMemo(()=>({
  characters:characters.filter(item=>!search||includes(`${item.name} ${item.aliases.join(' ')} ${item.id}`)),
  relationships:scopedRelationships.filter(item=>!search||includes(`${item.kind} ${item.description} ${item.branch} ${item.condition??''} ${characterLookup.get(item.fromCharacterId)?.name??item.fromCharacterId} ${characterLookup.get(item.toCharacterId)?.name??item.toCharacterId} ${characterLookup.get(item.fromCharacterId)?.aliases.join(' ')??''} ${characterLookup.get(item.toCharacterId)?.aliases.join(' ')??''}`))
 }),[characters,scopedRelationships,characterLookup,search]);
 const listItems=view.listType==='characters'?matches.characters:matches.relationships,page=Math.min(view.page,Math.max(0,Math.ceil(listItems.length/25)-1));
 const activeRoute=()=>{const params=new URLSearchParams(window.location.search);return params.get('view')==='knowledge'&&(params.get('resource')??'').startsWith('people:')&&(!params.get('project')||params.get('project')===state.project.id);};
 const checkpoint=()=>{
  if(restoring.current||!activeRoute())return;
  const snapshot={...viewRef.current,detailScroll:restoreScroll.current??detail.current?.scrollTop??viewRef.current.detailScroll};
  const old=window.history.state??{},views={...(old.peopleViews??{}),[scope]:snapshot};window.history.replaceState({...old,peopleViews:views},'');
  try{const all=JSON.parse(localStorage.getItem('workbench.people.views.v1')??'{}');all[scope]=snapshot;localStorage.setItem('workbench.people.views.v1',JSON.stringify(Object.fromEntries(Object.entries(all).slice(-20))));}catch{/* Optional view persistence. */}
 };
 const patch=(value:Partial<PeopleSnapshot>)=>setView(previous=>({...previous,...value}));
 const chooseCharacter=(id:string,focusNode=false)=>{checkpoint();if(selectedId!==`people:character:${id}`)restoreScroll.current=0;if(focusNode)setFocus(previous=>({id,token:previous.token+1}));onSelect(`people:character:${id}`);};
 const chooseRelationship=(id:string,focusNode=false)=>{checkpoint();if(selectedId!==`people:relationship:${id}`)restoreScroll.current=0;const item=relationships.find(item=>item.id===id);if(item&&focusNode)setFocus(previous=>({id:item.fromCharacterId,token:previous.token+1}));onSelect(`people:relationship:${id}`);};
 const openSource=(id:string)=>{checkpoint();navigateUnit(id);};
 const openKnowledge=(id:string)=>{checkpoint();onOpenKnowledge(id);};
 useEffect(()=>{const restore=(event:PopStateEvent)=>{const snapshot=readSnapshot(scope,event.state);if(!snapshot)return;restoring.current=true;restoreScroll.current=snapshot.detailScroll;setView(snapshot);setViewportToken(value=>value+1);setFocus(previous=>({token:previous.token+1}));requestAnimationFrame(()=>{restoring.current=false;});};window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[scope]);
 useEffect(()=>{const frame=requestAnimationFrame(checkpoint);return()=>cancelAnimationFrame(frame);},[view,selectedId]);
 useEffect(()=>{if(!detail.current)return;detail.current.scrollTop=restoreScroll.current??0;if(evidenceResponse?.key===evidenceKey&&(evidenceResponse.data||evidenceResponse.error))restoreScroll.current=undefined;},[selectedId,viewportToken,evidenceResponse?.data,evidenceResponse?.error]);
 useEffect(()=>{const element=graphSlot.current;if(!element)return;const observer=new ResizeObserver(()=>setWide(element.getBoundingClientRect().width>760));observer.observe(element);return()=>observer.disconnect();},[]);
 const evidenceList=(ids:string[])=>ids.length?<div className="people-evidence-list">{ids.map(id=>{
  const item=evidenceLookup.get(id),unit=unitLookup.get(item?.unitId??id),knowledge=item?.knowledgeId?knowledgeLookup.get(item.knowledgeId):undefined,url=evidenceUrl(item?.url);
  return <article key={id} className="people-evidence"><strong>{item?.title??unit?.speaker??knowledge?.title??id}</strong>{(item?.excerpt??unit?.source)&&<blockquote>{item?.excerpt??unit?.source}</blockquote>}{item?.location&&<small>{item.location}</small>}<div className="people-evidence-actions">{unit&&<Button type="button" onClick={()=>openSource(unit.id)} variant="ghost">원문 보기</Button>}{knowledge&&<Button type="button" onClick={()=>openKnowledge(knowledge.id)} variant="ghost">자료 {item?.knowledgeVersion?`v${item.knowledgeVersion}`:''} 보기</Button>}{url&&<a href={url} target="_blank" rel="noreferrer">웹 출처 열기</a>}{!unit&&!knowledge&&!url&&<span>참조 {id}</span>}</div>{item?.retrievedAt&&<small>조회 {new Date(item.retrievedAt).toLocaleString('ko-KR')}</small>}</article>;
 })}</div>:<p className="people-muted">등록된 근거가 없습니다.</p>;
 return <section className="people-page">
  <header className="people-heading"><h1><Users size={19}/>인물·관계</h1><label className="people-search"><Search size={14}/><Input aria-label="인물·관계 검색" placeholder="이름, 별칭, 관계 검색" value={view.search} onChange={event=>patch({search:event.target.value,list:true,page:0})}/></label><NativeSelect aria-label="관계 적용 범위" value={view.branch} onChange={event=>{patch({branch:event.target.value,page:0,viewport:undefined});setFocus(previous=>({token:previous.token+1}));}}><NativeSelectOption value="all">전체 범위</NativeSelectOption>{branches.map(branch=><NativeSelectOption key={branch} value={branch}>{branchLabel(branch)}</NativeSelectOption>)}</NativeSelect><Button type="button" aria-expanded={view.list} onClick={()=>patch({list:!view.list})} variant="ghost">목록</Button><Button type="button" onClick={()=>{checkpoint();onDocuments();}} variant="ghost"><BookOpen size={14}/>작품 문서</Button></header>
  <div className="people-graph-slot" ref={graphSlot}>
   {characters.length?<FlowCanvas nodes={nodes} edges={edges} selectedId={selectedCharacter?.id} selectedEdgeId={selectedRelationship?.id} onSelect={chooseCharacter} onOpen={chooseCharacter} onSelectEdge={chooseRelationship} onOpenEdge={chooseRelationship} scopeKey={`${scope}:${view.branch}`} focusId={focus.id} focusToken={focus.token} rightInset={selected&&wide?370:0} viewport={view.viewport} viewportToken={viewportToken} onViewportChange={viewport=>patch({viewport})}/>:<div className="people-empty"><Users size={28}/><h2>저장된 인물·관계가 없습니다.</h2><p>프로젝트 채팅에서 인물과 관계 생성 초안을 요청하고 수락하면 이곳에 표시됩니다.</p><Button type="button" onClick={onDocuments} variant="ghost">기존 작품 문서 보기</Button></div>}
   {(view.list||search)&&characters.length>0&&<aside className="people-results" aria-label="인물·관계 목록"><div className="people-list-tabs"><Button type="button" aria-pressed={view.listType==='characters'} onClick={()=>patch({listType:'characters',page:0})} variant="ghost">인물 {matches.characters.length}</Button><Button type="button" aria-pressed={view.listType==='relationships'} onClick={()=>patch({listType:'relationships',page:0})} variant="ghost">관계 {matches.relationships.length}</Button><Button type="button" aria-label="인물·관계 목록 닫기" onClick={()=>patch({list:false,search:''})} variant="ghost"><X size={13}/></Button></div><div className="people-result-items">{listItems.slice(page*25,(page+1)*25).map(item=>'name' in item?<Button type="button" key={item.id} className={selectedCharacter?.id===item.id?'selected':''} onClick={()=>chooseCharacter(item.id,true)} variant="ghost"><strong>{item.name}</strong>{item.aliases.length>0&&<small>{item.aliases.join(' · ')}</small>}</Button>:<Button type="button" key={item.id} className={selectedRelationship?.id===item.id?'selected':''} onClick={()=>chooseRelationship(item.id,true)} variant="ghost"><strong>{characterLookup.get(item.fromCharacterId)?.name??item.fromCharacterId} {item.direction==='mutual'?'↔':item.direction==='undirected'?'—':'→'} {characterLookup.get(item.toCharacterId)?.name??item.toCharacterId}</strong><small>{item.kind} · {branchLabel(item.branch)} · {certainty[item.certainty]}</small></Button>)}{!listItems.length&&<p>검색 결과가 없습니다.</p>}</div>{listItems.length>25&&<div className="people-list-pages"><Button type="button" disabled={!page} aria-label="이전 인물·관계 목록" onClick={()=>patch({page:page-1})} variant="ghost"><ChevronLeft size={14}/></Button><span>{page+1}/{Math.ceil(listItems.length/25)}</span><Button type="button" disabled={(page+1)*25>=listItems.length} aria-label="다음 인물·관계 목록" onClick={()=>patch({page:page+1})} variant="ghost"><ChevronRight size={14}/></Button></div>}</aside>}
   {selected&&<aside className="people-detail" ref={detail} aria-label={selectedCharacter?'인물 프로필':'관계 상세'} onScroll={checkpoint}><header><h2>{selectedCharacter?.name??selectedRelationship?.kind}</h2><Button type="button" aria-label="인물·관계 상세 닫기" onClick={()=>{checkpoint();onSelect('people:');}} variant="ghost"><X size={16}/></Button></header>
    {selectedCharacter&&<><p className="people-muted">v{selectedCharacter.version}{selectedCharacter.aliases.length?` · 별칭 ${selectedCharacter.aliases.join(' · ')}`:''}</p>{selectedCharacter.profileKnowledgeId?(()=>{const profile=knowledgeLookup.get(selectedCharacter.profileKnowledgeId!);return profile?<section className="people-profile"><h3>{profile.title}</h3><p>{profile.content}</p><Button type="button" onClick={()=>openKnowledge(profile.id)} variant="ghost">프로필 문서 열기 · v{profile.version??1}</Button></section>:<p>연결 프로필 {selectedCharacter.profileKnowledgeId}</p>;})():<p className="people-muted">연결된 프로필 문서가 없습니다.</p>}<h3>관계 · {scopedRelationships.filter(item=>item.fromCharacterId===selectedCharacter.id||item.toCharacterId===selectedCharacter.id).length}</h3><div className="people-related">{scopedRelationships.filter(item=>item.fromCharacterId===selectedCharacter.id||item.toCharacterId===selectedCharacter.id).map(item=><Button type="button" key={item.id} onClick={()=>chooseRelationship(item.id)} variant="ghost"><strong>{item.kind}</strong><span>{characterLookup.get(item.fromCharacterId)?.name??item.fromCharacterId} {item.direction==='mutual'?'↔':item.direction==='undirected'?'—':'→'} {characterLookup.get(item.toCharacterId)?.name??item.toCharacterId}</span><small>{branchLabel(item.branch)} · {certainty[item.certainty]}</small></Button>)}</div><h3>근거</h3>{evidenceList(selectedCharacter.evidenceIds)}</>}
    {selectedRelationship&&<><div className="people-endpoints"><Button type="button" onClick={()=>chooseCharacter(selectedRelationship.fromCharacterId,true)} disabled={!characterLookup.has(selectedRelationship.fromCharacterId)} variant="ghost">{characterLookup.get(selectedRelationship.fromCharacterId)?.name??selectedRelationship.fromCharacterId}</Button><span>{selectedRelationship.direction==='mutual'?'↔':selectedRelationship.direction==='undirected'?'—':'→'}</span><Button type="button" onClick={()=>chooseCharacter(selectedRelationship.toCharacterId,true)} disabled={!characterLookup.has(selectedRelationship.toCharacterId)} variant="ghost">{characterLookup.get(selectedRelationship.toCharacterId)?.name??selectedRelationship.toCharacterId}</Button></div><p className="people-muted">{certainty[selectedRelationship.certainty]} · v{selectedRelationship.version}</p><dl><dt>적용 범위</dt><dd>{branchLabel(selectedRelationship.branch)}</dd>{selectedRelationship.condition&&<><dt>조건</dt><dd>{selectedRelationship.condition}</dd></>}</dl>{view.branch!=='all'&&selectedRelationship.branch!==view.branch&&<Button type="button" onClick={()=>patch({branch:selectedRelationship.branch,viewport:undefined})} variant="ghost">선택 관계 범위 보기</Button>}<p className="people-description">{selectedRelationship.description}</p><h3>근거</h3>{evidenceList(selectedRelationship.evidenceIds)}</>}
    {selected.provenance&&<p className="people-muted">{selected.provenance.model?`모델 ${selected.provenance.model} · `:''}{selected.provenance.sessionId?'채팅 제안':selected.provenance.runId?'실행 결과':'저장 자료'}{selected.provenance.createdAt?` · ${new Date(selected.provenance.createdAt).toLocaleString('ko-KR')}`:''}</p>}
    {evidenceResponse?.key===evidenceKey&&evidenceResponse.error&&<div className="people-load-error" role="alert">{evidenceResponse.error}<Button type="button" onClick={()=>setRetry(value=>value+1)} variant="ghost">근거 다시 불러오기</Button></div>}
   </aside>}
   {selectedId!=='people:'&&selectedId.startsWith('people:')&&!selected&&<div className="people-missing" role="status">선택한 인물·관계를 찾을 수 없습니다.<Button type="button" onClick={()=>onSelect('people:')} variant="ghost">선택 해제</Button></div>}
  </div>
 </section>;
}
