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
        {/* The grid explains itself (its own intro): only the heading here. */}
        <h2 className="text-base font-semibold">도구와 권한</h2>
        <AgentTab />
      </div>
    </Page>
  );
}
