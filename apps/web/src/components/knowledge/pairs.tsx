import { createAndAttachTag } from '@/lib/create-tag';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { InferRequestType } from 'hono/client';
import { toast } from 'sonner';
import { type AutoMark, isSpecialListener, knowledgeMarksOf, listenerLabel, matchesMarks, OTHERS_LISTENER, SPEECH_LEVEL_LABELS } from '@tw/shared';
import { EmptyState, DataTable, type ColumnDef, Inspector, InspectorHeader, InspectorList, InspectorResult, TagListEditor, Chip, Box, Button, Icon, Inline, ListRow, Text, Section, Field } from '@loca/ui';
import { DraftEditor } from '@/components/knowledge/editor';
import { StretchPicker } from '@/components/knowledge/evidence';
import { candidateRow, fail, isHidden, matches, metaColumns, SourceBadge, type Draft, type KnowledgeFilterState, type KindSpec, type RelationshipRow, type SourceFilter, type StatusFilter, type SpeechRuleRow } from '@/components/knowledge/table';
import { splitList } from '@/lib/list-value';
import { personStyle } from '@/lib/person-colors';
import { client, unwrap } from '@/lib/api';
import { q, tagsIn, useReviewTagId } from '@/lib/queries';

/**
 * One speaker → listener direction: the relationship (a fact of the story) and the speech rules
 * (the Korean translation decision, in stretches). Stored apart, shown together.
 */
export interface Pair {
  key: string;
  from: string;
  to: string;
  fromId?: string;
  toId?: string;
  relationship?: RelationshipRow;
  rules: SpeechRuleRow[];
}

/** What creating a speech rule takes. */
export type SpeechRuleCreate = InferRequestType<(typeof client.projects)[':projectId']['speech-rules']['$post']>['json'];

export const pairKey = (from: string, to: string) => `${from}→${to}`;

