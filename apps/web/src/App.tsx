import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, FolderOpen, GitBranch, Inbox, LoaderCircle, MessageSquare, Play, RefreshCw, Settings2, Terminal, X } from 'lucide-react';
import { STAGE_LABELS, type JobStep, type SourceUnit, type Stage, type WorkspaceState } from '@workbench/contracts';
import { api, setApiWorkspace, type Workspace } from './api';
import type { Draft } from './DialogueCard';
import { SceneDetail, SOURCE_PAGE_SIZE } from './SceneDetail';
import { GlossaryPage } from './GlossaryPage';
import { SettingsPage } from './SettingsPage';
import { ReviewPage } from './ReviewPage';
import { currentRunStep, RunHistory } from './RunProgress';
import { GraphPage } from './GraphPage';
import { TaskButton } from './TaskButton';
import { KnowledgePage } from './KnowledgePage';
import { PeoplePage } from './PeoplePage';
import { ChatPage } from './ChatPage';
import {ChatDock,readChatDock} from './ChatDock';
import {WorkflowPage} from './WorkflowPage';
import {combineActivityStep,workflowActivities} from './workflow-activity';
import { UnitInspector } from './UnitInspector';
import { RunPlanner, type RunScope } from './RunPlanner';
import { ProjectManager } from './ProjectManager';
import {checkpoint,readRoute,validateRoute,writeRoute,restoreScroll,type NavigationRoute,type NavigationEntry,type GraphNavigation,type Page} from './navigation';
import './workspace-shell.css';
import './redesign.css';
import './workflow.css';

export type Mutate = (path: string, body?: unknown, method?: string, success?: string) => Promise<boolean>;
const retainedDrafts=new Map<string,Record<string,Draft>>();
type UiStateResponse = WorkspaceState | { unchanged: true; revision: number };
type GraphFocusRequest = { nodeId?: string; unitId?: string; groupId: string; token: number; mode?: 'scenes' | 'nodes' };
type ReviewScope = { groupId?: string; unitId?: string; unitIds?: string[] };
type ResourceFocus = { id: string; token: number };
const tabs: { id: Page; title: string; icon: typeof BookOpen }[] = [
  { id: 'graph', title: '작품', icon: GitBranch }, { id: 'knowledge', title: '작품 자료', icon: BookOpen }, { id: 'glossary', title: '용어집', icon: BookOpen },
  { id: 'reviews', title: '검토함', icon: Inbox }, { id: 'settings', title: 'AI 설정', icon: Settings2 }, { id: 'history', title: '실행 결과', icon: Terminal },
  {id:'workflow',title:'프로세스',icon:GitBranch},
];

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => { const initial = new URLSearchParams(window.location.search).get('workspace') === 'demo' ? 'demo' : 'main'; setApiWorkspace(initial); return initial; });
  useEffect(()=>{const restore=()=>{const next=readRoute(window.location.href).workspace;setApiWorkspace(next);setWorkspace(next);};window.addEventListener('popstate',restore);document.addEventListener('scroll',checkpoint,true);return()=>{window.removeEventListener('popstate',restore);document.removeEventListener('scroll',checkpoint,true);};},[]);
  return <WorkspaceApp key={workspace} workspace={workspace} onWorkspace={next => { checkpoint();writeRoute({workspace:next,page:'graph'},'push');setApiWorkspace(next);setWorkspace(next); }} />;
}

