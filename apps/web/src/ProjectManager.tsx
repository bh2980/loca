import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Input } from './components/ui/input';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FolderOpen, Upload } from 'lucide-react';
import type { WorkspaceState } from '@workbench/contracts';
import { api, apiPath } from './api';
import type { Mutate } from './App';
import { Modal } from './Modal';

type ProjectSummary = { id: string; title: string; unitCount: number; updatedAt: string; current: boolean };
export function ProjectManager({ state, mutate, busy, onClose, onChanged, canLeave }: { state: WorkspaceState; mutate: Mutate; busy: boolean; onClose: () => void; onChanged: () => void; canLeave: () => boolean }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [mode, setMode] = useState<'new' | 'update' | 'restore'>('new');
  const [incoming, setIncoming] = useState<{ data: unknown; title: string; count: number; name: string; mode: 'new' | 'update' | 'restore'; projectId: string }>();
  const [reading, setReading] = useState(false);
  const readToken = useRef(0);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const active = state.runs.some(run => ['queued','running','paused'].includes(run.status)) || state.taskTests?.some(test => ['queued','running'].includes(test.status));
  useEffect(() => { let live = true; api<ProjectSummary[]>('/projects').then(result => { if (live) setProjects(result); }).catch(error => { if (live) setError(error.message); }); return () => { live = false; }; }, [state.project.id]);
  const load = async (file?: File) => {
    if (!file) return;
    const token = ++readToken.current;
    setIncoming(undefined); setError(''); setReading(true);
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('64 MiB 이하의 JSON을 선택하세요.');
      const data = JSON.parse(await file.text());
      if (readToken.current !== token) return;
      const backup = data.format === 'translation-workbench-backup';
      if ((mode === 'restore') !== backup) throw new Error(mode === 'restore' ? '작업 백업 파일을 선택하세요. 번역 결과 JSON은 백업이 아닙니다.' : '작업 백업은 ‘백업 복원’에서 열어 주세요.');
      const project = backup ? data.data : data;
      if (!project?.project?.id || !Array.isArray(project.units)) throw new Error('프로젝트 정보와 원문이 포함된 파일이 필요합니다.');
      if (mode === 'update' && project.project.id !== state.project.id) throw new Error('현재 작품과 ID가 다른 파일입니다. 새 작품 가져오기를 사용하세요.');
      if (mode === 'new' && project.project.id === state.project.id) throw new Error('현재 작품과 같은 ID입니다. 원문 갱신을 사용하세요.');
      if (mode === 'new' && projects.some(item => item.id === project.project.id)) throw new Error('이미 보관된 작품입니다. 프로젝트 목록에서 연 뒤 원문 갱신을 사용하세요.');
      if (!backup && data.translations) throw new Error('번역 결과 내보내기는 패치용 파일입니다. 작업을 이어가려면 작업 백업을 복원하세요.');
      setIncoming({ data, title: project.project.title, count: project.units.length, name: file.name, mode, projectId:project.project.id });
    } catch (error) { if (readToken.current === token) setError(error instanceof Error ? error.message : '파일을 읽지 못했습니다.'); }
    finally { if (readToken.current === token) { setReading(false); if (fileInput.current) fileInput.current.value = ''; } }
  };
  const commit = async () => {
    if (!incoming || reading) return;
    if (incoming.mode !== mode || mode === 'update' && incoming.projectId !== state.project.id || mode === 'new' && incoming.projectId === state.project.id) { setError('가져오기 종류 또는 대상이 바뀌었습니다. 파일을 다시 선택하세요.'); return; }
    if (!canLeave()) return;
    if (await mutate(mode === 'restore' ? '/project/restore' : '/project/import', incoming.data, 'POST', mode === 'restore' ? '작업 백업을 복원했습니다.' : '원문을 가져왔습니다. 이전 작품은 프로젝트 목록에 보관됩니다.')) onChanged();
  };
  const open = async (id: string) => { if (canLeave() && await mutate(`/projects/${encodeURIComponent(id)}/open`, {}, 'POST', '보관된 프로젝트를 열었습니다.')) onChanged(); };
  const stale = Object.values(state.translations).filter(item => item.freshness === 'stale').length;
  const untranslated = state.units.filter(unit => !state.translations[unit.id]?.text).length;
  return <Modal title="프로젝트 관리" onClose={onClose} wide>
    <p className="subtext">프로젝트를 전환하면 현재 작업은 자동으로 보관됩니다. 원본 게임 파일과 별도로 작업합니다.</p>
    {active ? <p className="notice">실행·시험을 마치거나 취소한 뒤 프로젝트를 전환할 수 있습니다.</p> : null}
    <div className="project-manager-grid"><section><h3>보관된 프로젝트</h3><div className="project-list">{projects.map(project => <Button className="project-entry" disabled={busy || active || project.current} key={project.id} onClick={() => void open(project.id)} variant="ghost"><FolderOpen size={16} /><span><strong>{project.title}</strong><small>{project.unitCount}개 원문{project.current ? ' · 현재 작업' : ''}</small></span></Button>)}</div>
      <h3>가져오기</h3><label className="field">가져오기 종류<NativeSelect value={mode} disabled={reading} onChange={event => { readToken.current++; setMode(event.target.value as typeof mode); setIncoming(undefined); setError(''); }}><NativeSelectOption value="new">새 작품 가져오기</NativeSelectOption><NativeSelectOption value="update">현재 작품의 원문 갱신</NativeSelectOption><NativeSelectOption value="restore">작업 백업 복원</NativeSelectOption></NativeSelect></label>
      <p className="subtext">{mode === 'update' ? '동일한 원문 ID의 번역을 보존합니다. 원문·문맥이 바뀐 번역은 재검토 대상으로 표시됩니다.' : mode === 'restore' ? '번역·용어·작품 자료·검토·실행 이력을 복원합니다. 현재 AI 연결 설정을 유지합니다.' : '현재 작품을 보관한 뒤 표준 포맷의 새 작품을 엽니다.'}</p>
      <Input ref={fileInput} type="file" accept=".json,application/json" aria-label="프로젝트 파일 선택" hidden onChange={event => void load(event.target.files?.[0])} />
      <Button disabled={busy || active || reading} onClick={() => fileInput.current?.click()} variant="outline"><Upload size={14} />JSON 파일 선택</Button>
      {incoming ? <div className="import-preview"><strong>{incoming.title}</strong><p>{incoming.count}개 원문 · {incoming.name}</p><Button disabled={busy || active || reading} onClick={() => void commit()} variant="default">{mode === 'restore' ? '이 백업 복원' : mode === 'update' ? '원문 갱신 적용' : '새 작품 열기'}</Button></div> : null}
      {error ? <p role="alert" className="notice">{error}</p> : null}
    </section><section><h3>현재 작업 내보내기</h3><div className="export-choice"><strong>작업 백업</strong><p>다시 열어 작업을 이어갈 수 있는 복원용 파일입니다. AI 연결 주소·키와 작업 설정은 포함하지 않습니다.</p><Button asChild variant="outline"><a href={apiPath('/project/backup')} download><ArrowDownToLine size={14} />작업 백업 다운로드</a></Button></div><div className="export-choice"><strong>번역 결과</strong><p>패치 제작에 사용하는 원문·번역 목록입니다. 작업 복원에는 작업 백업을 사용하세요.</p><div className="scope-summary"><span>미번역 {untranslated} · 재검토 필요 {stale} · 열린 검토 {state.reviews.filter(review => review.status === 'open').length}</span></div><Button asChild variant="outline"><a href={apiPath('/export')} download><ArrowDownToLine size={14} />번역 결과 다운로드</a></Button></div></section></div>
  </Modal>;
}
