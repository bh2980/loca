import { createAndAttachTag } from '@/lib/create-tag';
import { useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { InferRequestType } from 'hono/client';
import { toast } from 'sonner';
import { isSpecialListener, listenerLabel, OTHERS_LISTENER, pairKey, pairMarks, pairSummary, SPEECH_LEVEL_LABELS, UNRESOLVED_RELATIONSHIP_KIND, type Pair as PairOf } from '@tw/shared';
import { EmptyState, DataTable, type ColumnDef, Inspector, InspectorHeader, InspectorResult, InspectorTabs, TagListEditor, Chip, Box, Button, Inline, Text, Section, Field } from '@loca/ui';
import { DraftEditor, draftKeyOf, savedOf } from '@/components/knowledge/editor';
import { PairLines, usePairLines } from '@/components/knowledge/evidence';
import { SpeechTimeline } from '@/components/knowledge/speech-timeline';
import { candidateRow, confirmLabel, fail, metaColumns, type Draft, type KnowledgeFilterState, type KindSpec, type RelationshipRow, type SpeechRuleRow } from '@/components/knowledge/table';
import { personStyle } from '@/lib/person-colors';
import { client } from '@/lib/api';
import { tagsIn } from '@/lib/queries';
import { useTaxonomy } from '@/lib/knowledge';
import { sent } from '@/lib/collections';
import { useLinesByKeys } from '@/lib/units';
import { useDirtyDrafts } from '@/lib/drafts';
import { useInspectorTab } from '@/lib/inspector-tab';

/** One speaker → listener direction (buildPairs, @tw/shared) with the rows these screens read. */
export type Pair = PairOf<RelationshipRow, SpeechRuleRow>;

/**
 * The pairs, keeping last time's object for a pair whose people, relationship and rules are the same
 * rows: the table draws again only the pairs whose rows changed.
 */
export function useStablePairs(pairs: Pair[]) {
  const previous = useRef(new Map<string, Pair>());
  return useMemo(() => {
    const next = new Map<string, Pair>();
    const kept = pairs.map((pair) => {
      const old = previous.current.get(pair.key);
      const same = old && old.fromId === pair.fromId && old.toId === pair.toId && old.relationship === pair.relationship && old.rules.length === pair.rules.length && old.rules.every((rule, index) => rule === pair.rules[index]);
      const row = same ? old : pair;
      next.set(pair.key, row);
      return row;
    });
    previous.current = next;
    return kept;
  }, [pairs]);
}

/** What creating a speech rule takes. */
export type SpeechRuleCreate = InferRequestType<(typeof client.projects)[':projectId']['speech-rules']['$post']>['json'];

export const pairItems = (pair: Pair) => [...(pair.relationship ? [{ kind: 'relationships' as const, row: pair.relationship }] : []), ...pair.rules.map((row) => ({ kind: 'speechRules' as const, row }))];
/** Why the analysis marked an item for a look (확인 권장), or null. */
const reviewOf = (row: Draft) => row.reviewNote || null;
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
      rowDeps={[filters.known, colorOf]}
      empty={<EmptyState noun="관계나 말투 규칙이 있는 쌍" filtered={Boolean(filters.source || filters.status || filters.decidedBy || filters.marks?.length || filters.tags?.length)} />}
    />
  );
}

type PairTab = 'speech' | 'relationship' | 'lines';
const PAIR_TABS = ['speech', 'relationship', 'lines'] as const;

