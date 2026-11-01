/** A pair's 말투 tab: the base speech (처음부터) as a card, then a timeline of the points where it changes, each decided and edited in place. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { listenerLabel, markName, SPEECH_LEVEL_LABELS, type SpeechLevel } from '@tw/shared';
import { Box, Button, Chip, Field, Inline, InspectorList, InspectorResult, Input, ListRow, Section, Text, Timeline, TimelineFields, TimelineNote, TimelinePoint, TimelineQuotes, TimelineStart } from '@loca/ui';
import { DraftEditor, FieldInput } from '@/components/knowledge/editor';
import { confirmLabel, fail, SourceBadge, type KindSpec, type SpeechRuleRow } from '@/components/knowledge/table';
import { splitList } from '@/lib/list-value';
import { q, useMarkStyles } from '@/lib/queries';
import { useLinePage, useLinesByKeys } from '@/lib/units';
import type { SpeechRuleCreate } from '@/components/knowledge/pairs';

type Line = NonNullable<ReturnType<typeof useLinesByKeys>['data']>[number];

const addressText = (address: string) => splitList(address).map((form) => `“${form}”`).join(' · ');

/** What a point changed from the stretch before it: the changed fields only (말투, 호칭), else the speech it keeps. */
function changedFields(rule: SpeechRuleRow, before: SpeechRuleRow | undefined) {
  const items: { label: string; before?: string; after: string }[] = [];
  if (!before || before.level !== rule.level) items.push({ label: '말투', before: before && SPEECH_LEVEL_LABELS[before.level], after: SPEECH_LEVEL_LABELS[rule.level] });
  if (!before || before.address !== rule.address) {
    if (rule.address || before?.address) items.push({ label: '호칭', before: before?.address ? addressText(before.address) : undefined, after: rule.address ? addressText(rule.address) : '없음' });
  }
  return items.length ? items : [{ label: '말투', after: `${SPEECH_LEVEL_LABELS[rule.level]} 그대로` }];
}

/** How many lines a rule applies to, from the query its 적용 대사 list reads. */
function useRuleCount(projectId: string, id: string) {
  return useQuery(q.ruleLines(projectId, id)).data?.count;
}

function Counts({ projectId, rule, range }: { projectId: string; rule: SpeechRuleRow; range: string }) {
  const count = useRuleCount(projectId, rule.id);
  return <>{[range, count != null ? `적용 ${count}줄` : null, rule.evidence.length ? `근거 ${rule.evidence.length}` : null].filter(Boolean).join(' · ')}</>;
}

/** Up to two of the lines a rule cites, each its key, who says it and its translation. */
function Quotes({ projectId, keys }: { projectId: string; keys: string[] }) {
  const first = useMemo(() => keys.slice(0, 2), [keys]);
  const lines = useLinesByKeys(projectId, first).data ?? [];
  if (!lines.length) return null;
  return <TimelineQuotes items={lines.map((line) => ({ id: line.id, label: line.key, text: `${line.speaker ? `${line.speaker}: ` : ''}${line.source}`, sub: line.translation || undefined }))} />;
}

