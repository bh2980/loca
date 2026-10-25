import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CircleAlert, CircleCheck, Network, Pencil } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { checkFormat, exclusionReason, isUnknownListener, type LineTranslate, listenerLabel, needsListener, PALETTE, SPEECH_LEVEL_LABELS, speechLevelOf, TAG_SCOPES, type FormatRules, type SpeechLevel } from '@tw/shared';
import { Select, SelectContent, SelectItem, SelectValue, AiMark, Chip, Box, Button, CandidateCard, DetailIssue, EditorChangedWord, Group, Icon, Inline, InspectorHeader, Inspector, InspectorList, SpeakerIdentity, Stack, StatusIcon, TagChip, TagListEditor, Text, ListItem, SelectTrigger, Section, Field, KeyValue, KeyValueRow } from '@loca/ui';
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
import { useReportView } from '@/lib/view-context';
import { editorChecks, tokenPatternOf } from '@/lib/line-context';
import { dateTime } from '@/lib/datetime';
import { usePersonColors } from '@/lib/person-colors';

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
  const colorOf = usePersonColors(projectId);
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
  const kindLabel = line?.kind === 'ui' ? 'UI 문자열' : line?.kind === 'document' ? '문서' : hasDialogueContext ? '대사' : '서술';
  const speakerTitle = line?.speaker || '화자 없음';
  const speakerPerson = line?.speaker ? people.data?.characters.find((person) => person.name.toLowerCase() === line.speaker!.toLowerCase() || person.aliases.some((alias) => alias.toLowerCase() === line.speaker!.toLowerCase())) : undefined;
  const listenerTitle = !line || !needsListener(line, project.data?.formatRules ?? undefined) || unknown || !line.listener ? '청자 미상' : listenerLabel(line.listener);

  const title = line ? (
    hasDialogueContext ? (
      <Inline as="span" inline gap="snug" minWidth={0}>
        <Text truncate>{speakerTitle}</Text>
        {!unknown && line.listener && (
          <>
            <Text tone="subtle">→</Text>
            <Text truncate>{listenerTitle}</Text>
          </>
        )}
      </Inline>
    ) : (
      <Text truncate>{line.group.title}</Text>
    )
  ) : (
    '…'
  );

  const kind = line ? (
    hasDialogueContext ? (
      <span>{kindLabel} · #{line.seq}</span>
    ) : (
      <Text truncate title={line.source}>{kindLabel} · #{line.seq} · {line.source}</Text>
    )
  ) : (
    '줄'
  );

  const metadata = line && (
    <>
      {status && <Inline as="span" inline gap="tight"><StatusIcon status={status} />{status.name}</Inline>}
      {line.statusBy === 'ai' && <AiMark by="ai" />}
      {showScene ? <Text asChild truncate underline="hover"><Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id }}>{line.group.title}</Link></Text> : <Text truncate>{line.group.title}</Text>}
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
      {line && editor && <Section><TranslationEditor projectId={projectId} unit={{ id: line.id, source: line.source, translation: line.translation, statusId: line.statusId, statusBy: line.statusBy, candidates: line.candidates }} statuses={statuses.data?.statuses ?? []} /></Section>}
      {line && (
        <>
          <Section title="정보">
            <KeyValue>
              <KeyValueRow label="대사 키">
                <Inline as="span" align="start" gap="tight" minWidth={0}>
                  <Text as="code" minWidth={0} grow paddingTop="tight" mono variant="caption" breakWords="all" tone="muted">{line.key}</Text>
                  <CopyButton value={line.key} label="대사 키 복사" />
                </Inline>
              </KeyValueRow>
              <KeyValueRow label="원문">
                <Inline as="span" align="start" gap="tight" minWidth={0}>
                  <Text minWidth={0} grow preserveLines breakWords paddingTop="hair">{line.source}</Text>
                  <CopyButton value={line.source} label="원문 복사" />
                </Inline>
              </KeyValueRow>
              <KeyValueRow label="장면">
                {showScene ? <Text asChild display="block" truncate underline="hover"><Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id }} title={line.group.title}>{line.group.title}</Link></Text> : <Text display="block" truncate title={line.group.title}>{line.group.title}</Text>}
              </KeyValueRow>
              {line.kind === 'dialogue' && (line.graphNodes.length > 0 || group.data?.kind === 'scene') && (
                <KeyValueRow label="대사 그래프">
                  {line.graphNodes.length ? (
                    <Box as="ul" spaceY="tight">
                      {line.graphNodes.map((item) => (
                        <Box as="li" key={item.id} minWidth={0}>
                          <Stack asChild direction="row" align="center" gap="snug" minWidth={0} underline="hover">
                            <Link
                              to="/p/$projectId/graph"
                              params={{ projectId }}
                              search={{ scope: 'dialogue', scene: line.group.id, node: item.id, jump: true }}
                            >
                              <Icon icon={Network} size="sm" shrink={false} tone="muted" />
                              <Text minWidth={0} truncate>{item.key}에서 열기</Text>
                            </Link>
                          </Stack>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Text asChild display="block" truncate underline="hover">
                      <Link
                        to="/p/$projectId/graph"
                        params={{ projectId }}
                        search={{ scope: 'dialogue', scene: line.group.id, ...(graphTarget && { node: graphTarget.id, jump: true }) }}
                      >
                        그래프에서 열기
                      </Link>
                    </Text>
                  )}
                </KeyValueRow>
              )}
              {line.speaker && <KeyValueRow label="화자"><SpeakerCard projectId={projectId} name={line.speaker}><SpeakerIdentity speaker={line.speaker} color={colorOf(line.speaker)} /></SpeakerCard></KeyValueRow>}
              {line.speech && <KeyValueRow label="말투 규칙"><Text asChild display="block" truncate underline="hover"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: line.speech.ruleId }} title={line.speech.rule}>{line.speech.rule}</Link></Text></KeyValueRow>}
              {line.speaker && <KeyValueRow label="인물"><Text asChild display="block" truncate underline="hover"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'characters', ...(speakerPerson && { item: speakerPerson.id }) }}>보기</Link></Text></KeyValueRow>}
            </KeyValue>
            {line.speaker && <LineHints projectId={projectId} line={{ id: line.id, source: line.source, translation: line.translation, speaker: line.speaker, listener: line.listener, lastRun: lastRun ? { issues: lastRun.data.issues ?? [] } : null }} part="context" />}
          </Section>

          <Section title="속성">
            <Box spaceY="normal">
              {needsListener(line, project.data?.formatRules ?? undefined) && (
                <Field label="청자">
                  <Stack minWidth={0} align="start" gap="tight">
                    <ListenerPicker line={{ speaker: line.speaker, listener: line.listener, listenerOrigin: line.listenerOrigin, listenerConfidence: line.listenerConfidence, sceneNames: line.sceneNames }} cast={cast} onPick={(listener) => patch.mutate({ listener })} />
                  </Stack>
                </Field>
              )}
              <Field label="번역 대상">
                <Select value={line.translate ?? (ruleReason ? 'exclude' : 'include')} onValueChange={(value) => patch.mutate({ translate: value as LineTranslate })}>
                  <SelectTrigger width="full" aria-label="번역 대상">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="include">번역 대상</SelectItem>
                    <SelectItem value="exclude">제외</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="태그">
                <TagListEditor
                  tags={orderedTags}
                  allTags={tags}
                  onToggle={(tagId, add) => patch.mutate({ tagIds: add ? [...line.tagIds, tagId] : line.tagIds.filter((id) => id !== tagId) })}
                  onCreate={createTagInline}
                  heading="줄에 붙일 태그"
                />
              </Field>
              <Field label="메모" action={!line.note && !noting ? <Button variant="ghost" size="inline" onClick={() => setNoting(true)}>메모 추가</Button> : undefined}>
                {line.note || noting ? <LineNote unitId={line.id} note={line.note} editing={noting} onEditing={setNoting} /> : null}
              </Field>
            </Box>
          </Section>

          <CandidatesAndMatches unit={line} draft={draft} onUse={useText} tokenPattern={tokenPattern} />

          <HistorySection projectId={projectId} history={line.history} />

          <Section title="검증">
            <LineChecks projectId={projectId} source={line.source} text={draft} rules={project.data?.formatRules} targetLanguage={project.data?.targetLanguage} speech={line.speech} lastRun={lastRun ? { runId: lastRun.runId, workflowName: lastRun.workflowName, issues: lastRun.data.issues ?? [] } : null} />
          </Section>

          <Section title="AI 프롬프트" defaultOpen={false}>
            <AiContextPanel projectId={projectId} unitKey={line.key} unitKind={line.kind} aiNode={aiNode} onAiNode={onAiNode} />
          </Section>
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
    <Section title={`번역 후보 ${unit.candidates.length + rows.length}`} actions={<>
      <AiButton variant="ghost" prompt={`${subject}의 번역 후보를 제안해줘.`}>AI 제안</AiButton>
      {unit.translation && <AiButton variant="ghost" send={false} prompt={`${subject}의 번역을 이렇게 다듬어줘: `}>다듬기</AiButton>}
    </>}>
      <Box spaceY="comfortable">
        <Group spaceY="condensed" title={<>{title} <Text weight="normal" tone="muted" tabular>{unit.candidates.length}</Text></>}>
          <InspectorList>
            {unit.candidates.map((candidate) => {
              const current = candidate.text === (unit.translation ?? null);
              return (
                <ListItem key={candidate.id} paddingY="tight">
                  <CandidateCard
                    text={<TokenText text={candidate.text} source={unit.source} pattern={tokenPattern} />}
                    current={current}
                    source={<Chip variant="outline">{ORIGIN[candidate.origin]}</Chip>}
                    meta={<Text truncate>{[candidate.model, dateTime(candidate.createdAt)].filter(Boolean).join(' · ')}</Text>}
                    action={current ? <Text shrink={false} weight="medium" tone="default">현재 번역</Text> : useButton(candidate.text)}
                  />
                </ListItem>
              );
            })}
            {!unit.candidates.length && <Box as="li" paddingY="condensed" variant="body" tone="muted">아직 후보가 없습니다.</Box>}
          </InspectorList>
        </Group>
        <Group spaceY="condensed" title={<>TM <Text weight="normal" tone="muted" tabular>{rows.length}</Text></>}>
          <InspectorList>
            {rows.map((match) => {
              const current = match.translation === (unit.translation ?? null);
              return (
                <ListItem key={match.unitId} paddingY="tight">
                  <CandidateCard
                    text={<>
                      <TokenText text={match.translation} source={unit.source} pattern={tokenPattern} />
                      {match.diff && (
                        <Text display="block" marginTop="tight" variant="caption" tone="muted">
                          <Text tone="subtle" marginRight="tight">원문 차이</Text>
                          {match.diff.map((word, at) => <EditorChangedWord key={at} changed={word.changed}>{at > 0 && ' '}{word.text}</EditorChangedWord>)}
                        </Text>
                      )}
                    </>}
                    current={current}
                    source={<Chip variant="outline">{match.score === 100 ? '같은 원문' : `비슷함 ${match.score}%`}{match.final ? '' : ' · 미확정'}</Chip>}
                    meta={<Text truncate>{[match.speaker, match.listener && `→ ${listenerLabel(match.listener)}`].filter(Boolean).join(' ') || match.groupTitle}</Text>}
                    action={current ? <Text shrink={false} weight="medium" tone="default">현재 번역</Text> : useButton(match.translation)}
                  />
                </ListItem>
              );
            })}
            {!rows.length && <Box as="li" paddingY="condensed" variant="body" tone="muted">{matches.isPending ? '찾는 중…' : '같거나 비슷한 원문이 없습니다.'}</Box>}
          </InspectorList>
        </Group>
      </Box>
    </Section>
  );
}

