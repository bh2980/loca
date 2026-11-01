import { createAndAttachTag } from '@/lib/create-tag';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CircleAlert, CircleCheck, Network, Pencil } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { CHARACTER_ROLE_LABELS, sameTranslation, checkFormat, exclusionReason, isUnknownListener, type LineTranslate, listenerLabel, needsListener, SPEECH_LEVEL_LABELS, speechLevelOf, TAG_SCOPES, type FormatRules, type SpeechLevel } from '@tw/shared';
import { AiMark, Chip, Box, Button, CandidateCard, DetailIssue, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EditorChangedWord, EditorDiffWord, Group, HistoryDay, HistoryDiff, HistoryEntry, HistoryFolded, HistoryFoldedRow, type HistoryActor, Icon, Inline, InspectorHeader, Inspector, InspectorList, InspectorTabs, SegmentedControl, SpeakerIdentity, StatusIcon, Switch, TagListEditor, Text, ListItem, Section, KeyValue, KeyValueRow } from '@loca/ui';
import { changeLines, patchedLine, useLineDetail } from '@/lib/units';
import { AiButton } from '@/components/ai-button';
import { AiContextPanel } from '@/components/ai-context';
import { TranslationEditor } from '@/components/translation-editor';
import { AiSuggestion, suggestionFrom } from '@/components/ai-suggestion';
import { wordDiff } from '@/lib/diff';
import { useSaveLine } from '@/lib/line-save';
import { useUsedTerms } from '@/components/script/line-row';
import { LineNote } from '@/components/script/line-note';
import { TokenText } from '@/components/editor/source-text';
import { replaceLineText } from '@/components/editor/translation-input';
import { ListenerPicker } from '@/components/script/listener-picker';
import { SpeakerCard } from '@/components/script/speaker-card';
import { SourceEditor } from '@/components/script/source-editor';
import { client } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { lineTags, q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { editorChecks, tokenPatternOf } from '@/lib/line-context';
import { byDay, dayLabel, hourMinute } from '@/lib/datetime';
import { useInspectorTab } from '@/lib/inspector-tab';
import { usePersonColors } from '@/lib/person-colors';
import { type Character, useCharacters, useRelationships, useTaxonomy } from '@/lib/knowledge';
import { useGroup } from '@/lib/groups';
import { useProject } from '@/lib/project';
import type { LineDetail as LineDetailData } from '@/lib/units';

/** Who left a text that no run left, on the history's timeline: a mark and a name. */
const ORIGIN: Record<'ai' | 'human' | 'import' | 'tool', { actor: HistoryActor; mark: string; name: string }> = {
  ai: { actor: 'ai', mark: 'AI', name: 'AI' },
  human: { actor: 'person', mark: '사', name: '사람' },
  import: { actor: 'neutral', mark: '가', name: '가져옴' },
  tool: { actor: 'neutral', mark: '도', name: '도구' },
};
/** The line pane's tabs: the line (what to decide it with), its history, the AI's prompt. */
const LINE_TABS = ['line', 'history', 'prompt'] as const;
export type LineTab = (typeof LINE_TABS)[number];
/** How many entries of 비슷한 번역 show before 더 보기. */
const FIRST_FEW = 3;
const STATE = { queued: '대기', running: '실행 중', done: '완료', failed: '실패', cancelled: '취소됨' } as const;
type LineRecord = LineDetailData;

/**
 * The selected line, deep, in three tabs. 대사: an AI 제안 waiting on it, translations of similar lines (TM), who speaks how
 * and the checks. 이력: the line's texts and the runs that touched it, as a timeline. AI 프롬프트: the AI's prompt context.
 * The tab opens as the URL names it, else as the last line was left (useInspectorTab).
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
  tab: urlTab,
  onTab,
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
  /** The tab the URL names; `onTab` writes a picked one back to it. */
  tab?: LineTab;
  onTab?: (tab: LineTab) => void;
}) {
  // Drawn from the line's row at once; what only the server knows (rule, nodes, history) fills in after.
  const unit = useLineDetail(projectId, unitId, { partial: true });
  const taxonomy = useTaxonomy(projectId);
  const project = useProject(projectId);
  const people = useCharacters(projectId);
  const colorOf = usePersonColors(projectId);
  const group = useGroup(projectId, unit.data?.group.id);
  const [draft, setDraft, , base] = useDraft(`line:${unitId}`, unit.data?.translation ?? '');
  const [noting, setNoting] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  const [tab, setTab] = useInspectorTab('line', LINE_TABS, urlTab, onTab);
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
      <span>{kindLabel}{line.seq != null && ` · #${line.seq}`}</span>
    ) : (
      <Text truncate title={line.source}>{kindLabel}{line.seq != null && ` · #${line.seq}`} · {line.source}</Text>
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

  const history = line ? historyOf(line) : null;
  const linePart = line && (
    <>
      {editor && <Section><TranslationEditor projectId={projectId} unit={{ id: line.id, source: line.source, translation: line.translation, statusId: line.statusId, statusBy: line.statusBy }} statuses={taxonomy.statuses ?? []} /></Section>}
      {/* The editor in this pane shows the AI 제안 and TM itself. */}
      {!editor && <AiSuggestion framed projectId={projectId} unit={line} draft={draft} dirty={!sameTranslation(draft, line.translation)} base={base} onDraft={useText} />}
      {!editor && <SimilarSection unit={line} draft={draft} onUse={useText} tokenPattern={tokenPattern} />}
      {(line.speaker || line.speech) && <PeopleSection projectId={projectId} line={line} speakerPerson={speakerPerson} listening={listening} listenerPicker={listenerPicker} people={people.data ?? []} />}
      <Section title="검증" collapsible persistKey="line.checks">
        <LineChecks projectId={projectId} source={line.source} kind={line.kind} text={draft} rules={project.data?.formatRules} targetLanguage={project.data?.targetLanguage} speech={line.speech} lastRun={lastRun ? { runId: lastRun.runId, workflowName: lastRun.workflowName, issues: lastRun.data.issues ?? [] } : null} />
      </Section>
    </>
  );
  // Inside another pane (a folded row of a node): the 대사 tab's sections without the pane around them, and a way to the rest.
  if (bare)
    return line ? (
      <>
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
        {linePart}
        <Box paddingX="comfortable" paddingY="condensed">
          <Text asChild variant="caption" tone="accent" underline="hover">
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id, detail: true }}>상세에서 열기 · 이력과 AI 프롬프트 →</Link>
          </Text>
        </Box>
      </>
    ) : null;

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
      tabs={line && <InspectorTabs<LineTab> value={tab} onChange={setTab} items={[{ value: 'line', label: '대사' }, { value: 'history', label: '이력', count: unit.extrasReady ? history!.count : null }, { value: 'prompt', label: 'AI 프롬프트' }]} />}
      scrollKey={tab}
      footer={line?.statusBy === 'ai' ? <Button type="button" disabled={check.isPending} onClick={() => check.mutate()}>확인함</Button> : undefined}
      loading={!line}
    >
      {tab === 'line' && linePart}
      {tab === 'history' && line && <HistoryTab projectId={projectId} unit={line} tokenPattern={tokenPattern} ready={unit.extrasReady} />}
      {tab === 'prompt' && line && (
        <Section>
          <AiContextPanel projectId={projectId} unitKey={line.key} unitKind={line.kind} aiNode={aiNode} onAiNode={onAiNode} />
        </Section>
      )}
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
    <Section title="비슷한 번역" count={matches.isPending ? '…' : rows.length} collapsible persistKey="line.similar" actions={<>
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
 * Who speaks to whom and how: the speaker (with their role, and 플레이어), the listener (picked here), the speech rule
 * between them, the speaker's profile and habit, how they stand with the listener, and a way to the person. Only what the
 * project knows; a missing fact reads 없음.
 */
function PeopleSection({ projectId, line, speakerPerson, listening, listenerPicker, people }: {
  projectId: string;
  line: LineRecord;
  speakerPerson: Character | undefined;
  listening: boolean;
  listenerPicker: ReactNode;
  people: Character[];
}) {
  const relationships = useRelationships(projectId);
  const colorOf = usePersonColors(projectId);
  const none = <Text weight="normal" tone="muted">없음</Text>;
  const lower = line.listener?.toLowerCase();
  const listenerPerson = lower ? people.find((person) => person.name.toLowerCase() === lower || person.aliases.some((alias) => alias.toLowerCase() === lower)) : undefined;
  const relation = speakerPerson && listenerPerson && relationships.data?.find((item) => (item.fromId === speakerPerson.id && item.toId === listenerPerson.id) || (item.mutual && item.fromId === listenerPerson.id && item.toId === speakerPerson.id));
  const about = speakerPerson ? [speakerPerson.role !== 'unknown' && CHARACTER_ROLE_LABELS[speakerPerson.role], speakerPerson.player && '플레이어'].filter(Boolean).join(' · ') : '';
  return (
    <Section title="말투와 인물" collapsible persistKey="line.people">
      <KeyValue align="start">
        {line.speaker && (
          <KeyValueRow label="화자">
            <Inline as="span" inline gap="tight" minWidth={0}>
              <SpeakerCard projectId={projectId} name={line.speaker}><SpeakerIdentity speaker={line.speaker} color={colorOf(line.speaker)} /></SpeakerCard>
              {about && <Text weight="normal" tone="muted" truncate>· {about}</Text>}
            </Inline>
          </KeyValueRow>
        )}
        <KeyValueRow label="청자">{listenerPicker ?? (line.listener ? listenerLabel(line.listener) : listening ? none : <Text weight="normal" tone="muted">필요 없음</Text>)}</KeyValueRow>
        <KeyValueRow label="말투 규칙">
          {line.speech ? <Text asChild display="block" truncate underline="hover"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: line.speech.ruleId }} title={line.speech.rule}>{line.speech.rule}</Link></Text> : none}
        </KeyValueRow>
        {line.speaker && (
          <>
            <KeyValueRow label="프로필">{speakerPerson?.profile.trim() ? <Text weight="normal" breakWords>{speakerPerson.profile}</Text> : none}</KeyValueRow>
            <KeyValueRow label="말버릇">{speakerPerson?.speech.trim() ? <Text weight="normal" breakWords>{speakerPerson.speech}</Text> : none}</KeyValueRow>
            {listenerPerson && <KeyValueRow label="관계">{relation ? <Text weight="normal" breakWords>{[relation.kind, relation.description].filter(Boolean).join(' — ')}</Text> : none}</KeyValueRow>}
            <KeyValueRow label="인물">
              <Text asChild display="block" truncate tone="accent" underline="hover">
                <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'characters', ...(speakerPerson && { item: speakerPerson.id }) }}>{speakerPerson ? `${speakerPerson.name} 보기 →` : '인물 목록 보기 →'}</Link>
              </Text>
            </KeyValueRow>
          </>
        )}
      </KeyValue>
      {!line.speech && listening && <Text as="p" variant="caption" tone="subtle">청자를 정하면 그 쌍의 말투 규칙이 여기에 붙습니다.</Text>}
    </Section>
  );
}

