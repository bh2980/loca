import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { isSettled, listenerLabel, SPEECH_LEVEL_LABELS, sourceOf, type SpeechLevel } from '@tw/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { candidateRow, DraftEditor, fail, matches, metaColumns, SourceBadge, type Draft, type KindSpec, type Row, type SourceFilter, type StatusFilter } from '@/components/knowledge/draft-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

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
  relationship?: Row;
  rules: Row[];
}

export const pairKey = (from: string, to: string) => `${from}→${to}`;

/** Every direction that has a relationship or a speech rule. Rule names resolve through aliases. */
export function buildPairs(characters: { id: string; name: string; aliases: string[] }[], relationships: Row[], rules: Row[]): Pair[] {
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
    const from = byId.get(rel.fromId as string);
    const to = byId.get(rel.toId as string);
    if (from && to) pair(from.name, to.name, from.id, to.id).relationship ??= rel;
  }
  for (const rule of rules) {
    const from = byName.get(String(rule.fromName).toLowerCase());
    const to = byName.get(String(rule.toName).toLowerCase());
    pair(from?.name ?? String(rule.fromName), to?.name ?? String(rule.toName), from?.id, to?.id).rules.push(rule);
  }
  return [...pairs.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** A pair is AI's if any of its items is, a candidate if any item is; what the table and graph show for it. */
export const pairSummary = (pair: Pair): Draft => {
  const rows = [pair.relationship, ...pair.rules].filter(Boolean) as Row[];
  return {
    id: pair.key,
    status: rows.some((row) => row.status === 'candidate') ? 'candidate' : 'confirmed',
    origin: rows.some((row) => sourceOf(row) === 'ai') ? 'ai' : 'human',
    reviewed: false,
    evidence: [],
  };
};
/** Pairs with any item matching the filters. */
export const pairMatches = (pair: Pair, source: SourceFilter, status: StatusFilter) => [pair.relationship, ...pair.rules].some((row) => row && matches(row, source, status));
export const pairSettled = (pair: Pair) => [pair.relationship, ...pair.rules].every((row) => !row || isSettled(row));
export const pairItems = (pair: Pair) => [...(pair.relationship ? [{ kind: 'relationships' as const, row: pair.relationship }] : []), ...pair.rules.map((row) => ({ kind: 'speechRules' as const, row }))];
const reviewOf = (rule: Row) => (typeof rule.review === 'string' && rule.review ? rule.review : null);
const ReviewBadge = ({ reasons }: { reasons: string }) => (
  <Badge variant="outline" className="border-warning text-warning" title={reasons}>
    확인 권장
  </Badge>
);
const levelsText = (rules: Row[]) => rules.map((rule) => SPEECH_LEVEL_LABELS[rule.level as SpeechLevel]).join(' → ');

/** The speaker → listener pairs as a table; 출처 and 상태 filter through their headers. */
export function PairTable({ pairs, loading, selected, picked, onPick, onOpen, bulk, filters }: {
  pairs: Pair[] | undefined;
  loading: boolean;
  selected?: string;
  picked: Set<string>;
  onPick: (keys: string[], on: boolean) => void;
  onOpen: (key: string) => void;
  bulk: ReactNode;
  filters: Parameters<typeof metaColumns>[1];
}) {
  const columns: ColumnDef<Pair, unknown>[] = [
    {
      id: 'pair',
      header: '화자 → 청자',
      meta: { width: 240, className: 'font-medium' },
      cell: ({ row: { original: pair } }) => {
        const reasons = pair.rules.map(reviewOf).filter((reason): reason is string => reason !== null);
        return (
          <>
            {pair.from} → {listenerLabel(pair.to)}
            {reasons.length > 0 && (
              <span className="ml-2 align-middle">
                <ReviewBadge reasons={reasons.join('\n')} />
              </span>
            )}
          </>
        );
      },
    },
    { id: 'relationship', header: '관계', meta: { width: 200 }, cell: ({ row: { original: pair } }) => (pair.relationship ? String(pair.relationship.kind) : <span className="text-muted-foreground">—</span>) },
    { id: 'speech', header: '말투', cell: ({ row: { original: pair } }) => (pair.rules.length ? levelsText(pair.rules) : <span className="text-muted-foreground">—</span>) },
    ...metaColumns<Pair>(pairSummary, filters),
  ];
  return (
    <DataTable
      columns={columns}
      rows={pairs}
      loading={loading}
      rowId={(pair) => pair.key}
      selected={selected}
      onRowClick={(pair) => onOpen(pair.key)}
      rowClassName={(pair) => candidateRow(pairSummary(pair))}
      picked={picked}
      onPick={onPick}
      bulk={bulk}
      empty="관계나 말투 규칙이 있는 쌍이 없습니다. “작품 분석”으로 초안을 받거나 인물을 추가하세요."
    />
  );
}

/** Right pane for a pair: ① the relationship, ② its speech rules by stretch, each editable in place. */
export function PairDetail({ projectId, pair, relationships, speechRules, characters, onClose, onDecide }: {
  projectId: string;
  pair: Pair;
  relationships: KindSpec;
  speechRules: KindSpec;
  characters: { id: string; name: string }[];
  onClose: () => void;
  onDecide: (kind: 'relationships' | 'speechRules', ids: string[], action: 'confirm' | 'discard') => void;
}) {
  const [openRule, setOpenRule] = useState<string | undefined>(pair.rules.length === 1 ? pair.rules[0].id : undefined);
  const addRelationship = useMutation({ mutationFn: () => relationships.create!(), onError: fail });
  const addRule = useMutation({ mutationFn: () => speechRules.create!(), onSuccess: (row) => setOpenRule(row.id), onError: fail });
  return (
    <DetailPane kicker="관계·말투" title={`${pair.from} → ${listenerLabel(pair.to)}`} onClose={onClose}>
      <PaneSection
        title="관계 · 이야기 속 사실"
        actions={
          pair.relationship ? (
            <span className="flex items-center gap-1.5">
              <SourceBadge row={pair.relationship} />
              {pair.relationship.status === 'candidate' && <span className="border-b border-dashed border-warning text-xs text-warning">후보</span>}
            </span>
          ) : undefined
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
          <Button variant="outline" disabled={!pair.fromId || !pair.toId || !relationships.create || addRelationship.isPending} title={!pair.fromId || !pair.toId ? '두 사람이 모두 인물 목록에 있어야 합니다' : undefined} onClick={() => addRelationship.mutate()}>
            <Plus /> 관계 추가
          </Button>
        )}
      </PaneSection>
      <PaneSection
        title="말투 규칙 · 번역 결정, 구간별"
        actions={
          <Button variant="ghost" disabled={addRule.isPending} onClick={() => addRule.mutate()}>
            <Plus /> 구간 추가
          </Button>
        }
      >
        {pair.rules.length === 0 && <p className="text-xs text-muted-foreground">이 쌍의 말투 규칙이 없습니다. 규칙이 없으면 번역 문맥에는 청자만 들어갑니다.</p>}
        <ul className="space-y-2">
          {pair.rules.map((rule) => {
            const open = openRule === rule.id;
            const review = reviewOf(rule);
            return (
              <li key={rule.id} className={cn('rounded-md border', rule.status === 'candidate' && 'border-dashed border-warning')}>
                <Collapsible open={open} onOpenChange={(next) => setOpenRule(next ? rule.id : undefined)}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-start">
                      <ChevronRight className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />
                      <span>{SPEECH_LEVEL_LABELS[rule.level as SpeechLevel]}</span>
                      {review && <ReviewBadge reasons={review} />}
                      {rule.address ? <span className="truncate font-normal text-muted-foreground">호칭 “{String(rule.address)}”</span> : null}
                      <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{rule.startKey ? `${String(rule.startKey)}부터` : '처음부터'}</span>
                      <SourceBadge row={rule} />
                    </Button>
                  </CollapsibleTrigger>
                  {review && <p className="px-3 pb-2 pl-9 text-xs text-muted-foreground">확인 권장: {review}</p>}
                  <CollapsibleContent>
                    <div className="border-t p-3">
                      <DraftEditor embedded projectId={projectId} kind="speechRules" spec={speechRules} row={rule} characters={characters} onDecide={(action) => onDecide('speechRules', [rule.id], action)} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            );
          })}
        </ul>
      </PaneSection>
    </DetailPane>
  );
}