/** Every direction that has a relationship or a speech rule. Rule names resolve through aliases. */
export function buildPairs(characters: { id: string; name: string; aliases: string[] }[], relationships: RelationshipRow[], rules: SpeechRuleRow[]): Pair[] {
  const byName = new Map(characters.flatMap((c) => [c.name, ...c.aliases].map((name) => [name.toLowerCase(), c] as const)));
  const byId = new Map(characters.map((c) => [c.id, c]));
  const pairs = new Map<string, Pair>();
  const pair = (from: string, to: string, fromId?: string, toId?: string) => {
    const key = pairKey(from, to);
    const existing = pairs.get(key) ?? { key, from, to, fromId, toId, rules: [] };
    pairs.set(key, existing);
    return existing;
  };
  for (const rel of relationships) {
    const from = byId.get(rel.fromId);
    const to = byId.get(rel.toId);
    if (from && to) pair(from.name, to.name, from.id, to.id).relationship ??= rel;
  }
  for (const rule of rules) {
    const from = byName.get(rule.fromName.toLowerCase());
    const to = byName.get(rule.toName.toLowerCase());
    pair(from?.name ?? rule.fromName, to?.name ?? rule.toName, from?.id, to?.id).rules.push(rule);
  }
  return [...pairs.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** A pair is AI's if any of its items is, a candidate if any item is; what the table and graph show for it. */
export const pairSummary = (pair: Pair): Draft => {
  const rows: Draft[] = [...(pair.relationship ? [pair.relationship] : []), ...pair.rules];
  return {
    id: pair.key,
    status: rows.some((row) => row.status === 'candidate') ? 'candidate' : 'confirmed',
    origin: rows.some((row) => row.origin === 'ai') ? 'ai' : 'human',
    statusBy: rows.some((row) => row.statusBy === 'ai') ? 'ai' : 'human',
    evidence: [],
    // Every tag of its items once; reasons of the same tag joined (확인 권장 on two stretches).
    tags: [...Map.groupBy(rows.flatMap((row) => row.tags ?? []), (tag) => tag.id).entries()].map(([id, list]) => ({ id, note: list.flatMap((tag) => (tag.note ? [tag.note] : [])).join('\n') || null })),
  };
};
/** The marks any item of a pair carries: what its row shows and the marks filter reads. */
export const pairMarks = (pair: Pair): AutoMark[] => [...new Set([pair.relationship, ...pair.rules].flatMap((row) => (row ? knowledgeMarksOf(row) : [])))];
/** Pairs matching the filters: by source and tags through any one item, by marks through the pair's marks. */
export const pairMatches = (pair: Pair, source: SourceFilter, marks?: readonly AutoMark[], tags?: string[], status?: StatusFilter, hidden: { hideMarks?: readonly AutoMark[]; hideTags?: readonly string[] } = {}) =>
  (!status || pairSummary(pair).status === status) && matchesMarks(pairMarks(pair), marks) && [pair.relationship, ...pair.rules].some((row) => row && matches(row, source, undefined, tags)) && !isHidden(pairMarks(pair), pairTagIds(pair), hidden);
const pairTagIds = (pair: Pair) => [pair.relationship, ...pair.rules].flatMap((row) => (row?.tags ?? []).map((tag) => tag.id));
export const pairItems = (pair: Pair) => [...(pair.relationship ? [{ kind: 'relationships' as const, row: pair.relationship }] : []), ...pair.rules.map((row) => ({ kind: 'speechRules' as const, row }))];
/** Why the app marked an item for a look (its tag's note), or null. */
const reviewOf = (row: Draft, reviewTag?: string) => row.tags?.find((tag) => tag.id === reviewTag)?.note ?? null;
const ReviewBadge = ({ reasons }: { reasons: string }) => (
  <Chip variant="outline" tone="warning" title={reasons}>
    확인 권장
  </Chip>
);
const levelsText = (rules: SpeechRuleRow[]) => rules.map((rule) => SPEECH_LEVEL_LABELS[rule.level]).join(' → ');

/** The speaker → listener pairs as a table; 출처 filters through its header, 후보 and AI가 정함 through the 태그 column. */
export function PairTable({ pairs, loading, selected, picked, onPick, onOpen, bulk, filters, colorOf }: {
  pairs: Pair[] | undefined;
  /** A person's color by name (usePersonColors). */
  colorOf?: (name: string) => string | undefined;
  loading: boolean;
  selected?: string;
  picked: ReadonlySet<string>;
  onPick: (keys: string[], on: boolean) => void;
  onOpen: (key: string) => void;
  bulk: ReactNode;
  filters: KnowledgeFilterState;
}) {
  const columns: ColumnDef<Pair, unknown>[] = [
    { id: 'pair', header: '화자 → 청자', meta: { width: 240, weight: 'medium', hideable: false }, cell: ({ row: { original: pair } }) => <><span style={personStyle(colorOf?.(pair.from))}>{pair.from}</span> → <span style={personStyle(colorOf?.(pair.to))}>{listenerLabel(pair.to)}</span></> },
    { id: 'relationship', header: '관계', meta: { width: 200 }, cell: ({ row: { original: pair } }) => (pair.relationship ? pair.relationship.kind : <Text tone="muted">—</Text>) },
    { id: 'speech', header: '말투', cell: ({ row: { original: pair } }) => (pair.rules.length ? levelsText(pair.rules) : <Text tone="muted">—</Text>) },
    ...metaColumns<Pair>(pairSummary, filters, pairMarks),
  ];
  return (
    <DataTable id="knowledge-pairs"
      columns={columns}
      rows={pairs}
      loading={loading}
      rowId={(pair) => pair.key}
      selected={selected}
      onRowClick={(pair) => onOpen(pair.key)}
      rowState={(pair) => candidateRow(pairSummary(pair))}
      picked={picked}
      onPick={onPick}
      bulk={bulk}
      empty={<EmptyState noun="관계나 말투 규칙이 있는 쌍" filtered={Boolean(filters.source || filters.status || filters.marks?.length || filters.tags?.length)} />}
    />
  );
}

/**
 * Right pane for a pair. Speech comes first, because it is what translation uses: one row per
 * stretch ("처음부터 · 하게체", "this line on · 해체"), each opening its own editor. A new stretch
 * starts at a line picked from this pair's lines, never a typed key. The relationship (a fact of
 * the story, not a translation decision) sits folded underneath.
 */
export function PairDetail({ projectId, pair, relationships, speechRules, addRule, characters, others, onOpenPair, onClose, onDecide }: {
  projectId: string;
  pair: Pair;
  /** The speaker's "그 밖의 인물" pair, if it has one (its rule covers listeners without their own). */
  others?: Pair;
  onOpenPair?: (key: string) => void;
  relationships: KindSpec;
  speechRules: KindSpec;
  /** Creates a speech rule (a new stretch, the speaker's 그 밖의 인물 rule). */
  addRule: (json: SpeechRuleCreate) => Promise<{ id: string }>;
  characters: { id: string; name: string }[];
  onClose: () => void;
  onDecide: (kind: 'relationships' | 'speechRules', ids: string[], action: 'confirm' | 'discard') => void;
}) {
  const reviewTag = useReviewTagId(projectId);
  const [openRule, setOpenRule] = useState<string | undefined>(pair.rules.length === 1 ? pair.rules[0].id : undefined);
  const [picking, setPicking] = useState(false);
  const starts = useQuery(q.linesByKeys(projectId, pair.rules.flatMap((rule) => (rule.startKey ? [rule.startKey] : []))));
  const startOf = new Map(starts.data?.map((line, index) => [line.key, { ...line, order: index }]));
  const rules = [...pair.rules].sort((a, b) => (a.startKey ? (startOf.get(a.startKey)?.order ?? 1e9) + 1 : 0) - (b.startKey ? (startOf.get(b.startKey)?.order ?? 1e9) + 1 : 0));
  // In the pair the speaker and listener are given; where a stretch starts is chosen by picking a line.
  const ruleSpec = { ...speechRules, fields: speechRules.fields.filter((field) => !['fromName', 'toName', 'startKey'].includes(field.name)) };
  const addRelationship = useMutation({ mutationFn: () => relationships.create!(), onError: fail });
  const addStretch = useMutation({
    mutationFn: (key: string) => {
      const before = rules.at(-1);
      return addRule({ fromName: pair.from, toName: pair.to, level: before?.level ?? 'haeyo', address: before?.address ?? '', startKey: key });
    },
    onSuccess: (row) => {
      setPicking(false);
      setOpenRule(row.id);
    },
    onError: fail,
  });
  const startLabel = (rule: SpeechRuleRow) => {
    if (!rule.startKey) return '처음부터';
    const line = startOf.get(rule.startKey);
    return line ? `“${line.source.length > 28 ? `${line.source.slice(0, 27)}…` : line.source}”부터` : `${rule.startKey}부터`;
  };

  const queryClient = useQueryClient();
  const statuses = useQuery(q.statuses(projectId));
  const knowledgeTags = tagsIn(statuses.data?.tags, 'people');
  const summaryTags = pairSummary(pair).tags ?? [];
  const attachedPairTags = summaryTags
    .map((item) => statuses.data?.tags?.find((t) => t.id === item.id))
    .filter(Boolean) as (Parameters<typeof TagListEditor>[0]['tags'][number])[];

  const pairItemsList = pairItems(pair);
  const pairTagMutation = useMutation({
    mutationFn: async ({ tagId, add }: { tagId: string; add: boolean }) => {
      for (const [kind, list] of Map.groupBy(pairItemsList, (item) => item.kind)) {
        await unwrap(client.projects[':projectId']['knowledge-tags'].$post({
          param: { projectId },
          json: { kind, ids: list.map((item) => item.row.id), tagId, add },
        }));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: fail,
  });

  const handleCreatePairTag = async (name: string) => {
    try {
      await createAndAttachTag(projectId, name, knowledgeTags.length, ['people'], (tagId) => pairTagMutation.mutateAsync({ tagId: tagId, add: true }));
      toast.success(`'${name}' 태그를 만들고 항목에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  const relationshipKind = pair.relationship?.kind;
  return (
    <Inspector header={<InspectorHeader kind="관계·말투" name={`${pair.from} → ${listenerLabel(pair.to)}`} onClose={onClose} />}>
      {pairItemsList.length > 0 && (
        <Section>
          <Field label="태그" help="이 쌍의 관계와 말투 규칙 모두에 붙습니다.">
            <TagListEditor tags={attachedPairTags} allTags={knowledgeTags} onToggle={(tagId, add) => pairTagMutation.mutate({ tagId, add })} onCreate={handleCreatePairTag} heading="태그" />
          </Field>
        </Section>
      )}
      <Section
        title="말투"
        actions={
          <Button variant="ghost" onClick={() => setPicking((value) => !value)} aria-pressed={picking}>
            <Plus /> 변화 지점 추가
          </Button>
        }
      >
        {picking && <StretchPicker projectId={projectId} from={pair.from} to={pair.to} taken={new Set(pair.rules.map((rule) => rule.startKey ?? ''))} onPick={(key) => addStretch.mutate(key)} onCancel={() => setPicking(false)} />}
        {rules.length === 0 && (
          <Text as="p" variant="body" tone="muted">
            {!isSpecialListener(pair.to) && others?.rules.length
              ? `규칙이 없어 ${pair.from}의 ‘그 밖의 인물’ 규칙(${SPEECH_LEVEL_LABELS[others.rules[0].level]})이 쓰입니다.`
              : '말투 규칙이 없습니다.'}
          </Text>
        )}
        <InspectorList>
          {rules.map((rule) => {
            const open = openRule === rule.id;
            const review = reviewOf(rule, reviewTag);
            return (
              <ListRow key={rule.id}>
                <Button variant="ghost" size="row" aria-expanded={open} onClick={() => setOpenRule(open ? undefined : rule.id)}>
                  <Icon icon={ChevronRight} tone="muted" turn={open} />
                  <Text minWidth={0} grow>
                    <Text display="block" variant="caption" tone="muted" truncate>{startLabel(rule)}</Text>
                    <Inline as="span" gap="condensed">
                      <Text weight="medium">{SPEECH_LEVEL_LABELS[rule.level]}</Text>
                      {rule.address ? <Text tone="muted" truncate>호칭 {splitList(rule.address).map((form) => `“${form}”`).join(' · ')}</Text> : null}
                      {review && <ReviewBadge reasons={review} />}
                    </Inline>
                  </Text>
                  {rule.status === 'candidate' && <Chip variant="outline">후보</Chip>}
                  <SourceBadge row={rule} />
                </Button>
                {open && (
                  <Box spaceY="normal" paddingTop="condensed" paddingBottom="condensed" paddingLeft="spacious">
                    {review && <InspectorResult tone="info">확인 권장: {review}</InspectorResult>}
                    <DraftEditor embedded projectId={projectId} kind="speechRules" spec={ruleSpec} row={rule} characters={characters} onDecide={(action) => onDecide('speechRules', [rule.id], action)} />
                  </Box>
                )}
              </ListRow>
            );
          })}
        </InspectorList>
        {!isSpecialListener(pair.to) && onOpenPair && (
          <Button
            variant="ghost"
            size="inline"
            tone="muted"
            onClick={() => (others ? onOpenPair(others.key) : addRule({ fromName: pair.from, toName: OTHERS_LISTENER, level: 'haeyo', address: '' }).then(() => onOpenPair(pairKey(pair.from, OTHERS_LISTENER))))}
          >
            {others?.rules.length ? `${pair.from} → 그 밖의 인물: ${SPEECH_LEVEL_LABELS[others.rules[0].level]}` : `${pair.from} → 그 밖의 인물 말투`}
          </Button>
        )}
      </Section>
      <Section
        title={relationshipKind ? `관계 · ${relationshipKind}` : '관계'}
        // Open where there is something to settle: a candidate, or a line just drawn that says nothing yet.
        defaultOpen={Boolean(pair.relationship && (pair.relationship.status === 'candidate' || !pair.relationship.description))}
        actions={
          pair.relationship && (
            <Inline as="span" gap="tight">
              {pair.relationship.status === 'candidate' && <Chip variant="outline">후보</Chip>}
              <SourceBadge row={pair.relationship} />
            </Inline>
          )
        }
      >
        {pair.relationship ? (
          <DraftEditor
            key={pair.relationship.id}
            embedded
            projectId={projectId}
            kind="relationships"
            spec={relationships}
            row={pair.relationship}
            characters={characters}
            onDecide={(action) => onDecide('relationships', [pair.relationship!.id], action)}
          />
        ) : (
          <>
            <Text as="p" variant="body" tone="muted">{!pair.fromId || !pair.toId ? '두 사람이 모두 인물 목록에 있어야 관계를 만들 수 있습니다.' : '정해진 관계가 없습니다.'}</Text>
            <Button variant="outline" disabled={!pair.fromId || !pair.toId || !relationships.create || addRelationship.isPending} onClick={() => addRelationship.mutate()}>
              <Plus /> 관계 추가
            </Button>
          </>
        )}
      </Section>
    </Inspector>
  );
}
