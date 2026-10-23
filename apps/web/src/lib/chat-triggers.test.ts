import { describe, expect, it } from 'vitest';
import { ATTACH_KINDS } from '@tw/shared';
import { allCommands, filterCommands, findAtTrigger, findSlashTrigger, insertAt, narrowAtTrigger, openNextTarget, parseAtQuery, removeAtTrigger, replaceAtTrigger } from './chat-triggers';

describe('@ trigger', () => {
  it('opens at the start of the box and after whitespace, with the query so far', () => {
    expect(findAtTrigger('@', 1)).toEqual({ start: 0, query: '' });
    expect(findAtTrigger('@mira', 5)).toEqual({ start: 0, query: 'mira' });
    expect(findAtTrigger('이 대사 @미', 7)).toEqual({ start: 5, query: '미' });
    expect(findAtTrigger('줄\n@x', 4)).toEqual({ start: 2, query: 'x' });
  });
  it('does not open mid-word, after a space in the query, or with the caret before it', () => {
    expect(findAtTrigger('mira@home', 9)).toBeNull();
    expect(findAtTrigger('@미라 가', 5)).toBeNull();
    expect(findAtTrigger('hello @abc', 3)).toBeNull();
    expect(findAtTrigger('no mention', 10)).toBeNull();
  });
  it('counts a half-composed Hangul query as typed text (IME)', () => {
    expect(findAtTrigger('@ㅁ', 2)).toEqual({ start: 0, query: 'ㅁ' });
    expect(findAtTrigger('@미ㄹ', 3)).toEqual({ start: 0, query: '미ㄹ' });
    expect(findAtTrigger('@인물 ㅁ', 5)).toEqual({ start: 0, query: '인물 ㅁ' });
  });
  it('is the latest @ before the caret', () => {
    expect(findAtTrigger('@a @b', 5)).toEqual({ start: 3, query: 'b' });
  });
  it('stays open after a kind word and a space, on one line', () => {
    expect(findAtTrigger('@인물 lo', 7)).toEqual({ start: 0, query: '인물 lo' });
    expect(findAtTrigger('이 @인물 Lookout Gentleman', '이 @인물 Lookout Gentleman'.length)).toEqual({ start: 2, query: '인물 Lookout Gentleman' });
    expect(findAtTrigger('@말투 규칙 Mole', 12)).toEqual({ start: 0, query: '말투 규칙 Mole' });
    expect(findAtTrigger('@인물 a\nb', 9)).toBeNull();
  });
  it('removes the @query it replaced, without leaving a double space', () => {
    expect(removeAtTrigger('이 @미라 를', { start: 2, query: '미라' }, 5)).toEqual({ value: '이 를', caret: 2 });
    expect(removeAtTrigger('@a', { start: 0, query: 'a' }, 2)).toEqual({ value: '', caret: 0 });
  });
  it('the paperclip inserts an @ that opens the picker, after a space when inside a word', () => {
    expect(insertAt('', 0)).toEqual({ value: '@', caret: 1 });
    expect(insertAt('abc', 3)).toEqual({ value: 'abc @', caret: 5 });
    expect(insertAt('abc ', 4)).toEqual({ value: 'abc @', caret: 5 });
    expect(findAtTrigger(insertAt('abc', 3).value, 5)).not.toBeNull();
  });
});

describe('kind narrowing', () => {
  it('a kind name followed by a space narrows; the rest is the search', () => {
    expect(parseAtQuery('인물 lo')).toEqual({ kind: '인물', term: 'lo' });
    expect(parseAtQuery('인물 ')).toEqual({ kind: '인물', term: '' });
    expect(parseAtQuery('대사   reeve')).toEqual({ kind: '대사', term: 'reeve' });
  });
  it('without the space it is a search for that word in every kind', () => {
    expect(parseAtQuery('인물')).toEqual({ kind: null, term: '인물' });
    expect(parseAtQuery('lo')).toEqual({ kind: null, term: 'lo' });
    expect(parseAtQuery('')).toEqual({ kind: null, term: '' });
  });
  it('knows two-word kinds and short names, longest first', () => {
    expect(parseAtQuery('말투 규칙 Mole')).toEqual({ kind: '말투 규칙', term: 'Mole' });
    expect(parseAtQuery('말투 Mole')).toEqual({ kind: '말투 규칙', term: 'Mole' });
    expect(parseAtQuery('실행 번역')).toEqual({ kind: '실행 기록', term: '번역' });
    expect(parseAtQuery('실행 기록 번역')).toEqual({ kind: '실행 기록', term: '번역' });
  });
  it('every kind can be named', () => {
    for (const kind of ATTACH_KINDS) expect(parseAtQuery(`${kind} x`)).toEqual({ kind, term: 'x' });
  });
  it('only the kinds on offer narrow (a run takes scenes, lines, tags, statuses, people)', () => {
    expect(parseAtQuery('용어 rat', ['장면', '대사'])).toEqual({ kind: null, term: '용어 rat' });
    expect(findAtTrigger('@용어 rat', 7)).not.toBeNull();
  });
  it('rewrites the @query to narrow and to go back up, keeping the search text', () => {
    const trigger = { start: 4, query: 'lo' };
    expect(narrowAtTrigger('이 것 @lo', trigger, 7, '인물', 'lo')).toEqual({ value: '이 것 @인물 lo', caret: 4 + '@인물 lo'.length });
    expect(narrowAtTrigger('@인물 lo', { start: 0, query: '인물 lo' }, 7, null, 'lo')).toEqual({ value: '@lo', caret: 3 });
    expect(narrowAtTrigger('@인물 ', { start: 0, query: '인물 ' }, 4, null, '')).toEqual({ value: '@', caret: 1 });
  });
});

