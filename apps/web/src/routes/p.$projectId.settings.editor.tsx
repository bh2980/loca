import { createFileRoute } from '@tanstack/react-router';
import { Tabs, TabsList, TabsTrigger, Skeleton, Box, PageBody } from '@loca/ui';
import { HeaderViews, Page } from '@/components/page';
import { EditorAiSection } from '@/components/settings/editor-ai';
import { ExclusionRulesSection } from '@/components/exclusion-rules';
import { FormatRulesSection } from '@/components/format-rules';
import { useProject, useProjectProgress } from '@/lib/project';
import { param, searchParams } from '@/lib/search';

/** The editor's settings in three unrelated parts, one tab each (the tab is in the URL). */
const TABS = { ai: 'AI', format: '서식 규칙', exclusion: '번역 제외' } as const;
type Tab = keyof typeof TABS;

export const Route = createFileRoute('/p/$projectId/settings/editor')({
  validateSearch: searchParams({ tab: param.oneOf<Tab>(['format', 'exclusion']) }),
  component: EditorSettings,
});

function EditorSettings() {
  const { projectId } = Route.useParams();
  const { tab = 'ai' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const project = useProject(projectId);
  const progress = useProjectProgress(projectId);

  return (
    <Page title="에디터" flush>
      {/* Which part is shown: next to the title, as every page's views (not far right with the tools). */}
      <HeaderViews>
        <Tabs stretch value={tab} onValueChange={(value) => void navigate({ search: { tab: value === 'ai' ? undefined : (value as Tab) }, replace: true })}>
          <TabsList variant="line" fill aria-label="에디터 설정">
            {(Object.keys(TABS) as Tab[]).map((id) => (
              <TabsTrigger key={id} value={id}>
                {TABS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </HeaderViews>
      <PageBody>
        {tab === 'ai' ? (
          <EditorAiSection target={{ kind: 'project', projectId }} />
        ) : project.data ? (
          tab === 'format' ? (
            <FormatRulesSection projectId={projectId} rules={project.data.formatRules} />
          ) : (
            <ExclusionRulesSection projectId={projectId} rules={project.data.exclusionRules} formatRules={project.data.formatRules} sourceLanguage={project.data.sourceLanguage} excludedCount={progress?.excludedCount ?? 0} />
          )
        ) : (
          <Box spaceY="comfortable">
            <Skeleton height="control" width="1/3" />
            <Skeleton height="placeholder-sm" width="full" />
          </Box>
        )}
      </PageBody>
    </Page>
  );
}
