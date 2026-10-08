import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { RadioGroup, RadioGroupItem } from './components/ui/radio-group';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, Link2, Plus, RefreshCw, Save, Search } from 'lucide-react';
import type { Term, TermCandidate, TermUsage, WorkspaceState } from '@workbench/contracts';
import type { Mutate } from './App';
import { termCandidates } from './term-candidates';
import './glossary-candidates.css';

type CandidateDraft = Pick<TermCandidate, 'id' | 'target' | 'guidance' | 'isDefault' | 'enabled'> & { isNew?: boolean };
type TermDraft = { description: string; candidates: CandidateDraft[]; version: number };
type UsageRecord = { unitId: string; usage: TermUsage };
const candidateLetter = (index: number) => index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
const originLabel = (origin: TermUsage['origin']) => origin === 'model' ? 'AI 선택' : origin === 'observed' ? '번역에서 관측' : '기존 번역에서 추출';

export function GlossaryPage({ state, selectedId, onSelect, navigateUnit, mutate, busy, onDirtyChange, onRecheck, focusRequest }: { state: WorkspaceState; selectedId: string; onSelect: (id: string) => void; navigateUnit: (id: string) => void; mutate: Mutate; busy: boolean; onDirtyChange?: (dirty: boolean) => void; onRecheck?: (unitIds: string[]) => void; focusRequest?: { id: string; token: number } }) {
  const filterKey = String(focusRequest?.token ?? 0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const search = filters[filterKey] ?? '';
  const setSearch = (value: string) => {
    setFilters(previous => { const next = { ...previous, [filterKey]: value }; const retained = Object.keys(next).filter(key => key !== '0' && key !== filterKey).slice(-28); return Object.fromEntries([...new Set(['0', filterKey, ...retained])].filter(key => key in next).map(key => [key, next[key]])); });
    onSelect('');
  };
  // Selection changes only replace the editor; these drafts remain mounted across tabs.
  const [drafts, setDrafts] = useState<Record<string, TermDraft>>({});
  const [adding, setAdding] = useState(false);
  const [newTerm, setNewTerm] = useState({ source: '', target: '', guidance: '' });
  const [createdSource, setCreatedSource] = useState<string | null>(null);
  const newDirty = !!(newTerm.source || newTerm.target || newTerm.guidance);
  const dirty = Object.keys(drafts).length > 0 || newDirty;
  useEffect(() => { if (focusRequest) setAdding(false); }, [focusRequest?.token]);
  useEffect(() => {
    if (!createdSource) return;
    const created = state.terms.find(item => item.source === createdSource);
    if (created) { onSelect(created.id); setCreatedSource(null); }
  }, [createdSource, state.terms, onSelect]);
  const create = async () => {
    const source = newTerm.source.trim();
    if (await mutate('/terms', newTerm, 'POST', '용어를 추가했습니다. 일치하는 원문과 기존 번역의 사용 기록을 연결했습니다.')) {
      setFilters(previous => ({ ...previous, [filterKey]: '' }));
      setCreatedSource(source); setNewTerm({ source: '', target: '', guidance: '' }); setAdding(false);
    }
  };
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const usageIndex = useMemo(() => {
    const result = new Map<string, UsageRecord[]>();
    for (const translation of Object.values(state.translations)) for (const usage of translation.termUsages ?? []) {
      const records = result.get(usage.termId) ?? [];
      records.push({ unitId: translation.unitId, usage }); result.set(usage.termId, records);
    }
    return result;
  }, [state.translations]);
  const items = state.terms.filter(item => `${item.source} ${item.description} ${item.aliases.join(' ')} ${termCandidates(item).map(candidate => `${candidate.target} ${candidate.guidance}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const term = items.find(item => item.id === selectedId) ?? items[0];
  const setDraft = (id: string, draft: TermDraft | null) => setDrafts(previous => { const next = { ...previous }; if (draft) next[id] = draft; else delete next[id]; return next; });
  return <main className="content-page glossary-candidates">
    <div className="page-heading"><div><h1>용어집</h1><p>기본 번역과 문맥에 따른 후보를 정합니다. 후보를 바꾸면 그 후보를 실제 사용한 번역에 재검토 표시가 남습니다.</p></div><Button disabled={busy} onClick={() => setAdding(true)} variant="outline"><Plus size={13} />{newDirty ? '추가 중인 용어' : '용어 추가'}</Button></div>
    <div className="library-filters"><label className="search-field"><Search size={14} /><Input aria-label="용어 검색" placeholder="원어, 번역, 별칭 검색" value={search} onChange={event => setSearch(event.target.value)} /></label>{dirty ? <span className="draft-indicator">저장 전 편집 {Object.keys(drafts).length + (newDirty ? 1 : 0)}개 · 화면 이동 시 유지</span> : null}</div>
    {term || adding ? <div className="knowledge-layout">
      <Card asChild><aside className="term-menu" aria-label="용어 목록">{items.map(item => <Button className={!adding && item.id === term?.id ? 'active' : ''} aria-pressed={!adding && item.id === term?.id} key={item.id} onClick={() => { setAdding(false); onSelect(item.id); }} variant="ghost"><strong>{item.source}</strong>{drafts[item.id] ? <small className="draft-indicator">저장 전 편집</small> : null}<span>{item.target || '기본 번역 미정'}</span><span className="gc-menu-meta">실제 사용 {new Set(usageIndex.get(item.id)?.map(record => record.unitId)).size}개 · v{item.version}</span></Button>)}</aside></Card>
      {adding ? <Card asChild><form className="term-detail gc-create" onSubmit={event => { event.preventDefault(); void create(); }}>
        <div className="page-heading gc-heading"><div><h2>용어 추가</h2><p className="subtext">원어가 일치하는 원문에 자동으로 연결됩니다. 기존 번역은 그대로 유지됩니다.</p></div></div>
        <label className="field">원어 <span className="subtext">필수</span><Input autoFocus required maxLength={500} disabled={busy} value={newTerm.source} onChange={event => setNewTerm(previous => ({ ...previous, source: event.target.value }))} placeholder="예: Watch Office" /></label>
        <label className="field">기본 번역 <span className="subtext">필수</span><Input required maxLength={500} disabled={busy} value={newTerm.target} onChange={event => setNewTerm(previous => ({ ...previous, target: event.target.value }))} placeholder="기본으로 사용할 번역" /></label>
        <label className="field">사용 지침 <span className="subtext">선택</span><Textarea rows={4} maxLength={10000} disabled={busy} value={newTerm.guidance} onChange={event => setNewTerm(previous => ({ ...previous, guidance: event.target.value }))} placeholder="의미와 적용할 문맥을 적으세요" /></label>
        <div className="actions"><Button disabled={busy || !newTerm.source.trim() || !newTerm.target.trim()} type="submit" variant="default"><Save size={13} />용어 추가 저장</Button><Button type="button" disabled={busy} onClick={() => { setNewTerm({ source: '', target: '', guidance: '' }); setAdding(false); }} variant="ghost">추가 취소</Button></div>
      </form></Card> : term ? <TermEditor key={term.id} term={term} state={state} usages={usageIndex.get(term.id) ?? []} navigateUnit={navigateUnit} mutate={mutate} busy={busy} draft={drafts[term.id] ?? null} setDraft={draft => setDraft(term.id, draft)} onRecheck={onRecheck} /> : null}
    </div> : <div className="empty-state"><BookOpen size={30} /><h2>표시할 용어가 없습니다.</h2><p>검색어를 지우거나 용어 추출 작업을 실행하세요.</p></div>}
  </main>;
}

function TermEditor({ term, state, usages, navigateUnit, mutate, busy, draft, setDraft, onRecheck }: { term: Term; state: WorkspaceState; usages: UsageRecord[]; navigateUnit: (id: string) => void; mutate: Mutate; busy: boolean; draft: TermDraft | null; setDraft: (draft: TermDraft | null) => void; onRecheck?: (unitIds: string[]) => void }) {
  const [usageFilter, setUsageFilter] = useState('used');
  const [shownEvidence, setShownEvidence] = useState<Record<string, boolean>>({});
  const [usageLimit, setUsageLimit] = useState(30);
  const savedCandidates = termCandidates(term);
  const candidates: CandidateDraft[] = draft?.candidates ?? savedCandidates;
  const description = draft?.description ?? term.description;
  const savedById = new Map(savedCandidates.map(candidate => [candidate.id, candidate]));
  const getDraft = (): TermDraft => draft ?? { description: term.description, candidates: savedCandidates.map(({ id, target, guidance, isDefault, enabled }) => ({ id, target, guidance, isDefault, enabled })), version: term.version };
  const updateCandidates = (update: (previous: CandidateDraft[]) => CandidateDraft[]) => { const previous = getDraft(); setDraft({ ...previous, candidates: update(previous.candidates) }); };
  const editCandidate = (id: string, field: 'target' | 'guidance', value: string) => updateCandidates(previous => previous.map(candidate => candidate.id === id ? { ...candidate, [field]: value } : candidate));
  const chooseDefault = (id: string) => updateCandidates(previous => previous.map(candidate => ({ ...candidate, isDefault: candidate.id === id })));
  const toggleCandidate = (id: string) => updateCandidates(previous => {
    const selected = previous.find(candidate => candidate.id === id);
    const replacement = selected?.isDefault ? previous.find(candidate => candidate.id !== id && candidate.enabled)?.id : undefined;
    return previous.map(candidate => candidate.id === id ? { ...candidate, enabled: !candidate.enabled, isDefault: candidate.enabled ? false : candidate.isDefault || !previous.some(item => item.enabled) } : replacement ? { ...candidate, isDefault: candidate.id === replacement } : candidate);
  });
  const addCandidate = () => updateCandidates(previous => [...previous, { id: `new:${crypto.randomUUID()}`, target: '', guidance: '', isDefault: !previous.some(candidate => candidate.enabled), enabled: true, isNew: true }]);
  const changedIds = new Set(candidates.filter(candidate => {
    const saved = savedById.get(candidate.id);
    return saved && (candidate.target.trim() !== saved.target || candidate.guidance.trim() !== saved.guidance || candidate.enabled !== saved.enabled);
  }).map(candidate => candidate.id));
  const descriptionChanged = description.trim() !== term.description;
  const impactedIds = new Set(usages.filter(record => descriptionChanged || changedIds.has(record.usage.candidateId)).map(record => record.unitId));
  const activeCandidates = candidates.filter(candidate => candidate.enabled && candidate.target.trim());
  const validationError = candidates.some(candidate => candidate.isNew && !candidate.target.trim()) ? '새 후보의 번역을 입력하거나 후보를 취소하세요.' : activeCandidates.length > 0 && !activeCandidates.some(candidate => candidate.isDefault) ? '사용할 번역 후보 중 하나를 기본으로 지정하세요.' : '';
  const invalid = !!validationError;
  const isStaleUsage = (record: UsageRecord) => {
    const saved = savedById.get(record.usage.candidateId);
    return !saved || !saved.enabled || !saved.target.trim() || record.usage.candidateVersion !== saved.version;
  };
  const staleIds = [...new Set(usages.filter(isStaleUsage).map(record => record.unitId))];
  const filteredUsages = usageFilter === 'linked' ? usages : usages.filter(record => usageFilter === 'used' || record.usage.candidateId === usageFilter);
  const displayedIds = new Set(usageFilter === 'linked' ? term.unitIds : filteredUsages.map(record => record.unitId));
  const occurrences = state.units.filter(unit => displayedIds.has(unit.id));
  const filteredStaleIds = [...new Set(filteredUsages.filter(isStaleUsage).map(record => record.unitId))];
  const groupTitles = new Map(state.groups.map(group => [group.id, group.title]));
  const save = async () => {
    const saved = await mutate(`/terms/${encodeURIComponent(term.id)}`, { description, candidates: candidates.map(candidate => ({ ...(candidate.isNew ? {} : { id: candidate.id }), target: candidate.target, guidance: candidate.guidance, isDefault: candidate.isDefault, enabled: candidate.enabled })), autoRecheck: false, expectedVersion: draft?.version ?? term.version }, 'PATCH', `용어를 저장했습니다. 실제 사용 번역 ${impactedIds.size}개에 재검토 표시를 남겼습니다.`);
    if (saved) { setDraft(null); if (usageFilter.startsWith('new:')) setUsageFilter('used'); }
  };
  const recheck = (ids: string[]) => onRecheck ? onRecheck(ids) : void mutate('/runs', { kind: 'recheck', unitIds: ids }, 'POST', '선택한 후보의 사용처를 재검토합니다.');
  return <Card asChild><section className="term-detail">
    <div className="page-heading gc-heading"><div><h2>{term.source}</h2><span className="subtext">{term.id} · v{term.version}</span></div><Badge variant={term.status === 'confirmed' ? 'success' : 'warning'}>{term.status === 'confirmed' ? '확정된 용어' : '임시 용어'}</Badge></div>
    <label className="field gc-description">의미와 적용 범위<Textarea disabled={busy} value={description} onChange={event => setDraft({ ...getDraft(), description: event.target.value })} /></label>
    <div className="gc-section-heading"><h3>번역 후보</h3><Button disabled={busy} onClick={addCandidate} variant="ghost" size="sm"><Plus size={12} />후보 추가</Button></div>
    <p className="subtext gc-help">기본 후보를 먼저 사용하고, 다른 후보는 사용 지침에 맞는 문맥에서 선택합니다.</p>
    <RadioGroup className="gc-candidate-list" value={candidates.find(candidate => candidate.isDefault)?.id} onValueChange={chooseDefault}>{candidates.map((candidate, index) => {
      const saved = savedById.get(candidate.id);
      const candidateUsages = usages.filter(record => record.usage.candidateId === candidate.id);
      const usageCount = new Set(candidateUsages.map(record => record.unitId)).size;
      const staleCount = new Set(candidateUsages.filter(isStaleUsage).map(record => record.unitId)).size;
      const evidence = saved?.evidence ?? [];
      return <article key={candidate.id} className={`gc-candidate ${candidate.enabled ? '' : 'disabled'}`}>
        <div className="gc-candidate-heading"><strong>후보 {candidateLetter(index)}</strong>{candidate.isDefault ? <Badge variant="success">기본</Badge> : null}{!candidate.enabled ? <Badge variant="outline">사용 중지</Badge> : saved?.status === 'provisional' || candidate.isNew ? <Badge variant="warning">임시 후보</Badge> : null}<span className="gc-version">{saved ? `v${saved.version}` : '새 후보'}</span><Button className="gc-text-button" disabled={busy} onClick={() => candidate.isNew ? updateCandidates(previous => previous.filter(item => item.id !== candidate.id)) : toggleCandidate(candidate.id)} variant="ghost">{candidate.isNew ? '후보 취소' : candidate.enabled ? '사용 중지' : '복원'}</Button></div>
        {candidate.enabled ? <div className="gc-candidate-fields"><label className="field">번역<Input aria-label={`후보 ${candidateLetter(index)} 번역`} disabled={busy} value={candidate.target} onChange={event => editCandidate(candidate.id, 'target', event.target.value)} placeholder="번역 후보를 입력하세요" /></label><label className="field">사용 지침<Textarea aria-label={`후보 ${candidateLetter(index)} 사용 지침`} disabled={busy} rows={2} value={candidate.guidance} onChange={event => editCandidate(candidate.id, 'guidance', event.target.value)} placeholder="어떤 문맥에서 이 후보를 사용할지 적으세요" /></label></div> : <p className="gc-disabled-copy"><strong>{candidate.target}</strong>{candidate.guidance ? <span>{candidate.guidance}</span> : null}</p>}
        <div className="gc-candidate-footer">{candidate.enabled ? <label className="gc-default-choice"><RadioGroupItem value={candidate.id} disabled={busy} />기본으로 사용</label> : null}<Button className="gc-text-button" aria-pressed={usageFilter === candidate.id} onClick={() => { setUsageFilter(candidate.id); setUsageLimit(30); }} variant="ghost">실제 사용 {usageCount}개{staleCount ? ` · 재검토 ${staleCount}개` : ''}</Button>{evidence.length ? <Button className="gc-text-button" aria-expanded={!!shownEvidence[candidate.id]} onClick={() => setShownEvidence(previous => ({ ...previous, [candidate.id]: !previous[candidate.id] }))} variant="ghost">추출 근거 {evidence.length}개 {shownEvidence[candidate.id] ? '접기' : '보기'}</Button> : null}</div>
        {draft && changedIds.has(candidate.id) ? <p className="gc-impact">저장하면 이 후보의 실제 사용 {usageCount}개를 재검토 대상으로 표시합니다.</p> : null}
        {shownEvidence[candidate.id] ? <div className="gc-evidence">{evidence.map((item, evidenceIndex) => <div key={`${item.unitId}:${item.translationVersion}:${evidenceIndex}`}><Button className="gc-text-button" onClick={() => navigateUnit(item.unitId)} variant="ghost">{item.unitId} · 번역 v{item.translationVersion}<ArrowUpRight size={11} /></Button><p><span>원문</span>{item.sourceText}</p><p><span>번역</span>{item.targetText}</p></div>)}</div> : null}
      </article>;
    })}</RadioGroup>
    <div className="gc-save"><div className="actions"><Button disabled={busy || !draft || invalid} onClick={() => void save()} variant="default"><Save size={13} />용어 저장</Button>{draft ? <Button disabled={busy} onClick={() => setDraft(null)} variant="ghost">수정 취소</Button> : null}</div>{draft ? <p className="gc-impact" role="status">저장 시 재검토 표시: 실제 사용 번역 {impactedIds.size}개{descriptionChanged ? ' · 의미와 적용 범위 변경 포함' : ''}. 기본 선택만 바꾸면 기존 번역은 재검토 대상이 되지 않습니다.</p> : null}{invalid ? <p className="gc-impact">{validationError}</p> : null}{draft && draft.version !== term.version ? <p className="gc-impact">다른 작업에서 용어 버전이 바뀌었습니다. 저장 시 충돌을 확인하며 기존 내용을 덮어쓰지 않습니다.</p> : null}</div>
    <p className="subtext gc-aliases">별칭: {term.aliases.length ? term.aliases.join(', ') : '없음'}</p>
    <div className="gc-usage-heading"><h3 className="section-title"><Link2 size={15} />사용처 <span>재검토 필요 {staleIds.length}개</span></h3><label className="field"><NativeSelect aria-label="사용처 후보 필터" value={usageFilter} onChange={event => { setUsageFilter(event.target.value); setUsageLimit(30); }}><NativeSelectOption value="used">전체 실제 사용 {new Set(usages.map(record => record.unitId)).size}개</NativeSelectOption>{candidates.map((candidate, index) => <NativeSelectOption key={candidate.id} value={candidate.id}>후보 {candidateLetter(index)} · {candidate.target || '입력 중'}{candidate.enabled ? '' : ' (사용 중지)'}</NativeSelectOption>)}<NativeSelectOption value="linked">연결된 모든 원문 {term.unitIds.length}개</NativeSelectOption></NativeSelect></label></div>
    <div className="gc-usage-actions"><span className="subtext">표시 {occurrences.length}개 · 후보 사용 버전이 바뀐 번역 {filteredStaleIds.length}개</span><Button disabled={busy || !filteredStaleIds.length || !!draft} onClick={() => recheck(filteredStaleIds)} variant="outline" size="sm"><RefreshCw size={12} />{usageFilter === 'used' || usageFilter === 'linked' ? '사용처' : '이 후보'} {filteredStaleIds.length}개 재검토</Button></div>
    {!occurrences.length ? <p className="subtext gc-empty">현재 번역에서 이 후보를 사용한 기록이 없습니다.</p> : null}
    {occurrences.slice(0, usageLimit).map(unit => { const translation = state.translations[unit.id]; const records = filteredUsages.filter(record => record.unitId === unit.id); return <Button className="occurrence" key={unit.id} onClick={() => navigateUnit(unit.id)} variant="ghost"><span className="occ-scene">{groupTitles.get(unit.groupId)}<br /><span className="record-id">{unit.id}</span></span><span className="occ-text">{unit.source}<small>{translation?.text || '아직 번역되지 않았습니다.'}</small><span className="gc-usage-meta">{records.length ? records.map(record => { const candidate = savedById.get(record.usage.candidateId); return `${candidate?.target || '이전 후보'} · ${originLabel(record.usage.origin)} · 사용 v${record.usage.candidateVersion}`; }).join(' / ') : '용어 연결만 있음 · 실제 후보 사용 기록 없음'}</span></span>{records.some(isStaleUsage) ? <Badge variant="warning">재검토 필요</Badge> : null}<ArrowUpRight size={14} className="gc-occ-arrow" /></Button>; })}
    {occurrences.length > usageLimit ? <Button onClick={() => setUsageLimit(previous => previous + 30)} variant="ghost" size="sm">사용처 더 보기 ({usageLimit}/{occurrences.length})</Button> : null}
  </section></Card>;
}
