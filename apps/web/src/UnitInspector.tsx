import { Button } from './components/ui/button';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, GitBranch, X } from 'lucide-react';
import { STAGE_LABELS, type ChangeRecord, type GraphEdge, type GraphNode, type SourceUnit, type WorkspaceState } from '@workbench/contracts';
import {UnitProgressPanel} from './UnitProgressPanel';
import { apiPath } from './api';
import { termCandidates } from './term-candidates';
import './ux-navigation.css';
import './glossary-candidates.css';

export const branchName = (branch: string) => !branch || branch === 'unknown' ? '분기 미분류' : branch === 'common' ? '공통 구간' : `분기 ${branch}`;
export const hasRecordedValue = (value: unknown) => value !== undefined && value !== null && (Array.isArray(value) ? value.length > 0 : typeof value === 'object' ? Object.keys(value).length > 0 : value !== '');
export interface GraphEvidence { nodes: GraphNode[]; edges: GraphEdge[]; omittedNodes: number; omittedEdges: number; matchingNodes: number; orderingNote: string }

export function useGraphEvidence(query: { groupId?: string; unitId?: string; offset?: number; limit?: number } | undefined) {
  const key = query ? JSON.stringify(query) : '';
  const [result, setResult] = useState<{ key: string; data?: GraphEvidence; error?: string }>();
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController(), params = new URLSearchParams({ scope: 'all', limit: '120' });
    for (const [name, value] of Object.entries(JSON.parse(key) as Record<string, string | number>)) if (value !== undefined) params.set(name, String(value));
    void fetch(apiPath(`/graph?${params}`), { signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '원본 연결을 불러오지 못했습니다.');
      if (!controller.signal.aborted) setResult({ key, data: body as GraphEvidence });
    }).catch(reason => { if (!controller.signal.aborted) setResult({ key, error: reason instanceof Error ? reason.message : '원본 연결 조회 실패' }); });
    return () => controller.abort();
  }, [key]);
  return { graph: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined, loading: !!key && result?.key !== key };
}

