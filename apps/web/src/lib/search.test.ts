import { describe, expect, it } from 'vitest';
import { param, searchParams } from './search';

describe('search param helpers', () => {
  const read = searchParams({
    q: param.text,
    tab: param.oneOf(['people', 'events']),
    scope: param.oneOfOr(['scene', 'dialogue'], 'dialogue'),
    review: param.flag,
    emptyTarget: param.bool,
    page: param.positive,
    tags: param.ids,
    open: param.list,
    marks: param.read((raw) => (Array.isArray(raw) ? raw.filter((mark) => mark === 'a' || mark === 'b') : undefined)),
  });

  it('keeps what each param may hold', () => {
    expect(read({ q: '등대', tab: 'events', scope: 'scene', review: 'true', emptyTarget: false, page: 3, tags: ['t1', 't2'], open: [], marks: ['a', 'x'] })).toEqual({
      q: '등대', tab: 'events', scope: 'scene', review: true, emptyTarget: false, page: 3, tags: ['t1', 't2'], open: [], marks: ['a'],
    });
  });

  it('drops a value a param cannot hold instead of failing, and unknown params', () => {
    const search = read({ q: '', tab: 'documents', scope: 'x', review: false, emptyTarget: 'maybe', page: 0, tags: [], open: 'no', other: 1 });
    expect(search).toEqual({ scope: 'dialogue' });
    expect('other' in search).toBe(false);
    expect(read({ page: 2.5, tags: ['a', 3] })).toEqual({ scope: 'dialogue' });
  });

  it('reads a flag and a yes/no as the router gives them (parsed JSON) or as text', () => {
    expect(read({ review: true }).review).toBe(true);
    expect(read({ review: '1' }).review).toBe(true);
    expect(read({ emptyTarget: 'true' }).emptyTarget).toBe(true);
    expect(read({ emptyTarget: 'false' }).emptyTarget).toBe(false);
  });

  it('settles rules between params after reading them', () => {
    const onePicked = searchParams({ node: param.text, frame: param.text }, (search) => ({ ...search, frame: search.node ? undefined : search.frame }));
    expect(onePicked({ node: 'n1', frame: 'f1' })).toEqual({ node: 'n1', frame: undefined });
    expect(onePicked({ frame: 'f1' })).toEqual({ frame: 'f1' });
  });
});
