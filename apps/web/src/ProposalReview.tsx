import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Textarea } from './components/ui/textarea';
import {useEffect,useState} from 'react';
import type {ChangeProposal,ProposalOperation,WorkspaceState} from '@workbench/contracts';
import {api} from './api';

const labels:Record<string,string>={url:'출처 주소',unitId:'원문 ID',excerpt:'인용',retrievedAt:'조회 시각',sourceVersion:'근거 버전',title:'제목',content:'내용',name:'이름',aliases:'별칭',description:'설명',kind:'종류',branch:'적용 분기',condition:'조건',certainty:'근거 수준',direction:'관계 방향',fromCharacterId:'출발 인물',toCharacterId:'도착 인물',profileKnowledgeId:'프로필 문서',evidenceIds:'근거',visibility:'공개 범위',color:'색상',role:'상태 역할',text:'번역문',statusId:'상태',labelIds:'라벨'};
const kinds:Record<string,string>={knowledge:'작품 자료',character:'인물',relationship:'관계',evidence:'근거',label:'라벨',status:'상태',unit:'대사 상태',translation:'번역',term:'용어'};
const choices:Record<string,string[]>={direction:['directed','mutual','undirected'],certainty:['confirmed','claimed','inferred','unknown'],visibility:['translator','character','player'],role:['untranslated','draft','confirmed','custom']};
const choiceLabels:Record<string,string>={directed:'한 방향',mutual:'서로',undirected:'방향 없음',confirmed:'확인됨',claimed:'진술에 근거',inferred:'추정',unknown:'미확인',translator:'번역자 참고',character:'인물 지식',player:'플레이어 공개',untranslated:'미번역',draft:'초안',custom:'사용자 지정'};
function payload(operation:ProposalOperation):Record<string,unknown>{const value=operation as unknown as Record<string,unknown>;return (value.item??value.patch??value.input??value) as Record<string,unknown>;}
function title(operation:ProposalOperation){const [kind,action]=operation.kind.split('.');return `${kinds[kind]??kind} ${action==='create'?'추가':action==='update'?'수정':action==='select'?'선택':'변경'}`;}
function currentPayload(operation:ProposalOperation,state:WorkspaceState):Record<string,unknown>|undefined{
 if(!('id' in operation))return;
 const records=operation.kind.startsWith('knowledge.')?state.knowledge:operation.kind.startsWith('character.')?state.studio?.characters:operation.kind.startsWith('relationship.')?state.studio?.relationships:operation.kind.startsWith('term.')?state.terms:[];
 return records?.find(item=>item.id===operation.id) as unknown as Record<string,unknown>|undefined;
}

