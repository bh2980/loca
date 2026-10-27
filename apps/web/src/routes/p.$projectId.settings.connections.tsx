import { createFileRoute } from '@tanstack/react-router';
import { ConnectionsSettings } from '@/components/settings/connections';

export const Route = createFileRoute('/p/$projectId/settings/connections')({
  validateSearch: (raw: Record<string, unknown>): { conn?: string; key?: string } => ({
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : undefined,
    key: typeof raw.key === 'string' && raw.key ? raw.key : undefined,
  }),
  component: ProjectConnectionsPage,
});

function ProjectConnectionsPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ConnectionsSettings
      target={{ kind: 'project', projectId }}
      search={search}
      onSearch={(next) => void navigate({ search: next, replace: true })}
      description="이 프로젝트에서만 쓰는 연결입니다. 새 프로젝트는 홈 설정의 기본 연결을 복사해 갑니다."
    />
  );
}
