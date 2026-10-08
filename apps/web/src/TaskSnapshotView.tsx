import { Button } from './components/ui/button';
import { useState } from 'react';
import type { TaskSnapshot } from '@workbench/contracts';
import { api } from './api';

export function TaskSnapshotView({ snapshot }: { snapshot: TaskSnapshot }) {
  return <div className="task-snapshot"><p className="subtext">{snapshot.connection.name} · {snapshot.capturedProfile.model} · 추론 {snapshot.capturedProfile.effort || '기본값'} · 프롬프트 v{snapshot.capturedProfile.promptVersion ?? 1} · 원문 {snapshot.unitIds.length}개</p><details open><summary>조립된 프롬프트</summary><pre>{snapshot.prompt}</pre></details><details><summary>문맥 · 용어 {Object.keys(snapshot.termVersions).length}개 / 자료 {Object.keys(snapshot.knowledgeVersions).length}개</summary><pre>{JSON.stringify(snapshot.context, null, 2)}</pre></details><details><summary>응답 스키마</summary><pre>{JSON.stringify(snapshot.schema, null, 2)}</pre></details></div>;
}
export function SavedTaskSnapshot({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<TaskSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div>{!snapshot ? <Button disabled={busy} onClick={() => { setBusy(true); void api<TaskSnapshot>(`/tasks/snapshots/${encodeURIComponent(id)}`).then(setSnapshot).catch(error => setError(String(error.message))).finally(() => setBusy(false)); }} variant="ghost" size="sm">{busy ? '불러오는 중…' : '실제 프롬프트·문맥 보기'}</Button> : <details open><summary>실행 당시 입력</summary><TaskSnapshotView snapshot={snapshot} /></details>}{error ? <p role="alert">{error}</p> : null}</div>;
}