/**
 * The line's history, newest first: every text it had (one entry per text; the same text left again in a row is one
 * entry, ×n) and, apart, the runs that left no text (a check that changed nothing, a failure). Waiting suggestions are
 * not history (the AI 제안 on the 대사 tab).
 */
function historyOf(unit: LineRecord) {
  const texts = unit.candidates.filter((candidate) => candidate.state !== 'pending');
  const ownRuns = new Set(texts.map((candidate) => candidate.runId).filter(Boolean));
  const entries: { key: string; at: number; candidate: (typeof texts)[number]; times: number; current: boolean }[] = [];
  for (const candidate of texts.toSorted((a, b) => time(b.createdAt) - time(a.createdAt))) {
    const last = entries.at(-1);
    const current = candidate.id === unit.candidateId;
    if (last && last.candidate.state === candidate.state && sameTranslation(last.candidate.text, candidate.text)) {
      last.times += 1;
      last.current = last.current || current;
    } else entries.push({ key: `c:${candidate.id}`, at: time(candidate.createdAt), candidate, times: 1, current });
  }
  const runs = unit.history.filter((run) => !ownRuns.has(run.runId)).map((run) => ({ key: `r:${run.id}`, at: time(run.createdAt), run }));
  return { texts, entries, runs, count: entries.length + runs.length };
}

