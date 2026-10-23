import type { ChatChip } from '@tw/shared';

const json = (ids: string[]) => JSON.stringify(ids);
const query = (search: Record<string, string | boolean>) => Object.entries(search).map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&');
const path = (projectId: string, page: string, search: Record<string, string | boolean> = {}) => `/p/${projectId}/${page}${Object.keys(search).length ? `?${query(search)}` : ''}`;

/**
 * Where a chip leads: the href the server gave it, or (for what a page reported with useReportView, which
 * has none) the page of its kind. Undefined for things with no page of their own (a graph node, an AI connection).
 */
export function chipHref(projectId: string, chip: Pick<ChatChip, 'kind' | 'id' | 'href'>): string | undefined {
  if (chip.href) return chip.href;
  switch (chip.kind) {
    case '대사':
    case '문서':
    case 'UI 문자열':
      return path(projectId, 'script', { line: chip.id, detail: true });
    case '장면':
    case '장면 묶음':
    case 'UI 묶음':
    case '문서 묶음':
      return path(projectId, 'script', { group: chip.id });
    case '인물':
      return path(projectId, 'knowledge', { tab: 'people', display: 'characters', item: chip.id });
    case '관계':
    case '말투 규칙':
    case '관계·말투':
      return path(projectId, 'knowledge', { tab: 'people', item: chip.id });
    case '사건':
      return path(projectId, 'knowledge', { tab: 'events', item: chip.id });
    case '노트':
      return path(projectId, 'knowledge', { tab: 'documents', item: chip.id });
    case '용어':
      return path(projectId, 'glossary', { term: chip.id });
    case '태그':
      return path(projectId, 'script', { tags: json([chip.id]) });
    case '상태':
      return path(projectId, 'script', { statuses: json([chip.id]) });
    case '워크플로':
      return path(projectId, `workflows/${chip.id}`);
    case '실행':
    case '실행 기록':
      return path(projectId, `runs/${chip.id}`);
    default:
      return undefined;
  }
}
