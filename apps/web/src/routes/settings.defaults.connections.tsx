import { createFileRoute } from '@tanstack/react-router';
import { ConnectionsSettings, connectionsSearchParams } from '@/components/settings/connections';
import { searchParams } from '@/lib/search';

export const Route = createFileRoute('/settings/defaults/connections')({
  validateSearch: searchParams(connectionsSearchParams),
  component: AppConnectionsPage,
});

function AppConnectionsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ConnectionsSettings
      target={{ kind: 'app' }}
      search={search}
      navigate={navigate}
      description="새 프로젝트가 처음에 복사해 가는 연결입니다. 여기서 바꿔도 이미 있는 프로젝트의 연결은 그대로입니다."
    />
  );
}
