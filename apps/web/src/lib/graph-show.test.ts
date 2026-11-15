import { describe, expect, it } from 'vitest';
import { shownText } from './graph-show';

describe('a line card\'s text', () => {
  it('says a missing translation is missing', () => {
    expect(shownText('translation', 'Hi', null)).toEqual({ body: '번역 없음', missing: 'body' });
    expect(shownText('both', 'Hi', null)).toEqual({ body: 'Hi', second: '번역 없음', missing: 'second' });
  });

  it('says a 번역 제외 line goes out as its source, without repeating it under itself', () => {
    expect(shownText('translation', 'OK', null, true)).toEqual({ body: '원문 그대로 · OK', kept: 'body' });
    expect(shownText('both', 'OK', null, true)).toEqual({ body: 'OK', second: '원문 그대로', kept: 'second' });
    expect(shownText('source', 'OK', null, true)).toEqual({ body: 'OK' });
  });
});
