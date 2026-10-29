import { createAndAttachTag } from '@/lib/create-tag';
/** One row of the line list, with the hints and links that open under the picked line. */
import { useMemo, useState, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Ellipsis, PanelRight } from 'lucide-react';
import { toast } from 'sonner';
import { AUTO_MARKS, compileFormatRules, isUnknownListener, lineExclusion, listenerLabel, needsListener, SPECIAL_LISTENERS, TAG_SCOPES, type FormatRules, type LineMark, type ListenerOrigin, mentions, SPEECH_LEVEL_LABELS, speechLevelOf } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText, MarkedSourceText, TokenText } from '@/components/editor/source-text';
import { insertIntoLine } from '@/components/editor/translation-input';
import { LineNote } from '@/components/script/line-note';
import { withoutTokens } from '@/lib/line-context';
import {
  Button,
  Checkbox,
  AiMark,
  TagChip,
  TagSubMenu,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  SpeakerIdentity,
  Chip,
  Box,
  Inline,
  Stack,
  Text,
  Icon,
  StatusIcon,
  ListRow,
  ScriptMenuAnchor,
  ScriptReviewIssue,
  ScriptSceneRow,
  ScriptSourceStyle,
  ScriptTranslationRow,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  type StatusLike,
  DropdownMenuContent,
} from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { SOURCE_GROUP_LABEL, SOURCE_UNIT_LABEL } from '@/lib/labels';
import { SpeakerCard } from '@/components/script/speaker-card';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { useDraft } from '@/lib/drafts';
import { useSaveLine } from '@/lib/line-save';
import type { InferResponseType } from '@/lib/api';
import { usePersonColors } from '@/lib/person-colors';
import { LineMenuItems } from '@/components/script/line-menu';

/** Who the line is addressed to. Unsure AI guesses count as unknown. */
function listenerText(line: { kind: string; speaker: string | null; source: string; listener: string | null; listenerOrigin: ListenerOrigin | null; listenerConfidence: number | null }, rules: FormatRules | undefined) {
  if (isUnknownListener(line, rules) || !line.listener) return { text: '청자 미상', unknown: true };
  return { text: listenerLabel(line.listener), unknown: false };
}

/** What a line nobody says is, shown where the speaker would be. */

/**
 * The few things worth knowing while typing, as one row under the editor: does the translation
 * keep the speech rule, the confirmed terms and the source's format, and what the last run said.
 * "자세히" opens everything else in the pane.
 */
/**
 * Context and last-run guidance for the selected line's inspector.
 */
