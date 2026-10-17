import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useMemo } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { checkFormat, listenerLabel, mentions, SPEECH_LEVEL_LABELS, speechLevelOf, type FormatRules, type KnowledgeStatus, type SpeechLevel } from '@tw/shared';
import { Badge } from '@/components/ui/badge';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { AiButton } from '@/components/ai-button';
import { AiContextPanel } from '@/components/ai-context';
import { DetailPane, FieldRow, PaneSection } from '@/components/detail-pane';
import { AiMark, StatusDot, TagChip } from '@/components/status';
import { TranslationEditor } from '@/components/translation-editor';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { lineTags, q } from '@/lib/queries';
import { useSaveLine } from '@/lib/line-save';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';
import { ListenerPicker } from '@/components/script/listener-picker';
import { editorChecks, tokenPatternOf, withoutTokens } from '@/lib/line-context';
import { dateTime } from '@/lib/datetime';

const ORIGIN = { ai: 'AI', human: '사람', import: '가져옴', tool: '도구' } as const;
const STATE = { queued: '대기', running: '실행 중', done: '완료', failed: '실패', cancelled: '취소' } as const;

export type LineTab = 'checks' | 'candidates' | 'context';
export const LINE_TABS: LineTab[] = ['checks', 'candidates', 'context'];

/**
 * Right-hand pane for one line. Always on top: the source, listener, status and tags. Under it the
 * tabs: checks of the translation being edited (format, terms, speech rule, the last run's
 * remarks), candidates and run history, and the AI context an AI node would send. In the
 * translation screen the editor sits in the line's row; elsewhere (`editor`) it is in the pane.
 */