export function RecordedConditions({ unit, graph, empty = true }: { unit: SourceUnit; graph?: GraphEvidence; empty?: boolean }) {
  const nodes = graph?.nodes.filter(node => node.unitIds.includes(unit.id)) ?? [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = graph?.edges.filter(edge => (nodeIds.has(edge.from) || !!edge.to && nodeIds.has(edge.to)) && hasRecordedValue(edge.conditions)) ?? [];
  const conditions = nodes.filter(node => hasRecordedValue(node.conditions));
  if (!conditions.length && !edges.length) return empty ? <p className="ux-muted">이 범위에서 확인된 조건 기록이 없습니다. 무조건 실행된다는 의미는 아닙니다.</p> : null;
  return <div className="ux-conditions">{conditions.map(node => <RawCondition key={node.id} title={`대사 노드 조건 · ${node.id}`} value={node.conditions} />)}{edges.map(edge => <RawCondition key={edge.id} title={`${nodeIds.has(edge.from) ? '다음 연결' : '진입 연결'} 조건 · ${edge.id}`} value={edge.conditions} />)}</div>;
}

export interface UnitInspectorProps {
  state: WorkspaceState; unitId: string; onClose: () => void; onNavigateUnit: (id: string) => void;
  onOpenTerm?: (id: string) => void; onOpenKnowledge?: (id: string) => void;
  onFlow?: (groupId: string, unitId?: string) => void; onReviewUnit?: (unitId: string) => void;
  onChatScope?: (unitIds: string[]) => void;
}

export function UnitInspector(props: UnitInspectorProps) {
  return <InspectorContent key={`${props.state.project.id}:${props.unitId}`} {...props} />;
}

function InspectorContent({ state, unitId, onClose, onNavigateUnit, onOpenTerm, onOpenKnowledge, onFlow, onReviewUnit, onChatScope }: UnitInspectorProps) {
  const tabKey=`workbench.unit.tab:${new URLSearchParams(window.location.search).get('workspace')??'main'}:${state.project.id}:${unitId}`;
  const [tab, setTab] = useState<'context' | 'resources' | 'changes' | 'progress'>(()=>{try{const saved=sessionStorage.getItem(tabKey);return saved==='resources'||saved==='changes'||saved==='progress'?saved:'context';}catch{return 'context';}});
  useEffect(()=>{try{sessionStorage.setItem(tabKey,tab);}catch{}},[tab,tabKey]);
  const [width, setWidth] = useState(410), resize = useRef<{x:number;width:number} | undefined>(undefined);
  const closeButton = useRef<HTMLButtonElement>(null), onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const unit = state.units.find(item => item.id === unitId), translation = state.translations[unitId];
  const group = state.groups.find(item => item.id === unit?.groupId);
  const { graph, loading, error } = useGraphEvidence(unit ? { unitId: unit.id } : undefined);
  const openReviews = state.reviews.filter(review => review.unitId === unitId && review.status === 'open');
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; closeButton.current?.focus({ preventScroll: true }); return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); }; }, []);
  useEffect(() => { const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); } }; document.addEventListener('keydown', handle); return () => document.removeEventListener('keydown', handle); }, []);
  if (!unit) return <aside className="unit-inspector" aria-label="대사 상세"><header><strong>대사를 찾을 수 없습니다.</strong><Button ref={closeButton} onClick={onClose} aria-label="대사 상세 닫기" variant="ghost" size="icon-sm"><X size={16} /></Button></header></aside>;
  const ordered = state.units.filter(item => item.groupId === unit.groupId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), index = ordered.findIndex(item => item.id === unitId);
  const selectedNodes = new Set(graph?.nodes.filter(node => node.unitIds.includes(unitId)).map(node => node.id) ?? []);
  const neighboring = [...new Set(graph?.edges.flatMap(edge => selectedNodes.has(edge.from) && edge.to ? [edge.to] : edge.to && selectedNodes.has(edge.to) ? [edge.from] : []) ?? [])];
  const adjacentUnits = [...new Set(graph?.nodes.filter(node => neighboring.includes(node.id)).flatMap(node => node.unitIds).filter(id => id !== unitId) ?? [])];
  return <aside className="unit-inspector" style={{width}} role="complementary" aria-label={`대사 문맥과 변경 검토: ${unit.id}`}>
    <div className="ux-inspector-resize" role="separator" aria-label="대사 상세 패널 너비 조절" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={300} aria-valuemax={680} tabIndex={0} onPointerDown={event=>{resize.current={x:event.clientX,width};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(resize.current)setWidth(Math.max(300,Math.min(680,resize.current.width+resize.current.x-event.clientX)));}} onPointerUp={()=>{resize.current=undefined;}} onPointerCancel={()=>{resize.current=undefined;}} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setWidth(value=>Math.max(300,Math.min(680,value+(event.key==='ArrowLeft'?20:-20))));}}}/>
    <header><div><small>{group?.title ?? unit.groupId} · {index + 1}/{ordered.length}</small><strong>{unit.speaker || (unit.kind === 'document' ? '문서' : '문구')}<span>{branchName(unit.branch)}</span></strong></div><Button ref={closeButton} onClick={onClose} aria-label="대사 상세 닫기" variant="ghost" size="icon-sm"><X size={16} /></Button></header>
    <div className="unit-inspector-tabs" role="group" aria-label="대사 상세 보기">{(['context', 'progress', 'resources', 'changes'] as const).map(value => <Button key={value} aria-pressed={tab === value} onClick={() => setTab(value)} variant="ghost">{value === 'context' ? '문맥' : value==='progress'?'후보·진행':value === 'resources' ? '자료·용어' : '변경 검토'}{value === 'changes' && openReviews.length ? <span>{openReviews.length}</span> : null}</Button>)}</div>
    <div className="unit-inspector-scroll">
      {onChatScope ? <Button onClick={() => onChatScope([unit.id])} variant="ghost" size="sm">이 원문 채팅에 첨부</Button> : null}
      <div hidden={tab!=='progress'}><UnitProgressPanel state={state} unit={unit} active={tab==='progress'}/></div>
      {tab === 'progress'?null:tab === 'context' ? <>
        <div className="unit-inspector-source"><small>원문</small><p>{unit.source}</p><small>현재 번역 · v{translation?.version ?? 0}</small><p className="translation">{translation?.text || '아직 번역되지 않았습니다.'}</p><code>{unit.id}</code></div>
        {unit.contextNotes?.length ? <section><h3>추출된 문맥 메모</h3>{unit.contextNotes.map((note, noteIndex) => <p className="ux-context-note" key={noteIndex}>{note}</p>)}</section> : null}
        <section><h3>원본 조건과 연결</h3>{loading ? <p className="ux-muted" role="status">원본 연결 확인 중…</p> : error ? <p className="ux-muted" role="alert">{error}</p> : <><RecordedConditions unit={unit} graph={graph} /><div className="ux-related-units">{adjacentUnits.map(id => { const neighbor = state.units.find(item => item.id === id); return neighbor ? <Button key={id} onClick={() => onNavigateUnit(id)} variant="ghost"><strong>{neighbor.speaker || '문구'}</strong><span>{neighbor.source.slice(0,110)}</span></Button> : null; })}</div>{!adjacentUnits.length ? <p className="ux-muted">직접 연결된 다른 원문은 이 범위에 없습니다.</p> : null}</>}{onFlow ? <Button onClick={() => onFlow(unit.groupId, unit.id)} variant="ghost" size="sm"><GitBranch size={12} />이 대사 주변 보기</Button> : null}</section>
        <section><h3>추출 순서로 앞뒤 읽기</h3><p className="ux-muted">실제 실행 경로와는 다를 수 있습니다.</p><div className="ux-sequential-actions"><Button disabled={index === 0} onClick={() => onNavigateUnit(ordered[index-1].id)} variant="ghost" size="sm"><ArrowLeft size={12} />이전 원문</Button><Button disabled={index + 1 >= ordered.length} onClick={() => onNavigateUnit(ordered[index+1].id)} variant="ghost" size="sm">다음 원문<ArrowRight size={12} /></Button></div></section>
      </> : tab === 'resources' ? <UnitResources state={state} units={[unit]} onOpenTerm={onOpenTerm} onOpenKnowledge={onOpenKnowledge} /> : <>
        {openReviews.length ? <section className="ux-open-reviews"><h3>검토 대기 {openReviews.length}개</h3>{openReviews.map(review => <details key={review.id}><summary>{review.reason}</summary><BeforeAfter before={review.currentText} after={review.proposedText} />{review.execution ? <p className="ux-muted">{STAGE_LABELS[review.execution.stage]} · {review.execution.model} · 프롬프트 v{review.execution.promptVersion ?? 1}</p> : null}</details>)}{onReviewUnit ? <Button onClick={() => onReviewUnit(unit.id)} variant="outline" size="sm">이 대사 검토 열기</Button> : null}</section> : null}
        <UnitChangeHistory state={state} units={[unit]} groupIds={new Set([unit.groupId])} onNavigateUnit={onNavigateUnit} />
      </>}
    </div><footer><Button onClick={() => onNavigateUnit(unit.id)} variant="outline" size="sm"><BookOpen size={12} />장면에서 편집</Button><span>{translation?.locked ? '자동 수정 보호 중' : '자동 수정 가능'}</span></footer>
  </aside>;
}

