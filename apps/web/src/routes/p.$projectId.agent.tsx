import { createFileRoute } from '@tanstack/react-router';
import { SettingsSection } from '@loca/ui';
import { Page } from '@/components/page';
import { AgentTab } from '@/components/settings/agent-tab';

export const Route = createFileRoute('/p/$projectId/agent')({
  component: AgentPage,
});

/** 에이전트: what the project's AI agent (the chat panel, and loca tools / loca call in a terminal) may do. */
function AgentPage() {
  return (
    <Page title="에이전트">
      <div className="max-w-3xl px-6 py-6">
        <SettingsSection title="도구와 권한">
          <AgentTab />
        </SettingsSection>
      </div>
    </Page>
  );
}
