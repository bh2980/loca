import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { StatusDot, TagChip } from '@/components/status';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

const ORIGIN = { ai: 'AI', human: '사람', import: '가져옴', tool: '도구' } as const;
const STATE = { queued: '대기', running: '실행 중', waiting: '사람 확인 대기', done: '완료', failed: '실패', cancelled: '취소' } as const;

/** Right-hand pane for one line: source, status, tags, translation editing, all candidates, run history. */
export function LineDetail({ projectId, unitId, onClose, showScene }: { projectId: string; unitId: string; onClose?: () => void; showScene?: boolean }) {
  const unit = useQuery(q.unit(unitId));
  const statuses = useQuery(q.statuses(projectId));
  const [draft, setDraft, clearDraft] = useDraft(`line:${unitId}`, unit.data?.translation ?? '');
  useReportView('line-detail', [unit.data && { kind: '대사', id: unit.data.id, label: `${unit.data.key} · ${unit.data.source.slice(0, 40)}` }]);

  const patch = useMutation({
    mutationFn: (json: { translation?: string; candidateId?: string; statusId?: string; tagIds?: string[] }) => unwrap(client.units[':unitId'].$patch({ param: { unitId }, json })),
    onSuccess: (_data, variables) => variables.translation !== undefined && clearDraft(),
  });

  if (!unit.data)
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-20" />
      </div>
    );
  const line = unit.data;
  const status = statuses.data?.statuses.find((item) => item.id === line.statusId);
  const tags = statuses.data?.tags ?? [];
  const dirty = draft !== (line.translation ?? '');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-muted-foreground">{line.key}</p>
          {showScene && (
            <Link to="/p/$projectId/scenes/$groupId" params={{ projectId, groupId: line.group.id }} search={{ line: line.id }} className="text-sm font-medium hover:underline">
              {line.group.title}
            </Link>
          )}
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="상세 닫기">
            <X />
          </Button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <section>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">원문{line.speaker ? ` · ${line.speaker}` : ''}</h3>
            <p className="text-sm whitespace-pre-wrap">{line.source}</p>
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <Select value={line.statusId} onValueChange={(statusId) => patch.mutate({ statusId })}>
              <SelectTrigger size="sm" className="w-44" aria-label="상태">
                <SelectValue>{status && <><StatusDot color={status.color} /> {status.name}</>}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {statuses.data?.statuses.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <StatusDot color={item.color} /> {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tags.map((tag) => {
              const on = line.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  aria-pressed={on}
                  className={cn('rounded transition-opacity', !on && 'opacity-40 hover:opacity-70')}
                  onClick={() => patch.mutate({ tagIds: on ? line.tagIds.filter((id) => id !== tag.id) : [...line.tagIds, tag.id] })}
                >
                  <TagChip tag={tag} />
                </button>
              );
            })}
          </section>

          <section>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">대표 번역</h3>
            <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="번역을 입력하면 사람 후보로 저장되고 대표 번역이 됩니다." className="min-h-24" />
            {dirty && (
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={clearDraft}>
                  되돌리기
                </Button>
                <Button
                  size="sm"
                  disabled={patch.isPending}
                  onClick={() => {
                    // Saving the exact text of an existing candidate selects it instead of duplicating it.
                    const same = line.candidates.find((candidate) => candidate.text === draft);
                    patch.mutate(same ? { candidateId: same.id } : { translation: draft }, { onSuccess: clearDraft });
                  }}
                >
                  <Check /> 저장
                </Button>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">후보 {line.candidates.length}개</h3>
            <ul className="space-y-2">
              {line.candidates.map((candidate) => {
                const current = candidate.text === (line.translation ?? null);
                const inEditor = dirty && candidate.text === draft;
                return (
                  <li key={candidate.id} className={cn('rounded-md border p-2.5 text-sm', current && 'border-foreground/30 bg-muted/40')}>
                    <p className="whitespace-pre-wrap">{candidate.text}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{ORIGIN[candidate.origin]}</Badge>
                      {candidate.model && <span>{candidate.model}</span>}
                      <span>{new Date(candidate.createdAt).toLocaleString()}</span>
                      {current && <span className="ml-auto font-medium text-foreground">현재 번역</span>}
                      {!current && (
                        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs" disabled={inEditor} onClick={() => setDraft(candidate.text)}>
                          {inEditor ? '편집기에 있음' : '편집기에 넣기'}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
              {!line.candidates.length && <li className="text-sm text-muted-foreground">아직 후보가 없습니다.</li>}
            </ul>
          </section>

          {line.history.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">실행 이력</h3>
              <ul className="space-y-1.5 text-sm">
                {line.history.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: item.runId }} className="truncate hover:underline">
                      {item.workflowName}
                    </Link>
                    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{STATE[item.state]}</span>
                    {!!item.data.issues?.length && <span className="truncate text-xs text-amber-600">{item.data.issues[0]}</span>}
                    {item.error && <span className="truncate text-xs text-destructive">{item.error}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