type HistoryFilter = 'all' | 'texts' | 'runs';

/**
 * The 이력 tab: the line's history as a timeline in days. An entry says who left the text (a workflow and its step, a
 * person, the AI), when (always shown), the text and what it changed from the one before (이전 / 이후), with 되돌리기 and
 * 실행 기록 보기 under it. The runs that left the text as it was fold into one box under the timeline. 전체 · 번역만 · 실행
 * narrow it.
 */
function HistoryTab({ projectId, unit, tokenPattern, ready }: { projectId: string; unit: LineRecord; tokenPattern: RegExp | null; /** The line's texts and runs have come (the pane draws before them). */ ready: boolean }) {
  const save = useSaveLine(projectId);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const runs = new Map(unit.history.map((run) => [run.runId, run]));
  const { texts, entries, runs: quietRuns } = historyOf(unit);
  type Version = (typeof texts)[number];
  // The text each one changed from: the next older one the line had (a declined suggestion was never the line's).
  const kept = texts.filter((candidate) => candidate.state === 'history');
  const before = (candidate: Version) => kept.find((older) => time(older.createdAt) < time(candidate.createdAt) && !sameTranslation(older.text, candidate.text));
  const restore = (candidate: Version) =>
    save.mutate({ unitId: unit.id, candidateId: candidate.id, candidateText: candidate.text, base: unit.translation }, {
      onSuccess: () => toast.success(candidate.state === 'declined' ? 'AI 제안을 적용했습니다.' : '이 번역으로 되돌렸습니다.'),
      onError: (error) => toast.error(error.message),
    });
  const runLink = (runId: string, label: string) => <Text asChild tone="accent" underline="hover"><Link to="/p/$projectId/runs/$runId" params={{ projectId, runId }}>{label}</Link></Text>;
  const timeline = [
    ...(filter === 'runs' ? entries.filter((entry) => entry.candidate.runId) : entries),
    ...(filter === 'runs' ? quietRuns : []),
  ].sort((a, b) => b.at - a.at);

  const textEntry = (entry: (typeof entries)[number]) => {
    const { candidate } = entry;
    const declined = candidate.state === 'declined';
    const run = candidate.runId ? runs.get(candidate.runId) : undefined;
    const previous = declined ? kept.find((older) => older.id === unit.candidateId) : before(candidate);
    const canTake = !entry.current && !sameTranslation(candidate.text, unit.translation);
    const who = candidate.runId
      ? { actor: 'workflow' as const, mark: 'W', name: run ? `워크플로 '${run.workflowName}'` : '워크플로', what: candidate.step ?? (previous ? '수정' : '첫 번역') }
      : { ...ORIGIN[candidate.origin], what: declined ? '제안 거절함' : candidate.origin === 'human' ? '직접 고침' : candidate.origin === 'ai' ? 'AI 제안 적용' : undefined };
    const diff = previous && wordDiff(previous.text.trim(), candidate.text.trim());
    return (
      <HistoryEntry
        key={entry.key}
        actor={who.actor}
        mark={who.mark}
        title={who.name}
        meta={who.what}
        muted={declined}
        badges={<>
          {entry.current && <Chip variant="outline">현재 번역</Chip>}
          {entry.times > 1 && <Text variant="caption" tone="muted" tabular>×{entry.times}</Text>}
        </>}
        time={hourMinute(candidate.createdAt)}
        actions={(canTake || run || (!candidate.runId && candidate.model)) && <>
          {canTake && <Button variant="ghost" size="inline" tone="accent" disabled={save.isPending} onClick={() => restore(candidate)}>{declined ? '적용' : '되돌리기'}</Button>}
          {run && runLink(run.runId, '실행 기록 보기')}
          {!candidate.runId && candidate.origin === 'ai' && candidate.model && <Text tone="subtle">제안: {suggestionFrom(candidate)}</Text>}
        </>}
      >
        <Text as="p" breakWords preserveLines>
          <TokenText text={candidate.text} source={unit.source} pattern={tokenPattern} />
        </Text>
        {diff && (
          <HistoryDiff
            before={diff.filter((part) => part.change !== 'added').map((part, index) => <EditorDiffWord key={index} change={part.change === 'removed' ? 'removed' : undefined}>{part.text}</EditorDiffWord>)}
            after={diff.filter((part) => part.change !== 'removed').map((part, index) => <EditorDiffWord key={index} change={part.change === 'added' ? 'added' : undefined}>{part.text}</EditorDiffWord>)}
          />
        )}
        {run?.data.issues?.[0] && <Text as="p" variant="caption" tone="warning">{run.data.issues[0]}</Text>}
      </HistoryEntry>
    );
  };
  const runEntry = (entry: (typeof quietRuns)[number]) => (
    <HistoryEntry
      key={entry.key}
      actor="workflow"
      mark="W"
      title={`워크플로 '${entry.run.workflowName}'`}
      meta={entry.run.step ?? STATE[entry.run.state]}
      time={hourMinute(entry.run.createdAt)}
      actions={runLink(entry.run.runId, '실행 기록 보기')}
    >
      {(entry.run.error ?? entry.run.data.issues?.[0]) && <Text as="p" variant="caption" tone={entry.run.error ? 'danger' : 'warning'}>{entry.run.error ?? entry.run.data.issues?.[0]}</Text>}
      {!entry.run.error && !entry.run.data.issues?.length && <Text as="p" variant="caption" tone="muted">번역은 그대로 · {STATE[entry.run.state]}</Text>}
    </HistoryEntry>
  );

  return (
    <Section>
      <SegmentedControl variant="pills" ariaLabel="이력 거르기" value={filter} onChange={(next) => setFilter(next as HistoryFilter)} items={[{ value: 'all', label: '전체' }, { value: 'texts', label: '번역만' }, { value: 'runs', label: '실행' }]} />
      {!ready ? (
        <Text as="p" variant="caption" tone="subtle">이력을 불러오는 중…</Text>
      ) : timeline.length ? (
        byDay(timeline, (entry) => entry.at).map((day) => (
          <HistoryDay key={day.key} label={dayLabel(day.key)}>
            {day.items.map((entry) => ('run' in entry ? runEntry(entry) : textEntry(entry)))}
          </HistoryDay>
        ))
      ) : (
        <Text as="p" variant="caption" tone="subtle">{filter === 'runs' ? '이 줄이 포함된 실행이 없습니다.' : '아직 번역이 없습니다.'}</Text>
      )}
      {ready && filter === 'all' && quietRuns.length > 0 && (
        <HistoryFolded label={`번역에 영향 없는 실행 ${quietRuns.length}건`}>
          {quietRuns.map(({ key, run }) => (
            <HistoryFoldedRow
              key={key}
              title={runLink(run.runId, run.workflowName)}
              meta={run.step ?? undefined}
              end={<Text tone={run.state === 'failed' ? 'danger' : run.state === 'done' ? 'success' : 'muted'}>{STATE[run.state]} {hourMinute(run.createdAt)}</Text>}
            />
          ))}
        </HistoryFolded>
      )}
    </Section>
  );
}

