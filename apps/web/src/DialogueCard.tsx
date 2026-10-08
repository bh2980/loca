import { Badge } from './components/ui/badge';
import { Checkbox } from './components/ui/checkbox';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { LoaderCircle, LockKeyhole, PanelRightOpen, Save, ShieldCheck, Undo2, UnlockKeyhole } from 'lucide-react';
import type { SourceUnit, Term, Translation } from '@workbench/contracts';
import type { Mutate } from './App';

export interface Draft { text: string; baseVersion: number }
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function DialogueCard({ unit, translation, index, terms, selected, draft, onDraft, mutate, busy, activity, activityState, checked, onChecked, onSelect, onInspect }: { unit: SourceUnit; translation?: Translation; index: number; terms: Term[]; selected: boolean; draft?: Draft; onDraft: (id: string, draft?: Draft) => void; mutate: Mutate; busy: boolean; activity?: string; activityState?: 'running' | 'waiting' | 'failed'; checked?: boolean; onChecked?: (value: boolean) => void; onSelect?: () => void; onInspect?: () => void }) {
  const text = draft?.text ?? translation?.text ?? '';
  const version = translation?.version ?? 0;
  const dirty = draft !== undefined;
  const changedRemotely = dirty && draft.baseVersion !== version;
  const relevantTerms = terms.filter(term => unit.termIds.includes(term.id) && term.source).map(term => term.source);
  const regex = relevantTerms.length ? new RegExp(`(${relevantTerms.map(escapeRegex).join('|')})`, 'gi') : null;
  const source = regex ? unit.source.split(regex).map((part, i) => relevantTerms.some(term => term.toLowerCase() === part.toLowerCase()) ? <mark key={i}>{part}</mark> : part) : unit.source;
  const save = async () => {
    if (await mutate(`/units/${encodeURIComponent(unit.id)}`, { text, expectedVersion: draft?.baseVersion ?? version }, 'PATCH', '직접 수정한 번역을 저장하고 보호했습니다.')) onDraft(unit.id);
  };
  const toggleLock = () => void mutate(`/units/${encodeURIComponent(unit.id)}`, { locked: !translation?.locked, expectedVersion: version }, 'PATCH', translation?.locked ? '자동 수정 보호를 해제했습니다.' : '자동 수정으로부터 보호했습니다.');
  const statusLabel = translation?.freshness === 'stale' ? '갱신 필요' : translation?.status === 'checked' ? `${translation.origin === 'demo' || translation.execution?.demo ? '모의' : translation.origin === 'manual' ? '직접' : 'AI'} 확인` : translation?.status === 'draft' ? '초안' : '번역 대기';
  return <article id={`unit-${unit.id}`} className={`line-card ${selected ? 'selected' : ''} ${activity ? 'has-activity' : ''} ${activity && activityState === 'failed' ? 'activity-failed' : ''}`} aria-label={`${unit.id} ${unit.speaker || unit.kind}`} onFocusCapture={() => { if (!selected) onSelect?.(); }}>
    {activity ? <div className="line-activity">{activityState === 'running' ? <LoaderCircle size={12} className="spinning" /> : null}{activity}<span>이 원문이 현재 단계의 대상입니다.</span></div> : null}
    <div className="line-head"><span className="line-index">{String(index + 1).padStart(2, '0')}</span><span className={`avatar ${(unit.speaker || '').toLowerCase()}`}>{unit.speaker?.slice(0, 1) || (unit.kind === 'document' ? 'D' : 'UI')}</span><span className="speaker">{unit.speaker || (unit.kind === 'document' ? '문서' : 'UI 문구')}</span><span className="record-id">{unit.id}</span><div className="line-state">{translation?.locked ? <Badge variant="outline" title="사람이 수정한 번역은 AI가 덮어쓰지 않습니다."><LockKeyhole size={9} />보호됨</Badge> : null}<Badge variant={translation?.freshness === 'stale' ? 'warning' : translation?.status === 'checked' ? 'success' : 'outline'}>{statusLabel}</Badge></div></div>
    {onChecked || onInspect ? <div className="ux-line-tools">{onChecked ? <label><Checkbox checked={!!checked} onCheckedChange={event => onChecked((event === true))} aria-label={`${unit.id} 실행 대상으로 체크`} />실행 대상으로 체크</label> : null}{onInspect ? <Button onClick={onInspect} variant="ghost" size="sm"><PanelRightOpen size={12} />문맥·변경 검토</Button> : null}</div> : null}
    {unit.branch !== 'common' || unit.contextNotes?.length ? <p className="subtext">{unit.branch === 'unknown' ? '분기 미분류' : unit.branch === 'common' ? '공통 구간' : `분기: ${unit.branch}`}{unit.contextNotes?.length ? ` · ${unit.contextNotes.join(' · ')}` : ''}</p> : null}
    <p className="source-line" lang={unit.sourceLanguage || 'en'}>{source}</p>
    <Textarea className="translation-input" aria-label={`${unit.id} 한국어 번역`} placeholder="번역을 실행하거나 직접 입력하세요." value={text} onChange={event => onDraft(unit.id, { text: event.target.value, baseVersion: draft?.baseVersion ?? version })} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && dirty && !busy) { event.preventDefault(); void save(); } }} rows={Math.max(2, Math.min(6, text.split('\n').length + 1))} />
    {changedRemotely ? <p className="subtext" style={{ color: 'var(--amber)' }}>편집하는 동안 저장된 버전이 변경됐습니다. 입력 내용은 보존됩니다. 되돌리기로 최신 번역을 확인할 수 있습니다.</p> : null}
    {translation?.qa.length ? <p className="subtext" style={{ color: 'var(--amber)' }}>{translation.qa.map(issue => issue.message).join(' · ')}</p> : null}
    <div className="line-foot"><span className="meta">{dirty ? <span style={{ color: 'var(--amber)' }}>저장하지 않은 수정</span> : <><ShieldCheck size={11} />{translation?.origin === 'manual' ? '직접 수정' : translation?.execution?.demo || translation?.origin === 'demo' ? '모의 결과' : translation?.origin === 'ai' ? 'AI 번역' : '아직 번역 없음'}{version > 0 ? ` · v${version}` : ''}</>}{!dirty && translation?.execution ? <span title={`${translation.execution.model} · ${translation.execution.effort}`}>{translation.execution.model}</span> : null}</span><div className="line-actions">{dirty ? <><Button onClick={() => onDraft(unit.id)} variant="ghost" size="sm"><Undo2 size={11} />되돌리기</Button><Button disabled={busy || changedRemotely} title="Ctrl+Enter" onClick={() => void save()} variant="default" size="sm"><Save size={11} />저장</Button></> : version > 0 ? <Button onClick={toggleLock} disabled={busy} aria-label={`${unit.id} ${translation?.locked ? '보호 해제' : '번역 보호'}`} title={translation?.locked ? '자동 수정 보호 해제' : '자동 수정 보호'} variant="ghost" size="icon-sm">{translation?.locked ? <UnlockKeyhole size={12} /> : <LockKeyhole size={12} />}</Button> : null}</div></div>
    {!onInspect && translation?.history.length ? <details style={{ marginTop: 8 }}><summary className="subtext" style={{ cursor: 'pointer', fontSize: 9 }}>변경 이력 {translation.history.length}개</summary>{[...translation.history].reverse().map(item => <div key={item.version} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><span className="record-id">v{item.version} · {item.origin === 'manual' ? '직접 수정' : item.origin === 'demo' ? '모의 결과' : 'AI'} · {new Date(item.createdAt).toLocaleString('ko-KR')}</span><p className="subtext" style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{item.text}</p><span className="subtext" style={{ fontSize: 9 }}>{item.reason}</span></div>)}</details> : null}
  </article>;
}
