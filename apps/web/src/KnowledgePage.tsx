import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Checkbox } from './components/ui/checkbox';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Textarea } from './components/ui/textarea';
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, History, RefreshCw, Save, Search } from 'lucide-react';
import type { KnowledgeItem, WorkspaceState } from '@workbench/contracts';
import type { Mutate } from './App';

const kinds: Record<KnowledgeItem['kind'], string> = { summary: '줄거리·배경', character: '인물·관계·말투', fact: '사건·증거', rule: '번역 규칙' };
const visibility = { translator: '번역자 참고', character: '등장인물 지식', player: '플레이어 공개' };
type KnowledgeDraft = { title: string; content: string; version: number };
export function KnowledgePage({ state, selectedId, onSelect, navigateUnit, mutate, busy, onDirtyChange, onRecheck, focusRequest, onPeople }: {
  state: WorkspaceState; selectedId: string; onSelect: (id: string) => void; navigateUnit: (id: string) => void; mutate: Mutate; busy: boolean; onDirtyChange?: (dirty: boolean) => void; onRecheck?: (unitIds: string[]) => void; focusRequest?: { id: string; token: number };
  onPeople?:()=>void;
}) {
  const [drafts, setDrafts] = useState<Record<string, KnowledgeDraft>>({});
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const setDraft = (id: string, draft?: KnowledgeDraft) => setDrafts(previous => { const next = { ...previous }; if (draft) next[id] = draft; else delete next[id]; return next; });
  type LibraryFilters = { search: string; kind: string; archived: boolean };
  const filterKey = String(focusRequest?.token ?? 0);
  const [filters, setFilters] = useState<Record<string, LibraryFilters>>({});
  const defaults: LibraryFilters = { search: '', kind: 'all', archived: !!focusRequest && !!state.knowledge.find(entry => entry.id === focusRequest.id)?.archived };
  const { search, kind, archived } = filters[filterKey] ?? defaults;
  const patchFilters = (value: Partial<LibraryFilters>) => {
    setFilters(previous => { const next = { ...previous, [filterKey]: { ...(previous[filterKey] ?? defaults), ...value } }; const retained = Object.keys(next).filter(key => key !== '0' && key !== filterKey).slice(-28); return Object.fromEntries([...new Set(['0', filterKey, ...retained])].filter(key => key in next).map(key => [key, next[key]])); });
    onSelect('');
  };
  const setSearch = (search: string) => patchFilters({ search });
  const setKind = (kind: string) => patchFilters({ kind });
  const setArchived = (archived: boolean) => patchFilters({ archived });
  const items = useMemo(() => state.knowledge.filter(item => (archived || !item.archived) && (kind === 'all' || item.kind === kind) && `${item.title} ${item.content} ${item.branch}`.toLowerCase().includes(search.toLowerCase())), [state.knowledge, search, kind, archived]);
  const item = items.find(item => item.id === selectedId) ?? items[0];
  return <main className="content-page knowledge-library">
    <div className="page-heading"><h1>작품 자료</h1><div className="actions">{onPeople?<Button onClick={onPeople} variant="outline">인물·관계</Button>:null}<Badge variant="outline">현재 자료 {state.knowledge.filter(item => !item.archived).length}개</Badge></div></div>
    <div className="library-filters"><label className="search-field"><Search size={14} /><Input aria-label="작품 자료 검색" placeholder="제목, 내용, 분기 검색" value={search} onChange={event => setSearch(event.target.value)} /></label><NativeSelect aria-label="자료 분류" value={kind} onChange={event => setKind(event.target.value)}><NativeSelectOption value="all">전체 분류</NativeSelectOption>{Object.entries(kinds).map(([id, label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}</NativeSelect><label><Checkbox checked={archived} onCheckedChange={event => setArchived((event === true))} />이전 분석 자료 포함</label>{dirty ? <span className="draft-indicator">저장 전 편집 {Object.keys(drafts).length}개</span> : null}</div>
    {item ? <div className="knowledge-layout"><Card asChild><aside className="term-menu" aria-label="작품 자료 목록">{items.map(entry => <Button key={entry.id} className={entry.id === item.id ? 'active' : ''} onClick={() => onSelect(entry.id)} variant="ghost"><strong>{entry.title}</strong>{drafts[entry.id] ? <small className="draft-indicator">저장 전 편집</small> : null}<span>{kinds[entry.kind]} · v{entry.version ?? 1}{entry.archived ? ' · 보관됨' : ''}</span><small>{entry.branch} · {visibility[entry.visibility]}</small></Button>)}</aside></Card><KnowledgeEditor key={item.id} item={item} state={state} navigateUnit={navigateUnit} mutate={mutate} busy={busy} draft={drafts[item.id]} setDraft={draft => setDraft(item.id, draft)} onRecheck={onRecheck} /></div> : <div className="empty-state"><BookOpen size={30} /><h2>표시할 자료가 없습니다.</h2><p>검색·분류 조건을 조정하거나 이전 분석 자료를 포함해 보세요. 작품 분석·인물 분석 결과도 이곳에 저장됩니다.</p></div>}
  </main>;
}

function KnowledgeEditor({ item, state, navigateUnit, mutate, busy, draft, setDraft, onRecheck }: { item: KnowledgeItem; state: WorkspaceState; navigateUnit: (id: string) => void; mutate: Mutate; busy: boolean; draft?: KnowledgeDraft; setDraft: (draft?: KnowledgeDraft) => void; onRecheck?: (unitIds: string[]) => void }) {
  const patch = (field: 'title' | 'content', value: string) => setDraft({ title: draft?.title ?? item.title, content: draft?.content ?? item.content, version: draft?.version ?? item.version ?? 1, [field]: value });
  const save = async () => { if (draft && await mutate(`/knowledge/${encodeURIComponent(item.id)}`, { title: draft.title, content: draft.content, expectedVersion: draft.version }, 'PATCH', '자료를 저장하고 사용된 번역에 재검토 표시를 남겼습니다.')) setDraft(undefined); };
  const staleIds = [...new Set([...item.evidenceIds, ...(item.usedUnitIds ?? [])])].filter(id => state.translations[id]?.freshness === 'stale');
  const restore = (version: number) => void mutate(`/knowledge/${encodeURIComponent(item.id)}/restore`, { version, expectedVersion: item.version ?? 1 }, 'POST', '선택한 내용을 새 버전으로 복원했습니다.');
  const units = new Map(state.units.map(unit => [unit.id, unit]));
  const links = (ids: string[]) => <div className="evidence-list">{ids.map(id => { const unit = units.get(id); return <Button key={id} className="evidence-link" disabled={!unit} onClick={() => navigateUnit(id)} variant="ghost"><strong>{unit?.speaker || id}</strong><span>{unit?.source ?? id}</span><small>{state.groups.find(group => group.id === unit?.groupId)?.title}</small></Button>; })}</div>;
  return <Card asChild><section className="knowledge-editor">
    <div className="page-heading"><div><Badge variant="outline">{kinds[item.kind]}</Badge> <Badge variant="outline">v{item.version ?? 1}</Badge>{item.archived ? <Badge variant="warning">이전 분석 · 보관됨</Badge> : null}</div><div className="actions">{item.archived ? <Button disabled={busy || !!draft} onClick={() => restore(item.version ?? 1)} variant="outline">현재 내용 복원</Button> : null}<Button disabled={busy || !draft || item.archived || !draft.title.trim() || !draft.content.trim()} onClick={() => void save()} variant="default"><Save size={13} />새 버전 저장</Button>{draft ? <Button onClick={() => setDraft(undefined)} variant="ghost">수정 취소</Button> : null}</div></div>
    <div className="knowledge-meta"><span>분기 <strong>{item.branch}</strong></span><span>공개 범위 <strong>{visibility[item.visibility]}</strong></span><span>사용된 원문 <strong>{item.usedUnitIds?.length ?? 0}개</strong></span></div>
    {draft && draft.version !== (item.version ?? 1) ? <p className="notice">다른 작업에서 새 버전이 저장되었습니다. 내용을 비교한 뒤 편집을 다시 시작하세요.<Button onClick={() => setDraft(undefined)} variant="outline" size="sm">최신 버전 불러오기</Button></p> : null}
    <label className="field">제목<Input disabled={busy || item.archived} value={draft?.title ?? item.title} onChange={event => patch('title', event.target.value)} /></label>
    <label className="field">자료 내용<Textarea rows={9} disabled={busy || item.archived} value={draft?.content ?? item.content} onChange={event => patch('content', event.target.value)} /></label>
    {item.provenance ? <p className="subtext">생성 모델 {item.provenance.model ?? '기록 없음'} · 프롬프트 v{item.provenance.promptVersion ?? 1} · 실행 {item.provenance.runId ?? '기록 없음'}</p> : <p className="subtext">가져온 자료 · 생성 실행 정보 없음</p>}
    <div className="scope-summary"><strong>연결 원문의 재검토 필요 {staleIds.length}개</strong><span>자료 저장은 재검토 표시를 남깁니다. 아래 작업은 근거 원문과 사용된 번역을 함께 확인합니다.</span><Button disabled={busy || !staleIds.length || !!draft} onClick={() => onRecheck ? onRecheck(staleIds) : void mutate('/runs', { kind: 'recheck', unitIds: staleIds }, 'POST', '자료와 연결된 원문을 재검토합니다.')} variant="outline"><RefreshCw size={13} />연결 원문 {staleIds.length}개 재검토</Button></div>
    <h3>근거 원문 · {item.evidenceIds.length}개</h3>{links(item.evidenceIds)}
    {item.usedUnitIds?.length ? <details><summary>이 자료를 사용한 번역 {item.usedUnitIds.length}개</summary>{links(item.usedUnitIds)}</details> : null}
    <details className="knowledge-history"><summary><History size={14} />버전 이력 {item.history?.length ?? 0}개</summary>{item.history?.length ? [...item.history].reverse().map(version => <article key={version.version}><div className="page-heading"><strong>v{version.version} · {version.title}</strong><Button disabled={busy || !!draft} onClick={() => restore(version.version)} variant="outline" size="sm">이 내용으로 복원</Button></div><small>{new Date(version.createdAt).toLocaleString('ko-KR')} · {version.reason}</small><p>{version.content}</p></article>) : <p className="subtext">이전 버전 기록이 없습니다.</p>}</details>
  </section></Card>;
}