function WorkspaceApp({ workspace, onWorkspace }: { workspace: Workspace; onWorkspace: (next: Workspace) => void }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [connectionError, setConnectionError] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState(0);
  const alive = useRef(true);
  const latestRevision = useRef<number | undefined>(undefined);
  const runStatuses = useRef<Map<string, string> | null>(null);
  const refresh = useCallback(async () => {
    try {
      const since = latestRevision.current === undefined ? '' : `&since=${latestRevision.current}`;
      const next = await api<UiStateResponse>(`/state?view=ui${since}`);
      if (!alive.current) return;
      if (!('unchanged' in next)) { latestRevision.current = Math.max(latestRevision.current ?? -1, next.revision); setState(previous => !previous || next.revision > previous.revision ? next : previous); }
      setLastSyncAt(Date.now()); setConnectionError('');
    } catch (error) { if (alive.current) setConnectionError(error instanceof Error ? error.message : '서버 연결을 확인해 주세요.'); }
  }, []);
  useEffect(() => { alive.current = true; let timeout: ReturnType<typeof setTimeout>; let stopped = false; const poll = async () => { await refresh(); if (!stopped) timeout = setTimeout(poll, 1200); }; void poll(); return () => { stopped = true; alive.current = false; clearTimeout(timeout); }; }, [refresh]);
  useEffect(() => { if (!toast || toast.error) return; const timeout = setTimeout(() => setToast(null), 4500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    if (!state) return;
    if (runStatuses.current) { const finished = state.runs.find(run => run.status === 'completed' && runStatuses.current?.has(run.id) && runStatuses.current.get(run.id) !== 'completed'); if (finished) setToast({ text: 'AI 작업이 완료됐습니다. 실행 결과에서 변경 내용과 검토할 항목을 확인하세요.' }); }
    runStatuses.current = new Map(state.runs.map(run => [run.id, run.status]));
  }, [state?.runs]);
  useEffect(() => { document.title = state ? `Translation Workbench — ${state.project.title}` : 'Translation Workbench'; }, [state?.project.title]);
  const mutate: Mutate = useCallback(async (path, body = {}, method = 'POST', success) => {
    setPending(count => count + 1);
    try { await api(path, body, method); await refresh(); if (success) setToast({ text: success }); return true; }
    catch (error) { setToast({ text: error instanceof Error ? error.message : '요청 실패', error: true }); await refresh(); return false; }
    finally { setPending(count => Math.max(0, count - 1)); }
  }, [refresh]);
  if (!state) return <div className="loading-screen"><BookOpen size={24} /><strong>Translation Workbench</strong><p>{connectionError || '작업을 불러오고 있습니다…'}</p>{connectionError ? <Button onClick={() => void refresh()} variant="outline"><RefreshCw size={14} />다시 연결</Button> : <LoaderCircle className="spinning" size={20} />}</div>;
  return <><WorkbenchShell key={`${state.project.id}:${epoch}`} workspace={workspace} state={state} mutate={mutate} busy={pending > 0} lastSyncAt={lastSyncAt} connectionError={connectionError} onWorkspace={onWorkspace} onProjectChanged={() => { for(const key of retainedDrafts.keys())if(key.startsWith(`${workspace}:`))retainedDrafts.delete(key);setEpoch(value => value + 1); }} onSettingsSaved={next => { latestRevision.current = Math.max(latestRevision.current ?? -1, next.revision); setState(previous => !previous || next.revision > previous.revision ? next : previous); }} />{toast ? <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <Inbox size={16} /> : <Check size={16} />}<span>{toast.text}</span><Button aria-label="알림 닫기" onClick={() => setToast(null)} variant="ghost"><X size={15} /></Button></div> : null}</>;
}

