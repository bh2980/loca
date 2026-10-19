import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SettingsContent, Skeleton } from '@loca/ui';
import { Page } from '@/components/page';
import { EditorAiSection } from '@/components/settings/editor-ai';
import { ExclusionRulesSection } from '@/components/exclusion-rules';
import { FormatRulesSection } from '@/components/format-rules';
import { q } from '@/lib/queries';

export const Route = createFileRoute('/p/$projectId/settings/editor')({
  component: EditorSettings,
});

function EditorSettings() {
  const { projectId } = Route.useParams();
  const project = useQuery(q.project(projectId));

  return (
    <Page title="에디터" flush>
      <SettingsContent>
        <div className="space-y-8">
          <EditorAiSection projectId={projectId} />
          {project.data ? (
            <>
              <FormatRulesSection projectId={projectId} rules={project.data.formatRules} />
              <ExclusionRulesSection projectId={projectId} rules={project.data.exclusionRules} formatRules={project.data.formatRules} sourceLanguage={project.data.sourceLanguage} excludedCount={project.data.excludedCount} />
            </>
          ) : (
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </div>
      </SettingsContent>
    </Page>
  );
}
