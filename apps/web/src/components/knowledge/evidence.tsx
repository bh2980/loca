/** Read-only facts under a knowledge item: its evidence lines, a speech rule's lines, a relationship's changes; and the picker for a stretch's first line. */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Play } from 'lucide-react';
import { listenerLabel, SPEECH_LEVEL_LABELS, type SpeechLevel } from '@tw/shared';
import { RunDialog } from '@/components/workflow/run-dialog';
import { GroupHeading, InspectorSection, InspectorList, InspectorResult, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@loca/ui';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PersonName } from '@/lib/person-colors';

/** A list that stays folded until asked for (a rule's lines, evidence inside a pair): the pane shows what to decide first. */
function Fold({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="inline" className="-ml-1 text-muted-foreground">
          <ChevronRight className={cn('transition-transform', open && 'rotate-90')} /> {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">{children}</CollapsibleContent>
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
      <InspectorSection title={title} actions={actions} defaultOpen={fold ? false : undefined}>
        {children}
      </InspectorSection>
    );
  return (
    <div className="space-y-1.5">
      {fold ? (
        <Fold label={title}>{children}</Fold>
      ) : (
        <>
          <div className="flex min-h-7 items-center justify-between gap-2">
            <GroupHeading>{title}</GroupHeading>
            {actions}
          </div>
          {children}
        </>
      )}
    </div>
  );
}

const lineLink = 'block py-1.5 text-sm hover:bg-muted';

/** The lines a draft cites, opening in the script. Keys that are not lines were already dropped by the server. Omitted when there are none. */
export function Evidence({ projectId, keys, embedded }: { projectId: string; keys: string[]; embedded?: boolean }) {
  const lines = useQuery(q.linesByKeys(projectId, keys.slice(0, 50)));
  if (!keys.length) return null;
  return (
    <Part title={`근거 대사 ${keys.length}`} embedded={embedded} fold>
      <InspectorList>
        {lines.data?.map((line) => (
          <li key={line.id}>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className={lineLink}>
              <span className="text-xs text-muted-foreground">{line.groupTitle} · </span>
              {line.speaker && <span className="font-medium"><PersonName projectId={projectId} name={line.speaker} />: </span>}
              {line.source}
            </Link>
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
          <InspectorList className="max-h-60 overflow-auto">
            {lines.data.rows.map((line) => (
              <li key={line.id}>
                <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className={lineLink}>
                  <span className="text-xs text-muted-foreground">{line.groupTitle} · </span>
                  {line.source}
                  {line.translation && <span className="block text-muted-foreground">{line.translation}</span>}
                </Link>
              </li>
            ))}
          </InspectorList>
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
            <li key={`${change.at}-${change.kind}`} className="py-2 text-sm first:pt-0 last:pb-0">
              <p>
                <span className="font-medium">→ {change.kind}</span>
                {change.cause && <span className="text-muted-foreground"> · {change.cause}</span>}
              </p>
              {line && (
                <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="mt-1 block text-muted-foreground hover:underline">
                  {line.speaker && `${line.speaker}: `}
                  {line.source}
                </Link>
              )}
            </li>
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
    <div className="space-y-1">
      <div className="flex min-h-7 items-center gap-2">
        <GroupHeading>시작 대사 선택</GroupHeading>
        <Button variant="ghost" size="inline" className="ml-auto text-muted-foreground" onClick={onCancel}>
          취소
        </Button>
      </div>
      {!lines.data ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : lines.data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">청자가 {listenerLabel(to)}로 정해진 {from}의 대사가 없습니다.</p>
      ) : (
        <InspectorList className="max-h-64 overflow-auto">
          {lines.data.rows.map((line) => (
            <li key={line.id}>
              <Button variant="ghost" size="row" className="text-sm" disabled={taken.has(line.key)} onClick={() => onPick(line.key)}>
                <span className="min-w-0">
                  <span className="text-xs text-muted-foreground">{line.groupTitle} · </span>
                  {line.source}
                </span>
              </Button>
            </li>
          ))}
        </InspectorList>
      )}
    </div>
  );
}
