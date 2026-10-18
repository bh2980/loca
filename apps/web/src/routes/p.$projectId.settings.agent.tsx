import { createFileRoute } from '@tanstack/react-router';
import { SettingsContent, SettingsSection } from '@loca/ui';
import { Page } from '@/components/page';
import { AgentTab } from '@/components/settings/agent-tab';
import { AiConfirmList } from '@/components/settings/ai-confirm';

export const Route = createFileRoute('/p/$projectId/settings/agent')({
  component: AgentSettingsPage,
});

function AgentSettingsPage() {
  const { projectId } = Route.useParams();

  return (
    <Page title="에이전트" flush>
      <SettingsContent width="wide">
        <div className="space-y-8">
          <AgentTab projectId={projectId} />
          <SettingsSection
            title="자료·용어의 AI 결과"
            description="분석을 포함한 워크플로가 만든 자료·용어를 바로 사용할지, 검토할 후보로 보관할지 정합니다. 편집기의 번역·다듬기와 대사 상태는 이 설정의 대상이 아닙니다."
          >
            <AiConfirmList projectId={projectId} />
          </SettingsSection>
        </div>
      </SettingsContent>
    </Page>
  );
}
