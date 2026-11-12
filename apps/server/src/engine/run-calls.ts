import { and, eq, inArray } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { INPUT_TYPES, connectionCan, errorKindOfCode, judgmentProblem, previousStepId, runNodeName, type AiNode, type FunctionNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { logged } from '../services/ai-calls.ts';
import { resolveTarget } from '../services/model-target.ts';
import type { SecretStore } from '../services/secrets.ts';
import { readAiOutput, type Outcome } from './ai-output.ts';
import { runAsyncFunction, type FunctionInput } from './functions/index.ts';
import { judgmentOutcome, judgmentQuestions } from './judgment.ts';
import type { ModelPort } from './model-port.ts';
import { isBatchScope } from './prompts.ts';
import { buildRequest, type RequestItem } from './request.ts';
import { haltRun, notifyRun, type RunGuards } from './run-guards.ts';
import { previousOf, record, route, takenBack, type Item, type Run } from './run-state.ts';
import { subjectOf } from './subjects.ts';

type StepRecord = Omit<typeof s.runSteps.$inferInsert, 'ok' | 'finishedAt'>;

const MISSING_WHAT: Record<AiNode['config']['output'], string> = { text: '번역', verdict: '판정', choice: '선택', json: '결과' };

const usageColumns = (usage: ai.Usage = {}) => ({
  inputTokens: usage.inputTokens,
  cachedInputTokens: usage.cachedInputTokens,
  outputTokens: usage.outputTokens,
  reasoningTokens: usage.reasoningTokens,
  costUsd: usage.costUsd,
});

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The slow work of a run: one request of an AI node or one call of an HTTP / script node, from the
 * moment the scheduler hands it over to its recorded outcome. Whatever happens on the way, the request
 * ends recorded: answered lines move on, a failure sends its lines out the node's "error" exit with a
 * kind and the message (and a step that says so), and if even that cannot be written the run pauses with
 * a notice. No line is left "running" with nothing working on it.
 */
export class RunCalls {
  constructor(
    private db: Db,
    private secrets: SecretStore,
    private model: ModelPort,
    private guards: RunGuards,
  ) {}

  /** One dispatched request. Never rejects. `modelKey`: the run.models key an AI node's lines go out on. */
  async run(run: Run, node: AiNode | FunctionNode, modelKey: string | null, batch: Item[], signal: AbortSignal): Promise<void> {
    const step: StepRecord = { runId: run.id, nodeId: node.id, subjectIds: batch.map((item) => item.subjectId), startedAt: new Date() };
    try {
      let failure: { code?: string; message: string } | undefined;
      try {
        const recorded = node.type === 'ai' ? await this.callAi(run, node, modelKey ?? '', batch, step, signal) : await this.callFunction(run, node, batch[0]!, step, signal);
        if (!recorded) return;
      } catch (error) {
        // A cancelled run's lines are already cancelled; a stopping server's are queued again when it starts.
        if (signal.aborted) return;
        failure = this.failBatch(run, batch, step, error);
      }
      notifyRun(this.db, run.id);
      this.guards.afterCall(run.id, failure);
    } catch (error) {
      this.giveUp(run, batch, error);
    }
  }

  /** The outcome could not be written (the database refused): the lines wait again and the run pauses, saying why. */
  private giveUp(run: Run, batch: Item[], error: unknown) {
    console.error(`[runner] run ${run.id}:`, error);
    try {
      this.requeue(batch);
      haltRun(this.db, run.id, `실행기 오류로 멈췄습니다: ${messageOf(error)}`);
    } catch (last) {
      console.error(`[runner] run ${run.id}: could not pause it:`, last);
    }
  }

  /** Lines a call did not finish go back to the queue. */
  private requeue(items: Item[]) {
    this.db.update(s.runItems).set({ state: 'queued' }).where(and(inArray(s.runItems.id, items.map((item) => item.id)), eq(s.runItems.state, 'running'))).run();
  }

  /** The item a function sees: the line or term with its tags, and the result of the step before it on the item's way here. */
  private functionInput(run: Run, item: Item): FunctionInput {
    const subject = subjectOf(run.subject);
    const input = subject.inputs(this.db, run, [item])(item);
    if (!input) throw new Error(subject.gone);
    const previousStep = previousStepId(run.definition, item.data.path);
    return previousStep ? { ...input, previous: item.data.outputs?.[previousStep] as Record<string, unknown> | undefined } : input;
  }

  private async callFunction(run: Run, node: FunctionNode, item: Item, step: StepRecord, signal: AbortSignal) {
    const outcome = await runAsyncFunction(node.config, this.functionInput(run, item), { db: this.db, secrets: this.secrets, signal });
    this.db.transaction((tx) => {
      record(tx, run, item, outcome);
      tx.insert(s.runSteps).values({ ...step, ok: true, output: outcome, finishedAt: new Date() }).run();
    });
    return true;
  }

  private async callAi(run: Run, node: AiNode, modelKey: string, batch: Item[], step: StepRecord, signal: AbortSignal) {
    const model = run.models[modelKey];
    if (!model) throw new Error('이 노드의 AI 연결이 실행을 시작할 때 없었습니다. 노드에서 연결과 모델을 다시 고르고 새로 실행하세요.');
    let connection: ai.ModelTarget;
    try {
      connection = resolveTarget(this.db, model, this.secrets);
    } catch (error) {
      // The key store would refuse the next request too (a locked or denied keychain): the run stops here, like a wrong key.
      throw new ai.ModelError('auth', messageOf(error), false);
    }
    step.connectionId = connection.connectionId ?? null;
    step.model = connection.model;
    // A connection that judges instead of writing answers typed questions, one line at a time.
    if (!connectionCan(connection.kind, 'generate')) {
      if (!INPUT_TYPES[run.subject].judgment) throw new Error('판정 연결은 대사 워크플로에서만 쓸 수 있습니다.');
      return this.askLines(run, node, batch, connection, step, signal);
    }
    return this.generate(run, node, model, connection, batch, step, signal);
  }

  /** The run's items as a request takes them: what the run has for each so far. */
  private requestItems(run: Run, node: AiNode, items: Item[]): RequestItem[] {
    return items.map((item) => ({ id: item.subjectId, candidate: item.data.candidateText, issues: item.data.issues, previous: previousOf(item, run.definition, node) }));
  }

  /**
   * One model request for `items`, recorded as its own step. Answered lines move on at once; a line
   * a per-line answer left out (or answered empty) leaves through "error" with kind "missing". False
   * when the request was not sent: it would have broken the run's input cap, which paused the run.
   */
  private async generate(run: Run, node: AiNode, model: s.AiSnapshot, connection: ai.ModelTarget, items: Item[], step: StepRecord, signal: AbortSignal) {
    const built = buildRequest(this.db, run.projectId, node, run.subject, this.requestItems(run, node, items), run.id);
    step.context = built.context.items;
    step.prompt = `${built.system}\n\n${built.prompt}`;
    const reserved = this.guards.reserve(run.id, step.connectionId ?? null, step.prompt);
    if ('over' in reserved) {
      haltRun(this.db, run.id, reserved.over, 'input');
      this.requeue(items);
      return false;
    }
    const request = { system: built.system, prompt: built.prompt, schema: built.schema, maxOutputTokens: model.maxOutputTokens, temperature: node.config.temperature, timeoutMs: node.config.timeoutMinutes * 60_000, signal };
    // Whole-script reads are logged as such: their pace (minutes per script) would skew the run estimates.
    const call = { projectId: run.projectId, kind: built.whole ? ('whole' as const) : ('run' as const), refId: run.id, label: `${runNodeName(run.definition, node)} · ${items.length.toLocaleString()}줄` };
    const result = await ai.callOnce(() => logged(this.db, call, connection, () => this.model.generate(connection, request)), signal).finally(reserved.release);
    const raw = result.object;
    const outcomes = readAiOutput(node, raw, built.lines, connection.model, built.choiceOptions);
    this.db.transaction((tx) => {
      items.forEach((item, index) => {
        const outcome = outcomes[index];
        if (outcome) record(tx, run, item, outcome);
        else route(tx, run, item, 'error', `모델 응답에 이 대사의 ${MISSING_WHAT[node.config.output]}이(가) 없습니다.`, 'missing');
      });
      tx.insert(s.runSteps).values({ ...step, ok: true, output: raw, returnedItems: isBatchScope(node) ? null : outcomes.filter(Boolean).length, ...usageColumns(result.usage), finishedAt: new Date() }).run();
    });
    return true;
  }

  /**
   * A connection that judges instead of writing (no 'generate' capability, e.g. System One): each line
   * is one state, with the same context an AI node is given (the line's listener and speech rule
   * included), and the node's output becomes typed questions (judgmentQuestions). Outputs it cannot
   * fill are refused by the workflow check (judgmentProblem) and again here.
   */
  private async askLines(run: Run, node: AiNode, batch: Item[], connection: ai.ModelTarget, step: StepRecord, signal: AbortSignal) {
    const problem = judgmentProblem(node.config);
    if (problem) throw new Error(problem);
    const { lines, context, choiceOptions } = buildRequest(this.db, run.projectId, node, run.subject, this.requestItems(run, node, batch), run.id);
    const questions = judgmentQuestions(node, choiceOptions ?? []);
    step.context = context.items;
    const outcomes: Outcome[] = [];
    let usage: ai.Usage = {};
    try {
      for (const line of lines) {
        const state = {
          line: { kind: line.kind, speaker: line.speaker, source: line.source, translation: line.candidate ?? '' },
          speech: context.speech[line.unitId] ?? null,
          scene: context.scenes[line.groupId] ?? null,
          characters: context.characters,
          glossary: context.terms,
        };
        const call = { projectId: run.projectId, kind: 'run' as const, refId: run.id, label: `${runNodeName(run.definition, node)} · 판정 1줄` };
        const judged = await ai.callOnce(() => logged(this.db, call, connection, () => this.model.ask(connection, { state, questions, timeoutMs: node.config.timeoutMinutes * 60_000, signal })), signal);
        usage = ai.addUsage(usage, judged.usage);
        outcomes.push(judgmentOutcome(node, judged.answers));
      }
    } catch (error) {
      // The step that fails still says what the lines judged before it used.
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { usage: ai.addUsage(usage, (error as { usage?: ai.Usage }).usage ?? {}) });
    }
    this.db.transaction((tx) => {
      batch.forEach((item, index) => record(tx, run, item, outcomes[index]!));
      tx.insert(s.runSteps).values({ ...step, ok: true, prompt: null, output: outcomes, returnedItems: outcomes.length, ...usageColumns(usage), finishedAt: new Date() }).run();
    });
    return true;
  }

  /**
   * Every line of a failed call leaves through "error" with the failure's kind (errorKindOfCode); the call is
   * recorded with whatever usage the connection reported. Returns what the guards read of the failure.
   */
  private failBatch(run: Run, batch: Item[], step: StepRecord, error: unknown) {
    const message = messageOf(error);
    const code = (error as { code?: string }).code;
    const kind = errorKindOfCode(code);
    // A failure whose lines the node's retry rules all take back does not count toward 연속 실패.
    const retried = takenBack(run, step.nodeId, batch, kind);
    this.db.transaction((tx) => {
      for (const item of batch) route(tx, run, item, 'error', message, kind);
      tx.insert(s.runSteps).values({ ...step, ok: false, error: message, errorKind: kind, retried, ...usageColumns((error as { usage?: ai.Usage }).usage), finishedAt: new Date() }).run();
    });
    return { code, message };
  }
}
