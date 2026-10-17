import { createFileRoute } from '@tanstack/react-router';
import { SettingsSection } from '@loca/ui';
import { Page } from '@/components/page';
import { AiConfirmList } from '@/components/settings/ai-confirm';
import { EditorAiSection } from '@/components/settings/editor-ai';

export const Route = createFileRoute('/p/$projectId/ai/usage')({
  component: AiPermissions,
});

/**
 * AI › 사용 방식: what AI does for the person in this project — the editor's continuation and
 * confirming what it made (per kind of knowledge) without asking. The chat agent's tools have their
 * own page (에이전트).
 */
function AiPermissions() {
  const { projectId } = Route.useParams();
  return (
    <Page title="사용 방식">
      <div className="max-w-3xl space-y-8 px-6 py-6">
        <EditorAiSection projectId={projectId} />
        <SettingsSection title="AI가 만든 것을 바로 확정" description="작품 분석과 워크플로가 만든 자료·용어입니다. 자동 확정은 바로 쓰이고 ✦가 붙습니다. 후보로만은 확정해야 쓰입니다.">
          <AiConfirmList projectId={projectId} />
        </SettingsSection>
      </div>
    </Page>
  );
}
