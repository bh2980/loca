import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/page';
import { AgentTab } from '@/components/settings/agent-tab';

export const Route = createFileRoute('/p/$projectId/agent')({
  component: AgentPage,
});

/** 에이전트: what the project's AI agent (the chat panel, and loca tools / loca call in a terminal) may do. */
function AgentPage() {
  return (
    <Page title="에이전트">
      <div className="max-w-3xl space-y-3 p-4">
        <div>
          <h2 className="text-base font-semibold">도구와 권한</h2>
          <p className="text-xs text-muted-foreground">채팅 패널과 터미널(loca tools · loca call)의 AI 에이전트가 쓸 수 있는 도구입니다. 끈 도구는 AI에게 보이지 않습니다.</p>
        </div>
        <AgentTab />
      </div>
    </Page>
  );
}
