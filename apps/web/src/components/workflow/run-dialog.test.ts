import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunDialog } from './run-dialog';

const queried = vi.hoisted(() => ({ plans: [] as { enabled: boolean; request: unknown }[], mutations: 0, starting: false }));

// Render the real form with an inline portal and read-only query fixtures. No run or AI call is made.
vi.mock('@loca/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@loca/ui')>(),
  DialogContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), Link: () => null }));
vi.mock('./run-estimate', () => ({ Pace: () => null, RunModels: () => null }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useMutation: () => {
    queried.mutations++;
    return { isPending: queried.starting, isError: false, mutate: vi.fn() };
  },
  useQuery: ({ queryKey, enabled = true }: { queryKey: unknown[]; enabled?: boolean }) => {
    if (queryKey[1] === 'run-preflight') {
      queried.plans.push({ enabled, request: queryKey[3] });
      return {
        data: enabled ? {
          lines: { total: 2, translated: 0 },
          readiness: {
            applies: { speech: false, glossary: false },
            unknownListenerLines: 0,
            unreviewedRules: { count: 0, examples: [] },
            pairsWithoutRule: { count: 0, examples: [] },
            unreviewedTerms: { count: 0, examples: [] },
          },
        } : undefined,
        isError: false, isPending: false, isPlaceholderData: false,
      };
    }
    if (queryKey[0] === 'statuses') return { data: { tags: [] } };
    if (queryKey[0] === 'workflows') return { data: [{ id: 'workflow', name: '번역', errorCount: 0 }] };
    if (queryKey[1] === 'groups') return { data: [{ id: 'scene', key: 'scene', title: '장면', kind: 'scene', total: 20 }] };
    return { data: undefined };
  },
}));

beforeEach(() => {
  queried.plans.length = 0;
  queried.mutations = 0;
  queried.starting = false;
});

function startButton(html: string) {
  const button = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([tag]) => tag).find((tag) => tag.includes('2줄 실행 시작'));
  expect(button).toBeDefined();
  return button!;
}

describe('RunDialog externally controlled opening', () => {
  it('mounts already open with route IDs selected and ready to start', () => {
    const html = renderToStaticMarkup(createElement(RunDialog, {
      projectId: 'project', workflowId: 'workflow', open: true, hideTrigger: true,
      unitIds: ['route-2', 'route-1'], unitsLabel: '이번 길 번역 안 한 줄', defaultIgnoreStatus: true,
    }));
    expect(queried.plans).toEqual([{ enabled: true, request: { unitIds: ['route-2', 'route-1'], ignoreStatus: true } }]);
    expect(html).toContain('이번 길 번역 안 한 줄 2줄');
    expect(startButton(html)).not.toContain('disabled=');
  });

  it('also captures a scene scope on an initially-open mount', () => {
    renderToStaticMarkup(createElement(RunDialog, { projectId: 'project', workflowId: 'workflow', open: true, groupIds: ['scene'] }));
    expect(queried.plans).toEqual([{ enabled: true, request: { groupIds: ['scene'], ignoreStatus: false } }]);
  });

  it.each([false, undefined])('does not preflight while closed (controlled open = %s)', (open) => {
    renderToStaticMarkup(createElement(RunDialog, { projectId: 'project', workflowId: 'workflow', open, unitIds: ['route-1'] }));
    expect(queried.plans.filter((plan) => plan.enabled)).toEqual([]);
  });

  it('requires a scope choice when opened without selected lines or scenes', () => {
    renderToStaticMarkup(createElement(RunDialog, { projectId: 'project', workflowId: 'workflow', open: true, viewKind: 'scene' }));
    expect(queried.plans.filter((plan) => plan.enabled)).toEqual([]);
  });

  it('keeps the start mutation mounted even when its per-opening form is closed', () => {
    renderToStaticMarkup(createElement(RunDialog, { projectId: 'project', open: false }));
    expect(queried.mutations).toBe(1);
    expect(queried.plans).toEqual([]);
  });

  it('disables a fresh form while the persistent start mutation is pending', () => {
    queried.starting = true;
    const html = renderToStaticMarkup(createElement(RunDialog, { projectId: 'project', workflowId: 'workflow', open: true, unitIds: ['new-route-1', 'new-route-2'] }));
    expect(queried.mutations).toBe(1);
    expect(startButton(html)).toContain('disabled=');
  });
});
