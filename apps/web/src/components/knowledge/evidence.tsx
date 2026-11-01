/** Read-only facts in a knowledge item's tabs: its evidence lines, a speech rule's lines, a relationship's changes, a pair's lines merged; and the picker for a stretch's first line. */
import { useMemo, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { listenerLabel, SPEECH_LEVEL_LABELS, type SpeechLevel } from '@tw/shared';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Box, Chip, Group, InspectorList, InspectorResult, Button, Inline, ListRow, Text, TextLink, Section, SectionHeading } from '@loca/ui';
import { q } from '@/lib/queries';
import { PersonName } from '@/lib/person-colors';
import { useLinePage, useLines, useLinesByKeys } from '@/lib/units';
import { mergeLines, type LineReason } from '@/lib/merge-lines';

type LineRow = NonNullable<ReturnType<typeof useLines>['rows']>[number];

/** A titled part of a tab: a section in the pane, or a group under a small heading when embedded in a pair's pane (which already sits in a tab). */
function Part({ title, actions, embedded, children }: { title: string; actions?: ReactNode; embedded?: boolean; children: ReactNode }) {
  return embedded ? (
    <Group title={title} actions={actions}>
      {children}
    </Group>
  ) : (
    <Section title={title} actions={actions}>
      {children}
    </Section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <Text as="p" variant="body" tone="muted">
    {children}
  </Text>
);

/** One line of a list, opening in the script: where it is, who says it, the source, its translation, then why it is listed. */
function LineLink({ projectId, line, translation, chips }: { projectId: string; line: LineRow; translation?: boolean; chips?: ReactNode }) {
  return (
    <ListRow as="link" variant="line">
      <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }}>
        <Text display="block" variant="caption" tone="muted">{line.groupTitle}</Text>
        {line.speaker && <Text weight="medium"><PersonName projectId={projectId} name={line.speaker} />: </Text>}
        {line.source}
        {translation && line.translation && <Text display="block" tone="muted">{line.translation}</Text>}
        {chips && <Box asChild marginTop="tight"><Inline as="span" gap="tight" wrap>{chips}</Inline></Box>}
      </Link>
    </ListRow>
  );
}

/** The lines a draft cites, opening in the script. Keys that are not lines were already dropped by the server. */
export function Evidence({ projectId, keys }: { projectId: string; keys: string[] }) {
  const cited = useMemo(() => keys.slice(0, 50), [keys]);
  const lines = useLinesByKeys(projectId, cited);
  return (
    <Part title={`근거 대사 ${keys.length}`}>
      {!keys.length ? (
        <Empty>근거로 든 대사가 없습니다.</Empty>
      ) : (
        <InspectorList>
          {lines.data?.map((line) => (
            <li key={line.id}>
              <LineLink projectId={projectId} line={line} />
            </li>
          ))}
        </InspectorList>
      )}
      {keys.length > cited.length && <Empty>앞 {cited.length}줄만 보입니다.</Empty>}
    </Part>
  );
}

/** 말투 맞추기 for lines already translated: re-runs them so their speech follows the rules. */
function FixSpeech({ projectId, unitIds, inline }: { projectId: string; unitIds: string[]; inline?: boolean }) {
  return (
    <RunDialog
      projectId={projectId}
      unitIds={unitIds}
      defaultIgnoreStatus
      remember="speech-fix"
      trigger={
        <Button variant="ghost" size={inline ? 'inline' : undefined}>
          <Play /> 말투 맞추기 · {unitIds.length.toLocaleString()}줄
        </Button>
      }
    />
  );
}

/**
 * Lines the rule governs and what their translations end in; after fixing the rule, re-run just these. Embedded in a pair's
 * pane it is the summary only: the lines themselves are in the pair's 근거 대사 tab.
 */