export function LineHints({ projectId, line, part }: { projectId: string; line: { id: string; source: string; translation: string | null; speaker?: string | null; listener?: string | null; lastRun: { issues: string[] } | null }; part?: 'context' | 'result' }) {
  const unit = useQuery(q.unit(line.id));
  const people = useQuery(q.characters(projectId));
  const terms = useQuery(q.terms(projectId));
  const project = useQuery(q.project(projectId));
  const [draft] = useDraft(`line:${line.id}`, line.translation ?? '');
  const text = draft.trim();
  const speech = unit.data?.speech;
  const guessed = text ? speechLevelOf(text) : null;
  // Words inside format tags (<d target="data_cassandra_…">) are not terms.
  const used = useMemo(() => {
    const { placeholder, tag } = compileFormatRules(project.data?.formatRules ?? undefined);
    const plain = [placeholder, tag].reduce((text, pattern) => withoutTokens(text, pattern), line.source);
    return (terms.data ?? []).filter((term) => term.status === 'confirmed' && term.target && mentions(plain, term.source));
  }, [terms.data, line.source, project.data?.formatRules]);

  const hint = (key: string, ok: boolean | null, label: ReactNode, title?: string) => (
    <Chip key={key} variant="card" tone={ok === false ? 'warning' : undefined} title={title}>
      {ok === true && <Icon icon={Check} size="xs" tone="success" />}
      {ok === false && <Icon icon={CircleAlert} size="xs" />}
      {label}
    </Chip>
  );
  // A term chip puts its translation at the cursor of the line's editor; it turns to a warning when the draft lacks it.
  const termChip = (term: { id: string; source: string; target: string }) => {
    const ok = text ? text.toLowerCase().includes(term.target.toLowerCase()) : null;
    return (
      <Chip
        key={term.id}
        as="button"
        variant="card"
        tone={ok === false ? 'warning' : undefined}
        type="button"
        title={ok === false ? '번역에 없음' : undefined}
        onClick={() => { if (!insertIntoLine(line.id, term.target)) toast.info('번역 칸이 열려 있지 않습니다.'); }}
      >
        {ok === true && <Icon icon={Check} size="xs" tone="success" />}
        {ok === false && <Icon icon={CircleAlert} size="xs" />}
        <span>{term.source}</span>
        <Text tone="subtle">→</Text>
        <Text weight="medium">{term.target}</Text>
      </Chip>
    );
  };
  const context = used.map(termChip);
  // Format checks of the draft sit with the editor (TranslationEditor); here only what the last run said.
  const result = line.lastRun?.issues.slice(0, 1).map((issue) => hint('run', false, issue)) ?? [];
  const items = [...(part !== 'result' ? context : []), ...(part !== 'context' ? result : [])];
  // The speech rule for this speaker → listener, written out under the source (it used to hide in a chip's tooltip).
  const ruleState = guessed === speech?.level ? 'kept' : guessed ? 'broken' : 'plain';
  const rule = part !== 'result' && speech && (
    <Stack key="speech" as="p" direction="row" align="start" gap="tight" variant="caption" tone={ruleState === 'broken' ? 'warning' : 'muted'}>
      {ruleState === 'kept' && <Icon icon={Check} size="xs" marginTop="hair" shrink={false} tone="success" />}
      {ruleState === 'broken' && <Icon icon={CircleAlert} size="xs" marginTop="hair" shrink={false} />}
      <span>
        말투 → {listenerLabel(speech.listener)}
        {speech.level !== 'other' && ` · ${SPEECH_LEVEL_LABELS[speech.level]}`}
        {guessed && guessed !== speech.level && ` (지금 ${SPEECH_LEVEL_LABELS[guessed]})`}
        {speech.rule && speech.rule !== SPEECH_LEVEL_LABELS[speech.level] && ` · ${speech.rule}`}
      </span>
    </Stack>
  );
  // Who is talking, in a line each: the speaker's habit and how they stand with the listener (the card has the rest).
  const named = (name: string | null | undefined) => {
    const lower = name?.toLowerCase();
    return lower ? people.data?.characters.find((person) => person.name.toLowerCase() === lower || person.aliases.some((alias) => alias.toLowerCase() === lower)) : undefined;
  };
  const speaker = part !== 'result' ? named(line.speaker) : undefined;
  const listener = speaker ? named(line.listener) : undefined;
  const relation = listener && people.data?.relationships.find((item) => (item.fromId === speaker!.id && item.toId === listener.id) || (item.mutual && item.fromId === listener.id && item.toId === speaker!.id));
  const about = [
    speaker?.speech && { key: 'habit', label: `${speaker.name} 말버릇`, text: speaker.speech },
    relation && { key: 'relation', label: `관계 ${speaker!.name} → ${listener!.name}`, text: [relation.kind, relation.description].filter(Boolean).join(' — ') },
  ].filter((item): item is { key: string; label: string; text: string } => !!item);
  if (!rule && !about.length && !items.some(Boolean)) return null;
  return (
    <Box marginTop="condensed" spaceY="condensed" onClick={(event) => event.stopPropagation()}>
      {/* Under the source: its term chips first (they match the underlines), then who is talking. */}
      {items.some(Boolean) && <Inline wrap gap="tight">{items}</Inline>}
      {/* Who is talking is a group of its own: tighter lines inside, more room above when chips come first. */}
      {(rule || about.length > 0) && (
        <Box spaceY="hair" paddingTop={items.some(Boolean) ? 'condensed' : undefined}>
          {rule}
          {about.map((item) => (
            <Text as="p" variant="caption" tone="muted" lines={1} key={item.key} title={item.text}>
              {item.label} · {item.text}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

type LineTag = StatusLike & { role?: string | null };
type Line = InferResponseType<(typeof client.projects)[':projectId']['units']['$get']> extends { rows: (infer Row)[] } ? Row : never;

/** One line of the list: a compact row, or the open editor when picked. */
export function LineRow({
  projectId,
  line,
  newScene,
  sceneSelection,
  selected,
  marked,
  findLabel,
  status,
  statusList,
  tags,
  tokenPattern,
  review,
  isPicked,
  arrived,
  rowRef,
  noting,
  focusTick,
  onPick,
  onSelect,
  onOpenDetail,
  onShowInGraph,
  onAddLine,
  onEditSource,
  onOpenScene,
  onArrivedEnd,
  onNoting,
  onEscape,
  onDone,
  onFilterTag,
  onFilterMark,
}: {
  projectId: string;
  line: Line;
  /** The line starts a new scene (shown with its title above). */
  newScene: boolean;
  sceneSelection?: { checked: boolean | 'indeterminate'; disabled: boolean; count?: string; onChange: (selected: boolean) => void };
  selected: boolean;
  marked: boolean | undefined;
  findLabel?: string;
  status: { name: string; color: string } | undefined;
  statusList: ComponentProps<typeof TranslationEditor>['statuses'];
  tags: LineTag[];
  tokenPattern: RegExp | null;
  review?: boolean;
  isPicked: boolean;
  /** Brought here from a link: flashes once. */
  arrived: boolean;
  rowRef?: RefObject<HTMLLIElement | null>;
  noting: boolean;
  focusTick: number;
  onPick: (on: boolean) => void;
  onSelect: () => void;
  onOpenDetail?: () => void;
  onShowInGraph?: () => void;
  /** Adds a line at the end of this line's scene (its source editor opens). */
  onAddLine?: () => void;
  /** Opens this line's source (text, speaker, key) in the editor. */
  onEditSource?: () => void;
  onOpenScene?: (groupId: string, lineId: string) => void;
  onArrivedEnd: () => void;
  onNoting: (noting: boolean) => void;
  onEscape: () => void;
  onDone: (advanced: boolean) => void;
  onFilterTag: (tagId: string) => void;
  onFilterMark: (mark: LineMark) => void;
}) {
  const project = useQuery(q.project(projectId)).data;
  const rules = project?.formatRules ?? undefined;
  // 번역 제외: hidden from the list by default (the 숨기기 filter); shown on request, it carries its mark.
  const excluded = lineExclusion(line, rules, project?.exclusionRules, project?.sourceLanguage) !== null;
  // Narration and lines of format tokens only are said to nobody: no listener slot, unless a person or the import gave one.
  const said = needsListener(line, rules) || (Boolean(line.listener) && (line.listenerOrigin === 'human' || line.listenerOrigin === 'import'));
  const who = listenerText(line, rules);
  const marks: LineMark[] = [];
  if (excluded) marks.push('excluded');
  if (line.note.trim()) marks.push('noted');
  const attachedTags = tags.filter((tag) => line.tagIds.includes(tag.id));
  const orderedTags = [...attachedTags.filter((tag) => tag.role), ...attachedTags.filter((tag) => !tag.role)];

  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[]; translate?: 'include' | 'exclude' }) => unwrap(client.units[':unitId'].$patch({ param: { unitId: line.id }, json })),
    onMutate: async (json) => ({ undo: await optimistic(queryClient, unitChanges([line.id], patchedLine(json))) }),
    onError: (error, _json, context) => {
      context?.undo();
      toast.error(error.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['units', projectId] });
      queryClient.invalidateQueries({ queryKey: ['unit', line.id] });
    },
  });

  const handleToggleTag = (tagId: string, add: boolean) => {
    const nextTagIds = add ? [...line.tagIds, tagId] : line.tagIds.filter((id) => id !== tagId);
    patch.mutate({ tagIds: nextTagIds });
  };

  const handleCreateTag = async (name: string) => {
    try {
      await createAndAttachTag(projectId, name, tags.length, [...TAG_SCOPES], (tagId) => patch.mutateAsync({ tagIds: [...line.tagIds, tagId] }));
      toast.success(`'${name}' 태그를 만들고 줄에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  const tagRow = marks.length || orderedTags.length ? (
    <Stack direction="row" wrap gap="tight" marginTop="tight" role="group" aria-label="이 줄의 태그" onClick={(event) => event.stopPropagation()}>
      {marks.map((mark) => (
        <Chip as="button" variant="bare" key={mark} title={`#${AUTO_MARKS[mark].name} 줄만 보기`} onClick={() => onFilterMark(mark)}>
          <MarkChip mark={mark} projectId={projectId} />
        </Chip>
      ))}
      {orderedTags.map((tag) => (
        <Chip as="button" variant="bare" key={tag.id} title={`#${tag.name} 줄만 보기`} onClick={() => onFilterTag(tag.id)}>
          <TagChip tag={tag} />
        </Chip>
      ))}
    </Stack>
  ) : null;
  // Lines nobody says read apart from dialogue without a label on every row: narration is muted
  // (stage directions), a document reads as prose, a UI string is one dense row with its key.
  const narration = line.kind === 'dialogue' && !line.speaker?.trim();
  const sourceTone = narration ? 'narration' : line.kind === 'document' ? 'document' : undefined;
  const header = newScene && (
    <ScriptSceneRow
      title={line.groupTitle}
      count={sceneSelection?.count}
      checkbox={sceneSelection && <Checkbox aria-label={`${line.groupTitle} 현재 검색 조건에 맞는 모든 줄 선택${sceneSelection.count ? `, ${sceneSelection.count}` : ''}`} checked={sceneSelection.checked} disabled={sceneSelection.disabled} onCheckedChange={(checked) => sceneSelection.onChange(checked === true)} />}
      trailing={onOpenScene && <Button variant="ghost" size="inline" onClick={() => onOpenScene(line.groupId, line.id)}>{SOURCE_GROUP_LABEL[line.groupKind]} 열기</Button>}
    />
  );
  const checkbox = <Checkbox aria-label={`${line.key} 선택`} checked={isPicked} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onPick(Boolean(checked))} />;
  const colorOf = usePersonColors(projectId);
  const addLineLabel = `이 ${SOURCE_GROUP_LABEL[line.groupKind]}에 ${SOURCE_UNIT_LABEL[line.groupKind]} 추가`;
  // Lines without a speaker (UI strings, documents) show their key in its place, level with the status opposite.
  const speaker = line.kind === 'ui' || line.kind === 'document' ? (
    <Text truncate mono variant="caption" tone="muted" title={line.key}>{line.key}</Text>
  ) : line.speaker ? (
    <SpeakerCard projectId={projectId} name={line.speaker}><SpeakerIdentity speaker={line.speaker} color={colorOf(line.speaker)} listener={said ? (who.unknown ? null : who.text) : undefined} listenerIsPerson={!line.listener || !Object.hasOwn(SPECIAL_LISTENERS, line.listener) && !who.unknown} /></SpeakerCard>
  ) : line.kind === 'dialogue' ? <SpeakerIdentity speaker={null} /> : null;
  const identity = (
    <Inline gap="tight" minWidth={0}>
      {speaker}
      {marked && <Text shrink={false} tone="warning">● {findLabel}</Text>}
    </Inline>
  );
  const statusContent = (
    <Inline as="span" gap="tight" minWidth={0} variant="caption" tone="muted">
      <StatusIcon status={status} />
      <Text truncate>{status?.name}</Text>
    </Inline>
  );
  const aiMeta = line.statusBy === 'ai' ? (
    <Chip as="button" variant="bare" title={`#${AUTO_MARKS.ai.name} 줄만 보기`} onClick={(event) => (event.stopPropagation(), onFilterMark('ai'))}>
      <AiMark by="ai" />
    </Chip>
  ) : null;
  // One menu for the line, the same from ⋯, from a right-click on the row (opened at the pointer) and on its graph node.
  const menuItems = (
    <LineMenuItems
      projectId={projectId}
      line={{ id: line.id, key: line.key, source: line.source, translation: line.translation, statusId: line.statusId, tagIds: line.tagIds, translate: line.translate, groupKind: line.groupKind }}
      onEdit={selected ? undefined : onSelect}
      onOpenDetail={onOpenDetail}
      onShowInGraph={onShowInGraph}
      onEditSource={onEditSource}
      onAddLine={onAddLine}
    />
  );
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // The line's actions sit at the right end of the header of the picked row: the details pane, and everything else in ⋯.
  const actions = selected ? (
    <Inline as="span" gap="hair" onClick={(event) => event.stopPropagation()}>
      {onOpenDetail && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" tone="muted" aria-label="상세 열기" onClick={onOpenDetail}>
              <PanelRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>상세 열기</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" tone="muted" aria-label="줄 동작">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>줄 동작</TooltipContent>
        </Tooltip>
        <DropdownMenuContent width="menu" align="end" onClick={(event) => event.stopPropagation()}>
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    </Inline>
  ) : null;
  const source = selected ? (
    <>
      <ScriptSourceStyle open tone={sourceTone}><LineSourceText projectId={projectId} unitId={line.id} source={line.source} translation={line.translation} /></ScriptSourceStyle>
      <LineHints projectId={projectId} line={{ id: line.id, source: line.source, translation: line.translation, speaker: line.speaker, listener: line.listener, lastRun: null }} part="context" />
      <LineNote key={`note-${line.id}`} unitId={line.id} note={line.note} editing={noting} onEditing={onNoting} />
    </>
  ) : <ScriptSourceStyle open={false} tone={sourceTone}><MarkedSourceText projectId={projectId} text={line.source} pattern={tokenPattern} /></ScriptSourceStyle>;
  const translation = selected ? (
    <>
      <TranslationEditor key={`editor-${line.id}`} projectId={projectId} unit={line} statuses={statusList} focusKey={focusTick} marks={tagRow} onEscape={onEscape} onDone={onDone} />
      {review && !!line.lastRun?.issues.length && <ScriptReviewIssue issue={line.lastRun.issues[0]} />}
    </>
  ) : (
    <>
      {line.translation ? <TokenText text={line.translation} source={line.source} pattern={tokenPattern} /> : <Text tone="subtle" userSelect="none">미번역</Text>}
      {review && !!line.lastRun?.issues.length && <ScriptReviewIssue issue={line.lastRun.issues[0]} />}
      {tagRow}
    </>
  );
  const compact = line.kind === 'ui' && !selected && !review;
  const row = (
    <ScriptTranslationRow
      checkbox={checkbox}
      speaker={identity}
      status={statusContent}
      meta={aiMeta || actions ? <>{aiMeta}{actions}</> : null}
      source={source}
      translation={translation}
      selected={selected}
      compact={compact}
      layout="grid"
      flagged={marked}
    />
  );
  const saveLine = useSaveLine();

  return (
    <>
      {header}
      <ListRow
        variant="choice"
        ref={rowRef}
        onClick={onSelect}
        selected={selected}
        flagged={marked}
        style={arrived ? { animation: 'line-arrived 2s ease-out' } : undefined}
        onAnimationEnd={onArrivedEnd}
      >
        <Box
          width="full"
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuAt({ x: event.clientX, y: event.clientY });
          }}
        >
          {row}
        </Box>
        {menuAt && (
          <DropdownMenu open onOpenChange={(open) => !open && setMenuAt(null)} modal={false}>
            <DropdownMenuTrigger asChild>
              <ScriptMenuAnchor x={menuAt.x} y={menuAt.y} />
            </DropdownMenuTrigger>
            <DropdownMenuContent width="menu" align="start" onClick={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => event.preventDefault()}>
              {menuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ListRow>
    </>
  );
}
