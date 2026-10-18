import { describe, expect, it } from 'vitest';
import { readingRouteCall } from './mock-llm-chat.ts';

const tools = new Set(['find_reading_route']);

describe('mock chat reading-route intent', () => {
  it('uses the currently reported route-start and route-end items', () => {
    const call = readingRouteCall(
      '이 경로를 읽어줘',
      [
        '사용자의 현재 화면:',
        '- 경로 시작: 미라: 처음 만남 · scene.1 [id=node-start-1]',
        '- 경로 끝: 조나스: 마지막 인사 · scene.9 [id=node-end-9]',
      ].join('\n'),
      tools,
    );

    expect(call).toEqual({ name: 'find_reading_route', args: { start: 'node-start-1', end: 'node-end-9' } });
  });

  it('accepts explicit line keys when no graph endpoint items are attached', () => {
    expect(readingRouteCall('A1에서 E2까지 경로를 찾아줘', '', tools)).toEqual({
      name: 'find_reading_route', args: { start: 'A1', end: 'E2' },
    });
    expect(readingRouteCall('시작: 시작.1 끝: 끝.8 경로', '', tools)).toEqual({
      name: 'find_reading_route', args: { start: '시작.1', end: '끝.8' },
    });
  });

  it('does not invent a missing endpoint or call an unavailable tool', () => {
    expect(readingRouteCall('경로를 찾아줘', '- 경로 시작: 시작 [id=node-start]', tools)).toBeUndefined();
    expect(readingRouteCall('A1에서 E2까지 경로를 찾아줘', '', new Set())).toBeUndefined();
    expect(readingRouteCall('번역을 고쳐줘', '', tools)).toBeUndefined();
  });
});