export function RuleLines({ projectId, ruleId, candidate, embedded }: { projectId: string; ruleId: string; candidate: boolean; embedded?: boolean }) {
  const rule = useQuery(q.ruleLines(projectId, ruleId));
  // The rule's numbers are the question; its first lines come from the units collection.
  const shownIds = useMemo(() => (embedded ? undefined : rule.data?.unitIds.slice(0, 100)), [rule.data, embedded]);
  const shown = useLines(projectId, shownIds).rows ?? [];
  const levels = Object.entries(rule.data?.levels ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Part
      title={`${candidate ? '확정하면 적용될' : '적용되는'} 대사 ${rule.data?.count ?? '…'}개`}
      embedded={embedded}
      actions={rule.data?.translatedIds.length && !candidate ? <FixSpeech projectId={projectId} unitIds={rule.data.translatedIds} inline={embedded} /> : undefined}
    >
      {!!rule.data?.routeDependent && <InspectorResult tone="info">이 중 {rule.data.routeDependent.toLocaleString()}개는 루트에 따라 규칙이 달라질 수 있어 대본 순서로 골랐습니다. 확인하세요.</InspectorResult>}
      {levels.length > 0 && (
        <InspectorResult tone="info">
          번역 말투 · 추정: {levels.map(([level, count]) => `${level === 'unknown' ? '판단 불가·번역 없음' : SPEECH_LEVEL_LABELS[level as SpeechLevel]} ${count}`).join(' · ')}
        </InspectorResult>
      )}
      {embedded ? (
        !!rule.data?.count && <Empty>대사 목록은 근거 대사 탭에서 봅니다.</Empty>
      ) : rule.data && !rule.data.count ? (
        <Empty>이 규칙이 적용되는 대사가 없습니다.</Empty>
      ) : (
        <InspectorList>
          {shown.map((line) => (
            <li key={line.id}>
              <LineLink projectId={projectId} line={line} translation />
            </li>
          ))}
        </InspectorList>
      )}
      {!embedded && rule.data && rule.data.count > shown.length && shown.length > 0 && <Empty>앞 {shown.length}줄만 보입니다.</Empty>}
    </Part>
  );
}

export function RelationshipChanges({ projectId, changes, embedded, actions }: { projectId: string; changes: { at: string; kind: string; cause: string }[]; embedded?: boolean; actions?: ReactNode }) {
  const atKeys = useMemo(() => changes.map((change) => change.at), [changes]);
  const lines = useLinesByKeys(projectId, atKeys);
  const byKey = new Map(lines.data?.map((line) => [line.key, line]));
  return (
    <Part title={`관계 변화 ${changes.length}`} embedded={embedded} actions={actions}>
      {!changes.length ? (
        <Empty>이야기 중 관계가 바뀌는 지점이 없습니다.</Empty>
      ) : (
        <InspectorList>
          {changes.map((change) => {
            const line = byKey.get(change.at);
            return (
              <ListRow key={`${change.at}-${change.kind}`} density="loose">
                <p>
                  <Text weight="medium">→ {change.kind}</Text>
                  {change.cause && <Text tone="muted"> · {change.cause}</Text>}
                </p>
                {line && (
                  <Box asChild marginTop="tight">
                    <TextLink asChild block tone="muted" underline="hover">
                      <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }}>
                        {line.speaker && `${line.speaker}: `}
                        {line.source}
                      </Link>
                    </TextLink>
                  </Box>
                )}
              </ListRow>
            );
          })}
        </InspectorList>
      )}
    </Part>
  );
}

const REASON: Record<LineReason, string> = { applied: '말투 적용', evidence: '근거' };

/**
 * A pair's lines in one list: those its rules apply to and those its rule(s) and relationship cite, each once (mergeLines),
 * marked 말투 적용 / 근거 and with the speech level the rule asks for. `count` is for the tab; null while loading.
 */
