import type { InferResponseType } from 'hono/client';
import { Link } from '@tanstack/react-router';
import { Box, Button, Grid, Inline, NumberInput, SectionHeading, Stack, Text, Field } from '@loca/ui';
import type { CapEdits, Caps } from '@/lib/run-limits';
import { splitBasis, splitTitle } from '@/lib/split-text';
import { paceParts } from '@/lib/run-summary';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import type { client } from '@/lib/api';

/** A run's plan and estimate as the preflight returns it (starting a run, or continuing one). */
export type PlanData = InferResponseType<(typeof client.workflows)[':id']['preflight']['$post'], 200>;

/**
 * How long and how much, in plain words (for the models picked below). With `projectId`, also how
 * many AI requests other runs already send at once and what this one adds: a notice, never a block.
 */
export function Pace({ data, projectId }: { data: PlanData; projectId?: string }) {
  const { callText, time, money } = paceParts(data);
  return (
    <Box as="section" spaceY="condensed">
      <SectionHeading>예상</SectionHeading>
      <Text as="p" variant="body">
        AI 요청 <Text as="b" weight="medium" tabular>{callText}</Text>
        {time !== null && (
          <>
            {' · 약 '}
            <Text as="b" weight="medium">{time}</Text>
          </>
        )}
        {money && ` · ${money}`}
      </Text>
      {data.nodes.length > 0 && (
        <Box spaceY="snug">
          {data.nodes.map((node) => (
            <div key={node.nodeId}>
              <Text as="p" variant="body">{splitTitle(node.name, node.split)}</Text>
              <Text as="p" variant="caption" tone="muted">{splitBasis(node.split)}</Text>
            </div>
          ))}
        </Box>
      )}
      {projectId && data.load.runs > 0 && (
        <Text as="p" variant="caption" tone="warning" role="status">
          다른 실행 {data.load.runs}개가 AI 요청을 최대 {data.load.max}개까지 동시에 보내는 중입니다. 이 실행을 시작하면 최대 {data.load.max + data.load.added}개가 됩니다.{' '}
          <Text asChild underline="offset">
            <Link to="/p/$projectId/runs" params={{ projectId }}>
              실행 기록 보기
            </Link>
          </Text>
        </Text>
      )}
    </Box>
  );
}

/**
 * Which model each AI step runs on, changeable for this run only (like the work analysis's picker).
 * Each starts at the step's own model; a picked one replaces it, and the models the step otherwise
 * shares its requests with, for this run. The workflow keeps its own (change it there for good).
 */
export function RunModels({ nodes, picked, onPick, onReset, changedNote = '이번 실행만' }: { nodes: PlanData['nodes']; picked: Record<string, ModelValue>; onPick: (nodeId: string, value: ModelValue) => void; onReset: (nodeId: string) => void; /** Says how far a picked model reaches. */ changedNote?: string }) {
  return (
    <Box as="section" spaceY="condensed">
      <SectionHeading>모델</SectionHeading>
      {nodes.map((node) => {
        const own = node.choice.connectionId && node.choice.model ? node.choice : null;
        const changed = Boolean(picked[node.nodeId]);
        return (
          <Inline key={node.nodeId} minWidth={0} wrap gap="condensed">
            {nodes.length > 1 && <Text width="field" shrink={false} truncate variant="body">{node.name}</Text>}
            <ModelPicker value={picked[node.nodeId] ?? own} onChange={(value) => onPick(node.nodeId, value)} grow />
            {changed && (
              <Inline as="span" gap="tight" variant="caption" tone="muted">
                {changedNote}
                <Button variant="ghost" size="inline" onClick={() => onReset(node.nodeId)}>
                  원래대로
                </Button>
              </Inline>
            )}
          </Inline>
        );
      })}
    </Box>
  );
}

/** The caps a run pauses at, filled with the suggestion; emptying a field removes that cap. */
export function RunCaps({ suggested, edits, onChange }: { suggested: Caps | undefined; edits: CapEdits; onChange: (edits: CapEdits) => void }) {
  const shown = (key: keyof Caps) => (edits[key] === undefined ? suggested?.[key] : edits[key]);
  return (
    <Grid columns="twoFromSm" gap="normal">
      <Field label="호출 상한" description="비우면 상한 없이 실행합니다." help="이만큼 쓰면 실행을 멈춥니다. 재요청 노드가 있으면 그 여유분이 들어 있습니다.">
        <NumberInput optional min={1} value={shown('maxCalls')} onValueChange={(next) => onChange({ ...edits, maxCalls: next ?? null })} />
      </Field>
      <Field label="입력 상한" description="비우면 상한 없이 실행합니다." help="실행 전체가 AI에 보내는 입력 토큰(캐시 포함)이 이만큼 되기 전에 멈춥니다.">
        <NumberInput optional min={1} value={shown('maxInputTokens')} onValueChange={(next) => onChange({ ...edits, maxInputTokens: next ?? null })} />
      </Field>
    </Grid>
  );
}
