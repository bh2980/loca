import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/page';
import { AgentTab } from '@/components/settings/agent-tab';

export const Route = createFileRoute('/p/$projectId/settings/agent')({
  component: AgentSettings,
});

/** Which tools the project agent may use. */
function AgentSettings() {
  return (
    <Page title="에이전트">
      <AgentTab />
    </Page>
  );
}