export function usePairLines(projectId: string, rules: readonly { id: string; level: SpeechLevel; status: string; evidence: string[] }[], citing: readonly { evidence: string[] }[]) {
  const ruleLines = useQueries({ queries: rules.map((rule) => q.ruleLines(projectId, rule.id)) });
  const appliedIds = useMemo(() => [...new Set(ruleLines.flatMap((result) => result.data?.unitIds.slice(0, 100) ?? []))], [ruleLines]);
  const keys = useMemo(() => [...new Set([...rules, ...citing].flatMap((item) => item.evidence))].slice(0, 100), [rules, citing]);
  const applied = useLines(projectId, appliedIds.length ? appliedIds : undefined).rows;
  const cited = useLinesByKeys(projectId, keys).data;
  const loading = ruleLines.some((result) => result.isLoading) || (appliedIds.length > 0 && !applied) || (keys.length > 0 && !cited);
  const byId = new Map((applied ?? []).map((line) => [line.id, line]));
  const merged = mergeLines<LineRow>([
    ...rules.map((rule, index) => ({ reason: 'applied' as const, note: SPEECH_LEVEL_LABELS[rule.level], lines: (ruleLines[index]?.data?.unitIds.slice(0, 100) ?? []).flatMap((id) => byId.get(id) ?? []) })),
    { reason: 'evidence' as const, lines: cited ?? [] },
  ]);
  // Only confirmed rules steer translation; their translated lines are what 말투 맞추기 re-runs.
  const translatedIds = [...new Set(rules.flatMap((rule, index) => (rule.status === 'candidate' ? [] : (ruleLines[index]?.data?.translatedIds ?? []))))];
  const truncated = ruleLines.some((result) => (result.data?.count ?? 0) > 100) || keys.length >= 100;
  return { merged, count: loading ? null : merged.length, translatedIds, truncated };
}

export function PairLines({ projectId, lines }: { projectId: string; lines: ReturnType<typeof usePairLines> }) {
  return (
    <Part title={`근거 대사 ${lines.count ?? '…'}`} actions={lines.translatedIds.length ? <FixSpeech projectId={projectId} unitIds={lines.translatedIds} /> : undefined}>
      <Empty>적용되는 대사와 근거 대사를 합쳐 한 번만 보여 줍니다.</Empty>
      {lines.count === 0 ? (
        <Empty>이 쌍에 적용되거나 근거로 든 대사가 없습니다.</Empty>
      ) : (
        <InspectorList>
          {lines.merged.map(({ line, reasons, notes }) => (
            <li key={line.id}>
              <LineLink
                projectId={projectId}
                line={line}
                translation
                chips={
                  <>
                    {reasons.map((reason) => <Chip key={reason} variant="outline" size="compact">{REASON[reason]}</Chip>)}
                    {reasons.includes('applied') && notes.map((note) => <Chip key={note} variant="quiet" size="compact">{note}</Chip>)}
                  </>
                }
              />
            </li>
          ))}
        </InspectorList>
      )}
      {lines.truncated && <Empty>규칙·근거마다 앞 100줄까지 보입니다.</Empty>}
    </Part>
  );
}

/** This pair's lines (by listener), to pick the one where the speech changes or starts. */
export function StretchPicker({ projectId, from, to, taken, onPick, onCancel }: { projectId: string; from: string; to: string; taken: Set<string>; onPick: (key: string) => void; onCancel: () => void }) {
  const lines = useLinePage(projectId, { speaker: from, listener: to, limit: 300 });
  return (
    <Box spaceY="tight">
      <Inline gap="condensed" minHeight="control-sm">
        <SectionHeading level="group">시작 대사 선택</SectionHeading>
        <Button variant="ghost" size="inline" marginLeft="auto" tone="muted" onClick={onCancel}>
          취소
        </Button>
      </Inline>
      {!lines.data ? (
        <Text as="p" variant="body" tone="muted">불러오는 중…</Text>
      ) : lines.data.rows.length === 0 ? (
        <Text as="p" variant="body" tone="muted">청자가 {listenerLabel(to)}로 정해진 {from}의 대사가 없습니다.</Text>
      ) : (
        <InspectorList scroll="scroll">
          {lines.data.rows.map((line) => (
            <li key={line.id}>
              <ListRow as="button" variant="pick" disabled={taken.has(line.key)} onClick={() => onPick(line.key)}>
                <Text minWidth={0}>
                  <Text variant="caption" tone="muted">{line.groupTitle} · </Text>
                  {line.source}
                </Text>
              </ListRow>
            </li>
          ))}
        </InspectorList>
      )}
    </Box>
  );
}