/** The last run's findings, the speech rule and the format checks of the line's current draft. */
function LineChecks({ projectId, source, kind, text, rules, targetLanguage, speech, lastRun }: { kind?: string; projectId: string; source: string; text: string; rules?: FormatRules; targetLanguage?: string; speech?: { listener: string; ruleId: string; rule: string; level: SpeechLevel; byOrder: boolean; routeDependent?: boolean; others?: boolean } | null; lastRun: { runId: string; workflowName: string; issues: string[] } | null }) {
  const formatIssues = text.trim() ? checkFormat(source, text, editorChecks(targetLanguage, true), rules) : [];
  // The confirmed terms the source uses, each with whether the translation has its Korean form.
  const usedTerms = useUsedTerms(projectId, { source, kind });
  const lower = text.toLowerCase();
  const guessed = text.trim() ? speechLevelOf(text) : null;
  return (
    <Box spaceY="comfortable">
      <Group nested title={lastRun ? <>지적 · <Text asChild weight="normal" tone="muted" underline="hover"><Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: lastRun.runId }}>{lastRun.workflowName}</Link></Text></> : '지적'}>
        {lastRun?.issues.length ? (
          <Box as="ul" spaceY="tight" variant="body" tone="warning">{lastRun.issues.map((issue, i) => <DetailIssue key={i}>{issue}</DetailIssue>)}</Box>
        ) : (
          <Text as="p" variant="body" tone="muted">최근 실행에서 지적된 내용이 없습니다.</Text>
        )}
      </Group>
      {speech && (
        <Group nested title={`말투 → ${speech.others ? "그 밖의 인물" : listenerLabel(speech.listener)}${speech.routeDependent ? ' (루트에 따라 달라 대본 순서 기준)' : speech.byOrder ? ' (그래프 밖이라 대본 순서 기준)' : ''}`}>
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
      {usedTerms.length > 0 && (
        <Group nested title="용어">
          <Box as="ul" spaceY="tight" variant="body">
            {usedTerms.map((term) => {
              const kept = Boolean(text.trim()) && lower.includes(term.target.toLowerCase());
              return (
                <Inline as="li" key={term.id} gap="tight" tone={kept ? undefined : 'warning'}>
                  <Icon icon={kept ? CircleCheck : CircleAlert} size="sm" tone={kept ? 'success' : 'warning'} />
                  <Text>{term.source} → {term.target}</Text>
                  {!kept && <Text variant="caption" tone="warning">{text.trim() ? '번역에 없음' : '번역 없음'}</Text>}
                </Inline>
              );
            })}
          </Box>
        </Group>
      )}
      <Group nested title="형식">
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