/** Runs that touched this line; open only when there are any. */
function HistorySection({ projectId, history }: { projectId: string; history: LineRecord['history'] }) {
  return (
    <Section title={`이력 ${history.length}`} defaultOpen={history.length > 0}>
      {history.length ? (
        <InspectorList body>
          {history.map((item) => (
            <ListItem key={item.id} spaceY="hair" paddingY="condensed">
              <Inline minWidth={0} gap="condensed">
                <Text asChild minWidth={0} grow truncate weight="medium" underline="hover">
                  <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: item.runId }}>
                    {item.workflowName}
                  </Link>
                </Text>
                <Text shrink={false} variant="caption" tone="muted">{STATE[item.state]}</Text>
                <Text shrink={false} variant="caption" tone="subtle">{dateTime(item.createdAt)}</Text>
              </Inline>
              {item.data.issues?.[0] && <Text as="p" truncate variant="caption" tone="warning">{item.data.issues[0]}</Text>}
              {item.error && <Text as="p" variant="caption" tone="danger">{item.error}</Text>}
            </ListItem>
          ))}
        </InspectorList>
      ) : (
        <Text as="p" variant="body" tone="muted">이 줄이 포함된 실행이 없습니다.</Text>
      )}
    </Section>
  );
}

/** The last run's findings, the speech rule and the format checks of the line's current draft. */
function LineChecks({ projectId, source, text, rules, targetLanguage, speech, lastRun }: { projectId: string; source: string; text: string; rules?: FormatRules; targetLanguage?: string; speech?: { listener: string; ruleId: string; rule: string; level: SpeechLevel; byOrder: boolean; routeDependent?: boolean; others?: boolean } | null; lastRun: { runId: string; workflowName: string; issues: string[] } | null }) {
  const formatIssues = text.trim() ? checkFormat(source, text, editorChecks(targetLanguage, true), rules) : [];
  const guessed = text.trim() ? speechLevelOf(text) : null;
  return (
    <Box spaceY="comfortable">
      <Group title={lastRun ? <>지적 · <Text asChild weight="normal" tone="muted" underline="hover"><Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: lastRun.runId }}>{lastRun.workflowName}</Link></Text></> : '지적'}>
        {lastRun?.issues.length ? (
          <Box as="ul" spaceY="tight" variant="body" tone="warning">{lastRun.issues.map((issue, i) => <DetailIssue key={i}>{issue}</DetailIssue>)}</Box>
        ) : (
          <Text as="p" variant="body" tone="muted">최근 실행에서 지적된 내용이 없습니다.</Text>
        )}
      </Group>
      {speech && (
        <Group title={`말투 → ${speech.others ? "그 밖의 인물" : listenerLabel(speech.listener)}${speech.routeDependent ? ' (루트에 따라 달라 대본 순서 기준)' : speech.byOrder ? ' (그래프 밖이라 대본 순서 기준)' : ''}`}>
          <Inline gap="condensed" variant="body">
            <Text asChild minWidth={0} truncate underline="hover">
              <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: speech.ruleId }}>
                {speech.rule}
              </Link>
            </Text>
            <Text marginLeft="auto" shrink={false} variant="caption" tone={!guessed || speech.level === 'other' ? 'muted' : guessed === speech.level ? 'success' : 'warning'}>
              {!guessed || speech.level === 'other' ? '' : guessed === speech.level ? '맞음 · 추정' : `번역은 ${SPEECH_LEVEL_LABELS[guessed]} · 추정`}
            </Text>
          </Inline>
        </Group>
      )}
      <Group title="형식">
        {!text.trim() ? (
          <Text as="p" variant="body" tone="muted">번역이 없습니다.</Text>
        ) : formatIssues.length ? (
          <Box as="ul" spaceY="tight" variant="body" tone="warning">
            {formatIssues.map((issue) => (
              <DetailIssue key={issue.code}>{issue.message}</DetailIssue>
            ))}
          </Box>
        ) : (
          <Inline as="p" gap="snug" variant="body" tone="success">
            <Icon icon={CircleCheck} size="sm" />
            원문과 맞습니다.
          </Inline>
        )}
      </Group>
    </Box>
  );
}