export function ProposalReview({proposal,state,onRefresh,onFeedback,onSource,onKnowledge}:{proposal:ChangeProposal;state:WorkspaceState;onRefresh():void;onFeedback(content:string):Promise<void>;onSource(id:string):void;onKnowledge(id:string):void}){
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState<ProposalOperation[]>(proposal.operations),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const base=`/studio/proposals/${encodeURIComponent(proposal.id)}`,query=`?projectId=${encodeURIComponent(state.project.id)}`;
 useEffect(()=>{if(!editing)setDraft(proposal.operations);},[proposal.version,editing]);
 const perform=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await action();onRefresh();}catch(error){setError((error as Error).message);}finally{setBusy(false);}};
 const patch=(index:number,key:string,value:unknown)=>setDraft(previous=>previous.map((operation,i)=>{if(i!==index)return operation;const field='item' in operation?'item':'patch' in operation?'patch':'input' in operation?'input':undefined;return (field?{...operation,[field]:{...payload(operation),[key]:value}}:{...operation,[key]:value}) as ProposalOperation;}));
 const display=(key:string,value:unknown)=>{
  if(key==='kind'&&typeof value==='string')return ({character:'인물 프로필',summary:'작품 설명',fact:'사건·단서',style:'번역 규칙',source:'원문 근거',web:'웹 근거',knowledge:'작품 자료 근거'} as Record<string,string>)[value]??value;
  if(key==='url'&&typeof value==='string'&&/^https?:\/\//i.test(value))return <a href={value} target="_blank" rel="noreferrer">{value}</a>;
  if(key==='unitId'&&typeof value==='string'&&state.units.some(unit=>unit.id===value))return <Button className="text-button" onClick={()=>onSource(value)} variant="ghost">{value}</Button>;
  if(key==='evidenceIds'&&Array.isArray(value))return <span className="proposal-evidence">{value.map(id=>{const unit=state.units.find(item=>item.id===id),evidence=state.studio?.evidence.find(item=>item.id===id);return unit?<Button key={id} className="text-button" onClick={()=>onSource(id)} variant="ghost">{unit.speaker||id}</Button>:evidence?.unitId?<Button key={id} className="text-button" onClick={()=>onSource(evidence.unitId!)} variant="ghost">{evidence.title||id}</Button>:evidence?.url&&/^https?:\/\//i.test(evidence.url)?<a key={id} href={evidence.url} target="_blank" rel="noreferrer">{evidence.title||id}</a>:<span key={id}>{String(id)}</span>;})}</span>;
  if(key==='profileKnowledgeId'&&typeof value==='string'&&state.knowledge.some(item=>item.id===value))return <Button className="text-button" onClick={()=>onKnowledge(value)} variant="ghost">{state.knowledge.find(item=>item.id===value)?.title}</Button>;
  if(key==='profileKnowledgeId'&&typeof value==='string')return draft.flatMap(op=>op.kind==='knowledge.create'&&op.item.id===value?[op.item.title]:[])[0]??value;
  if(['fromCharacterId','toCharacterId'].includes(key)&&typeof value==='string')return state.studio?.characters.find(item=>item.id===value)?.name??draft.flatMap(op=>op.kind==='character.create'&&op.item.id===value?[op.item.name]:[])[0]??value;
  return Array.isArray(value)?value.join(', '):typeof value==='string'?choiceLabels[value]??value:value===undefined?'—':JSON.stringify(value);
 };
 return <article className={`proposal-review ${proposal.status}`} aria-label={proposal.title}>
  <header><strong>{proposal.title}</strong><span>v{proposal.version} · {proposal.status==='draft'?'수락 대기':proposal.status==='accepted'?'반영됨':'거절됨'}</span></header>
  {(editing?draft:proposal.operations).map((operation,index)=>{const data=payload(operation),before=currentPayload(operation,state);return <section key={index} className="proposal-operation"><h4>{title(operation)}{typeof data.name==='string'?` · ${data.name}`:''}</h4><dl>{Object.keys(data).filter(key=>labels[key]).map(key=><div key={key}><dt>{labels[key]}</dt><dd>{before&&JSON.stringify(before[key])!==JSON.stringify(data[key])?<del>{display(key,before[key])}</del>:null}{editing?(choices[key]?<NativeSelect aria-label={`${index+1} ${labels[key]}`} value={String(data[key]??'')} onChange={event=>patch(index,key,event.target.value)}>{choices[key].map(choice=><NativeSelectOption key={choice} value={choice}>{choiceLabels[choice]??choice}</NativeSelectOption>)}</NativeSelect>:<Textarea rows={key==='content'||key==='description'?5:2} aria-label={`${index+1} ${labels[key]}`} value={Array.isArray(data[key])?(data[key] as string[]).join('\n'):String(data[key]??'')} onChange={event=>patch(index,key,Array.isArray(data[key])?event.target.value.split('\n').map(value=>value.trim()).filter(Boolean):event.target.value)}/>):<div>{display(key,data[key])}</div>}</dd></div>)}</dl></section>;})}
  {error?<p role="alert" className="studio-error">{error}</p>:null}
  {proposal.status==='draft'?<><div className="actions">{editing?<><Button disabled={busy} onClick={()=>void perform(async()=>{await api(base+query,{expectedVersion:proposal.version,operations:draft,reason:'직접 초안 편집'},'PATCH');setEditing(false);})} variant="default">초안 저장</Button><Button disabled={busy} onClick={()=>{setDraft(proposal.operations);setEditing(false);}} variant="outline">편집 취소</Button></>:<><Button disabled={busy} onClick={()=>void perform(()=>api(base+'/accept'+query,{expectedVersion:proposal.version,sessionId:proposal.sessionId}))} variant="default">수락</Button><Button disabled={busy} onClick={()=>void perform(()=>api(base+'/reject'+query,{expectedVersion:proposal.version,sessionId:proposal.sessionId}))} variant="outline">거절</Button><Button disabled={busy} onClick={()=>setEditing(true)} variant="ghost">초안 편집</Button></>}</div><div className="proposal-feedback"><Textarea rows={2} aria-label="제안 피드백" placeholder="수정할 점을 적어 주세요" value={feedback} onChange={event=>setFeedback(event.target.value)}/><Button disabled={busy||!feedback.trim()||editing} onClick={()=>void perform(async()=>{await api(base+'/feedback'+query,{expectedVersion:proposal.version,content:feedback,sessionId:proposal.sessionId});await onFeedback(`제안 ${proposal.id}의 피드백을 반영해서 초안을 수정해줘.\n${feedback}`);setFeedback('');})} variant="outline">피드백 보내기</Button></div></>:null}
  {proposal.feedback.length?<details><summary>피드백 {proposal.feedback.length}개</summary>{proposal.feedback.map(item=><p key={item.id}>{item.content}</p>)}</details>:null}
 </article>;
}
