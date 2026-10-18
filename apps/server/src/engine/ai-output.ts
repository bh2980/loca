import { analysisSectionsOf, type AiNode, type IssueKind } from '@tw/shared';
import { analysisToKeys, type Analysis } from '../services/analysis.ts';
import type { FunctionResult } from './functions/index.ts';
import type { KnowledgeOutput, PromptLine } from './prompts.ts';

/** A node's result for one line: the exit to take plus what it produced. */
export interface Outcome extends FunctionResult {
  /** Candidate provenance when `candidate` is set. */
  origin?: 'ai' | 'tool';
  model?: string;
  error?: string;
}

/**
 * An AI node's answer read line by line (#49: out of runner.ts, no state of its own). Per-line
 * outputs (candidate, verdict, listener, json) give each line its own outcome or null when the
 * answer left the line out (the runner retries or fails those). Batch outputs (terms, knowledge,
 * analysis) describe the whole request: only the first line carries the payload (batchLeader).
 */
export function readAiOutput(node: AiNode, raw: unknown, lines: PromptLine[], model: string, analysisKeys?: Map<string, string>): (Outcome | null)[] {
  const missing = (_what: string) => null;
  const value = raw as { translations?: { id: string; text: string }[]; results?: ({ id: string } & Record<string, unknown>)[]; terms?: unknown[]; listeners?: { id: string; value: unknown; confidence: unknown; reason?: unknown }[] };
  switch (node.config.output) {
    case 'candidate':
      return lines.map((line) => {
        const text = value.translations?.find((entry) => entry.id === line.id)?.text;
        return text === undefined || !text.trim() ? missing('번역') : { port: 'out', candidate: text, origin: 'ai', model, output: { text } };
      });
    case 'verdict':
      return lines.map((line) => {
        const result = value.results?.find((entry) => entry.id === line.id) as { passed: boolean; issues: string[]; categories?: IssueKind[] } | undefined;
        if (!result) return missing('판정');
        // A review covers every kind: passing clears them, failing names what it found (기타 when it did not say).
        const kinds = result.categories?.length ? [...new Set(result.categories)] : (['other'] as IssueKind[]);
        return {
          port: result.passed ? 'pass' : 'fail',
          issues: result.passed ? undefined : result.issues,
          output: { passed: result.passed, issues: result.issues, ...(!result.passed && { categories: kinds }) },
          issueTags: result.passed ? { clear: 'all' } : { add: kinds },
        };
      });
    case 'terms': {
      const terms = (value.terms ?? []) as unknown[];
      return lines.map((_, index) => ({ port: 'out', output: { terms, batchLeader: index === 0 } }));
    }
    case 'knowledge': {
      // Like terms, the change set describes the whole batch; line ids become line keys so it outlives the prompt.
      const keyOf = new Map(lines.map((line) => [line.id, line.key]));
      const known = (id: string | null | undefined) => (id ? (keyOf.get(id) ?? null) : null);
      const found = raw as KnowledgeOutput;
      const knowledge = {
        characters: (found.characters ?? []).map((c) => ({
          ...c,
          evidence: ((c as { evidence?: string[] }).evidence ?? []).flatMap((id) => (keyOf.get(id) ? [keyOf.get(id)!] : [])),
        })),
        relationships: (found.relationships ?? []).map((rel) => ({ ...rel, at: known(rel.at), evidence: (rel.at && keyOf.get(rel.at) ? [keyOf.get(rel.at)!] : []) })),
        events: (found.events ?? []).map((event) => ({ ...event, evidence: event.evidence.flatMap((id) => (keyOf.get(id) ? [keyOf.get(id)!] : [])) })),
        speechRules: (found.speechRules ?? []).map((rule) => ({ ...rule, start: known(rule.start), evidence: (rule.start && keyOf.get(rule.start) ? [keyOf.get(rule.start)!] : []) })),
      };
      return lines.map((_, index) => ({
        port: 'out',
        // To save space in run_items.data (H7), only the first line carries the full payload;
        // subsequent lines carry an empty payload with batchLeader: false so downstream nodes skip redundant writes.
        output: index === 0
          ? { knowledge, batchLeader: true }
          : { knowledge: { characters: [], relationships: [], events: [], speechRules: [] }, batchLeader: false },
      }));
    }
    case 'analysis': {
      // One answer for the whole request, its line ids turned into line keys; only the first line
      // carries it (H7) and `saveAnalysis` stores it once.
      const analysis = analysisToKeys(raw as Partial<Analysis>, analysisKeys ?? new Map());
      const sections = analysisSectionsOf(node.config.sections);
      return lines.map((_, index) => ({ port: 'out', output: index === 0 ? { analysis, sections, batchLeader: true } : { analysis: null, batchLeader: false } }));
    }
    case 'listener':
      return lines.map((line) => {
        const entry = value.listeners?.find((candidate) => candidate.id === line.id);
        if (!entry) return missing('분류·추론');
        const answer = typeof entry.value === 'string' && entry.value.trim() ? entry.value.trim() : null;
        const reason = typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : undefined;
        return { port: 'out', output: { value: answer, confidence: Math.min(1, Math.max(0, Number(entry.confidence) || 0)), ...(reason && { reason }) } };
      });
    case 'json':
      return lines.map((line) => {
        const result = value.results?.find((entry) => entry.id === line.id);
        if (!result) return missing('결과');
        const { id: _id, ...fields } = result;
        return { port: 'out', output: fields };
      });
  }
}
