/** Read-only facts under a knowledge item: its evidence lines, a speech rule's lines, a relationship's changes; and the picker for a stretch's first line. */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Play } from 'lucide-react';
import { listenerLabel, SPEECH_LEVEL_LABELS, type SpeechLevel } from '@tw/shared';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Box, InspectorList, InspectorResult, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, Inline, ListRow, Text, TextLink, Section, SectionHeading } from '@loca/ui';
import { q } from '@/lib/queries';
import { PersonName } from '@/lib/person-colors';
import { useLinePage, useLines, useLinesByKeys } from '@/lib/units';

/** A list that stays folded until asked for (a rule's lines, evidence inside a pair): the pane shows what to decide first. */
function Fold({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="inline" tone="muted" flush="start">
          <Icon icon={ChevronRight} turn={open} /> {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent marginTop="tight">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A titled part of the pane, or (embedded in a pair's pane, where it already sits inside a section)
 * the same content under a small heading. `fold` keeps the content folded either way.
 */
function Part({ title, actions, embedded, fold, children }: { title: string; actions?: ReactNode; embedded?: boolean; fold?: boolean; children: ReactNode }) {
  if (!embedded)
    return (
      <Section title={title} actions={actions} defaultOpen={fold ? false : undefined}>
        {children}
      </Section>
    );
  return (
    <Box spaceY="condensed">
      {fold ? (
        <Fold label={title}>{children}</Fold>
      ) : (
        <>
          <Inline gap="condensed" minHeight="control-sm" justify="between">
            <SectionHeading level="group">{title}</SectionHeading>
            {actions}
          </Inline>
          {children}
        </>
      )}
    </Box>
  );
}

/** The lines a draft cites, opening in the script. Keys that are not lines were already dropped by the server. Omitted when there are none. */
export function Evidence({ projectId, keys, embedded }: { projectId: string; keys: string[]; embedded?: boolean }) {
  const cited = useMemo(() => keys.slice(0, 50), [keys]);
  const lines = useLinesByKeys(projectId, cited);
  if (!keys.length) return null;
  return (
    <Part title={`근거 대사 ${keys.length}`} embedded={embedded} fold>
      <InspectorList>
        {lines.data?.map((line) => (
          <li key={line.id}>
            <ListRow as="link" variant="line">
              <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }}>
                <Text variant="caption" tone="muted">{line.groupTitle} · </Text>
                {line.speaker && <Text weight="medium"><PersonName projectId={projectId} name={line.speaker} />: </Text>}
                {line.source}
              </Link>
            </ListRow>
          </li>
        ))}
      </InspectorList>
    </Part>
  );
}

/** Lines the rule governs and what their translations end in; after fixing the rule, re-run just these. */
export function RuleLines({ projectId, ruleId, candidate, embedded }: { projectId: string; ruleId: string; candidate: boolean; embedded?: boolean }) {
  const rule = useQuery(q.ruleLines(projectId, ruleId));
  // The rule's numbers are the question; its first lines come from the units collection.
  const shownIds = useMemo(() => rule.data?.unitIds.slice(0, 100), [rule.data]);
  const shown = useLines(projectId, shownIds).rows;
  const lines = { data: rule.data && { ...rule.data, rows: shown ?? [] } };
  const levels = Object.entries(lines.data?.levels ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Part
      title={`${candidate ? '확정하면 적용될' : '적용되는'} 대사 ${lines.data?.count ?? '…'}개`}
      embedded={embedded}
      actions={
        lines.data?.translatedIds.length && !candidate ? (
          <RunDialog
            projectId={projectId}
            unitIds={lines.data.translatedIds}
            defaultIgnoreStatus
            remember="speech-fix"
            trigger={
              <Button variant="ghost" size={embedded ? 'inline' : undefined}>
                <Play /> 말투 맞추기 · {lines.data.translatedIds.length.toLocaleString()}줄
              </Button>
            }
          />
        ) : undefined
      }
    >
      {!!lines.data?.routeDependent && <InspectorResult tone="info">이 중 {lines.data.routeDependent.toLocaleString()}개는 루트에 따라 규칙이 달라질 수 있어 대본 순서로 골랐습니다. 확인하세요.</InspectorResult>}
      {levels.length > 0 && (
        <InspectorResult tone="info">
          번역 말투 · 추정: {levels.map(([level, count]) => `${level === 'unknown' ? '판단 불가·번역 없음' : SPEECH_LEVEL_LABELS[level as SpeechLevel]} ${count}`).join(' · ')}
        </InspectorResult>
      )}
      {!!lines.data?.rows.length && (
        <Fold label="대사 보기">
          <InspectorList scroll="scroll">
            {lines.data.rows.map((line) => (
              <li key={line.id}>
                <ListRow as="link" variant="line">
                  <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }}>
                    <Text variant="caption" tone="muted">{line.groupTitle} · </Text>
                    {line.source}
                    {line.translation && <Text display="block" tone="muted">{line.translation}</Text>}
                  </Link>
                </ListRow>
              </li>
            ))}
          </InspectorList>
        </Fold>
      )}
    </Part>
  );
}

export function RelationshipChanges({ projectId, changes, embedded }: { projectId: string; changes: { at: string; kind: string; cause: string }[]; embedded?: boolean }) {
  const atKeys = useMemo(() => changes.map((change) => change.at), [changes]);
  const lines = useLinesByKeys(projectId, atKeys);
  if (!changes.length) return null;
  const byKey = new Map(lines.data?.map((line) => [line.key, line]));
  return (
    <Part title={`관계 변화 ${changes.length}`} embedded={embedded}>
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
