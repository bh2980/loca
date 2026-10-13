import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/page';
import { AiConfirmList } from '@/components/settings/ai-confirm';
import { AgentTab } from '@/components/settings/agent-tab';
import { EditorAiSection } from '@/components/settings/editor-ai';

export const Route = createFileRoute('/p/$projectId/ai/usage')({
  component: AiPermissions,
});

/**
 * AI › 사용 방식: what AI does for the person in this project, in one place — the editor's
 * continuation, confirming what it made (per kind of knowledge) without asking, and which tools
 * the chat AI (and loca tools / loca call) may use.
 */
function AiPermissions() {
  const { projectId } = Route.useParams();
  return (
    <Page title="사용 방식">
      <div className="max-w-3xl space-y-8 p-4">
        <EditorAiSection projectId={projectId} />
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">AI가 만든 것을 바로 확정</h2>
            <p className="text-xs text-muted-foreground">작품 분석과 워크플로가 만든 자료·용어입니다. 자동 확정은 바로 쓰이고 ✦가 붙습니다. 후보로만은 확정해야 쓰입니다.</p>
          </div>
          <AiConfirmList projectId={projectId} />
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">AI 에이전트 도구 (채팅·터미널)</h2>
          <AgentTab />
        </section>
      </div>
    </Page>
  );
}
