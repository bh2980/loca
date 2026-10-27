import { createFileRoute } from '@tanstack/react-router';
import { PageBody } from '@loca/ui';
import { Page } from '@/components/page';
import { EditorAiSection } from '@/components/settings/editor-ai';

export const Route = createFileRoute('/settings/defaults/editor')({ component: AppEditorSettings });

function AppEditorSettings() {
  return (
    <Page title="에디터 AI 기본값" flush>
      <PageBody>
        <EditorAiSection target={{ kind: 'app' }} />
      </PageBody>
    </Page>
  );
}
