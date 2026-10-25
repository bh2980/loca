/** Read-only facts under a knowledge item: its evidence lines, a speech rule's lines, a relationship's changes; and the picker for a stretch's first line. */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { listenerLabel, SPEECH_LEVEL_LABELS, type SpeechLevel } from '@tw/shared';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Box, GroupHeading, InspectorSection, InspectorList, InspectorResult, Button, KnowledgeFold, KnowledgeLineLink, KnowledgeListItem, KnowledgeRowButton, KnowledgeScrollList, KnowledgeSubheadRow, Text } from '@loca/ui';
import { q } from '@/lib/queries';
import { PersonName } from '@/lib/person-colors';

/** A list that stays folded until asked for (a rule's lines, evidence inside a pair): the pane shows what to decide first. */
function Fold({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <KnowledgeFold label={label} open={open} onOpenChange={setOpen}>
      {children}
    </KnowledgeFold>
  );
}

/**
 * A titled part of the pane, or (embedded in a pair's pane, where it already sits inside a section)
 * the same content under a small heading. `fold` keeps the content folded either way.
 */
function Part({ title, actions, embedded, fold, children }: { title: string; actions?: ReactNode; embedded?: boolean; fold?: boolean; children: ReactNode }) {
  if (!embedded)
    return (
      <InspectorSection title={title} actions={actions} defaultOpen={fold ? false : undefined}>
        {children}
      </InspectorSection>
    );
  return (
    <Box spaceY="snug">
      {fold ? (
        <Fold label={title}>{children}</Fold>
      ) : (
        <>
          <KnowledgeSubheadRow spread>
            <GroupHeading>{title}</GroupHeading>
            {actions}
          </KnowledgeSubheadRow>
          {children}
        </>
      )}
    </Box>
  );
}

/** The lines a draft cites, opening in the script. Keys that are not lines were already dropped by the server. Omitted when there are none. */
export function Evidence({ projectId, keys, embedded }: { projectId: string; keys: string[]; embedded?: boolean }) {
  const lines = useQuery(q.linesByKeys(projectId, keys.slice(0, 50)));
  if (!keys.length) return null;
  return (
    <Part title={`근거 대사 ${keys.length}`} embedded={embedded} fold>
      <InspectorList>
        {lines.data?.map((line) => (
          <li key={line.id}>
            <KnowledgeLineLink>
              <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }}>
                <Text variant="caption" tone="muted">{line.groupTitle} · </Text>
                {line.speaker && <Text weight="medium"><PersonName projectId={projectId} name={line.speaker} />: </Text>}
                {line.source}
              </Link>
            </KnowledgeLineLink>
          </li>
        ))}
      </InspectorList>
    </Part>
  );
}

/** Lines the rule governs and what their translations end in; after fixing the rule, re-run just these. */
export function RuleLines({ projectId, ruleId, candidate, embedded }: { projectId: string; ruleId: string; candidate: boolean; embedded?: boolean }) {
  const lines = useQuery(q.ruleLines(projectId, ruleId));
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
          <KnowledgeScrollList limit={60}>
            {lines.data.rows.map((line) => (
              <li key={line.id}>
                <KnowledgeLineLink>
                  <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }}>
                    <Text variant="caption" tone="muted">{line.groupTitle} · </Text>
                    {line.source}
                    {line.translation && <Text display="block" tone="muted">{line.translation}</Text>}
                  </Link>
                </KnowledgeLineLink>
              </li>
            ))}
          </KnowledgeScrollList>
        </Fold>
      )}
    </Part>
  );
}

export function RelationshipChanges({ projectId, changes, embedded }: { projectId: string; changes: { at: string; kind: string; cause: string }[]; embedded?: boolean }) {
  const lines = useQuery(q.linesByKeys(projectId, changes.map((change) => change.at)));
  if (!changes.length) return null;
  const byKey = new Map(lines.data?.map((line) => [line.key, line]));
  return (
    <Part title={`관계 변화 ${changes.length}`} embedded={embedded}>
      <InspectorList>
        {changes.map((change) => {
          const line = byKey.get(change.at);
          return (
            <KnowledgeListItem key={`${change.at}-${change.kind}`} density="loose">
              <p>
                <Text weight="medium">→ {change.kind}</Text>
                {change.cause && <Text tone="muted"> · {change.cause}</Text>}
              </p>
              {line && (
                <KnowledgeLineLink kind="quote">
                  <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }}>
                    {line.speaker && `${line.speaker}: `}
                    {line.source}
                  </Link>
                </KnowledgeLineLink>
              )}
            </KnowledgeListItem>
          );
        })}
      </InspectorList>
    </Part>
  );
}

/** This pair's lines (by listener), to pick the one where the speech changes or starts. */
export function StretchPicker({ projectId, from, to, taken, onPick, onCancel }: { projectId: string; from: string; to: string; taken: Set<string>; onPick: (key: string) => void; onCancel: () => void }) {
  const lines = useQuery(q.units(projectId, { speaker: from, listener: to, limit: 300 }));
  return (
    <Box spaceY="tight">
      <KnowledgeSubheadRow>
        <GroupHeading>시작 대사 선택</GroupHeading>
        <Button variant="ghost" size="inline" marginLeft="auto" tone="muted" onClick={onCancel}>
          취소
        </Button>
      </KnowledgeSubheadRow>
      {!lines.data ? (
        <Text as="p" variant="body" tone="muted">불러오는 중…</Text>
      ) : lines.data.rows.length === 0 ? (
        <Text as="p" variant="body" tone="muted">청자가 {listenerLabel(to)}로 정해진 {from}의 대사가 없습니다.</Text>
      ) : (
        <KnowledgeScrollList limit={64}>
          {lines.data.rows.map((line) => (
            <li key={line.id}>
              <KnowledgeRowButton disabled={taken.has(line.key)} onClick={() => onPick(line.key)}>
                <Text minWidth={0}>
                  <Text variant="caption" tone="muted">{line.groupTitle} · </Text>
                  {line.source}
                </Text>
              </KnowledgeRowButton>
            </li>
          ))}
        </KnowledgeScrollList>
      )}
    </Box>
  );
}
