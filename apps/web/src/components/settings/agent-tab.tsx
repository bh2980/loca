import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AGENT_TOOL_GROUPS, AGENT_TOOLS, type AgentToolGroup } from '@tw/shared';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

/**
 * Which tools the project agent gets. One list for the in-app chat (API or pi) and the CLI. Changes never apply without a card, whatever is switched on here.
 */
export function AgentTab() {
  const { projectId } = useParams({ from: '/p/$projectId/settings/ai' });
  const queryClient = useQueryClient();
  const project = useQuery(q.project(projectId));
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
  const groups = Object.keys(AGENT_TOOL_GROUPS) as AgentToolGroup[];

  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-3">
        {groups.map((group) => {
          const names = Object.entries(AGENT_TOOLS)
            .filter(([, info]) => info.group === group)
            .map(([name]) => name);
          const onCount = names.filter((name) => !disabled.has(name)).length;
          return (
            <div key={group} className="rounded-lg border">
              <div className="flex items-start gap-3 border-b px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {AGENT_TOOL_GROUPS[group].label} <span className="text-xs font-normal text-muted-foreground tabular-nums">{onCount}/{names.length}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{AGENT_TOOL_GROUPS[group].description}</p>
                </div>
                <Switch checked={onCount > 0} disabled={save.isPending} onCheckedChange={(on) => set(names, on)} aria-label={`${AGENT_TOOL_GROUPS[group].label} 전체`} />
              </div>
              <ul className="grid gap-x-6 px-4 py-2 sm:grid-cols-2">
                {names.map((name) => (
                  <li key={name} className="flex items-center justify-between gap-2 py-1 text-sm">
                    <span className="min-w-0 truncate">
                      {AGENT_TOOLS[name].label} <code className="text-[11px] text-muted-foreground">{name}</code>
                    </span>
                    <Switch checked={!disabled.has(name)} disabled={save.isPending} onCheckedChange={(on) => set([name], on)} aria-label={AGENT_TOOLS[name].label} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}