export function SpeechTimeline({ projectId, from, to, rules, startOf, spec, pointSpec, characters, dirty, onDecide, addRule, fallback }: {
  projectId: string;
  from: string;
  to: string;
  /** The pair's rules in story order: the base (no start line) first. */
  rules: SpeechRuleRow[];
  /** Each start line, by key. */
  startOf: Map<string, Line>;
  /** The base rule's fields (no start line), and a point's (with its start line). */
  spec: KindSpec;
  pointSpec: KindSpec;
  characters: { id: string; name: string }[];
  dirty: (id: string) => boolean;
  onDecide: (ids: string[], action: 'confirm' | 'discard') => void;
  addRule: (json: SpeechRuleCreate) => Promise<{ id: string }>;
  /** What applies when the pair has no rule (the speaker's 그 밖의 인물 rule), said in the empty card. */
  fallback?: string;
}) {
  const markStyles = useMarkStyles(projectId);
  const [editing, setEditing] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const base = rules.find((rule) => !rule.startKey);
  const points = rules.filter((rule) => rule.startKey);
  const addBase = useMutation({ mutationFn: () => addRule({ fromName: from, toName: to, level: 'haeyo', address: '' }), onError: fail });

  const status = (rule: SpeechRuleRow) => (
    <>
      {dirty(rule.id) && <Chip variant="outline">고침</Chip>}
      <SourceBadge row={rule} />
      {rule.status === 'candidate' ? <Chip variant="outline" tone="warning">후보</Chip> : <Chip variant="quiet">확정</Chip>}
    </>
  );
  const actions = (rule: SpeechRuleRow) => (
    <>
      <Button variant="ghost" size="inline" aria-pressed={editing === rule.id} onClick={() => setEditing((id) => (id === rule.id ? undefined : rule.id))}>
        {editing === rule.id ? '닫기' : '편집'}
      </Button>
      {rule.status === 'candidate' && (
        <>
          <Button variant="ghost" size="inline" tone="danger" onClick={() => onDecide([rule.id], 'discard')}>
            버리기
          </Button>
          <Button size="inline" disabled={dirty(rule.id)} title={dirty(rule.id) ? '고친 내용을 저장한 뒤 정합니다.' : undefined} onClick={() => onDecide([rule.id], 'confirm')}>
            <Check /> {confirmLabel([rule])}
          </Button>
        </>
      )}
    </>
  );
  const review = (rule: SpeechRuleRow) => rule.reviewNote && <InspectorResult tone="info">{markName('review', markStyles)}: {rule.reviewNote}</InspectorResult>;
  const editor = (rule: SpeechRuleRow, fields: KindSpec) => <DraftEditor key={rule.id} embedded bare projectId={projectId} kind="speechRules" spec={fields} row={rule} characters={characters} />;
  const rangeOf = (index: number, start: string) => {
    const next = points[index + 1]?.startKey;
    return next ? `${start} ~ ${next} 전` : `${start} ~ 끝`;
  };

  return (
    <>
      <Section>
        {base ? (
          <TimelineStart title="기본 말투 · 처음부터" status={status(base)} counts={<Counts projectId={projectId} rule={base} range={points[0]?.startKey ? `처음 ~ ${points[0].startKey} 전` : '처음부터 끝까지'} />} actions={actions(base)} active={editing === base.id}>
            {review(base)}
            {editing === base.id ? (
              editor(base, spec)
            ) : (
              <>
                <Inline as="p" gap="condensed" wrap>
                  <Text weight="medium">{SPEECH_LEVEL_LABELS[base.level]}</Text>
                  {base.address && <Text tone="muted">호칭 {addressText(base.address)}</Text>}
                </Inline>
                {base.note && <TimelineNote>{base.note}</TimelineNote>}
              </>
            )}
          </TimelineStart>
        ) : (
          <TimelineStart
            title="기본 말투 · 처음부터"
            actions={
              <Button variant="ghost" size="inline" disabled={addBase.isPending} onClick={() => addBase.mutate()}>
                <Plus /> 기본 말투 추가
              </Button>
            }
          >
            <Text as="p" variant="body" tone="muted">{fallback ?? '처음부터 쓰는 말투가 정해지지 않았습니다.'}</Text>
          </TimelineStart>
        )}
      </Section>
      <Section
        title="바뀌는 지점"
        count={points.length}
        actions={
          <Button variant="ghost" aria-pressed={adding} onClick={() => setAdding((open) => !open)}>
            <Plus /> 변화 추가
          </Button>
        }
      >
        <Box spaceY="normal">
          {points.length === 0 && !adding ? (
            <Box spaceY="tight">
              <Text as="p" variant="body" weight="medium">처음부터 끝까지 같은 말투</Text>
              <Text as="p" variant="body" tone="muted">관계가 바뀌어 말투나 호칭이 달라지는 대사가 있으면 그 대사부터 새 말투를 정하세요.</Text>
            </Box>
          ) : (
            <Text as="p" variant="caption" tone="muted">대본 순서대로. 각 지점부터 다음 지점 전까지 그 말투를 씁니다.</Text>
          )}
          {(points.length > 0 || adding) && (
            <Timeline label="바뀌는 지점">
              {points.map((rule, index) => {
                const start = startOf.get(rule.startKey!);
                return (
                  <TimelinePoint
                    key={rule.id}
                    mark={rule.status === 'candidate' ? 'candidate' : 'confirmed'}
                    title={`${rule.startKey}부터`}
                    meta={start?.groupTitle}
                    status={status(rule)}
                    counts={<Counts projectId={projectId} rule={rule} range={rangeOf(index, rule.startKey!)} />}
                    actions={actions(rule)}
                    active={editing === rule.id}
                  >
                    {review(rule)}
                    {editing === rule.id ? (
                      editor(rule, pointSpec)
                    ) : (
                      <>
                        <TimelineFields items={changedFields(rule, rules[rules.indexOf(rule) - 1])} />
                        {rule.note && <TimelineNote>{rule.note}</TimelineNote>}
                        <Quotes projectId={projectId} keys={rule.evidence} />
                      </>
                    )}
                  </TimelinePoint>
                );
              })}
              {adding && (
                <TimelinePoint mark="add" title="새 변화" active>
                  <AddChange projectId={projectId} from={from} to={to} rules={rules} spec={spec} characters={characters} addRule={addRule} onDone={() => setAdding(false)} />
                </TimelinePoint>
              )}
            </Timeline>
          )}
        </Box>
      </Section>
    </>
  );
}

