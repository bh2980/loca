import { createAndAttachTag } from '@/lib/create-tag';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CircleCheck, Network, Pencil } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { sameTranslation, checkFormat, exclusionReason, isUnknownListener, type LineTranslate, listenerLabel, needsListener, SPEECH_LEVEL_LABELS, speechLevelOf, TAG_SCOPES, type FormatRules, type SpeechLevel } from '@tw/shared';
import { AiMark, Chip, Box, Button, CandidateCard, DetailIssue, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EditorChangedWord, EditorDiffWord, Group, HistoryItem, HistoryList, Icon, Inline, InspectorHeader, Inspector, InspectorList, SpeakerIdentity, StatusIcon, Switch, TagListEditor, Text, ListItem, Section, KeyValue, KeyValueRow } from '@loca/ui';
import { changeLines, patchedLine, useLineDetail } from '@/lib/units';
import { AiButton } from '@/components/ai-button';
import { AiContextPanel } from '@/components/ai-context';
import { TranslationEditor } from '@/components/translation-editor';
import { AiSuggestion, suggestionFrom } from '@/components/ai-suggestion';
import { wordDiff } from '@/lib/diff';
import { useSaveLine } from '@/lib/line-save';
import { LineHints } from '@/components/script/line-row';
import { LineNote } from '@/components/script/line-note';
import { TokenText } from '@/components/editor/source-text';
import { replaceLineText } from '@/components/editor/translation-input';
import { ListenerPicker } from '@/components/script/listener-picker';
import { SpeakerCard } from '@/components/script/speaker-card';
import { SourceEditor } from '@/components/script/source-editor';
import { client, type InferResponseType } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { lineTags, q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { editorChecks, tokenPatternOf } from '@/lib/line-context';
import { dateTime } from '@/lib/datetime';
import { usePersonColors } from '@/lib/person-colors';
import { useCharacters, useTaxonomy } from '@/lib/knowledge';
import { useGroup } from '@/lib/groups';
import { useProject } from '@/lib/project';

const ORIGIN = { ai: 'AI', human: '사람', import: '가져옴', tool: '도구' } as const;
/** How many entries of 비슷한 번역 and 이력 show before 더 보기. */
const FIRST_FEW = 3;
const STATE = { queued: '대기', running: '실행 중', done: '완료', failed: '실패', cancelled: '취소됨' } as const;
type LineRecord = InferResponseType<(typeof client.units)[':unitId']['$get']>;

/**
 * The selected line, deep, one scrolling pane: an AI 제안 waiting on it, translations of similar lines (TM), who speaks how,
 * checks, the line's 이력 (its texts and the runs that touched it) and the AI's prompt context.
 */
export function LineDetail({
  projectId,
  unitId,
  onClose,
  showScene,
  editor,
  bare,
  aiNode,
  onAiNode,
}: {
  projectId: string;
  unitId: string;
  onClose?: () => void;
  showScene?: boolean;
  /** Show the translation editor in the pane (screens without an editing row). */
  editor?: boolean;
  /** Only the sections, for a place that has its own pane (no header, no footer). */
  bare?: boolean;
  aiNode?: string;
  onAiNode: (value: string) => void;
}) {
  const unit = useLineDetail(projectId, unitId);
  const taxonomy = useTaxonomy(projectId);
  const project = useProject(projectId);
  const people = useCharacters(projectId);
  const colorOf = usePersonColors(projectId);
  const group = useGroup(projectId, unit.data?.group.id);
  const [draft, setDraft, , base] = useDraft(`line:${unitId}`, unit.data?.translation ?? '');
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

  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[]; listener?: string | null; translate?: LineTranslate | null }) => changeLines(projectId, [unitId], patchedLine(json), () => client.units[':unitId'].$patch({ param: { unitId }, json })),
    onError: (error) => toast.error(error.message),
  });
  const check = useMutation({
    mutationFn: () => changeLines(projectId, [unitId], patchedLine({ checked: true }), () => client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [unitId], checked: true } })),
    onError: (error) => toast.error(error.message),
  });

  const line = unit.data;
  const statusId = line ? line.statusId : undefined;
  const status = taxonomy.statuses?.find((item) => item.id === statusId);
  const tags = lineTags(taxonomy.tags);
  const lastRun = line?.history[0];
  const unknown = line ? isUnknownListener(line, project.data?.formatRules ?? undefined) : true;
  const cast = (people.data ?? []).filter((person) => person.status === 'confirmed').map((person) => ({ name: person.name, player: person.player }));
  const hasDialogueContext = line?.kind === 'dialogue' && Boolean(line.speaker?.trim());
  // 번역 제외: what the project's rules say about this source, and what a person's choice does.
  const ruleReason = line ? exclusionReason(line.source, project.data?.formatRules ?? undefined, project.data?.exclusionRules, project.data?.sourceLanguage) : null;
  const kindLabel = line?.kind === 'ui' ? 'UI 문자열' : line?.kind === 'document' ? '문서' : hasDialogueContext ? '대사' : '서술';
  const speakerTitle = line?.speaker || '화자 없음';
  const speakerPerson = line?.speaker ? people.data?.find((person) => person.name.toLowerCase() === line.speaker!.toLowerCase() || person.aliases.some((alias) => alias.toLowerCase() === line.speaker!.toLowerCase())) : undefined;
  const listening = line ? needsListener(line, project.data?.formatRules ?? undefined) : false;

  // The listener is picked on the title itself.
  const listenerPicker = line && listening ? (
    <ListenerPicker inline arrow={false} line={{ speaker: line.speaker, listener: line.listener, listenerOrigin: line.listenerOrigin, listenerConfidence: line.listenerConfidence, sceneNames: line.sceneNames }} cast={cast} onPick={(listener) => patch.mutate({ listener })} />
  ) : null;
  const title = line ? (
    hasDialogueContext ? (
      <Inline as="span" inline gap="tight" minWidth={0}>
        <Text truncate>{speakerTitle}</Text>
        {/* The arrow is outside the control: only the listener's name is the button. */}
        {listening && (
          <>
            <Text tone="subtle">→</Text>
            {listenerPicker}
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
    </>
  );
  // The line's place in the dialogue graph: one node opens it, several are a menu, a scene line without a node opens its scene.
  const graphSearch = (node?: string) => ({ scope: 'dialogue' as const, scene: line!.group.id, ...(node && { node, jump: true as const }) });
  const graphButton = line?.kind === 'dialogue' && (line.graphNodes.length > 0 || group.data?.kind === 'scene') ? (
    line.graphNodes.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="그래프에서 열기" title="그래프에서 열기"><Network /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" width="fit">
          {line.graphNodes.map((item) => (
            <DropdownMenuItem key={item.id} asChild>
              <Link to="/p/$projectId/graph" params={{ projectId }} search={graphSearch(item.id)}>{item.key}에서 열기</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Button asChild variant="ghost" size="icon-sm" aria-label="그래프에서 열기" title="그래프에서 열기">
        <Link to="/p/$projectId/graph" params={{ projectId }} search={graphSearch(line.graphNodes[0]?.id)}><Network /></Link>
      </Button>
    )
  ) : null;
  const attachedTags = line ? tags.filter((tag) => line.tagIds.includes(tag.id)) : [];

  const createTagInline = async (name: string) => {
    if (!line) return;
    try {
      await createAndAttachTag(projectId, name, tags.length, [...TAG_SCOPES], (tagId) => patch.mutateAsync({ tagIds: [...line.tagIds, tagId] }));
      toast.success(`'${name}' 태그를 만들고 줄에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  // The tags and the note have a row under the header; whether the line is translated sits by 원문 편집.
  const translateOn = (line?.translate ?? (ruleReason ? 'exclude' : 'include')) === 'include';
  const translateSwitch = line && (
    <Inline as="span" gap="tight" title={ruleReason && line.translate == null ? `번역 제외: ${ruleReason}` : translateOn ? '번역 대상입니다' : '번역에서 제외한 줄입니다'}>
      <Text variant="caption" tone="muted">번역</Text>
      <Switch checked={translateOn} onCheckedChange={(on) => patch.mutate({ translate: on ? 'include' : 'exclude' })} aria-label="번역 대상" />
    </Inline>
  );
  const tagLine = line && (
    <Inline wrap gap="tight" role="group" aria-label="이 줄의 태그">
      <TagListEditor
        tags={attachedTags}
        allTags={tags}
        onToggle={(tagId, add) => patch.mutate({ tagIds: add ? [...line.tagIds, tagId] : line.tagIds.filter((id) => id !== tagId) })}
        onCreate={createTagInline}
        heading="줄에 붙일 태그"
      />
      {!line.note && !noting && <Button variant="ghost" size="inline" onClick={() => setNoting(true)}>＋ 메모</Button>}
    </Inline>
  );
  const memo = line && (line.note || noting) ? <LineNote projectId={projectId} unitId={line.id} note={line.note} editing={noting} onEditing={setNoting} /> : null;

  const tokenPattern = tokenPatternOf(project.data?.formatRules);
  // A taken text goes into the line's editor when it is open, else into the draft it will show.
  const useText = (text: string) => { if (!replaceLineText(unitId, text)) setDraft(text); };

  if (line && editingSource) return <SourceEditor
    projectId={projectId}
    kind={line.kind === 'dialogue' ? 'scene' : line.kind}
    unitId={line.id}
    mode="edit-unit"
    onBack={() => setEditingSource(false)}
    onSaved={() => setEditingSource(false)}
    onDeleted={() => { setEditingSource(false); onClose?.(); }}
  />;

  const body = (
    <>
      {bare && line && (
        <Box paddingX="comfortable" paddingY="condensed" spaceY="condensed">
          <Inline wrap gap="condensed">
            {listenerPicker && (
              <Inline as="span" gap="tight">
                <Text variant="caption" tone="muted">청자</Text>
                {listenerPicker}
              </Inline>
            )}
            {translateSwitch}
          </Inline>
          {tagLine}
          {memo}
        </Box>
      )}
      {line && editor && <Section><TranslationEditor projectId={projectId} unit={{ id: line.id, source: line.source, translation: line.translation, statusId: line.statusId, statusBy: line.statusBy }} statuses={taxonomy.statuses ?? []} /></Section>}
      {line && (
        <>
          {/* The editor in this pane shows the AI 제안 and TM itself. */}
          {!editor && <AiSuggestion framed projectId={projectId} unit={line} draft={draft} dirty={!sameTranslation(draft, line.translation)} base={base} onDraft={useText} />}
          {!editor && <SimilarSection unit={line} draft={draft} onUse={useText} tokenPattern={tokenPattern} />}

          {(line.speaker || line.speech) && (
            <Section title="말투와 인물">
              <KeyValue>
              {line.speaker && <KeyValueRow label="화자"><SpeakerCard projectId={projectId} name={line.speaker}><SpeakerIdentity speaker={line.speaker} color={colorOf(line.speaker)} /></SpeakerCard></KeyValueRow>}
              {line.speech && <KeyValueRow label="말투 규칙"><Text asChild display="block" truncate underline="hover"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: line.speech.ruleId }} title={line.speech.rule}>{line.speech.rule}</Link></Text></KeyValueRow>}
              {line.speaker && <KeyValueRow label="인물"><Text asChild display="block" truncate underline="hover"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'characters', ...(speakerPerson && { item: speakerPerson.id }) }}>보기</Link></Text></KeyValueRow>}
              </KeyValue>
            {line.speaker && <LineHints projectId={projectId} line={{ id: line.id, source: line.source, translation: line.translation, speaker: line.speaker, listener: line.listener, lastRun: lastRun ? { issues: lastRun.data.issues ?? [] } : null }} part="context" />}
          </Section>
          )}

          <Section title="검증">
            <LineChecks projectId={projectId} source={line.source} text={draft} rules={project.data?.formatRules} targetLanguage={project.data?.targetLanguage} speech={line.speech} lastRun={lastRun ? { runId: lastRun.runId, workflowName: lastRun.workflowName, issues: lastRun.data.issues ?? [] } : null} />
          </Section>

          <HistorySection projectId={projectId} unit={line} tokenPattern={tokenPattern} />

          <Section title="AI 프롬프트" defaultOpen={false}>
            <AiContextPanel projectId={projectId} unitKey={line.key} unitKind={line.kind} aiNode={aiNode} onAiNode={onAiNode} />
          </Section>
        </>
      )}
    </>
  );
  // Inside another pane (a folded row of a node): the sections without the pane around them.
  if (bare) return line ? body : null;

  return (
    <Inspector
      header={<InspectorHeader
        // The kind line carries the controls, so the title (who → whom) has the header's whole width.
        kind={
          <Inline gap="normal">
            <Inline as="span" gap="tight" minWidth={0} grow>
              <Text minWidth={0} truncate>{kind}</Text>
              {line && <CopyButton value={line.key} label="대사 키 복사" tip={line.key} />}
            </Inline>
            {line && (
              <>
                {translateSwitch}
                {graphButton}
                <Button type="button" variant="outline" onClick={() => setEditingSource(true)}><Pencil /> 원문 편집</Button>
              </>
            )}
          </Inline>
        }
        name={title}
        status={metadata}
        below={<>{tagLine}{memo}</>}
        onClose={onClose}
      />}
      footer={line?.statusBy === 'ai' ? <Button type="button" disabled={check.isPending} onClick={() => check.mutate()}>확인함</Button> : undefined}
      loading={!line}
    >
      {body}
    </Inspector>
  );
}

/** Translations of the same or a similar source elsewhere (TM): the first few, the rest one click away; 쓰기 puts one into the box. */
function SimilarSection({ unit, draft, onUse, tokenPattern }: { unit: LineRecord; draft: string; onUse: (text: string) => void; tokenPattern: RegExp | null }) {
  const matches = useQuery(q.lineMatches(unit.id));
  const [all, setAll] = useState(false);
  const subject = unit.kind === 'ui' ? 'UI 문자열' : unit.kind === 'document' ? '문서' : '대사';
  const rows = matches.data ?? [];
  const shown = all ? rows : rows.slice(0, FIRST_FEW);
  const inEditor = (text: string) => draft !== (unit.translation ?? '') && text === draft;
  return (
    <Section title={`비슷한 번역 ${rows.length}`} actions={<>
      <AiButton variant="ghost" prompt={`${subject}의 번역을 제안해줘.`}>AI 제안 받기</AiButton>
      {unit.translation && <AiButton variant="ghost" send={false} prompt={`${subject}의 번역을 이렇게 다듬어줘: `}>다듬기</AiButton>}
    </>}>
      <InspectorList>
        {shown.map((match) => {
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
                action={current ? <Text shrink={false} weight="medium" tone="default">현재 번역</Text> : <Button variant="ghost" disabled={inEditor(match.translation)} onClick={() => onUse(match.translation)}>{inEditor(match.translation) ? '초안에 있음' : '쓰기'}</Button>}
              />
            </ListItem>
          );
        })}
        {!rows.length && <Box as="li" paddingY="condensed" variant="body" tone="muted">{matches.isPending ? '찾는 중…' : '같거나 비슷한 원문이 없습니다.'}</Box>}
      </InspectorList>
      {rows.length > FIRST_FEW && <Button variant="ghost" size="inline" onClick={() => setAll((open) => !open)}>{all ? '접기' : `${rows.length - FIRST_FEW}개 더 보기`}</Button>}
    </Section>
  );
}

const time = (at: string | number | Date) => new Date(at).getTime();

/**
 * The line's 이력, newest first: the texts it had and the runs that touched it, one quiet entry each (who, when, two lines of
 * the text). An entry opens to the whole text and the words it changed from the one before; 되돌리기 (적용, for a declined AI
 * 제안) sits at the entry's right end. The same text left again in a row is one entry (×n). Waiting suggestions are not
 * history (the AI 제안 above). The first few show, the rest one click away.
 */
function HistorySection({ projectId, unit, tokenPattern }: { projectId: string; unit: LineRecord; tokenPattern: RegExp | null }) {
  const save = useSaveLine(projectId);
  const [all, setAll] = useState(false);
  const runs = new Map(unit.history.map((run) => [run.runId, run]));
  const texts = unit.candidates.filter((candidate) => candidate.state !== 'pending');
  type Version = (typeof texts)[number];
  // The text each one changed from: the next older one the line had (a declined suggestion was never the line's).
  const kept = texts.filter((candidate) => candidate.state === 'history');
  const before = (candidate: Version) => kept.find((older) => time(older.createdAt) < time(candidate.createdAt) && !sameTranslation(older.text, candidate.text));
  const ownRuns = new Set(texts.map((candidate) => candidate.runId).filter(Boolean));
  const sorted = [
    ...texts.map((candidate) => ({ key: `c:${candidate.id}`, at: time(candidate.createdAt), candidate, times: 1, current: candidate.id === unit.candidateId })),
    // A run that left a text is told by that text; the others (a check that changed nothing, a failure) stand alone.
    ...unit.history.filter((run) => !ownRuns.has(run.runId)).map((run) => ({ key: `r:${run.id}`, at: time(run.createdAt), run })),
  ].sort((a, b) => b.at - a.at);
  const entries: typeof sorted = [];
  for (const entry of sorted) {
    const last = entries.at(-1);
    if ('candidate' in entry && last && 'candidate' in last && last.candidate.state === entry.candidate.state && sameTranslation(last.candidate.text, entry.candidate.text)) {
      last.times += 1;
      last.current = last.current || entry.current;
    } else entries.push({ ...entry });
  }
  const shown = all ? entries : entries.slice(0, FIRST_FEW);
  const restore = (candidate: Version) =>
    save.mutate({ unitId: unit.id, candidateId: candidate.id, candidateText: candidate.text, base: unit.translation }, {
      onSuccess: () => toast.success(candidate.state === 'declined' ? 'AI 제안을 적용했습니다.' : '이 번역으로 되돌렸습니다.'),
      onError: (error) => toast.error(error.message),
    });
  const runLink = (runId: string, label: string) => <Text asChild underline="hover"><Link to="/p/$projectId/runs/$runId" params={{ projectId, runId }}>{label}</Link></Text>;
  return (
    <Section title={`이력 ${entries.length}`} defaultOpen={false}>
      {entries.length ? (
        <HistoryList>
          {shown.map((entry) => {
            if ('run' in entry) {
              const run = entry.run;
              return (
                <HistoryItem
                  key={entry.key}
                  title={runLink(run.runId, run.workflowName)}
                  badges={<Text variant="caption" tone="muted">{STATE[run.state]}</Text>}
                  time={dateTime(run.createdAt)}
                  preview={run.error ?? run.data.issues?.[0]}
                />
              );
            }
            const { candidate } = entry;
            const declined = candidate.state === 'declined';
            const run = candidate.runId ? runs.get(candidate.runId) : undefined;
            const previous = declined ? kept.find((older) => older.id === unit.candidateId) : before(candidate);
            const canTake = !entry.current && !sameTranslation(candidate.text, unit.translation);
            return (
              <HistoryItem
                key={entry.key}
                title={run ? run.workflowName : declined ? suggestionFrom(candidate) : ORIGIN[candidate.origin]}
                badges={<>
                  {entry.current && <Chip variant="outline">현재 번역</Chip>}
                  {declined && <Chip variant="outline">거절함</Chip>}
                  {entry.times > 1 && <Text variant="caption" tone="muted" tabular>×{entry.times}</Text>}
                </>}
                time={dateTime(candidate.createdAt)}
                preview={candidate.text.trim()}
                action={canTake && <Button variant="ghost" size="inline" disabled={save.isPending} onClick={() => restore(candidate)}>{declined ? '적용' : '되돌리기'}</Button>}
              >
                <Text as="p" breakWords preserveLines variant="body" tone={declined ? 'muted' : undefined}>
                  <TokenText text={candidate.text} source={unit.source} pattern={tokenPattern} />
                </Text>
                {previous && (
                  <Box spaceY="hair">
                    <Text as="p" variant="caption" tone="muted">{declined ? '지금 번역과 다른 곳' : '앞 번역과 다른 곳'}</Text>
                    <Text as="p" breakWords preserveLines variant="caption">
                      {wordDiff(previous.text.trim(), candidate.text.trim()).map((part, index) => (
                        <EditorDiffWord key={index} change={part.change === 'removed' || part.change === 'added' ? part.change : undefined}>{part.text}</EditorDiffWord>
                      ))}
                    </Text>
                  </Box>
                )}
                {run?.data.issues?.[0] && <Text as="p" variant="caption" tone="warning">{run.data.issues[0]}</Text>}
                {run && <Text as="p" variant="caption" tone="muted">{runLink(run.runId, '실행 기록 보기')}</Text>}
              </HistoryItem>
            );
          })}
        </HistoryList>
      ) : (
        <Text as="p" variant="body" tone="muted">아직 번역도, 이 줄이 포함된 실행도 없습니다.</Text>
      )}
      {entries.length > FIRST_FEW && <Button variant="ghost" size="inline" onClick={() => setAll((open) => !open)}>{all ? '접기' : `${entries.length - FIRST_FEW}개 더 보기`}</Button>}
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
          <Inline as="p" gap="tight" variant="body" tone="success">
            <Icon icon={CircleCheck} size="sm" />
            원문과 맞습니다.
          </Inline>
        )}
      </Group>
    </Box>
  );
}
