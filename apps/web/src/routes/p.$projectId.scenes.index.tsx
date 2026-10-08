import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Page } from '@/components/page';
import { StatusBar } from '@/components/status';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { GROUP_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';

type Kind = 'scene' | 'document' | 'ui';

export const Route = createFileRoute('/p/$projectId/scenes/')({
  validateSearch: (raw: Record<string, unknown>): { kind?: Kind; q?: string } => ({
    kind: raw.kind === 'scene' || raw.kind === 'document' || raw.kind === 'ui' ? raw.kind : undefined,
    q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
  }),
  component: Scenes,
});

function Scenes() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const groups = useQuery(q.groups(projectId, { kind: search.kind, q: search.q }));
  const statuses = useQuery(q.statuses(projectId));
  const finalIds = new Set(statuses.data?.statuses.filter((status) => status.kind === 'final').map((status) => status.id));

  return (
    <Page title="장면" description="장면·문서·UI 묶음. 행을 누르면 대사 목록이 열립니다.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={search.kind ?? 'all'} onValueChange={(value) => value && void navigate({ search: (previous) => ({ ...previous, kind: value === 'all' ? undefined : (value as Kind) }) })}>
          <ToggleGroupItem value="all">전체</ToggleGroupItem>
          {(Object.keys(GROUP_KIND) as Kind[]).map((kind) => (
            <ToggleGroupItem key={kind} value={kind}>
              {GROUP_KIND[kind]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <InputGroup className="w-64">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            defaultValue={search.q}
            placeholder="제목·키"
            onKeyDown={(event) => event.key === 'Enter' && void navigate({ search: (previous) => ({ ...previous, q: event.currentTarget.value.trim() || undefined }) })}
          />
        </InputGroup>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">{groups.data?.length.toLocaleString() ?? '–'}개</span>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14 text-right">#</TableHead>
              <TableHead>제목</TableHead>
              <TableHead className="w-20">종류</TableHead>
              <TableHead className="w-20 text-right">대사</TableHead>
              <TableHead className="w-64">상태</TableHead>
              <TableHead className="w-16 text-right">최종</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.data?.map((group, index) => {
              const done = Object.entries(group.statuses).reduce((sum, [id, count]) => sum + (finalIds.has(id) ? count : 0), 0);
              return (
                <TableRow key={group.id} className="cursor-pointer" onClick={() => void navigate({ to: '/p/$projectId/scenes/$groupId', params: { projectId, groupId: group.id } })}>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{index + 1}</TableCell>
                  <TableCell>
                    <Link to="/p/$projectId/scenes/$groupId" params={{ projectId, groupId: group.id }} className="font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
                      {group.title}
                    </Link>
                    <p className="truncate font-mono text-xs text-muted-foreground">{group.key}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{GROUP_KIND[group.kind]}</TableCell>
                  <TableCell className="text-right tabular-nums">{group.total.toLocaleString()}</TableCell>
                  <TableCell>
                    <StatusBar statuses={statuses.data?.statuses ?? []} counts={group.statuses} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{group.total ? Math.round((done / group.total) * 100) : 0}%</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Page>
  );
}
