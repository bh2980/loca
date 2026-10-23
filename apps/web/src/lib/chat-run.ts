import type { AutoMark, ChatChip } from '@tw/shared';
import { startLimits, type Caps } from './run-limits';
import { paceParts, type PaceInput } from './run-summary';

/** A run scope as the run dialog sends it (the server's RunScope). */
export type RunScope = { groupIds?: string[]; unitIds?: string[]; tagIds?: string[]; statusIds?: string[]; termIds?: string[]; marks?: AutoMark[] };

/** The part of a preflight the confirm card reads. */
export interface RunPlanLike extends PaceInput {
  lines: { total: number; excluded: number };
  suggestedLimits?: Caps;
}

/** The server calls the card makes: the same ones the run dialog uses (preflight, start) plus the scope of the picks. */
export interface RunApi {
  scope(workflowId: string, items: { kind: string; id: string }[]): Promise<{ input: 'lines' | 'terms'; scope: RunScope }>;
  preflight(workflowId: string, scope: RunScope): Promise<RunPlanLike>;
  start(workflowId: string, scope: RunScope, limits: Caps): Promise<{ runId: string }>;
}

/** An "실행 확인" card in the chat: what will run, kept in the browser for this conversation. */
export interface RunCard {
  id: string;
  workflowId: string;
  workflowName: string;
  input: 'lines' | 'terms';
  /** What the person picked: the card shows it and does not change it (cancel and start again to change the target). */
  chips: ChatChip[];
  /** How many messages the conversation had when it was made: it sits after them. */
  after: number;
  /** Set once 실행 started the run; the card then follows it. */
  runId?: string;
  cancelled?: boolean;
}

export interface CardPlan {
  scope: RunScope;
  plan: RunPlanLike;
}

/** The picks' scope and its preflight: what the card shows before anything runs. */
export async function planCard(api: RunApi, card: Pick<RunCard, 'workflowId' | 'chips'>): Promise<CardPlan> {
  const { scope } = await api.scope(card.workflowId, card.chips.map(({ kind, id }) => ({ kind, id })));
  return { scope, plan: await api.preflight(card.workflowId, scope) };
}

/** 실행: starts the run with the scope that was planned and the suggested caps, as the run dialog does when its fields are left as they are. */
export function startCard(api: RunApi, card: Pick<RunCard, 'workflowId'>, planned: CardPlan): Promise<{ runId: string }> {
  return api.start(card.workflowId, planned.scope, startLimits(planned.plan.suggestedLimits, {}));
}

/** The card's numbers in words: how many lines (or terms), requests, time and cost. */
export function cardSummary(input: 'lines' | 'terms', plan: RunPlanLike) {
  const unit = input === 'terms' ? '개' : '줄';
  const { callText, time, money } = paceParts(plan);
  return { targets: `${plan.lines.total.toLocaleString()}${unit}`, empty: plan.lines.total === 0, excluded: plan.lines.excluded, requests: callText, time, money };
}

const KEY = (sessionId: string) => `tw.chat.runcards.${sessionId}`;

/** The cards of a conversation, from this browser's session storage (a broken or blocked storage reads as none). */
export function loadCards(sessionId: string): RunCard[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY(sessionId)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((card): card is RunCard => Boolean(card?.id && card.workflowId && Array.isArray(card.chips))) : [];
  } catch {
    return [];
  }
}

export function saveCards(sessionId: string, cards: RunCard[]) {
  try {
    sessionStorage.setItem(KEY(sessionId), JSON.stringify(cards.slice(-30)));
  } catch {
    /* kept in memory only */
  }
}
