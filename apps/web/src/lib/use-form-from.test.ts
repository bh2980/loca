import { describe, expect, it } from 'vitest';
import { changedFields, nextEdit, resolveForm } from './use-form-from';

const t1 = { source: 'Guild', target: 'T1', note: 'N1' };

describe('form drafts over a saved value', () => {
  it('lets untouched fields follow a change made elsewhere, and patches only what the person edited', () => {
    const edit = nextEdit(t1, null, { ...t1, note: 'N2' });
    const t2 = { ...t1, target: 'T2' };
    const { draft, mine, conflicts } = resolveForm(t2, edit);
    expect(draft).toEqual({ source: 'Guild', target: 'T2', note: 'N2' });
    expect(mine).toEqual(['note']);
    expect(conflicts).toEqual([]);
    expect(changedFields(draft, t2)).toEqual({ note: 'N2' });
  });

  it('keeps editing on top of the moved-on fields without claiming them', () => {
    const first = nextEdit(t1, null, { ...t1, note: 'N2' });
    const t2 = { ...t1, target: 'T2' };
    const second = nextEdit(t2, first, { ...resolveForm(t2, first).draft, note: 'N3' });
    expect(resolveForm(t2, second).mine).toEqual(['note']);
    // A later change to target elsewhere still shows.
    expect(resolveForm({ ...t1, target: 'T3' }, second).draft).toEqual({ source: 'Guild', target: 'T3', note: 'N3' });
  });

  it('reports a field changed both here and elsewhere, and not when both made the same change', () => {
    const edit = nextEdit(t1, null, { ...t1, target: 'Mine' });
    expect(resolveForm({ ...t1, target: 'Theirs' }, edit)).toMatchObject({ draft: { target: 'Mine' }, conflicts: ['target'] });
    expect(resolveForm({ ...t1, target: 'Mine' }, edit).conflicts).toEqual([]);
  });

  it('treats a value that is not an object as one field', () => {
    const edit = nextEdit('10', null, '20');
    expect(resolveForm('10', edit)).toEqual({ draft: '20', mine: ['value'], conflicts: [] });
    expect(resolveForm('30', edit).conflicts).toEqual(['value']);
    expect(resolveForm('30', nextEdit('10', null, '10')).draft).toBe('30');
  });
});
