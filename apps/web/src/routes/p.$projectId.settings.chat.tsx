import { createFileRoute } from '@tanstack/react-router';
import { SettingsContent } from '@loca/ui';
import { Page } from '@/components/page';
import { AgentTab } from '@/components/settings/agent-tab';

export const Route = createFileRoute('/p/$projectId/settings/chat')({
  component: ChatSettingsPage,
});

function ChatSettingsPage() {
  const { projectId } = Route.useParams();

  return (
    <Page title="채팅" flush>
      <SettingsContent width="wide">
        <AgentTab projectId={projectId} />
      </SettingsContent>
    </Page>
  );
}
