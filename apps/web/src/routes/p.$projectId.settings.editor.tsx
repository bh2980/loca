import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SettingsContent, Skeleton, Tabs, TabsList, TabsTrigger } from '@loca/ui';
import { HeaderActions, Page } from '@/components/page';
import { EditorAiSection } from '@/components/settings/editor-ai';
import { ExclusionRulesSection } from '@/components/exclusion-rules';
import { FormatRulesSection } from '@/components/format-rules';
import { q } from '@/lib/queries';

/** The editor's settings in three unrelated parts, one tab each (the tab is in the URL). */
const TABS = { ai: 'AI', format: '서식 규칙', exclusion: '번역 제외' } as const;
type Tab = keyof typeof TABS;

export const Route = createFileRoute('/p/$projectId/settings/editor')({
  validateSearch: (raw: Record<string, unknown>): { tab?: Tab } => ({
    tab: raw.tab === 'format' || raw.tab === 'exclusion' ? raw.tab : undefined,
  }),
  component: EditorSettings,
});

function EditorSettings() {
  const { projectId } = Route.useParams();
  const { tab = 'ai' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const project = useQuery(q.project(projectId));

  return (
    <Page title="에디터" flush>
      <HeaderActions>
        <Tabs value={tab} onValueChange={(value) => void navigate({ search: { tab: value === 'ai' ? undefined : (value as Tab) }, replace: true })} className="self-stretch">
          <TabsList variant="line" className="h-full border-b-0" aria-label="에디터 설정">
            {(Object.keys(TABS) as Tab[]).map((id) => (
              <TabsTrigger key={id} value={id}>
                {TABS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </HeaderActions>
      <SettingsContent>
        {tab === 'ai' ? (
          <EditorAiSection projectId={projectId} />
        ) : project.data ? (
          tab === 'format' ? (
            <FormatRulesSection projectId={projectId} rules={project.data.formatRules} />
          ) : (
            <ExclusionRulesSection projectId={projectId} rules={project.data.exclusionRules} formatRules={project.data.formatRules} sourceLanguage={project.data.sourceLanguage} excludedCount={project.data.excludedCount} />
          )
        ) : (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
      </SettingsContent>
    </Page>
  );
}
