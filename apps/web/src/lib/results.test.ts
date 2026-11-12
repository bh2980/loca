import { describe, expect, it } from 'vitest';
import { restParts, startStatuses } from './results';

const statuses = [
  { id: 'new', name: '미번역', kind: 'initial' },
  { id: 'review', name: '검토 필요', kind: 'normal' },
  { id: 'done', name: '확정', kind: 'final' },
];

describe('what goes in at first', () => {
  it('is the final statuses, unless the list is filtered to some or lines were picked by hand', () => {
    expect([...startStatuses('groups', statuses)]).toEqual(['done']);
    expect([...startStatuses('view', statuses, {})]).toEqual(['done']);
    expect([...startStatuses('view', statuses, { statuses: ['review'] })]).toEqual(['review']);
    expect([...startStatuses('units', statuses)]).toEqual(['new', 'review', 'done']);
  });

  it('from the review inbox, is the statuses the inbox shows (those of them the list is filtered to)', () => {
    const inbox = statuses.map((status) => ({ ...status, inReview: status.id !== 'done' }));
    expect([...startStatuses('view', inbox, { review: true })]).toEqual(['new', 'review']);
    expect([...startStatuses('view', inbox, { review: true, statuses: ['review', 'done'] })]).toEqual(['review']);
  });
});

describe('why the rest does not go in', () => {
  it('names each reason it has, in the statuses order', () => {
    expect(restParts({ excluded: 96, empty: 3, statuses: { review: 1863 } }, statuses)).toBe('검토 필요 1,863 · 번역 없음 3 · 번역 제외 96');
    expect(restParts({ excluded: 0, empty: 0, statuses: {} }, statuses)).toBe('');
  });
});
