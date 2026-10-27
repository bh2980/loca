import { createFileRoute } from '@tanstack/react-router';
import { ConnectionsSettings } from '@/components/settings/connections';

export const Route = createFileRoute('/settings/defaults/connections')({
  validateSearch: (raw: Record<string, unknown>): { conn?: string; key?: string } => ({
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : undefined,
    key: typeof raw.key === 'string' && raw.key ? raw.key : undefined,
  }),
  component: AppConnectionsPage,
});

function AppConnectionsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ConnectionsSettings
      target={{ kind: 'app' }}
      search={search}
      onSearch={(next) => void navigate({ search: next, replace: true })}
      description="새 프로젝트가 처음에 복사해 가는 연결입니다. 여기서 바꿔도 이미 있는 프로젝트의 연결은 그대로입니다."
    />
  );
}