export function LineDetail({
  projectId,
  unitId,
  onClose,
  showScene,
  editor,
  tab = 'checks',
  onTab,
  aiNode,
  onAiNode,
}: {
  projectId: string;
  unitId: string;
  onClose?: () => void;
  showScene?: boolean;
  /** Show the translation editor in the pane (screens without an editing row). */
  editor?: boolean;
  tab?: LineTab;
  onTab: (tab: LineTab) => void;
  aiNode?: string;
  onAiNode: (value: string) => void;
}) {
  const unit = useQuery(q.unit(unitId));
  const statuses = useQuery(q.statuses(projectId));
  const terms = useQuery(q.terms(projectId));
  const project = useQuery(q.project(projectId));
  const people = useQuery(q.characters(projectId));
  const [draft, setDraft] = useDraft(`line:${unitId}`, unit.data?.translation ?? '');
  useReportView('line-detail', [unit.data && { kind: '대사', id: unit.data.id, label: `${unit.data.key} · ${unit.data.source.slice(0, 40)}` }]);

  const queryClient = useQueryClient();
  const saveLine = useSaveLine();
  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[]; listener?: string | null }) => unwrap(client.units[':unitId'].$patch({ param: { unitId }, json })),
    // The pick shows at once (pane and list); a failure puts it back.
    onMutate: async (json) => ({ undo: await optimistic(queryClient, unitChanges([unitId], patchedLine(json))) }),
    onError: (error, _json, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });
  // 확인함: the status a run set stays, a person now holds it.
  const check = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [unitId], checked: true } })),
    onMutate: async () => ({ undo: await optimistic(queryClient, unitChanges([unitId], patchedLine({ checked: true }))) }),
    onError: (error, _vars, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });

  const line = unit.data;
  const status = statuses.data?.statuses.find((item) => item.id === line?.statusId);
  const tags = lineTags(statuses.data?.tags);
  const lastRun = line?.history[0];

  return (
    <DetailPane
      kicker={line ? <span className="font-mono">{line.key}</span> : '대사'}
      title={
        !line ? '…' : showScene ? (
          <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id }} className="hover:underline">
            {line.group.title}
          </Link>
        ) : (
          line.group.title
        )
      }
      onClose={onClose}
      loading={!line}
      summary={
        line && (
          <>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">원문{line.speaker ? ` · ${line.speaker}` : ''}</p>
              <p className="text-sm whitespace-pre-wrap">{line.source}</p>
            </div>
            <div className="space-y-1">
              {line.kind === 'dialogue' && (
                <FieldRow label="청자">
                  <ListenerPicker line={line} cast={(people.data?.characters ?? []).filter((c) => c.status === 'confirmed').map((c) => ({ name: c.name, player: c.player }))} onPick={(listener) => patch.mutate({ listener })} />
                </FieldRow>
              )}
              <FieldRow label="상태">
                <Select value={line.statusId} onValueChange={(statusId) => saveLine.mutate({ unitId, statusId }, { onError: (error) => toast.error(error.message) })}>
                  <SelectTrigger size="sm" className="w-40" aria-label="상태">
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
                {line.statusBy === 'ai' && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <AiMark by="ai" /> 실행이 정함
                    <Button variant="ghost" size="inline" disabled={check.isPending} title="상태는 그대로 두고 사람이 확인한 것으로 표시합니다" onClick={() => check.mutate()}>
                      확인함
                    </Button>
                  </span>
                )}
              </FieldRow>
              {tags.length > 0 && (
                <FieldRow label="태그">
                  {tags.map((tag) => {
                    const on = line.tagIds.includes(tag.id);
                    return (
                      <Toggle
                        key={tag.id}
                        size="sm"
                        pressed={on}
                        onPressedChange={(pressed) => patch.mutate({ tagIds: pressed ? [...line.tagIds, tag.id] : line.tagIds.filter((id) => id !== tag.id) })}
                        className={cn('h-6 min-w-0 px-0 data-[state=on]:bg-transparent', !on && 'opacity-40 hover:opacity-80')}
                        aria-label={`#${tag.name}`}
                      >
                        <TagChip tag={tag} />
                      </Toggle>
                    );
                  })}
                </FieldRow>
              )}
            </div>
            {editor && <TranslationEditor projectId={line.projectId} unit={line} statuses={statuses.data?.statuses ?? []} />}
          </>
        )
      }
      tabs={{
        value: tab,
        onChange: onTab,
        items: [
          { value: 'checks', label: '검사' },
          { value: 'candidates', label: `후보·이력${line ? ` ${line.candidates.length}` : ''}` },
          { value: 'context', label: 'AI 문맥' },
        ],
      }}
    >
      {line && tab === 'checks' && (
        <>
          {!!lastRun?.data.issues?.length && (
            <PaneSection
              title={
                <>
                  최근 실행의 지적 ·{' '}
                  <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: lastRun.runId }} className="hover:underline">
                    {lastRun.workflowName}
                  </Link>
                </>
              }
            >
              <ul className="space-y-1 text-sm text-warning">
                {lastRun.data.issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {issue}
                  </li>
                ))}
              </ul>
            </PaneSection>
          )}
          <LineChecks projectId={projectId} source={line.source} text={draft} terms={terms.data ?? []} rules={project.data?.formatRules} targetLanguage={project.data?.targetLanguage} speech={line.speech} />
        </>
      )}
      {line && tab === 'candidates' && (
        <>
          <PaneSection
            title={`후보 ${line.candidates.length}개`}
            actions={
              <>
                <AiButton variant="ghost" prompt="이 대사의 번역 후보를 제안해줘.">
                  AI 제안
                </AiButton>
                {line.translation && (
                  <AiButton variant="ghost" send={false} prompt="이 대사의 번역을 이렇게 다듬어줘: ">
                    다듬기
                  </AiButton>
                )}
              </>
            }
          >
            <ul className="space-y-2">
              {line.candidates.map((candidate) => {
                const current = candidate.text === (line.translation ?? null);
                const inEditor = draft !== (line.translation ?? '') && candidate.text === draft;
                return (
                  <li key={candidate.id} className={cn('rounded-md border p-3 text-sm', current && 'border-foreground/30 bg-muted/40')}>
                    <p className="whitespace-pre-wrap">{candidate.text}</p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{ORIGIN[candidate.origin]}</Badge>
                      <span className="min-w-0 truncate">
                        {[candidate.model, dateTime(candidate.createdAt)].filter(Boolean).join(' · ')}
                      </span>
                      {current ? (
                        <span className="ml-auto shrink-0 font-medium text-foreground">현재 번역</span>
                      ) : (
                        <Button variant="ghost" className="ml-auto" disabled={inEditor} onClick={() => setDraft(candidate.text)}>
                          {inEditor ? '편집기에 있음' : '편집기에 넣기'}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
              {!line.candidates.length && <li className="text-sm text-muted-foreground">아직 후보가 없습니다.</li>}
            </ul>
          </PaneSection>
          <PaneSection title="실행 이력">
            {line.history.length ? (
              <ul className="space-y-1.5 text-sm">
                {line.history.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: item.runId }} className="truncate hover:underline">
                      {item.workflowName}
                    </Link>
                    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{STATE[item.state]}</span>
                    {!!item.data.issues?.length && <span className="truncate text-xs text-warning">{item.data.issues[0]}</span>}
                    {item.error && <span className="truncate text-xs text-destructive">{item.error}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">이 대사가 들어간 실행이 없습니다.</p>
            )}
          </PaneSection>
        </>
      )}
      {line && tab === 'context' && <AiContextPanel projectId={projectId} unitKey={line.key} aiNode={aiNode} onAiNode={onAiNode} />}
    </DetailPane>
  );
}

/** Glossary terms in this line, and whether the translation being edited keeps them and the source's format. */
function LineChecks({ projectId, source, text, terms, rules, targetLanguage, speech }: { projectId: string; source: string; text: string; terms: { id: string; source: string; target: string; status: KnowledgeStatus }[]; rules?: FormatRules; targetLanguage?: string; speech?: { listener: string; ruleId: string; rule: string; level: SpeechLevel; byOrder: boolean; routeDependent?: boolean; others?: boolean } | null }) {
  // Words inside format tags are not terms.
  const used = useMemo(() => {
    const plain = withoutTokens(source, tokenPatternOf(rules));
    return terms.filter((term) => mentions(plain, term.source));
  }, [terms, source, rules]);
  const formatIssues = text.trim() ? checkFormat(source, text, editorChecks(targetLanguage, true), rules) : [];
  const kept = (target: string) => Boolean(target.trim()) && text.toLowerCase().includes(target.toLowerCase());
  const guessed = text.trim() ? speechLevelOf(text) : null;
  return (
    <>
      {speech && (
        <PaneSection title={`말투 규칙 → ${listenerLabel(speech.listener)}${speech.others ? ' (그 밖의 사람 규칙)' : ''}${speech.routeDependent ? ' (루트에 따라 달라 대본 순서 기준)' : speech.byOrder ? ' (그래프 밖이라 대본 순서 기준)' : ''}`}>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: speech.ruleId }} className="min-w-0 truncate hover:underline">
              {speech.rule}
            </Link>
            <span className={cn('ml-auto shrink-0 text-xs', !guessed || speech.level === 'other' ? 'text-muted-foreground' : guessed === speech.level ? 'text-success' : 'text-warning')}>
              {!guessed || speech.level === 'other' ? '' : guessed === speech.level ? '맞음 (어미 추정)' : `번역은 ${SPEECH_LEVEL_LABELS[guessed]} (어미 추정)`}
            </span>
          </div>
        </PaneSection>
      )}
      <PaneSection title="형식 (편집 중인 번역 기준)">
        {!text.trim() ? (
          <p className="text-sm text-muted-foreground">번역이 없습니다.</p>
        ) : formatIssues.length ? (
          <ul className="space-y-1 text-sm text-warning">
            {formatIssues.map((issue) => (
              <li key={issue.code} className="flex items-start gap-1.5">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-3.5" /> 자리표시자·태그·줄바꿈이 원문과 맞습니다.
          </p>
        )}
      </PaneSection>
      <PaneSection title={`용어 ${used.length}개`}>
        {used.length ? (
          <ul className="space-y-1 text-sm">
            {used.map((term) => {
              const ok = kept(term.target);
              return (
                <li key={term.id} className="flex items-center gap-2">
                  <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ term: term.id }} className="min-w-0 truncate hover:underline">
                    <b>{term.source}</b> → {term.target || <span className="text-muted-foreground">(번역 없음)</span>}
                  </Link>
                  {term.status === 'candidate' && <Badge variant="outline">후보</Badge>}
                  <span className={cn('ml-auto shrink-0 text-xs', !text.trim() || !term.target ? 'text-muted-foreground' : ok ? 'text-success' : term.status === 'confirmed' ? 'text-warning' : 'text-muted-foreground')}>
                    {!text.trim() || !term.target ? '' : ok ? '번역에 있음' : '번역에 없음'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">원문에 나오는 용어가 없습니다.</p>
        )}
      </PaneSection>
    </>
  );
}


