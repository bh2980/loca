import type { ProposalDetail } from '@loca/shared';
import { diffStats } from './text-diff';

export function detailsSummary(details: readonly ProposalDetail[]): string | null {
  const changesDetail = details.find((detail): detail is Extract<ProposalDetail, { kind: 'changes' }> => detail.kind === 'changes');
  if (changesDetail) {
    const n = changesDetail.items.length;
    const f = changesDetail.items.reduce((sum, item) => sum + item.changes.length, 0);
    let a = 0;
    let r = 0;
    for (const item of changesDetail.items) {
      for (const change of item.changes) {
        if (change.before === undefined) continue;
        const stats = diffStats(change.before, change.after);
        a += stats.added;
        r += stats.removed;
      }
    }
    const base = f === 0 ? '바뀌는 내용 없음' : `${n > 1 ? `항목 ${n}개 · ` : ''}${f}곳 바뀜${a + r > 0 ? ` · +${a} −${r}줄` : ''}`;
    const addedNodes = details
      .filter((detail): detail is Extract<ProposalDetail, { kind: 'list' }> => detail.kind === 'list' && detail.title === '추가할 노드')
      .reduce((sum, detail) => sum + detail.items.length + (detail.more ?? 0), 0);
    const removedNodes = details
      .filter((detail): detail is Extract<ProposalDetail, { kind: 'list' }> => detail.kind === 'list' && detail.title === '삭제할 노드')
      .reduce((sum, detail) => sum + detail.items.length + (detail.more ?? 0), 0);
    const nodeSuffix = addedNodes + removedNodes > 0 ? ` · 노드 ${[addedNodes && `+${addedNodes}`, removedNodes && `−${removedNodes}`].filter(Boolean).join(' ')}` : '';
    return `${base}${nodeSuffix}`;
  }

  const linesDetail = details.find((detail): detail is Extract<ProposalDetail, { kind: 'lines' }> => detail.kind === 'lines');
  if (linesDetail) return `대사 ${linesDetail.total.toLocaleString()}개`;

  const listDetail = details.find((detail): detail is Extract<ProposalDetail, { kind: 'list' }> => detail.kind === 'list');
  if (listDetail) return `${(listDetail.items.length + (listDetail.more ?? 0)).toLocaleString()}개`;

  return null;
}
