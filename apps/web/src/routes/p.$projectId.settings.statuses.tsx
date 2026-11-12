import { createFileRoute } from '@tanstack/react-router';
import { TaxonomySettings, taxonomySearchParams } from '@/components/settings/taxonomy-settings';
import { useProjectTaxonomy } from '@/components/settings/taxonomy-source';
import { searchParams } from '@/lib/search';

export const Route = createFileRoute('/p/$projectId/settings/statuses')({
  validateSearch: searchParams(taxonomySearchParams),
  component: StatusSettings,
});

/** A project's statuses, tags and automatic tags. */
function StatusSettings() {
  const { projectId } = Route.useParams();
  return <TaxonomySettings target={{ kind: 'project', projectId }} source={useProjectTaxonomy(projectId)} search={Route.useSearch()} navigate={Route.useNavigate()} />;
}
