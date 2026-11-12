import type { UIMessage } from 'ai';
import { isRunRecord } from '@tw/shared';

export { cardSummary } from '@tw/shared';

/**
 * The conversation on screen with the run cards and run ends of the stored one: one this window does not have
 * goes where the stored conversation has it (after the message that precedes it there), and one it has
 * is replaced by the stored state. Other messages are never touched (a reply may be streaming in
 * them); null when nothing changes.
 */
export function syncCards(local: UIMessage[], stored: UIMessage[]): UIMessage[] | null {
  let next = local;
  stored.forEach((message, index) => {
    if (!isRunRecord(message)) return;
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
