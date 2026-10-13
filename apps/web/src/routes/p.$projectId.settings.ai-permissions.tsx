import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/page';
import { AiConfirmList } from '@/components/settings/ai-confirm';
import { AgentTab } from '@/components/settings/agent-tab';

export const Route = createFileRoute('/p/$projectId/settings/ai-permissions')({
  component: AiPermissions,
});

/**
 * 설정 › AI 권한: what AI may do without asking — confirm what it made (per kind of knowledge) and
 * which tools the chat AI (and loca tools / loca call) may use.
 */
function AiPermissions() {
  const { projectId } = Route.useParams();
  return (
    <Page title="AI 권한">
      <div className="max-w-3xl space-y-8 p-4">
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">AI가 만든 것을 바로 확정</h2>
            <p className="text-xs text-muted-foreground">작품 분석과 워크플로가 만든 자료·용어입니다. 자동 확정은 바로 쓰이고 ✦가 붙습니다. 후보로만은 확정해야 쓰입니다.</p>
          </div>
          <AiConfirmList projectId={projectId} />
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">채팅 AI가 쓸 수 있는 도구</h2>
          <AgentTab />
        </section>
      </div>
    </Page>
  );
}
