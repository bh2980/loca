import type { UIMessage } from 'ai';
import { runCardMessage, runCardOf, type RunCard, type RunCardPlan } from '@tw/shared';
import { paceParts } from './run-summary';

/** The card's numbers in words: how many lines (or terms), requests, time and cost, as they were when the card was made. */
export function cardSummary(input: 'lines' | 'terms', plan: RunCardPlan) {
  const unit = input === 'terms' ? '개' : '줄';
  const { callText, time, money } = paceParts(plan);
  return { targets: `${plan.lines.total.toLocaleString()}${unit}`, empty: plan.lines.total === 0, excluded: plan.lines.excluded, requests: callText, time, money };
}

/** A card put into a stored conversation: replaces its message when it is there, else goes to the end. */
export function withCard<T extends { messages: unknown[] }>(session: T, card: RunCard): T {
  const message = runCardMessage(card);
  const messages = session.messages as UIMessage[];
  const at = messages.findIndex((item) => item.id === card.id);
  return { ...session, messages: at >= 0 ? messages.map((item, index) => (index === at ? message : item)) : [...messages, message] };
}

/**
 * The conversation on screen with the run cards of the stored one: a card this window does not have
 * goes where the stored conversation has it (after the message that precedes it there), and one it has
 * is replaced by the stored state. Other messages are never touched (a reply may be streaming in
 * them); null when nothing changes.
 */
export function syncCards(local: UIMessage[], stored: UIMessage[]): UIMessage[] | null {
  let next = local;
  stored.forEach((message, index) => {
    if (!runCardOf(message)) return;
    const at = next.findIndex((item) => item.id === message.id);
    if (at >= 0) {
      if (JSON.stringify(next[at]!.parts) !== JSON.stringify(message.parts)) next = next.map((item, i) => (i === at ? message : item));
      return;
    }
    let insertAt = 0;
    for (let before = index - 1; before >= 0; before--) {
      const found = next.findIndex((item) => item.id === stored[before]!.id);
      if (found >= 0) {
        insertAt = found + 1;
        break;
      }
    }
    next = [...next.slice(0, insertAt), message, ...next.slice(insertAt)];
  });
  return next === local ? null : next;
}