describe('{대상} in a saved prompt', () => {
  it('opens an @ where the first slot was, caret after it', () => {
    expect(openNextTarget('{대상}에서 말투가 어색한 곳을 짚어 줘')).toEqual({ value: '@에서 말투가 어색한 곳을 짚어 줘', caret: 1, start: 0 });
    expect(findAtTrigger('@에서 말투', 1)).toEqual({ start: 0, query: '' });
    expect(openNextTarget('이 {대상}과 {대상}을 비교해 줘')).toEqual({ value: '이 @과 {대상}을 비교해 줘', caret: 3, start: 2 });
  });
  it('has nothing to open when there is no slot', () => {
    expect(openNextTarget('이 장면을 요약해 줘')).toBeNull();
  });
  it('the pick replaces the @query with its short name, and the next slot opens', () => {
    const open = openNextTarget('{대상}과 {대상}을 비교해 줘')!;
    const typed = { value: '@폐허과 {대상}을 비교해 줘', caret: 3 };
    const trigger = findAtTrigger(typed.value, typed.caret)!;
    expect(trigger).toEqual({ start: open.start, query: '폐허' });
    const filled = replaceAtTrigger(typed.value, trigger, typed.caret, '폐허의 만남');
    expect(filled.value).toBe('폐허의 만남과 {대상}을 비교해 줘');
    expect(openNextTarget(filled.value)).toEqual({ value: '폐허의 만남과 @을 비교해 줘', caret: 9, start: 8 });
  });
});

describe('/ commands', () => {
  const workflows = [
    { id: 'w1', name: '번역', description: '번역하고 검수까지', input: 'lines' as const },
    { id: 'w2', name: '청자 추정', description: '대사마다 누구에게 하는 말인지 적기', input: 'lines' as const },
    { id: 'w3', name: '용어 추출', description: '', input: 'terms' as const, errorCount: 2 },
  ];
  const commands = allCommands(workflows, [{ name: '요약', text: '이 장면을 요약해줘' }, { name: '번역투', text: '{대상}의 번역투를 찾아 줘' }]);
  it('opens only at the very start; the name filter may hold spaces', () => {
    expect(findSlashTrigger('/', 1)).toEqual({ query: '' });
    expect(findSlashTrigger('/번', 2)).toEqual({ query: '번' });
    expect(findSlashTrigger('/청자 추', 5)).toEqual({ query: '청자 추' });
    expect(findSlashTrigger(' /mo', 4)).toBeNull();
    expect(findSlashTrigger('hi /mo', 6)).toBeNull();
    expect(findSlashTrigger('/a\nb', 4)).toBeNull();
  });
  it('lists the project workflows, then saved prompts; the app adds none of its own', () => {
    expect(commands.map((command) => `${command.kind}:${command.name}`)).toEqual(['workflow:번역', 'workflow:청자 추정', 'workflow:용어 추출', 'prompt:요약', 'prompt:번역투']);
    expect(allCommands([], []).length).toBe(0);
  });
  it('a workflow with errors is listed but says why it cannot run', () => {
    const blocked = commands.find((command) => command.name === '용어 추출');
    expect(blocked).toMatchObject({ kind: 'workflow', input: 'terms', blocked: expect.stringContaining('2') });
    expect(commands.find((command) => command.name === '번역')).not.toHaveProperty('blocked');
  });
  it('filters by prefix first, then by containing text, workflows above prompts', () => {
    expect(filterCommands(commands, '').length).toBe(5);
    expect(filterCommands(commands, '번역').map((command) => command.name)).toEqual(['번역', '번역투']);
    expect(filterCommands(commands, '추').map((command) => command.name)).toEqual(['청자 추정', '용어 추출']);
    expect(filterCommands(commands, '청자 추').map((command) => command.name)).toEqual(['청자 추정']);
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });
});
