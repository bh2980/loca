/** Read-only facts under a knowledge item: its evidence lines, a speech rule's lines, a relationship's changes. */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Play } from 'lucide-react';
import { SPEECH_FIX_WORKFLOW, SPEECH_LEVEL_LABELS, type SpeechLevel } from '@tw/shared';
import { RunDialog } from '@/components/workflow/run-dialog';
import { InspectorSection, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@loca/ui';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** A list that stays folded until asked for (evidence, a rule's lines): the pane shows what to decide first. */
function Fold({ label, children, actions }: { label: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex min-h-7 items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="inline" className="-ml-1 text-muted-foreground">
            <ChevronRight className={cn('transition-transform', open && 'rotate-90')} /> {label}
          </Button>
        </CollapsibleTrigger>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      <CollapsibleContent className="mt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** The lines a draft cites, opening in the script. Keys that are not lines were already dropped by the server. */
export function Evidence({ projectId, keys }: { projectId: string; keys: string[] }) {
  const lines = useQuery(q.linesByKeys(projectId, keys.slice(0, 50)));
  if (!keys.length)
    return (
      <InspectorSection title="근거 대사">
        <p className="text-xs text-muted-foreground">연결된 근거 대사가 없습니다.</p>
      </InspectorSection>
    );
  return <InspectorSection title={`근거 대사 ${keys.length}개`} defaultOpen={false}>
    <ul className="space-y-1">
      {lines.data?.map((line) => (
        <li key={line.id}>
          <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
            <span className="text-muted-foreground">{line.groupTitle} · </span>
            {line.speaker && <span className="font-medium">{line.speaker}: </span>}
            {line.source}
          </Link>
        </li>
      ))}
    </ul>
  </InspectorSection>;
}

/** Lines the rule governs and what their translations end in; after fixing the rule, re-run just these. */
export function RuleLines({ projectId, ruleId, candidate }: { projectId: string; ruleId: string; candidate: boolean }) {
  const lines = useQuery(q.ruleLines(projectId, ruleId));
  const levels = Object.entries(lines.data?.levels ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <InspectorSection
      title={`${candidate ? '확정하면 적용될' : '이 규칙이 적용되는'} 대사 ${lines.data?.count ?? '…'}개`}
      actions={
        lines.data?.translatedIds.length && !candidate ? (
          <RunDialog
            projectId={projectId}
            unitIds={lines.data.translatedIds}
            defaultIgnoreStatus
            preferWorkflow={SPEECH_FIX_WORKFLOW}
            trigger={
              <Button variant="ghost" title={`“${SPEECH_FIX_WORKFLOW}” 워크플로로 번역된 줄의 어미·호칭만 이 규칙에 맞춥니다`}>
                <Play /> 번역된 {lines.data.translatedIds.length.toLocaleString()}줄 말투 맞추기
              </Button>
            }
          />
        ) : undefined
      }
    >
      <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {lines.data && !lines.data.translatedIds.length
          ? '아직 번역된 줄이 없습니다. 이 줄들을 번역할 때 이 규칙이 들어갑니다.'
          : `규칙을 고쳤다면 “말투 맞추기”로 이미 번역된 줄의 어미·호칭만 다시 맞춥니다. 뜻과 표현은 그대로 둡니다.`}
      </p>
      {!!lines.data?.routeDependent && (
        <p className="text-xs text-warning">
          이 중 {lines.data.routeDependent.toLocaleString()}개는 구간 시작을 거쳤는지가 루트에 따라 달라, 대본 순서로 이 규칙을 골랐습니다. 번역은 한 줄에 하나라 루트 하나에만 맞을 수 있으니 확인하세요.
        </p>
      )}
      {levels.length > 0 && (
        <p className="text-xs">
          지금 번역의 말투(어미 추정):{' '}
          {levels.map(([level, count]) => `${level === 'unknown' ? '판단 불가·번역 없음' : SPEECH_LEVEL_LABELS[level as SpeechLevel]} ${count}`).join(' · ')}
        </p>
      )}
      <Fold label="대사 보기">
      <ul className="max-h-60 space-y-1 overflow-auto">
        {lines.data?.rows.map((line) => (
          <li key={line.id}>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
              <span className="text-muted-foreground">{line.groupTitle} · </span>
              {line.source}
              {line.translation && <span className="block text-muted-foreground">{line.translation}</span>}
            </Link>
          </li>
        ))}
      </ul>
      </Fold>
      </div>
    </InspectorSection>
  );
}

export function RelationshipChanges({ projectId, changes }: { projectId: string; changes: { at: string; change: string; cause: string }[] }) {
  const lines = useQuery(q.linesByKeys(projectId, changes.map((change) => change.at)));
  if (!changes.length) return null;
  const byKey = new Map(lines.data?.map((line) => [line.key, line]));
  return (
    <InspectorSection title="관계 변화">
      <ul className="space-y-2">
        {changes.map((change) => {
          const line = byKey.get(change.at);
          return (
            <li key={`${change.at}-${change.change}`} className="rounded border p-2 text-xs">
              <p>{change.change}</p>
              {line && (
                <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="mt-1 block text-muted-foreground hover:underline">
                  {line.speaker && `${line.speaker}: `}
                  {line.source}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </InspectorSection>
  );
}
