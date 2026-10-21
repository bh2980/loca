import type { InferResponseType } from 'hono/client';
import { Link } from '@tanstack/react-router';
import { Button, InspectorField, NumberInput, SectionHeading } from '@loca/ui';
import type { CapEdits, Caps } from '@/lib/run-limits';
import { splitBasis, splitTitle } from '@/lib/split-text';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import type { client } from '@/lib/api';

/** A run's plan and estimate as the preflight returns it (starting a run, or continuing one). */
export type PlanData = InferResponseType<(typeof client.workflows)[':id']['preflight']['$post'], 200>;

const duration = (seconds: number) => (seconds < 90 ? `${Math.max(1, Math.round(seconds / 10) * 10)}초` : seconds < 5400 ? `${Math.round(seconds / 60)}분` : `${(seconds / 3600).toFixed(1)}시간`);

/**
 * How long and how much, in plain words (for the models picked below). With `projectId`, also how
 * many AI requests other runs already send at once and what this one adds: a notice, never a block.
 */
export function Pace({ data, projectId }: { data: PlanData; projectId?: string }) {
  const calls = data.totals.calls;
  const callText = calls.expected !== null ? `${calls.expected.toLocaleString()}회` : `${calls.min.toLocaleString()}~${calls.max.toLocaleString()}회`;
  const { seconds, costUsd, subscription } = data.pace;
  // Only what is known: no time without history, no cost the provider never reported.
  const money = subscription && !costUsd ? '구독 사용' : costUsd === null ? null : costUsd === 0 && !subscription ? '무료' : costUsd < 0.01 ? '1센트 미만' : `약 $${costUsd.toFixed(2)}${subscription ? ' + 구독' : ''}`;
  return (
    <section className="space-y-2">
      <SectionHeading>예상</SectionHeading>
      <p className="text-sm">
        AI 요청 <b className="font-medium tabular-nums">{callText}</b>
        {seconds !== null && (
          <>
            {' · 약 '}
            <b className="font-medium">{duration(seconds)}</b>
          </>
        )}
        {money && ` · ${money}`}
      </p>
      {data.nodes.length > 0 && (
        <div className="space-y-1.5">
          {data.nodes.map((node) => (
            <div key={node.nodeId}>
              <p className="text-sm">{splitTitle(node.name, node.split)}</p>
              <p className="text-xs text-muted-foreground">{splitBasis(node.split)}</p>
            </div>
          ))}
        </div>
      )}
      {projectId && data.load.runs > 0 && (
        <p className="text-xs text-warning" role="status">
          다른 실행 {data.load.runs}개가 AI 요청을 최대 {data.load.max}개까지 동시에 보내는 중입니다. 이 실행을 시작하면 최대 {data.load.max + data.load.added}개가 됩니다.{' '}
          <Link to="/p/$projectId/runs" params={{ projectId }} className="underline underline-offset-2">
            실행 기록 보기
          </Link>
        </p>
      )}
    </section>
  );
}

/**
 * Which model each AI step runs on, changeable for this run only (like the work analysis's picker).
 * Each starts at the step's own model; a picked one replaces it, and the models the step otherwise
 * shares its requests with, for this run. The workflow keeps its own (change it there for good).
 */
export function RunModels({ nodes, picked, onPick, onReset, changedNote = '이번 실행만' }: { nodes: PlanData['nodes']; picked: Record<string, ModelValue>; onPick: (nodeId: string, value: ModelValue) => void; onReset: (nodeId: string) => void; /** Says how far a picked model reaches. */ changedNote?: string }) {
  return (
    <section className="space-y-2">
      <SectionHeading>모델</SectionHeading>
      {nodes.map((node) => {
        const own = node.choice.connectionId && node.choice.model ? node.choice : null;
        const changed = Boolean(picked[node.nodeId]);
        return (
          <div key={node.nodeId} className="flex min-w-0 flex-wrap items-center gap-2">
            {nodes.length > 1 && <span className="w-28 shrink-0 truncate text-sm">{node.name}</span>}
            <ModelPicker value={picked[node.nodeId] ?? own} onChange={(value) => onPick(node.nodeId, value)} className="min-w-0 flex-1" />
            {changed && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {changedNote}
                <Button variant="ghost" size="inline" onClick={() => onReset(node.nodeId)}>
                  원래대로
                </Button>
              </span>
            )}
            {!changed && node.sharedWith.length > 0 && <span className="text-xs text-muted-foreground">+ {node.sharedWith.join(', ')}</span>}
          </div>
        );
      })}
    </section>
  );
}

/** The caps a run pauses at, filled with the suggestion; emptying a field removes that cap. */
export function RunCaps({ suggested, edits, onChange }: { suggested: Caps | undefined; edits: CapEdits; onChange: (edits: CapEdits) => void }) {
  const shown = (key: keyof Caps) => (edits[key] === undefined ? suggested?.[key] : edits[key]);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <InspectorField label="호출 상한" description="비우면 상한 없이 실행합니다." help="이만큼 쓰면 실행을 멈춥니다. 재요청 노드가 있으면 그 여유분이 들어 있습니다.">
        <NumberInput optional min={1} value={shown('maxCalls')} onValueChange={(next) => onChange({ ...edits, maxCalls: next ?? null })} />
      </InspectorField>
      <InspectorField label="입력 상한" description="비우면 상한 없이 실행합니다." help="실행 전체가 AI에 보내는 입력 토큰(캐시 포함)이 이만큼 되기 전에 멈춥니다.">
        <NumberInput optional min={1} value={shown('maxInputTokens')} onValueChange={(next) => onChange({ ...edits, maxInputTokens: next ?? null })} />
      </InspectorField>
    </div>
  );
}