export function UnitResources({ state, units, onOpenTerm, onOpenKnowledge }: { state: WorkspaceState; units: SourceUnit[]; onOpenTerm?: (id: string) => void; onOpenKnowledge?: (id: string) => void }) {
  const ids = new Set(units.map(unit => unit.id));
  const actualUsages = units.flatMap(unit => state.translations[unit.id]?.termUsages ?? []);
  const terms = state.terms.filter(term => term.unitIds.some(id => ids.has(id)) || units.some(unit => unit.termIds.includes(term.id)) || actualUsages.some(usage => usage.termId === term.id));
  const direct = state.knowledge.filter(item => !item.archived && [...item.evidenceIds, ...(item.usedUnitIds ?? [])].some(id => ids.has(id)));
  const general = state.knowledge.filter(item => units.length > 0 && !item.archived && !direct.includes(item) && item.visibility === 'translator' && (item.branch === 'common' || units.every(unit => unit.branch !== 'unknown' && unit.branch === item.branch)) && (item.kind === 'rule' || item.kind === 'summary'));
  const knowledgeLink = (item: WorkspaceState['knowledge'][number]) => <Button className="ux-resource" disabled={!onOpenKnowledge} key={item.id} onClick={() => onOpenKnowledge?.(item.id)} variant="ghost"><strong>{item.title}</strong><span>{item.content}</span><small>{item.visibility === 'translator' ? '번역자 자료' : item.visibility === 'character' ? '인물의 기억' : '플레이어 정보'} · {branchName(item.branch)} · v{item.version ?? 1}</small></Button>;
  return <><section><h3>연결된 용어 <span>{terms.length}</span></h3>{terms.map(term => {
    const candidates = termCandidates(term), usages = actualUsages.filter(usage => usage.termId === term.id);
    const summaries = [...new Set(usages.map(usage => { const candidate = candidates.find(item => item.id === usage.candidateId); return `${candidate?.target || '이전 후보'} · ${usage.origin === 'model' ? 'AI 선택' : usage.origin === 'observed' ? '번역에서 관측' : '기존 번역에서 추출'} · 사용 v${usage.candidateVersion}${!candidate || !candidate.enabled || !candidate.target.trim() || usage.candidateVersion !== candidate.version ? ' · 재검토 필요' : ''}`; }))];
    return <Button className="ux-resource" key={term.id} disabled={!onOpenTerm} onClick={() => onOpenTerm?.(term.id)} variant="ghost"><strong>{term.source} · 기본 {term.target || '미정'}</strong><span>{term.description}</span><small>v{term.version} · {term.unitIds.filter(id => ids.has(id)).length}개 원문에 연결</small><span className="gc-resource-usages">{summaries.length ? `실제 사용: ${summaries.join(' / ')}` : '실제 후보 사용 기록 없음'}</span></Button>;
  })}{!terms.length ? <p className="ux-muted">연결된 용어가 없습니다.</p> : null}</section><section><h3>근거·사용 기록이 연결된 자료</h3>{direct.map(knowledgeLink)}{!direct.length ? <p className="ux-muted">이 원문에 직접 연결된 자료가 없습니다.</p> : null}</section>{general.length ? <section><h3>작품·분기 공통 번역자 자료</h3><p className="ux-muted">인물이 이 시점에 아는 정보와는 구분합니다.</p>{general.map(knowledgeLink)}</section> : null}</>;
}

