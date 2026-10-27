import { createFileRoute } from '@tanstack/react-router';
import { PageBody } from '@loca/ui';
import { Page } from '@/components/page';
import { AgentTab } from '@/components/settings/agent-tab';

export const Route = createFileRoute('/settings/defaults/chat')({ component: AppChatSettings });

function AppChatSettings() {
  return (
    <Page title="채팅 기본값" flush>
      <PageBody width="wide">
        <AgentTab target={{ kind: 'app' }} />
      </PageBody>
    </Page>
  );
}
