import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_TOOLS, type AgentToolGroup } from '@tw/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

/** The tool groups shown to the user, in order. */
const GROUPS: { group: AgentToolGroup; title: string; description: string }[] = [
  { group: 'read', title: '프로젝트 읽기', description: '대본·인물·사건·용어·문서·워크플로·실행 기록을 읽습니다.' },
  { group: 'change', title: '변경 제안', description: '무엇이든 고치자는 제안은 항상 수락·거절 카드로만 나타납니다.' },
  { group: 'run', title: '워크플로 실행 제안', description: '실행을 제안합니다. 수락하면 시작되고 AI 비용이 듭니다.' },
  { group: 'web', title: '웹 검색', description: '인터넷을 검색하고 페이지를 읽습니다.' },
  { group: 'editor', title: '워크플로 편집기 연동', description: '열려 있는 편집기의 노드를 고칩니다. 저장은 사람이 합니다.' },
];

type ToolRow = { name: string; label: string; group: AgentToolGroup };

const toolNames = (group: AgentToolGroup) => Object.keys(AGENT_TOOLS).filter((name) => AGENT_TOOLS[name]!.group === group);

/**
 * Which tools the project agent gets. Three group switches, with the single tools underneath on
 * demand. A tool switched off is invisible to the AI; changes never apply without a card.
 */
export function AgentTab() {
  const { projectId } = useParams({ from: '/p/$projectId/settings/agent' });
  const queryClient = useQueryClient();
  const project = useQuery(q.project(projectId));
  const loaded = !!project.data;
  const disabled = new Set(project.data?.agentSettings.disabledTools ?? []);
  const save = useMutation({
    mutationFn: (next: Set<string>) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { agentSettings: { disabledTools: [...next] } } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['units', 'project', projectId] }),
    onError: (error) => toast.error(error.message),
  });
  const set = (names: string[], on: boolean) => {
    const next = new Set(disabled);
    for (const name of names) if (on) next.delete(name);
    else next.add(name);
    save.mutate(next);
  };

  const rows: ToolRow[] = GROUPS.flatMap(({ group }) => toolNames(group).map((name) => ({ name, label: AGENT_TOOLS[name]!.label, group })));
  const columns: ColumnDef<ToolRow, unknown>[] = [
    { id: 'label', header: '도구', cell: ({ row }) => row.original.label },
    { id: 'name', header: '이름', meta: { width: 200, className: 'font-mono text-xs text-muted-foreground' }, cell: ({ row }) => row.original.name },
    {
      id: 'on',
      header: '',
      meta: { width: 64, align: 'end' },
      cell: ({ row: { original: tool } }) => <Switch checked={!disabled.has(tool.name)} disabled={!loaded || save.isPending} onCheckedChange={(on) => set([tool.name], on)} aria-label={tool.label} />,
    },
  ];

  return (
    <div className="max-w-3xl space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        채팅 패널의 AI(연결 종류와 관계없이)와 터미널의 <code>loca tools</code>·<code>loca call</code>이 쓸 수 있는 도구입니다. 끈 도구는 AI에게 보이지 않습니다. CLI의 읽기 명령(lines, stats, context, export …)과 워크플로에는 영향이 없습니다.
      </p>
      <ul className="divide-y rounded-lg border">
        {GROUPS.map(({ group, title, description }) => {
          const names = toolNames(group);
          const onCount = names.filter((name) => !disabled.has(name)).length;
          return (
            <li key={group} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {title} <span className="text-xs font-normal text-muted-foreground tabular-nums">{loaded ? `${onCount}/${names.length}` : ''}</span>
                </p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <Switch checked={onCount > 0} disabled={!loaded || save.isPending} onCheckedChange={(on) => set(names, on)} aria-label={`${title} 전체`} />
            </li>
          );
        })}
      </ul>
      <Collapsible className="group/tools">
        <CollapsibleTrigger asChild>
          <Button variant="ghost">
            <ChevronRight className="transition-transform group-data-[state=open]/tools:rotate-90" />
            도구별로 고르기
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-lg border">
          <DataTable className="flex-none" columns={columns} rows={loaded ? rows : undefined} rowId={(row) => row.name} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
