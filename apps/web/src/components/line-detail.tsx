import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CircleAlert, CircleCheck, Network, Pencil } from 'lucide-react';
import { checkFormat, EXCLUSION_REASON_LABELS, exclusionReason, isUnknownListener, type LineTranslate, listenerLabel, needsListener, PALETTE, SPEECH_LEVEL_LABELS, speechLevelOf, TAG_SCOPES, type FormatRules, type SpeechLevel } from '@tw/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, AiMark, Badge, Button, CandidateCard, Group, InspectorBlock, InspectorField, InspectorFields, InspectorHeader, Inspector, InspectorList, InspectorSection, PropertyGrid, PropertyRow, SpeakerIdentity, StatusIcon, TagChip, TagListEditor } from '@loca/ui';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { AiButton } from '@/components/ai-button';
import { AiContextPanel } from '@/components/ai-context';
import { TranslationEditor } from '@/components/translation-editor';
import { LineHints } from '@/components/script/line-row';
import { LineNote } from '@/components/script/line-note';
import { TokenText } from '@/components/editor/source-text';
import { replaceLineText } from '@/components/editor/translation-input';
import { ListenerPicker } from '@/components/script/listener-picker';
import { SpeakerCard } from '@/components/script/speaker-card';
import { SourceEditor } from '@/components/script/source-editor';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { lineTags, q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';
import { editorChecks, tokenPatternOf } from '@/lib/line-context';
import { dateTime } from '@/lib/datetime';

const ORIGIN = { ai: 'AI', human: '사람', import: '가져옴', tool: '도구' } as const;
const STATE = { queued: '대기', running: '실행 중', done: '완료', failed: '실패', cancelled: '취소됨' } as const;
type LineRecord = InferResponseType<(typeof client.units)[':unitId']['$get']>;

/** The selected line, deep: basics, candidates and similar lines, history, checks and the AI's prompt context, one scrolling pane. */
export function LineDetail({
  projectId,
  unitId,
  onClose,
  showScene,
  editor,
  aiNode,
  onAiNode,
}: {
  projectId: string;
  unitId: string;
  onClose?: () => void;
  showScene?: boolean;
  /** Show the translation editor in the pane (screens without an editing row). */
  editor?: boolean;
  aiNode?: string;
  onAiNode: (value: string) => void;
}) {
  const unit = useQuery(q.unit(unitId));
  const statuses = useQuery(q.statuses(projectId));
  const project = useQuery(q.project(projectId));
  const people = useQuery(q.characters(projectId));
  const group = useQuery({ ...q.group(unit.data?.group.id ?? ''), enabled: Boolean(unit.data?.group.id) });
  const [draft, setDraft] = useDraft(`line:${unitId}`, unit.data?.translation ?? '');
  const [noting, setNoting] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  useReportView('line-detail', [
    unit.data && {
      kind: unit.data.kind === 'ui' ? 'UI 문자열' : unit.data.kind === 'document' ? '문서' : '대사',
      id: unit.data.id,
      label: `${unit.data.speaker?.trim() ? `${unit.data.speaker.trim()}: ` : ''}${unit.data.source.slice(0, 40)}`,
      detail: JSON.stringify({ key: unit.data.key }),
    },
  ]);

  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[]; listener?: string | null; translate?: LineTranslate | null }) => unwrap(client.units[':unitId'].$patch({ param: { unitId }, json })),
    onMutate: async (json) => ({ undo: await optimistic(queryClient, unitChanges([unitId], patchedLine(json))) }),
    onError: (error, _json, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });
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
  const unknown = line ? isUnknownListener(line, project.data?.formatRules ?? undefined) : true;
  const cast = (people.data?.characters ?? []).filter((person) => person.status === 'confirmed').map((person) => ({ name: person.name, player: person.player }));
  const hasDialogueContext = line?.kind === 'dialogue' && Boolean(line.speaker?.trim());
  // 번역 제외: what the project's rules say about this source, and what a person's choice does.
  const ruleReason = line ? exclusionReason(line.source, project.data?.formatRules ?? undefined, project.data?.exclusionRules, project.data?.sourceLanguage) : null;
  const translateNote = line?.translate === 'exclude' || (!line?.translate && ruleReason) ? '진행률·실행·내보내기·검사에서 빠집니다. 번역은 그대로 둡니다.' : undefined;
  const kindLabel = line?.kind === 'ui' ? 'UI 문자열' : line?.kind === 'document' ? '문서' : hasDialogueContext ? '대사' : '서술';
  const speakerTitle = line?.speaker || '화자 없음';
  const speakerPerson = line?.speaker ? people.data?.characters.find((person) => person.name.toLowerCase() === line.speaker!.toLowerCase() || person.aliases.some((alias) => alias.toLowerCase() === line.speaker!.toLowerCase())) : undefined;
  const listenerTitle = !line || !needsListener(line, project.data?.formatRules ?? undefined) || unknown || !line.listener ? '청자 미상' : listenerLabel(line.listener);

  const title = line ? (
    hasDialogueContext ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="truncate">{speakerTitle}</span>
        {!unknown && line.listener && (
          <>
            <span className="text-subtle-foreground">→</span>
            <span className="truncate">{listenerTitle}</span>
          </>
        )}
      </span>
    ) : (
      <span className="truncate">{line.group.title}</span>
    )
  ) : (
    '…'
  );

  const kind = line ? (
    hasDialogueContext ? (
      <span>{kindLabel} · #{line.seq}</span>
    ) : (
      <span className="truncate" title={line.source}>{kindLabel} · #{line.seq} · {line.source}</span>
    )
  ) : (
    '줄'
  );

  const metadata = line && (
    <>
      {status && <span className="inline-flex items-center gap-1"><StatusIcon status={status} />{status.name}</span>}
      {line.statusBy === 'ai' && <AiMark by="ai" />}
      {showScene ? <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id }} className="truncate hover:underline">{line.group.title}</Link> : <span className="truncate">{line.group.title}</span>}
      {line.tagIds.map((id) => {
        const tag = tags.find((item) => item.id === id);
        return tag ? <TagChip key={id} tag={tag} /> : null;
      })}
    </>
  );
  const graphTarget = line?.graphNodes[0];
  const attachedTags = line ? tags.filter((tag) => line.tagIds.includes(tag.id)) : [];
  const orderedTags = [...attachedTags.filter((tag) => tag.role), ...attachedTags.filter((tag) => !tag.role)];

  const createTagInline = async (name: string) => {
    if (!line) return;
    try {
      const color = (PALETTE[tags.length % PALETTE.length] as any).light ?? PALETTE[tags.length % PALETTE.length].hex;
      const res = await unwrap(client.projects[':projectId'].tags.$post({
        param: { projectId },
        json: { name, color, scope: [...TAG_SCOPES] },
      }));
      await patch.mutateAsync({ tagIds: [...line.tagIds, res.id] });
      queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['units', projectId] });
      queryClient.invalidateQueries({ queryKey: ['unit', line.id] });
      toast.success(`'${name}' 태그를 만들고 줄에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  const tokenPattern = tokenPatternOf(project.data?.formatRules);
  // A taken text goes into the line's editor when it is open, else into the draft it will show.
  const useText = (text: string) => { if (!replaceLineText(unitId, text)) setDraft(text); };

  if (line && editingSource) return <SourceEditor
    projectId={projectId}
    kind={line.kind === 'dialogue' ? 'scene' : line.kind}
    unitId={line.id}
    mode="edit-unit"
    onClose={() => setEditingSource(false)}
    onSaved={() => setEditingSource(false)}
    onDeleted={() => { setEditingSource(false); onClose?.(); }}
  />;

  return (
    <Inspector
      header={<InspectorHeader
        kind={kind}
        name={title}
        status={metadata}
        actions={line && <Button type="button" variant="outline" onClick={() => setEditingSource(true)}><Pencil /> 원문 편집</Button>}
        onClose={onClose}
      />}
      footer={line?.statusBy === 'ai' ? <Button type="button" disabled={check.isPending} onClick={() => check.mutate()}>확인함</Button> : undefined}
      loading={!line}
    >
      {line && editor && <InspectorBlock><TranslationEditor projectId={projectId} unit={{ id: line.id, source: line.source, translation: line.translation, statusId: line.statusId, statusBy: line.statusBy, candidates: line.candidates }} statuses={statuses.data?.statuses ?? []} /></InspectorBlock>}
      {line && (
        <>
          <InspectorSection title="정보">
            <PropertyGrid>
              <PropertyRow label="대사 키">
                <code className="font-mono text-xs break-all text-muted-foreground">{line.key}</code>
              </PropertyRow>
              <PropertyRow label="장면">
                {showScene ? <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id }} className="block truncate hover:underline" title={line.group.title}>{line.group.title}</Link> : <span className="block truncate" title={line.group.title}>{line.group.title}</span>}
              </PropertyRow>
              {line.kind === 'dialogue' && (line.graphNodes.length > 0 || group.data?.kind === 'scene') && (
                <PropertyRow label="대사 그래프">
                  {line.graphNodes.length ? (
                    <ul className="space-y-1">
                      {line.graphNodes.map((item) => (
                        <li key={item.id} className="min-w-0">
                          <Link
                            to="/p/$projectId/graph"
                            params={{ projectId }}
                            search={{ scope: 'dialogue', scene: line.group.id, node: item.id, jump: true }}
                            className="flex min-w-0 items-center gap-1.5 hover:underline"
                          >
                            <Network className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 truncate">{item.key}에서 열기</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Link
                      to="/p/$projectId/graph"
                      params={{ projectId }}
                      search={{ scope: 'dialogue', scene: line.group.id, ...(graphTarget && { node: graphTarget.id, jump: true }) }}
                      className="block truncate hover:underline"
                    >
                      그래프에서 열기
                    </Link>
                  )}
                </PropertyRow>
              )}
              {line.speaker && <PropertyRow label="화자"><SpeakerCard projectId={projectId} name={line.speaker}><SpeakerIdentity speaker={line.speaker} /></SpeakerCard></PropertyRow>}
              {line.speech && <PropertyRow label="말투 규칙"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: line.speech.ruleId }} className="block truncate hover:underline" title={line.speech.rule}>{line.speech.rule}</Link></PropertyRow>}
              {line.speaker && <PropertyRow label="인물"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'characters', ...(speakerPerson && { item: speakerPerson.id }) }} className="block truncate hover:underline">보기</Link></PropertyRow>}
            </PropertyGrid>
            {line.speaker && <LineHints projectId={projectId} line={{ id: line.id, source: line.source, translation: line.translation, speaker: line.speaker, listener: line.listener, lastRun: lastRun ? { issues: lastRun.data.issues ?? [] } : null }} part="context" />}
          </InspectorSection>

          <InspectorSection title="속성">
            <InspectorFields>
              {needsListener(line, project.data?.formatRules ?? undefined) && (
                <InspectorField label="청자">
                  <div className="flex min-w-0 flex-col items-start gap-1">
                    <ListenerPicker line={{ speaker: line.speaker, listener: line.listener, listenerOrigin: line.listenerOrigin, listenerConfidence: line.listenerConfidence, sceneNames: line.sceneNames }} cast={cast} onPick={(listener) => patch.mutate({ listener })} />
                  </div>
                </InspectorField>
              )}
              <InspectorField label="번역 대상" description={translateNote}>
                <Select value={line.translate ?? 'auto'} onValueChange={(value) => patch.mutate({ translate: value === 'auto' ? null : (value as LineTranslate) })}>
                  <SelectTrigger className="w-full" aria-label="번역 대상">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">규칙대로 ({ruleReason ? `제외 · ${EXCLUSION_REASON_LABELS[ruleReason]}` : '번역함'})</SelectItem>
                    <SelectItem value="include">번역함</SelectItem>
                    <SelectItem value="exclude">제외</SelectItem>
                  </SelectContent>
                </Select>
              </InspectorField>
              <InspectorField label="태그">
                <TagListEditor
                  tags={orderedTags}
                  allTags={tags}
                  onToggle={(tagId, add) => patch.mutate({ tagIds: add ? [...line.tagIds, tagId] : line.tagIds.filter((id) => id !== tagId) })}
                  onCreate={createTagInline}
                  heading="줄에 붙일 태그"
                />
              </InspectorField>
              <InspectorField label="메모" action={!line.note && !noting ? <Button variant="ghost" size="inline" onClick={() => setNoting(true)}>메모 추가</Button> : undefined}>
                {line.note || noting ? <LineNote unitId={line.id} note={line.note} editing={noting} onEditing={setNoting} /> : null}
              </InspectorField>
            </InspectorFields>
          </InspectorSection>

          <CandidatesAndMatches unit={line} draft={draft} onUse={useText} tokenPattern={tokenPattern} />

          <HistorySection projectId={projectId} history={line.history} />

          <InspectorSection title="검증">
            <LineChecks projectId={projectId} source={line.source} text={draft} rules={project.data?.formatRules} targetLanguage={project.data?.targetLanguage} speech={line.speech} lastRun={lastRun ? { runId: lastRun.runId, workflowName: lastRun.workflowName, issues: lastRun.data.issues ?? [] } : null} />
          </InspectorSection>

          <InspectorSection title="AI 프롬프트" defaultOpen={false}>
            <AiContextPanel projectId={projectId} unitKey={line.key} unitKind={line.kind} aiNode={aiNode} onAiNode={onAiNode} />
          </InspectorSection>
        </>
      )}
    </Inspector>
  );
}

const ORIGIN_TITLE = { ai: 'AI', human: '사람', import: '가져온 것', tool: '도구' } as const;

/** The line's own candidates and, below them, the same or similar sources translated elsewhere (translation memory). */
function CandidatesAndMatches({ unit, draft, onUse, tokenPattern }: { unit: LineRecord; draft: string; onUse: (text: string) => void; tokenPattern: RegExp | null }) {
  const matches = useQuery(q.lineMatches(unit.id));
  const origins = new Set(unit.candidates.map((candidate) => candidate.origin));
  const title = origins.size === 1 ? `${ORIGIN_TITLE[unit.candidates[0]!.origin]} 후보` : '후보';
  const subject = unit.kind === 'ui' ? 'UI 문자열' : unit.kind === 'document' ? '문서' : '대사';
  const rows = matches.data ?? [];
  const inEditor = (text: string) => draft !== (unit.translation ?? '') && text === draft;
  const useButton = (text: string) => <Button variant="ghost" disabled={inEditor(text)} onClick={() => onUse(text)}>{inEditor(text) ? '초안에 있음' : '쓰기'}</Button>;
  return (
    <InspectorSection title={`번역 후보 ${unit.candidates.length + rows.length}`} actions={<>
      <AiButton variant="ghost" prompt={`${subject}의 번역 후보를 제안해줘.`}>AI 제안</AiButton>
      {unit.translation && <AiButton variant="ghost" send={false} prompt={`${subject}의 번역을 이렇게 다듬어줘: `}>다듬기</AiButton>}
    </>}>
      <div className="space-y-4">
        <Group title={<>{title} <span className="font-normal text-muted-foreground tabular-nums">{unit.candidates.length}</span></>} className="space-y-2">
          <InspectorList>
            {unit.candidates.map((candidate) => {
              const current = candidate.text === (unit.translation ?? null);
              return (
                <li key={candidate.id} className="py-1 first:pt-0 last:pb-0">
                  <CandidateCard
                    text={<TokenText text={candidate.text} source={unit.source} pattern={tokenPattern} className="whitespace-pre-wrap" />}
                    current={current}
                    source={<Badge variant="outline">{ORIGIN[candidate.origin]}</Badge>}
                    meta={<span className="truncate">{[candidate.model, dateTime(candidate.createdAt)].filter(Boolean).join(' · ')}</span>}
                    action={current ? <span className="shrink-0 font-medium text-foreground">현재 번역</span> : useButton(candidate.text)}
                  />
                </li>
              );
            })}
            {!unit.candidates.length && <li className="py-2 text-sm text-muted-foreground">아직 후보가 없습니다.</li>}
          </InspectorList>
        </Group>
        <Group title={<>TM <span className="font-normal text-muted-foreground tabular-nums">{rows.length}</span></>} className="space-y-2">
          <InspectorList>
            {rows.map((match) => {
              const current = match.translation === (unit.translation ?? null);
              return (
                <li key={match.unitId} className="py-1 first:pt-0 last:pb-0">
                  <CandidateCard
                    text={<>
                      <TokenText text={match.translation} source={unit.source} pattern={tokenPattern} className="whitespace-pre-wrap" />
                      {match.diff && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          <span className="mr-1 text-subtle-foreground">원문 차이</span>
                          {match.diff.map((word, at) => <span key={at} className={cn(word.changed && 'rounded-xs bg-warning/15 px-0.5 font-medium text-warning')}>{at > 0 && ' '}{word.text}</span>)}
                        </span>
                      )}
                    </>}
                    current={current}
                    source={<Badge variant="outline">{match.score === 100 ? '같은 원문' : `비슷함 ${match.score}%`}{match.final ? '' : ' · 미확정'}</Badge>}
                    meta={<span className="truncate">{[match.speaker, match.listener && `→ ${listenerLabel(match.listener)}`].filter(Boolean).join(' ') || match.groupTitle}</span>}
                    action={current ? <span className="shrink-0 font-medium text-foreground">현재 번역</span> : useButton(match.translation)}
                  />
                </li>
              );
            })}
            {!rows.length && <li className="py-2 text-sm text-muted-foreground">{matches.isPending ? '찾는 중…' : '같거나 비슷한 원문이 없습니다.'}</li>}
          </InspectorList>
        </Group>
      </div>
    </InspectorSection>
  );
}

/** Runs that touched this line; open only when there are any. */
function HistorySection({ projectId, history }: { projectId: string; history: LineRecord['history'] }) {
  return (
    <InspectorSection title={`이력 ${history.length}`} defaultOpen={history.length > 0}>
      {history.length ? (
        <InspectorList className="text-sm">
          {history.map((item) => (
            <li key={item.id} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: item.runId }} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {item.workflowName}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">{STATE[item.state]}</span>
                <span className="shrink-0 text-xs text-subtle-foreground">{dateTime(item.createdAt)}</span>
              </div>
              {item.data.issues?.[0] && <p className="truncate text-xs text-warning">{item.data.issues[0]}</p>}
              {item.error && <p className="text-xs text-destructive">{item.error}</p>}
            </li>
          ))}
        </InspectorList>
      ) : (
        <p className="text-sm text-muted-foreground">이 줄이 포함된 실행이 없습니다.</p>
      )}
    </InspectorSection>
  );
}

/** The last run's findings, the speech rule and the format checks of the line's current draft. */
function LineChecks({ projectId, source, text, rules, targetLanguage, speech, lastRun }: { projectId: string; source: string; text: string; rules?: FormatRules; targetLanguage?: string; speech?: { listener: string; ruleId: string; rule: string; level: SpeechLevel; byOrder: boolean; routeDependent?: boolean; others?: boolean } | null; lastRun: { runId: string; workflowName: string; issues: string[] } | null }) {
  const formatIssues = text.trim() ? checkFormat(source, text, editorChecks(targetLanguage, true), rules) : [];
  const guessed = text.trim() ? speechLevelOf(text) : null;
  return (
    <div className="space-y-4">
      <Group title={lastRun ? <>지적 · <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: lastRun.runId }} className="font-normal text-muted-foreground hover:underline">{lastRun.workflowName}</Link></> : '지적'}>
        {lastRun?.issues.length ? (
          <ul className="space-y-1 text-sm text-warning">{lastRun.issues.map((issue, i) => <li key={i} className="flex items-start gap-1.5"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{issue}</li>)}</ul>
        ) : (
          <p className="text-sm text-muted-foreground">최근 실행에서 지적된 내용이 없습니다.</p>
        )}
      </Group>
      {speech && (
        <Group title={`말투 → ${speech.others ? "그 밖의 사람" : listenerLabel(speech.listener)}${speech.routeDependent ? ' (루트에 따라 달라 대본 순서 기준)' : speech.byOrder ? ' (그래프 밖이라 대본 순서 기준)' : ''}`}>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: speech.ruleId }} className="min-w-0 truncate hover:underline">
              {speech.rule}
            </Link>
            <span className={cn('ml-auto shrink-0 text-xs', !guessed || speech.level === 'other' ? 'text-muted-foreground' : guessed === speech.level ? 'text-success' : 'text-warning')}>
              {!guessed || speech.level === 'other' ? '' : guessed === speech.level ? '맞음 · 추정' : `번역은 ${SPEECH_LEVEL_LABELS[guessed]} · 추정`}
            </span>
          </div>
        </Group>
      )}
      <Group title="형식">
        {!text.trim() ? (
          <p className="text-sm text-muted-foreground">번역이 없습니다.</p>
        ) : formatIssues.length ? (
          <ul className="space-y-1 text-sm text-warning">
            {formatIssues.map((issue) => (
              <li key={issue.code} className="flex items-start gap-1.5">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-3.5" />
            원문과 맞습니다.
          </p>
        )}
      </Group>
    </div>
  );
}