/**
 * Right pane for a pair, in three tabs: 말투 (what translation uses: the base speech from the start, then a timeline of the
 * points where it changes, each decided and edited in place: SpeechTimeline), 관계 (a fact of the story, its changes on the
 * same timeline), 근거 대사 (the lines the rules apply to and the lines cited, each once). The header sums up both decisions
 * (the base speech's and the relationship's) and holds their buttons; a tab with a candidate or an unsaved edit carries a dot.
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
  const [tab, setTab] = useInspectorTab<PairTab>('pair', PAIR_TABS);
  const startKeys = useMemo(() => pair.rules.flatMap((rule) => (rule.startKey ? [rule.startKey] : [])), [pair.rules]);
  const starts = useLinesByKeys(projectId, startKeys);
  const startOf = new Map(starts.data?.map((line, index) => [line.key, { ...line, order: index }]));
  const rules = [...pair.rules].sort((a, b) => (a.startKey ? (startOf.get(a.startKey)?.order ?? 1e9) + 1 : 0) - (b.startKey ? (startOf.get(b.startKey)?.order ?? 1e9) + 1 : 0));
  // In the pair the speaker and listener are given; where a stretch starts is chosen by picking a line.
  const ruleSpec = { ...speechRules, fields: speechRules.fields.filter((field) => !['fromName', 'toName', 'startKey'].includes(field.name)) };
  // A change point's own form also moves its start line.
  const pointSpec = { ...speechRules, fields: speechRules.fields.filter((field) => !['fromName', 'toName'].includes(field.name)) };
  const base = rules.find((item) => !item.startKey);
  const addRelationship = useMutation({ mutationFn: () => relationships.create!(), onError: fail });
  const taxonomy = useTaxonomy(projectId);
  const knowledgeTags = tagsIn(taxonomy.tags, 'people');
  const summaryTags = pairSummary(pair).tags ?? [];
  const attachedPairTags = summaryTags
    .map((item) => taxonomy.tags?.find((t) => t.id === item.id))
    .filter(Boolean) as (Parameters<typeof TagListEditor>[0]['tags'][number])[];

  const pairItemsList = pairItems(pair);
  const pairTagMutation = useMutation({
    mutationFn: async ({ tagId, add }: { tagId: string; add: boolean }) => {
      for (const [kind, list] of Map.groupBy(pairItemsList, (item) => item.kind)) {
        await sent(projectId, client.projects[':projectId']['knowledge-tags'].$post({
          param: { projectId },
          json: { kind, ids: list.map((item) => item.row.id), tagId, add },
        }));
      }
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

  const relationship = pair.relationship;
  // Unsaved edits of the embedded editors (the rules' and the relationship's), for the tab dots and the header buttons.
  const drafts = [...rules.map((item) => ({ key: draftKeyOf('speechRules', item.id), saved: savedOf(item.startKey ? pointSpec : ruleSpec, item) })), ...(relationship ? [{ key: draftKeyOf('relationships', relationship.id), saved: savedOf(relationships, relationship) }] : [])];
  const dirty = useDirtyDrafts(drafts);
  const ruleDirty = (id: string) => dirty[rules.findIndex((item) => item.id === id)] ?? false;
  const relationshipDirty = relationship ? dirty[rules.length] : false;
  const lines = usePairLines(projectId, rules, useMemo(() => (relationship ? [relationship] : []), [relationship]));
  // 관계 미확인: the analysis could not tell; it says so quietly instead of reading like a relationship.
  const unresolved = relationship?.kind === UNRESOLVED_RELATIONSHIP_KIND;

  /** One decision of the pair: what it is now, and while it is a candidate its 버리기 / 확인함 (saved first: an unsaved edit is not what gets decided). */
  const decision = (label: string, row: Draft | undefined, kind: 'relationships' | 'speechRules', unsaved: boolean, quiet?: boolean) => (
    <Inline gap="condensed" justify="between" wrap>
      <Chip variant={row?.status === 'candidate' && !quiet ? 'outline' : 'quiet'} tone={row?.status === 'candidate' && !quiet ? 'warning' : undefined}>
        {label}
        {row && ` · ${row.status === 'candidate' ? '후보' : '확정'}`}
      </Chip>
      {row?.status === 'candidate' && (
        <Inline as="span" gap="tight">
          <Button variant="ghost" tone="danger" onClick={() => onDecide(kind, [row.id], 'discard')}>
            버리기
          </Button>
          <Button variant={quiet ? 'outline' : undefined} disabled={unsaved} title={unsaved ? '고친 내용을 저장한 뒤 정합니다.' : undefined} onClick={() => onDecide(kind, [row.id], 'confirm')}>
            <Check /> {confirmLabel([row])}
          </Button>
        </Inline>
      )}
    </Inline>
  );

  const header = (
    <InspectorHeader
      kind="관계·말투"
      name={`${pair.from} → ${listenerLabel(pair.to)}`}
      onClose={onClose}
      below={
        <Box spaceY="condensed">
          {decision(base ? `말투 ${SPEECH_LEVEL_LABELS[base.level]}${rules.length > 1 ? ` · 변화 ${rules.length - 1}` : ''}` : rules.length ? `말투 변화 ${rules.length}` : '말투 없음', base, 'speechRules', base ? ruleDirty(base.id) : false)}
          {decision(relationship ? (unresolved ? relationship.kind : `관계 ${relationship.kind}`) : '관계 없음', relationship, 'relationships', relationshipDirty, unresolved)}
          {pairItemsList.length > 0 && (
            <Field label="태그" help="이 쌍의 관계와 말투 규칙 모두에 붙습니다.">
              <TagListEditor tags={attachedPairTags} allTags={knowledgeTags} onToggle={(tagId, add) => pairTagMutation.mutate({ tagId, add })} onCreate={handleCreatePairTag} heading="태그" />
            </Field>
          )}
        </Box>
      }
    />
  );

  const speech = (
    <>
      <SpeechTimeline
        projectId={projectId}
        from={pair.from}
        to={pair.to}
        rules={rules}
        startOf={startOf}
        spec={ruleSpec}
        pointSpec={pointSpec}
        characters={characters}
        dirty={ruleDirty}
        onDecide={(ids, action) => onDecide('speechRules', ids, action)}
        addRule={addRule}
        fallback={!isSpecialListener(pair.to) && others?.rules.length ? `규칙이 없어 ${pair.from}의 ‘그 밖의 인물’ 규칙(${SPEECH_LEVEL_LABELS[others.rules[0].level]})이 쓰입니다.` : undefined}
      />
      {!isSpecialListener(pair.to) && onOpenPair && (
        <Section>
          <Button
            variant="ghost"
            size="inline"
            tone="muted"
            onClick={() => (others ? onOpenPair(others.key) : addRule({ fromName: pair.from, toName: OTHERS_LISTENER, level: 'haeyo', address: '' }).then(() => onOpenPair(pairKey(pair.from, OTHERS_LISTENER))))}
          >
            {others?.rules.length ? `${pair.from} → 그 밖의 인물: ${SPEECH_LEVEL_LABELS[others.rules[0].level]}` : `${pair.from} → 그 밖의 인물 말투`}
          </Button>
        </Section>
      )}
    </>
  );

  const relationshipView = relationship ? (
    <Section>
      <Box spaceY="normal">
        {unresolved && reviewOf(relationship) && <InspectorResult tone="info">{reviewOf(relationship)}</InspectorResult>}
        <DraftEditor key={relationship.id} embedded projectId={projectId} kind="relationships" spec={relationships} row={relationship} characters={characters} />
      </Box>
    </Section>
  ) : (
    <Section>
      <Box spaceY="normal">
        <Text as="p" variant="body" tone="muted">{!pair.fromId || !pair.toId ? '두 사람이 모두 인물 목록에 있어야 관계를 만들 수 있습니다.' : '정해진 관계가 없습니다.'}</Text>
        <Button variant="outline" disabled={!pair.fromId || !pair.toId || !relationships.create || addRelationship.isPending} onClick={() => addRelationship.mutate()}>
          <Plus /> 관계 추가
        </Button>
      </Box>
    </Section>
  );

  return (
    <Inspector
      header={header}
      tabs={
        <InspectorTabs<PairTab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'speech', label: '말투', count: rules.length, attention: rules.some((item) => item.status === 'candidate' || ruleDirty(item.id)) },
            { value: 'relationship', label: '관계', attention: Boolean(relationship && (relationship.status === 'candidate' || relationshipDirty)) },
            { value: 'lines', label: '근거 대사', count: lines.count },
          ]}
        />
      }
      scrollKey={tab}
    >
      {tab === 'speech' ? speech : tab === 'relationship' ? relationshipView : <PairLines projectId={projectId} lines={lines} />}
    </Inspector>
  );
}