export function RawCondition({title,value}:{title:string;value:unknown}){if(value===undefined||value===null)return <p className="map-muted">{title}: 기록 없음</p>;return <details className="map-raw"><summary>{title} · 원본 값</summary><pre>{typeof value==='string'?value:JSON.stringify(value,null,2)}</pre></details>;}
const changeLabels:Record<string,string>={'translation-created':'번역 생성','translation-updated':'번역 수정','translation-manual':'직접 수정','translation-reviewed':'검수 반영','translation-stale':'갱신 필요','translation-lock':'자동 수정 보호','translation-term-usage':'용어 후보 사용 기록 갱신','term-created':'용어 생성','term-updated':'용어 수정','knowledge-created':'자료 생성','knowledge-archived':'자료 보관','knowledge-revised':'자료 수정'};
function contentOf(value:unknown):string{if(value===undefined||value===null)return '없음';if(typeof value==='string')return value;if(typeof value==='object'){const record=value as Record<string,unknown>;if(typeof record.text==='string')return record.text||'(빈 번역)';if(typeof record.content==='string')return `${record.title??''}\n${record.content}`;}return JSON.stringify(value,null,2);}
export function BeforeAfter({before,after}:{before:unknown;after:unknown}){return <div className="map-change-diff"><div><span>변경 전</span><pre>{contentOf(before)}</pre></div><div><span>변경 후</span><pre>{contentOf(after)}</pre></div></div>;}
export function UnitChangeHistory({state,units,groupIds,onNavigateUnit}:{state:WorkspaceState;units:SourceUnit[];groupIds:Set<string>;onNavigateUnit:(id:string)=>void}){
 const scope=JSON.stringify({groups:[...groupIds].sort(),units:units.map(unit=>unit.id).sort()});
 const [ledger,setLedger]=useState<{items:ChangeRecord[];hasMore:boolean;loaded:number;total:number}>(),[requested,setRequested]=useState(100),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController(),selection=JSON.parse(scope) as {groups:string[];units:string[]};let cancelled=false;
  const queries=selection.groups.length?selection.groups.map(id=>({key:'groupId',id})):selection.units.map(id=>({key:'unitId',id}));
  setLoading(true);setLoadError('');
  void (async()=>{
   const results:{total:number;items:ChangeRecord[]}[]=[];
   // Bound concurrency and response pages independently of the size of the selected scene.
   for(let start=0;start<queries.length;start+=4){
    const batch=await Promise.all(queries.slice(start,start+4).map(async query=>{
     const items:ChangeRecord[]=[];let total=0;
     do{
      const params=new URLSearchParams({[query.key]:query.id,offset:String(items.length),limit:String(Math.min(500,requested-items.length))});
      const response=await fetch(apiPath(`/changes?${params}`),{signal:controller.signal}),body=await response.json() as {total?:number;items?:ChangeRecord[];error?:string};
      if(!response.ok)throw new Error(body.error||'변경 이력을 불러오지 못했습니다.');
      if(!Array.isArray(body.items)||typeof body.total!=='number')throw new Error('변경 이력 응답을 확인할 수 없습니다.');
      total=body.total;items.push(...body.items);if(!body.items.length)break;
     }while(items.length<total&&items.length<requested);
     return {total,items};
    }));results.push(...batch);
   }
   if(!cancelled)setLedger({items:[...new Map(results.flatMap(result=>result.items).map(item=>[item.id,item])).values()],hasMore:results.some(result=>result.items.length<result.total),loaded:results.reduce((sum,result)=>sum+result.items.length,0),total:results.reduce((sum,result)=>sum+result.total,0)});
  })().catch(reason=>{if(!cancelled)setLoadError(reason instanceof Error?reason.message:'변경 이력 조회 실패');}).finally(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;controller.abort();};
 },[scope,state.revision,requested,retry]);
 const ids=new Set(units.map(u=>u.id)),changes=(ledger?.items??state.changes??[]).filter(c=>c.unitIds.some(id=>ids.has(id))||(!c.unitIds.length&&c.groupIds.some(id=>groupIds.has(id)))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const [limit,setLimit]=useState(30),legacy=units.flatMap(unit=>(state.translations[unit.id]?.history??[]).map((version,index,all)=>({unit,version,before:index?all[index-1].text:''}))).sort((a,b)=>b.version.createdAt.localeCompare(a.version.createdAt));
 return <><h2>변경 이력</h2><p className="map-muted">원문과 연결된 번역·용어·자료 변경입니다. 기존 번역 버전 기록도 함께 보존됩니다.</p>{loading?<p className="map-muted" role="status">선택 범위의 변경 기록 조회 중…</p>:null}{loadError?<div role="alert"><p className="map-muted">{loadError} 표시된 기록은 일부일 수 있습니다.</p><Button onClick={()=>setRetry(value=>value+1)} variant="ghost" size="sm">다시 조회</Button></div>:null}{changes.slice(0,limit).map(c=><details className="map-change" key={c.id}><summary><strong>{changeLabels[c.kind]??c.kind}</strong><time>{new Date(c.createdAt).toLocaleString('ko-KR')}</time></summary><div className="map-change-meta">{c.stage?<span>{STAGE_LABELS[c.stage]}</span>:null}{c.model?<span>{c.model}</span>:null}{c.promptVersion!==undefined?<span>프롬프트 v{c.promptVersion}</span>:null}</div><BeforeAfter before={c.before} after={c.after}/><RawCondition title="변경 전체 값" value={{before:c.before,after:c.after}}/><ChangeReferences change={c}/><div className="map-endpoints">{c.unitIds.filter(id=>ids.has(id)).slice(0,8).map(id=><Button key={id} onClick={()=>onNavigateUnit(id)} variant="ghost">{id}</Button>)}</div></details>)}{changes.length>limit?<Button onClick={()=>setLimit(v=>v+30)} variant="ghost" size="sm">변경 더 보기</Button>:null}{ledger?.hasMore?<><p className="map-muted">연결 장면의 기록 {ledger.total.toLocaleString()}개 중 {ledger.loaded.toLocaleString()}개를 조회했습니다. 이전 기록은 추가로 불러올 수 있습니다.</p><Button disabled={loading} onClick={()=>setRequested(value=>value+100)} variant="ghost" size="sm">이전 기록 더 조회</Button></>:null}
  <h3>번역 버전 기록 <span>{legacy.length}</span></h3>{legacy.slice(0,limit).map(({unit,version,before})=><details className="map-change legacy" key={`${unit.id}:${version.version}`}><summary><strong>v{version.version} · {version.origin==='manual'?'직접 수정':version.origin==='demo'?'모의 번역':'AI 번역'}</strong><time>{new Date(version.createdAt).toLocaleString('ko-KR')}</time></summary><p className="map-muted">{unit.speaker||unit.id} · {version.reason}</p><div className="map-change-meta">{version.execution?.stage?<span>{STAGE_LABELS[version.execution.stage]}</span>:null}{version.execution?.model?<span>{version.execution.model}</span>:null}</div><BeforeAfter before={before} after={version.text}/><RawCondition title="적용된 용어 버전" value={version.termVersions}/><Button onClick={()=>onNavigateUnit(unit.id)} variant="ghost" size="sm">대사 상세 보기</Button></details>)}{legacy.length>limit?<Button onClick={()=>setLimit(v=>v+30)} variant="ghost" size="sm">번역 기록 더 보기</Button>:null}{!loading&&!loadError&&ledger&&!ledger.hasMore&&!changes.length&&!legacy.length?<p className="map-muted">이 범위에 저장된 변경 기록이 없습니다.</p>:null}</>;
}
function ChangeReferences({change}:{change:ChangeRecord}){
 const [snapshot,setSnapshot]=useState<Record<string,unknown>>(),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null);useEffect(()=>()=>request.current?.abort(),[]);
 const open=async()=>{if(!change.snapshotId||snapshot||loading)return;const controller=new AbortController();request.current=controller;setLoading(true);setError('');try{const response=await fetch(apiPath(`/tasks/snapshots/${encodeURIComponent(change.snapshotId)}`),{signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'스냅샷 조회 실패');if(!controller.signal.aborted)setSnapshot(data);}catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'스냅샷 조회 실패');}finally{if(!controller.signal.aborted)setLoading(false);}};
 return change.snapshotId||change.runId||change.stepId?<details className="map-raw"><summary>실행 근거 참조</summary>{change.runId?<code>실행: {change.runId}</code>:null}{change.stepId?<code>단계: {change.stepId}</code>:null}{change.snapshotId?<><code>스냅샷: {change.snapshotId}</code><Button disabled={loading} onClick={()=>void open()} variant="ghost" size="sm">{loading?'불러오는 중…':'당시 프롬프트·문맥 열기'}</Button></>:null}{error?<p className="map-muted" role="alert">{error}</p>:null}{snapshot?<><RawCondition title="당시 프롬프트" value={snapshot.prompt}/><RawCondition title="당시 문맥" value={snapshot.context}/><RawCondition title="응답 규격" value={snapshot.schema}/></>:null}</details>:null;
}
