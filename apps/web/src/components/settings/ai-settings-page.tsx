import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@loca/ui';
import { Page } from '@/components/page';

const SETTINGS_ROUTES = {
  connections: '/p/$projectId/ai/connections',
  editor: '/p/$projectId/ai/usage',
  agent: '/p/$projectId/agent',
  results: '/p/$projectId/settings/ai-results',
} as const;
type AiSettingsTab = keyof typeof SETTINGS_ROUTES;
let pendingFocusIntent: { projectId: string; target: AiSettingsTab } | undefined;

/** Shared tab navigation for the four AI settings routes; each route keeps its own URL and state. */
export function AiSettingsPage({ projectId, tab, children }: { projectId: string; tab: AiSettingsTab; children: ReactNode }) {
  const active = tab;
  const navigate = useNavigate();
  const tabListRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const intent = pendingFocusIntent;
    if (!intent) return;
    // Consume every cross-route intent once. A direct link or later navigation to a different
    // project/tab must not inherit a stale request to steal focus.
    pendingFocusIntent = undefined;
    if (intent.projectId !== projectId || intent.target !== active) return;
    tabListRef.current?.querySelector<HTMLButtonElement>(`[data-ai-settings-tab="${active}"]`)?.focus();
  }, [active, projectId]);
  const changeTab = (value: string) => {
    if (!(value in SETTINGS_ROUTES)) return;
    const to = SETTINGS_ROUTES[value as AiSettingsTab];
    pendingFocusIntent = { projectId, target: value as AiSettingsTab };
    void navigate({ to, params: { projectId }, search: () => ({}) });
  };

  return (
    <Page title="AI 설정" flush>
      <Tabs value={active} onValueChange={changeTab} className="h-full min-h-0 flex-1 gap-0">
        <div ref={tabListRef} className="shrink-0 border-b border-border bg-background px-6">
          <div className="w-full max-w-6xl">
            <TabsList variant="line" className="-mb-px h-10 w-full justify-start border-b-0" aria-label="AI 설정">
              <TabsTrigger value="connections" data-ai-settings-tab="connections" className="flex-none">연결</TabsTrigger>
              <TabsTrigger value="editor" data-ai-settings-tab="editor" className="flex-none">편집기</TabsTrigger>
              <TabsTrigger value="agent" data-ai-settings-tab="agent" className="flex-none">에이전트</TabsTrigger>
              <TabsTrigger value="results" data-ai-settings-tab="results" className="flex-none">결과 반영</TabsTrigger>
            </TabsList>
          </div>
        </div>
        <TabsContent value={active} className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {children}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
