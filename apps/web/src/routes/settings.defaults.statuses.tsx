import { createFileRoute } from '@tanstack/react-router';
import { TaxonomySettings, taxonomySearchParams } from '@/components/settings/taxonomy-settings';
import { useDefaultTaxonomy } from '@/components/settings/taxonomy-source';
import { searchParams } from '@/lib/search';

export const Route = createFileRoute('/settings/defaults/statuses')({
  validateSearch: searchParams(taxonomySearchParams),
  component: AppStatusSettings,
});

/** The statuses and the person's own tags a new project starts with. */
function AppStatusSettings() {
  return <TaxonomySettings target={{ kind: 'app' }} source={useDefaultTaxonomy()} search={Route.useSearch()} navigate={Route.useNavigate()} />;
}
