import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition, WorkflowNode } from '@tw/shared';
import { nodeSummary, type SummaryNames } from './flow-graph';

const names: SummaryNames = { status: new Map(), connection: new Map([['key-1', '맞춤법 API 키']]), connectionsLoaded: true };
const definition = { nodes: [], edges: [] } as unknown as WorkflowDefinition;
const fn = (name: string, params: Record<string, unknown>) => ({ id: 'n1', label: '', type: 'function', config: { fn: name, params }, position: { x: 0, y: 0 } }) as unknown as WorkflowNode;
const summary = (name: string, params: Record<string, unknown>) => nodeSummary(fn(name, params), definition, names);

describe('nodeSummary: HTTP 호출', () => {
  it('says the method and the address the node calls', () => {
    expect(summary('http', { method: 'GET', url: 'https://api.example.com/spell' })).toBe('GET api.example.com/spell');
  });

  it('does not ask for a connection: the API key is optional', () => {
    expect(summary('http', { url: 'https://api.example.com/spell' })).not.toContain('연결');
    expect(summary('http', { url: 'https://api.example.com/spell', connectionId: 'key-1' })).toBe('POST api.example.com/spell');
  });

  it("reads the schema's default method and says when no address is set", () => {
    expect(summary('http', {})).toBe('POST 주소 없음');
  });

  it('leaves the query out with a mark, and cuts a long address', () => {
    expect(summary('http', { method: 'GET', url: 'https://api.example.com/spell?lang=ko&text={{candidate}}' })).toBe('GET api.example.com/spell?…');
    const long = summary('http', { url: `https://api.example.com/${'a'.repeat(80)}` });
    expect(long.length).toBe('POST '.length + 48);
    expect(long.endsWith('…')).toBe(true);
  });

  it("falls back to the function's name when the settings do not fit its schema", () => {
    expect(summary('http', { method: 'DELETE', url: 'https://api.example.com' })).toBe('HTTP 호출');
  });
});

describe('nodeSummary: 스크립트', () => {
  it('lists the declared exits, "out" when none is declared', () => {
    expect(summary('script', { ports: ['ok', 'retry'] })).toBe('출구: ok, retry');
    expect(summary('script', {})).toBe('출구: out');
  });
});

describe('nodeSummary: 형식 검사', () => {
  it("reads the checks that are on by the schema's defaults", () => {
    expect(summary('formatCheck', {})).toBe('검사: 자리표시자·서식 태그·줄바꿈·빈 번역');
    expect(summary('formatCheck', { placeholders: false, tags: false, numbers: true })).toBe('검사: 줄바꿈·빈 번역·숫자');
  });

  it('counts length limits and forbidden words as checks: a node with only those does not always pass', () => {
    const off = { placeholders: false, tags: false, newlines: false, emptyText: false };
    expect(summary('formatCheck', off)).toBe('켠 검사 항목 없음 (항상 통과)');
    expect(summary('formatCheck', { ...off, maxChars: 40 })).toBe('검사: 길이');
    expect(summary('formatCheck', { ...off, forbiddenWords: '암튼, 대충' })).toBe('검사: 금지어');
    expect(summary('formatCheck', { ...off, forbiddenWords: ' , ' })).toBe('켠 검사 항목 없음 (항상 통과)');
  });

  it('counts a custom rule that is still being typed without losing the other checks', () => {
    expect(summary('formatCheck', { customRules: [{ id: 'r1', name: '', pattern: '' }] })).toBe('검사: 자리표시자·서식 태그·줄바꿈·빈 번역·규칙 1개');
  });
});
