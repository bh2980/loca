import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Check, CircleAlert, CircleCheck, X } from 'lucide-react';
import { checkFormat, isSpecialListener, KNOWLEDGE_ORIGIN_LABELS, LISTENER_MIN_CONFIDENCE, listenerLabel, mentions, SPECIAL_LISTENERS, SPEECH_LEVEL_LABELS, speechLevelOf, type FormatRules, type KnowledgeStatus, type SpeechLevel } from '@tw/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { AiButton } from '@/components/ai-button';
import { AiContextPanel } from '@/components/ai-context';
import { StatusDot, TagChip } from '@/components/status';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

const ORIGIN = { ai: 'AI', human: '사람', import: '가져옴', tool: '도구' } as const;
const STATE = { queued: '대기', running: '실행 중', done: '완료', failed: '실패', cancelled: '취소' } as const;

export type LineTab = 'edit' | 'context';

/**
 * Right-hand pane for one line: source, status, tags, translation editing, all candidates, run
 * history; and the AI context an AI node would send for it. The host keeps tab and node in its URL.
 */
export function LineDetail({
  projectId,
  unitId,
  onClose,
  showScene,
  tab = 'edit',
  onTab,
  aiNode,
  onAiNode,
}: {
  projectId: string;
  unitId: string;
  onClose?: () => void;
  showScene?: boolean;
  tab?: LineTab;
  onTab?: (tab: LineTab) => void;
  aiNode?: string;
  onAiNode?: (value: string) => void;
}) {
  const unit = useQuery(q.unit(unitId));
  const statuses = useQuery(q.statuses(projectId));
  const terms = useQuery(q.terms(projectId));
  const project = useQuery(q.project(projectId));
  const people = useQuery(q.characters(projectId));
  const [draft, setDraft, clearDraft] = useDraft(`line:${unitId}`, unit.data?.translation ?? '');
  useReportView('line-detail', [unit.data && { kind: '대사', id: unit.data.id, label: `${unit.data.key} · ${unit.data.source.slice(0, 40)}` }]);

  const patch = useMutation({
    mutationFn: (json: { translation?: string; candidateId?: string; statusId?: string; tagIds?: string[]; listener?: string | null }) => unwrap(client.units[':unitId'].$patch({ param: { unitId }, json })),
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
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id }} className="text-sm font-medium hover:underline">
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
      {onTab && (
        <Tabs value={tab} onValueChange={(value) => onTab(value as LineTab)} className="border-b px-4 py-2">
          <TabsList className="h-8">
            <TabsTrigger value="edit" className="text-xs">
              번역
            </TabsTrigger>
            <TabsTrigger value="context" className="text-xs">
              AI 문맥
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <ScrollArea className="min-h-0 flex-1">
        {tab === 'context' && onAiNode ? (
          <div className="p-4">
            <AiContextPanel projectId={projectId} unitKey={line.key} aiNode={aiNode} onAiNode={onAiNode} />
          </div>
        ) : (
        <div className="space-y-5 p-4">
          <section>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">원문{line.speaker ? ` · ${line.speaker}` : ''}</h3>
            <p className="text-sm whitespace-pre-wrap">{line.source}</p>
          </section>

          {line.kind === 'dialogue' && (
            <section className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">청자</span>
              <Select value={line.listener ?? '-'} onValueChange={(value) => patch.mutate({ listener: value === '-' ? null : value })}>
                <SelectTrigger size="sm" className="w-44" aria-label="청자">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-">미상</SelectItem>
                  {Object.entries(SPECIAL_LISTENERS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                  {people.data?.characters
                    .filter((c) => c.status === 'confirmed' || c.name === line.listener)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                        {c.player && ' · 플레이어'}
                      </SelectItem>
                    ))}
                  {line.listener && !isSpecialListener(line.listener) && !people.data?.characters.some((c) => c.name === line.listener) && <SelectItem value={line.listener}>{line.listener}</SelectItem>}
                </SelectContent>
              </Select>
              {line.listenerOrigin && (
                <span className={cn('text-xs', line.listenerOrigin === 'ai' && (line.listenerConfidence ?? 0) < LISTENER_MIN_CONFIDENCE ? 'text-amber-700' : 'text-muted-foreground')}>
                  {KNOWLEDGE_ORIGIN_LABELS[line.listenerOrigin === 'import' ? 'import' : line.listenerOrigin]}
                  {line.listenerOrigin === 'ai' &&
                    ` 추정 · 확신 ${(line.listenerConfidence ?? 0).toFixed(2)}${(line.listenerConfidence ?? 0) < LISTENER_MIN_CONFIDENCE ? ' (낮아서 미상으로 다룸)' : ''}`}
                </span>
              )}
            </section>
          )}

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
            <div className="mb-1 flex items-center gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">대표 번역</h3>
              <AiButton size="xs" variant="ghost" className="ml-auto" prompt="이 대사의 번역 후보를 제안해줘.">
                AI 제안
              </AiButton>
              {line.translation && (
                <AiButton size="xs" variant="ghost" send={false} prompt="이 대사의 번역을 이렇게 다듬어줘: ">
                  다듬기
                </AiButton>
              )}
            </div>
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

          <LineChecks projectId={projectId} source={line.source} text={draft} terms={terms.data ?? []} rules={project.data?.formatRules} speech={line.speech} />

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
        )}
      </ScrollArea>
    </div>
  );
}

/** Glossary terms in this line, and whether the translation in the editor keeps them and the source's format. */
export function LineChecks({ projectId, source, text, terms, rules, speech }: { projectId: string; source: string; text: string; terms: { id: string; source: string; target: string; status: KnowledgeStatus }[]; rules?: FormatRules; speech?: { listener: string; ruleId: string; rule: string; level: SpeechLevel; byOrder: boolean; routeDependent?: boolean } | null }) {
  const used = useMemo(() => terms.filter((term) => mentions(source, term.source)), [terms, source]);
  const formatIssues = text.trim() ? checkFormat(source, text, { placeholders: true, tags: true, newlines: true, emptyText: true }, rules) : [];
  const kept = (target: string) => Boolean(target.trim()) && text.toLowerCase().includes(target.toLowerCase());
  const guessed = text.trim() ? speechLevelOf(text) : null;
  return (
    <section className="space-y-3">
      {speech && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">말투 규칙 (→ {listenerLabel(speech.listener)}{speech.routeDependent ? ', 루트에 따라 달라 구간은 대본 순서 기준' : speech.byOrder ? ', 그래프 밖이라 구간은 대본 순서 기준' : ''})</h3>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: speech.ruleId }} className="min-w-0 truncate hover:underline">
              {speech.rule}
            </Link>
            <span className={cn('ml-auto shrink-0 text-xs', !guessed || speech.level === 'other' ? 'text-muted-foreground' : guessed === speech.level ? 'text-emerald-700' : 'text-amber-700')}>
              {!guessed || speech.level === 'other' ? '' : guessed === speech.level ? '맞음 (어미 추정)' : `번역은 ${SPEECH_LEVEL_LABELS[guessed]} (어미 추정)`}
            </span>
          </div>
        </div>
      )}
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">형식 검사 (편집기의 번역 기준)</h3>
        {!text.trim() ? (
          <p className="text-sm text-muted-foreground">번역이 없습니다.</p>
        ) : formatIssues.length ? (
          <ul className="space-y-1 text-sm text-amber-700">
            {formatIssues.map((issue) => (
              <li key={issue.code} className="flex items-start gap-1.5">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CircleCheck className="size-3.5" /> 자리표시자·태그·줄바꿈이 원문과 맞습니다.
          </p>
        )}
      </div>
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">이 대사의 용어 {used.length}개</h3>
        {used.length ? (
          <ul className="space-y-1 text-sm">
            {used.map((term) => {
              const ok = kept(term.target);
              return (
                <li key={term.id} className="flex items-center gap-2">
                  <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ term: term.id }} className="min-w-0 truncate hover:underline">
                    <b>{term.source}</b> → {term.target || <span className="text-muted-foreground">(번역 없음)</span>}
                  </Link>
                  {term.status === 'candidate' && <Badge variant="outline" className="px-1.5 py-0 text-[11px]">후보</Badge>}
                  <span className={cn('ml-auto shrink-0 text-xs', !text.trim() || !term.target ? 'text-muted-foreground' : ok ? 'text-emerald-700' : term.status === 'confirmed' ? 'text-amber-700' : 'text-muted-foreground')}>
                    {!text.trim() || !term.target ? '' : ok ? '번역에 있음' : '번역에 없음'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">원문에 나오는 용어가 없습니다.</p>
        )}
      </div>
    </section>
  );
}