/**
 * A new change: its first line picked from this pair's lines (searchable, in script order), its 말투 and 호칭 starting as the
 * stretch it splits (직전), a note why.
 */
function AddChange({ projectId, from, to, rules, spec, characters, addRule, onDone }: {
  projectId: string;
  from: string;
  to: string;
  rules: SpeechRuleRow[];
  spec: KindSpec;
  characters: { id: string; name: string }[];
  addRule: (json: SpeechRuleCreate) => Promise<{ id: string }>;
  onDone: () => void;
}) {
  const page = useLinePage(projectId, { speaker: from, listener: to, limit: 300 });
  const lines = page.data?.rows;
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | undefined>();
  const indexOf = new Map(lines?.map((line, index) => [line.key, index]));
  // The stretch the picked line falls in: the last rule starting at or before it (the base starts before every line).
  const previous = (key: string | undefined) => {
    const at = key ? (indexOf.get(key) ?? Infinity) : Infinity;
    return [...rules].reverse().find((rule) => (rule.startKey ? (indexOf.get(rule.startKey) ?? Infinity) <= at : true)) ?? rules.at(-1);
  };
  const before = previous(picked);
  const [form, setForm] = useState<{ level: SpeechLevel; address: string; note: string }>({ level: before?.level ?? 'haeyo', address: before?.address ?? '', note: '' });
  const taken = new Set(rules.map((rule) => rule.startKey ?? ''));
  const shown = (lines ?? []).filter((line) => !search || line.source.toLowerCase().includes(search.toLowerCase()) || line.key.includes(search) || (line.translation ?? '').includes(search));
  const pick = (key: string) => {
    setPicked(key);
    const stretch = previous(key);
    setForm((value) => ({ ...value, level: stretch?.level ?? value.level, address: stretch?.address ?? value.address }));
  };
  const add = useMutation({
    mutationFn: () => addRule({ fromName: from, toName: to, level: form.level, address: form.address, note: form.note, startKey: picked! }),
    onSuccess: onDone,
    onError: fail,
  });
  const fieldOf = (name: string) => spec.fields.find((field) => field.name === name)!;
  const pickedLine = lines?.find((line) => line.key === picked);

  return (
    <Box spaceY="normal">
      <Field label="시작 대사" description={pickedLine ? `${pickedLine.key} · “${pickedLine.source}”부터` : `청자가 ${listenerLabel(to)}인 ${from}의 대사에서 고릅니다.`}>
        <Input value={search} placeholder="대사 검색" onChange={(event) => setSearch(event.target.value)} />
      </Field>
      {!lines ? (
        <Text as="p" variant="body" tone="muted">불러오는 중…</Text>
      ) : lines.length === 0 ? (
        <Text as="p" variant="body" tone="muted">청자가 {listenerLabel(to)}로 정해진 {from}의 대사가 없습니다.</Text>
      ) : (
        <InspectorList scroll="scroll">
          {shown.map((line) => (
            <ListRow key={line.id} variant="choice" selected={line.key === picked}>
              <Button variant="ghost" size="row" aria-pressed={line.key === picked} disabled={taken.has(line.key)} onClick={() => pick(line.key)}>
                <Text minWidth={0}>
                  <Text display="block" variant="caption" tone="muted" truncate>{line.key} · {line.groupTitle}</Text>
                  {line.source}
                </Text>
              </Button>
            </ListRow>
          ))}
        </InspectorList>
      )}
      <Field label="말투" description={before ? `직전: ${SPEECH_LEVEL_LABELS[before.level]}` : undefined}>
        <FieldInput field={fieldOf('level')} value={form.level} characters={characters} onChange={(value) => setForm((old) => ({ ...old, level: value as SpeechLevel }))} />
      </Field>
      <Field label="호칭" description={before ? `직전: ${before.address ? addressText(before.address) : '없음'}` : undefined}>
        <FieldInput field={fieldOf('address')} value={form.address} characters={characters} onChange={(value) => setForm((old) => ({ ...old, address: typeof value === 'string' ? value : '' }))} />
      </Field>
      <Field label="메모">
        <FieldInput field={fieldOf('note')} value={form.note} characters={characters} onChange={(value) => setForm((old) => ({ ...old, note: typeof value === 'string' ? value : '' }))} />
      </Field>
      <Inline gap="condensed" justify="end">
        <Button variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button disabled={!picked || add.isPending} onClick={() => add.mutate()}>
          <Plus /> 추가
        </Button>
      </Inline>
    </Box>
  );
}