function WorkbenchShell({ workspace, state, mutate, busy, lastSyncAt, connectionError, onWorkspace, onProjectChanged, onSettingsSaved }: { workspace: Workspace; state: WorkspaceState; mutate: Mutate; busy: boolean; lastSyncAt: number; connectionError: string; onWorkspace: (workspace: Workspace) => void; onProjectChanged: () => void; onSettingsSaved: (state: WorkspaceState) => void }) {
  const [initialRoute]=useState(()=>{const route=validateRoute(readRoute(window.location.href),workspace,state.project.id,new Set(state.groups.map(g=>g.id)),new Map(state.units.map(u=>[u.id,u.groupId])));if(route.unitId&&route.sourcePage===undefined){const units=state.units.filter(u=>u.groupId===route.groupId).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));route.sourcePage=Math.floor(Math.max(0,units.findIndex(u=>u.id===route.unitId))/SOURCE_PAGE_SIZE);}return route;});
  const [page, setPage] = useState<Page>(initialRoute.page);
  const [visited, setVisited] = useState<Set<Page>>(() => new Set(['graph',initialRoute.page]));
  const [groupId, setGroupId] = useState(initialRoute.groupId??'');
  const [focusId, setFocusId] = useState(initialRoute.unitId??'');
  const [focusRequest, setFocusRequest] = useState(0);
  const [graphFocus, setGraphFocus] = useState<GraphFocusRequest>();
  const navigationToken = useRef(0);
  const [flowScenes, setFlowScenes] = useState<string[]>(initialRoute.page==='flow'&&initialRoute.groupId?[initialRoute.groupId]:[]);
  const [sourcePages, setSourcePages] = useState<Record<string, number>>(initialRoute.groupId?{[initialRoute.groupId]:initialRoute.sourcePage??0}:{});
  const [termId, setTermId] = useState(initialRoute.page==='glossary'?initialRoute.resourceId??'':'');
  const [knowledgeId, setKnowledgeId] = useState(initialRoute.page==='knowledge'?initialRoute.resourceId??'':'');
  const [chatAttachment,setChatAttachment]=useState<{unitIds:string[];token:number}>();
  const [workflowRunRequest,setWorkflowRunRequest]=useState<{runId:string;token:number}>();
  const chatStorageKey=`workbench.chat-dock.v1:${workspace}:${state.project.id}`;
  const [savedChat]=useState(()=>readChatDock(chatStorageKey));
  const [chatOpen,setChatOpen]=useState(!!initialRoute.legacyChat||savedChat.open);
  const [chatId,setChatId]=useState(initialRoute.legacyChat?.sessionId||savedChat.sessionId);
  const [chatMounted,setChatMounted]=useState(chatOpen);
  useEffect(()=>{if(chatOpen)setChatMounted(true);try{sessionStorage.setItem(chatStorageKey,JSON.stringify({open:chatOpen,sessionId:chatId}));}catch{}},[chatOpen,chatId,chatStorageKey]);
  const [profileRequest,setProfileRequest]=useState(0);
  const [workflowScope,setWorkflowScope]=useState<{unitIds:string[];token:number}>();
  const [termRequest, setTermRequest] = useState<ResourceFocus>();
  const [knowledgeRequest, setKnowledgeRequest] = useState<ResourceFocus>();
  const draftKey=`${workspace}:${state.project.id}`;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(()=>retainedDrafts.get(draftKey)??{});
  useEffect(()=>{retainedDrafts.set(draftKey,drafts);},[draftKey,drafts]);
  const [resourceDirty, setResourceDirty] = useState({ terms: false, knowledge: false, settings: false });
  const [inspector, setInspector] = useState('');
  const lastWorkPage = useRef<Page>(['graph','scene','flow'].includes(initialRoute.page)?initialRoute.page:'graph');
  const [runScope, setRunScope] = useState<RunScope|undefined>(initialRoute.page==='execute'?{pipeline:true}:undefined);
  const [runPlanVersion, setRunPlanVersion] = useState(0);
  const [resultVisit, setResultVisit] = useState(0);
  const [projectManager, setProjectManager] = useState(false);
  const [testRequest, setTestRequest] = useState<{ unitIds: string[]; token: number; stage?: Stage; testId?: string }>();
  const [reviewScope, setReviewScope] = useState<ReviewScope>();
  const hasDrafts = Object.keys(drafts).length > 0 || Object.values(resourceDirty).some(Boolean);
  const groups = useMemo(() => [...state.groups].sort((a,b) => a.order-b.order), [state.groups]);
  const unitLookup = useMemo(() => new Map(state.units.map(unit => [unit.id, unit])), [state.units]);
  const unitGroups = useMemo(() => { const result = new Map<string, SourceUnit[]>(); for (const unit of state.units) { const list = result.get(unit.groupId) ?? []; list.push(unit); result.set(unit.groupId, list); } for (const list of result.values()) list.sort((a,b) => a.order-b.order || a.id.localeCompare(b.id)); return result; }, [state.units]);
  const group = groups.find(item => item.id === groupId);
  const units = unitGroups.get(groupId) ?? [];
  const sourcePage = Math.min(sourcePages[groupId] ?? 0, Math.max(0, Math.ceil(units.length / SOURCE_PAGE_SIZE) - 1));
  const [graphNavigation,setGraphNavigation]=useState<GraphNavigation>(initialRoute.graph??{mode:'scenes',dataset:'scenes',flow:''});
  const navigationPending=useRef(false),[navigationVisit,setNavigationVisit]=useState(0);
  const markNavigation=()=>{checkpoint();navigationPending.current=true;setNavigationVisit(value=>value+1);};
  const route:NavigationRoute={workspace,projectId:state.project.id,page,graph:graphNavigation,...(['scene','flow'].includes(page)?{groupId,...((page==='scene'?focusId:graphFocus?.groupId===groupId?graphFocus.unitId:undefined)?{unitId:page==='scene'?focusId:graphFocus?.unitId}:{}),...(sourcePage?{sourcePage}:{})}:{}),...(page==='glossary'&&termId?{resourceId:termId}:{}),...(page==='knowledge'&&knowledgeId?{resourceId:knowledgeId}:{})};
  const serializedRoute=JSON.stringify(route),currentRoute=useRef(route);currentRoute.current=route;
  useEffect(()=>{writeRoute(initialRoute,'replace');const restore=(event:PopStateEvent)=>{
   const requested=readRoute(window.location.href);if(requested.workspace!==workspace)return;
   const next=validateRoute(requested,workspace,state.project.id,new Set(state.groups.map(g=>g.id)),new Map(state.units.map(u=>[u.id,u.groupId])));
   navigationPending.current=false;setPage(next.page);setVisited(previous=>new Set([...previous,next.page]));setGroupId(next.groupId??'');setFocusId(next.unitId??'');setInspector('');
   if(['graph','scene','flow'].includes(next.page))lastWorkPage.current=next.page;
   if(next.groupId)setSourcePages(previous=>({...previous,[next.groupId!]:next.sourcePage??0}));
   if(next.page==='flow'&&next.groupId){setFlowScenes(previous=>[...new Set([...previous,next.groupId!])]);if(!(event.state as {graphViews?:Record<string,unknown>}|null)?.graphViews?.[`${workspace}:${state.project.id}:${next.groupId}`])setGraphFocus({groupId:next.groupId,unitId:next.unitId,mode:'nodes',token:++navigationToken.current});}
   if(next.page==='glossary'){setTermId(next.resourceId??'');setTermRequest(next.resourceId?{id:next.resourceId,token:++navigationToken.current}:undefined);}
   if(next.page==='knowledge'){setKnowledgeId(next.resourceId??'');setKnowledgeRequest(next.resourceId?{id:next.resourceId,token:++navigationToken.current}:undefined);}
   if(next.legacyChat){setChatOpen(true);if(next.legacyChat.sessionId)setChatId(next.legacyChat.sessionId);}
   if(next.page==='execute')setRunScope(previous=>previous??{pipeline:true});
   setGraphNavigation(next.graph??{mode:'scenes',dataset:'scenes',flow:''});writeRoute(next,'replace');restoreScroll((event.state as NavigationEntry|null)?.scroll);
  };window.addEventListener('popstate',restore);document.addEventListener('scroll',checkpoint,true);return()=>{window.removeEventListener('popstate',restore);document.removeEventListener('scroll',checkpoint,true);};
  // This shell is already scoped by project/workspace. Polling must not replay navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{if(navigationPending.current){navigationPending.current=false;writeRoute(currentRoute.current,'push');}},[serializedRoute,navigationVisit]);
  const run = state.runs.find(item => item.status === 'running') ?? state.runs.find(item => item.status === 'paused') ?? state.runs.find(item => item.status === 'queued');
  const legacyStep=currentRunStep(run);
  const customActivities=useMemo(()=>workflowActivities(state),[state.workflow,state.units,state.project.id]);
  const currentStep = useMemo(()=>combineActivityStep(state,legacyStep,customActivities),[state.units,legacyStep,customActivities]);
  const targetUnitIds = useMemo(() => new Set(currentStep?.unitIds ?? []), [currentStep?.unitIds]);
  const workLabel = [legacyStep&&(currentStep?.status!=='running'||legacyStep.status==='running')?`${STAGE_LABELS[legacyStep.stage]} · 이번 묶음 ${legacyStep.unitIds.length}개`:undefined,...customActivities.filter(activity=>activity.step&&(currentStep?.status!=='running'||activity.running)).map(activity=>activity.label)].filter(Boolean).join(' / ')||undefined;
  const dirtyTerms = useCallback((dirty: boolean) => setResourceDirty(previous => previous.terms === dirty ? previous : { ...previous, terms: dirty }), []);
  const dirtyKnowledge = useCallback((dirty: boolean) => setResourceDirty(previous => previous.knowledge === dirty ? previous : { ...previous, knowledge: dirty }), []);
  const dirtySettings = useCallback((dirty: boolean) => setResourceDirty(previous => previous.settings === dirty ? previous : { ...previous, settings: dirty }), []);
  useEffect(() => { if (!hasDrafts) return; const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave); }, [hasDrafts]);
  useEffect(() => { if (!focusId || page !== 'scene') return; const timeout = setTimeout(() => document.getElementById(`unit-${focusId}`)?.scrollIntoView({ behavior:'smooth', block:'center' }), 70); return () => clearTimeout(timeout); }, [focusRequest]);
  const go = (next: Page) => { markNavigation();if (['graph','scene','flow'].includes(next)) lastWorkPage.current = next; setInspector(''); setVisited(previous => new Set([...previous, next])); setPage(next); };
  const canLeave = (destination:'project'|'workspace'='project') => destination==='workspace'
    ? !Object.values(resourceDirty).some(Boolean)||window.confirm('저장하지 않은 자료·설정 편집이 있습니다. 작업 공간을 바꾸면 이 편집을 초기화합니다. 전환할까요?')
    : !hasDrafts||window.confirm('저장하지 않은 번역·자료·설정 편집이 있습니다. 프로젝트를 바꾸면 이 초안을 버립니다. 저장된 작업은 보관됩니다. 전환할까요?');
  const navigateUnit = (id: string) => {
    const unit = unitLookup.get(id); if (!unit) return;
    go('scene'); setGroupId(unit.groupId); setFocusId(id); setFocusRequest(value => value+1);
    const index = unitGroups.get(unit.groupId)?.findIndex(item => item.id === id) ?? 0; setSourcePages(previous => ({ ...previous, [unit.groupId]: Math.floor(Math.max(0,index)/SOURCE_PAGE_SIZE) }));
  };
  const enterScene = (id: string, view: 'read' | 'flow', unitId?: string) => {
    if (view === 'read' && unitId) { navigateUnit(unitId); return; }
    go(view === 'read' ? 'scene' : 'flow'); setGroupId(id);
    if (view === 'read') { setFocusId(''); return; }
    setFlowScenes(previous => [...previous.filter(scene => scene !== id), id].slice(-30));
    setGraphFocus({ groupId: id, unitId, nodeId:unitId ? unitLookup.get(unitId)?.graphNodeIds?.[0] : undefined, mode: 'nodes', token: ++navigationToken.current });
  };
  const openFlow = (id: string, unitId?: string) => {
    go('flow'); setGroupId(id);
    setFlowScenes(previous => [...previous.filter(scene => scene !== id), id].slice(-30));
    setGraphFocus({ groupId:id, unitId, nodeId:unitId ? unitLookup.get(unitId)?.graphNodeIds?.[0] : undefined, mode:'nodes', token:++navigationToken.current });
  };
  const openLatestResults = () => { setResultVisit(value => value + 1); go('history'); };
  const openTerm = (id: string) => { go('glossary'); setTermId(id); setTermRequest({id,token:++navigationToken.current}); };
  const openKnowledge = (id: string) => { go('knowledge'); setKnowledgeId(id); setKnowledgeRequest({id,token:++navigationToken.current}); };
  const openReviews = (scope?: { groupId?: string; unitId?: string; unitIds?: string[] }) => { go('reviews'); setReviewScope(scope); };
  const testScope = (_groupId: string, unitIds: string[]) => { go('settings'); setTestRequest(previous => ({ unitIds, stage:'translate', token:(previous?.token ?? 0)+1 })); };
  const navigateStep = (step: JobStep) => { const id = step.unitIds.find(id => unitLookup.has(id)); if (page === 'flow' && step.groupId) enterScene(step.groupId,'flow'); else if (id) navigateUnit(id); else if (step.groupId) enterScene(step.groupId,'read'); };
  const editDraft = (id: string, draft?: Draft) => setDrafts(previous => { const next = { ...previous }; if (draft) next[id] = draft; else delete next[id]; return next; });
  const openRunPlan = (scope: RunScope) => { setRunScope(scope); setRunPlanVersion(value => value + 1); go('execute'); };
  const scopeRun = (_id: string, unitIds: string[]) => {setWorkflowScope(previous=>({unitIds,token:(previous?.token??0)+1}));go('workflow');};
  const configurePlan = (scope: RunScope) => {
    setRunScope(scope); go('settings');
    const selected = scope.unitIds ? new Set(scope.unitIds) : undefined;
    const filter = scope.stage === 'recheck' ? 'stale' : scope.filter ?? 'all';
    const unitIds = state.units.filter(unit => (!selected || selected.has(unit.id)) && (!scope.groupId || unit.groupId === scope.groupId) && (filter === 'stale' ? state.translations[unit.id]?.freshness === 'stale' : filter === 'untranslated' ? !state.translations[unit.id]?.text : true)).map(unit => unit.id);
    setTestRequest(previous => ({ unitIds, stage:scope.stage ?? 'analyze', token:(previous?.token ?? 0)+1 }));
  };
  const reviewCount = state.reviews.filter(review => review.status === 'open').length;
  const attachChat=(unitIds:string[])=>{setChatAttachment(previous=>({unitIds,token:(previous?.token??0)+1}));setChatOpen(true);};
  const currentChatUnit=unitLookup.get(inspector||(page==='scene'?focusId:''));
  const currentChatSource=currentChatUnit?{label:currentChatUnit.speaker||'선택 대사',unitIds:[currentChatUnit.id]}:page==='scene'?{label:group?.title??'현재 장면',unitIds:units.map(unit=>unit.id)}:undefined;
  const graphProps = { onChatScope:attachChat,state, groupId, onSelectGroup:setGroupId, onNavigateUnit:navigateUnit, onReadGroup:(id:string, unitId?:string) => enterScene(id,'read',unitId), onEnterScene:enterScene, currentStep, activityLabel:workLabel, onOpenKnowledge:openKnowledge, onOpenTerm:openTerm, onInspectUnit:setInspector, onRunScope:scopeRun, onTestScope:testScope };
  return <div className={`app workspace-shell page-${page}`}>
    <nav className="nav" aria-label="주요 메뉴"><div className="workspace-picker" title={state.project.title}><i className={`status-dot ${connectionError ? 'error' : ''}`} /><NativeSelect aria-label="작업 공간 선택" value={workspace} disabled={busy} onChange={event => { if (canLeave('workspace')) onWorkspace(event.target.value as Workspace); }}><NativeSelectOption value="main">{workspace === 'main' ? state.project.title : '기존 작업'}</NativeSelectOption><NativeSelectOption value="demo">3장면 데모 · 별도 저장</NativeSelectOption></NativeSelect></div>
      {tabs.map(tab => <Button key={tab.id} className={`nav-tab ${page === tab.id || (['scene','flow'].includes(page) && tab.id === 'graph') ? 'active' : ''}`} aria-current={page === tab.id ? 'page' : undefined} onClick={() => { if(tab.id === 'graph') { go(lastWorkPage.current); return; } if(tab.id === page) return; if(tab.id === 'glossary') { setTermRequest(undefined); setTermId(''); } if(tab.id === 'knowledge') { setKnowledgeRequest(undefined); setKnowledgeId(''); } if(tab.id === 'reviews') openReviews(); else go(tab.id); }} variant="ghost"><tab.icon size={15} />{tab.title}{tab.id === 'reviews' && reviewCount ? <span className="nav-count">{reviewCount}</span> : null}</Button>)}
      <div className="nav-right"><Button className=" chat-toggle" aria-label="AI 채팅" title="AI 채팅 열기/닫기" aria-expanded={chatOpen} aria-controls="project-chat-dock" onClick={()=>setChatOpen(value=>!value)} variant="ghost"><MessageSquare size={15}/><span>채팅</span></Button>{hasDrafts ? <span className="draft-indicator" title="저장하지 않은 편집은 화면을 이동해도 유지됩니다. 프로젝트 전환 전 저장하세요.">미저장 편집</span> : null}<TaskButton state={state} mutate={mutate} busy={busy} lastSyncAt={lastSyncAt} disconnected={!!connectionError} onOpenTarget={navigateStep} onHistory={openLatestResults} onWorkflow={runId=>{setWorkflowRunRequest(previous=>({runId,token:(previous?.token??0)+1}));go('workflow');}} onOpenTest={test => { go('settings'); setTestRequest(previous => ({ unitIds:test.unitIds, stage:test.stage, testId:test.id, token:(previous?.token ?? 0)+1 })); }} /><Button onClick={() => setProjectManager(true)} variant="ghost"><FolderOpen size={14} />프로젝트</Button><Button disabled={busy} aria-current={page === 'workflow' ? 'page' : undefined} onClick={() => go('workflow')} variant="default"><Play size={13} />작업 준비</Button></div>
    </nav>
    {connectionError ? <div className="notice" role="alert">서버 연결이 끊겼습니다. {connectionError}</div> : null}
    <div className="workbench-body"><div className="shell-content">
      <div className="graph-workspace" hidden={page !== 'graph'}><GraphPage {...graphProps} navigationView={graphNavigation} onNavigationView={next=>{markNavigation();setGraphNavigation(next);}} /></div>
      {flowScenes.map(sceneId => <div className="graph-workspace" key={sceneId} hidden={page !== 'flow' || groupId !== sceneId}><GraphPage {...graphProps} groupId={sceneId} sceneScope={sceneId} focusRequest={graphFocus} onBackToWork={() => go('graph')} /></div>)}
      {visited.has('scene') ? <div className="shell-page" hidden={page !== 'scene'} ><SceneDetail state={state} group={group} groups={groups} units={units} sourcePage={sourcePage} onSourcePage={next => { markNavigation();setSourcePages(previous => ({ ...previous, [groupId]:next })); setFocusId(''); }} focusId={focusId} drafts={drafts} onDraft={editDraft} mutate={mutate} busy={busy} activeRun={!!run||customActivities.length>0} targetUnitIds={targetUnitIds} activityLabel={workLabel} activityState={currentStep?.status === 'running' ? 'running' : 'waiting'} onTerm={openTerm} onNavigateUnit={navigateUnit} onBack={() => go('graph')} onFlow={id => openFlow(id)} onSelectGroup={id => enterScene(id,'read')} onSelectUnit={setFocusId} onInspectUnit={setInspector} onChatScope={attachChat} onReviewScope={groupId => openReviews({groupId})} onRunScope={scopeRun} onTestScope={testScope} /></div> : null}
      {runScope ? <div className="shell-page planner-shell" hidden={page !== 'execute'}><RunPlanner key={runPlanVersion} state={state} scope={runScope} mutate={mutate} busy={busy} hasDrafts={hasDrafts} onClose={openLatestResults} onSettings={configurePlan} /></div> : null}
      {(['glossary','knowledge','reviews','settings','history','workflow'] as const).map(id => visited.has(id) ? <div className="shell-page" hidden={page !== id} key={id} >
        {id === 'glossary' ? <GlossaryPage state={state} selectedId={termId} focusRequest={termRequest} onSelect={setTermId} navigateUnit={navigateUnit} mutate={mutate} busy={busy} onDirtyChange={dirtyTerms} onRecheck={unitIds => openRunPlan({ unitIds, stage:'recheck' })} /> : null}
        {id === 'knowledge' ? <><div className="materials-view" hidden={knowledgeId.startsWith('people:')}><KnowledgePage state={state} selectedId={knowledgeId} focusRequest={knowledgeRequest} onSelect={value=>{markNavigation();setKnowledgeId(value);}} onPeople={()=>{markNavigation();setKnowledgeId('people:');}} navigateUnit={navigateUnit} mutate={mutate} busy={busy} onDirtyChange={dirtyKnowledge} onRecheck={unitIds => openRunPlan({ unitIds, stage:'recheck' })} /></div><div className="materials-view" hidden={!knowledgeId.startsWith('people:')}><PeoplePage state={state} selectedId={knowledgeId} onSelect={value=>{markNavigation();setKnowledgeId(value);}} onDocuments={()=>{markNavigation();setKnowledgeId('');}} onOpenKnowledge={openKnowledge} navigateUnit={navigateUnit}/></div></> : null}
        {id==='workflow'?<WorkflowPage state={state} visible={page==='workflow'} scopeRequest={workflowScope} runRequest={workflowRunRequest} onSource={navigateUnit} onSettings={()=>{setProfileRequest(value=>value+1);go('settings');}}/>:null}
        {id === 'reviews' ? <ReviewPage state={state} navigateUnit={navigateUnit} mutate={mutate} busy={busy} scope={reviewScope} onClearScope={() => setReviewScope(undefined)} onInspectUnit={setInspector} onRecheck={unitIds => openRunPlan({unitIds,stage:'recheck'})} /> : null}
        {id === 'settings' ? <SettingsPage state={state} profileRequest={profileRequest} mutate={mutate} busy={busy} testRequest={testRequest} onDirtyChange={dirtySettings} onRunScope={openRunPlan} onSettingsSaved={onSettingsSaved} /> : null}
        {id === 'history' ? <RunHistory key={resultVisit} state={state} onOpenTarget={navigateStep} onInspectUnit={setInspector} onReviewScope={unitIds => openReviews({unitIds})} /> : null}
      </div> : null)}
    {inspector ? <UnitInspector state={state} unitId={inspector} onClose={() => setInspector('')} onNavigateUnit={navigateUnit} onOpenTerm={openTerm} onOpenKnowledge={openKnowledge} onFlow={openFlow} onReviewUnit={unitId => openReviews({unitId})} onChatScope={attachChat} /> : null}
    </div>
    {chatMounted||chatOpen?<ChatDock open={chatOpen} storageKey={chatStorageKey}><ChatPage key={`${workspace}:${state.project.id}`} attachment={chatAttachment} currentSource={currentChatSource} visible={chatOpen} state={state} sessionId={chatId} onSession={setChatId} onClose={()=>setChatOpen(false)} onSource={navigateUnit} onKnowledge={openKnowledge} onSettings={()=>{setProfileRequest(value=>value+1);go('settings');}}/></ChatDock>:null}
    </div>

    {projectManager ? <ProjectManager state={state} mutate={mutate} busy={busy} canLeave={canLeave} onClose={() => setProjectManager(false)} onChanged={onProjectChanged} /> : null}
  </div>;
}

