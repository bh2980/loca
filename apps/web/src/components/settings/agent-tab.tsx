import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_TOOL_ACTIONS, AGENT_TOOL_TARGETS, AGENT_TOOLS, type AgentToolAction, type AgentToolTarget } from '@tw/shared';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';

const TARGETS = Object.keys(AGENT_TOOL_TARGETS) as AgentToolTarget[];
const ACTIONS = Object.keys(AGENT_TOOL_ACTIONS) as AgentToolAction[];
const toolsIn = (target: AgentToolTarget, action?: AgentToolAction) => Object.keys(AGENT_TOOLS).filter((name) => AGENT_TOOLS[name]!.target === target && (!action || AGENT_TOOLS[name]!.action === action));

/**
 * Which tools the project's AI agent gets, as a grid: what a tool acts on (rows) by how far it goes
 * (read / propose a change / run). One switch per cell, so a whole column ("nothing runs") or a whole
 * target (everything about workflows) is one look; a row opens to its single tools. A tool switched
 * off is invisible to the AI; changes never apply without a card.
 */
export function AgentTab() {
  const { projectId } = useParams({ from: '/p/$projectId/settings/ai-permissions' });
  const queryClient = useQueryClient();
  const project = useQuery(q.project(projectId));
  const loaded = !!project.data;
  const disabled = new Set(project.data?.agentSettings.disabledTools ?? []);
  const save = useMutation({
    mutationFn: (next: Set<string>) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { agentSettings: { disabledTools: [...next] } } })),
    // Switches flip at once; the projects change event brings the saved settings.
    onMutate: async (next) => ({
      undo: await optimistic(queryClient, [{ key: ['units', 'project', projectId], update: (data: { agentSettings: object }) => ({ ...data, agentSettings: { ...data.agentSettings, disabledTools: [...next] } }) }]),
    }),
    onError: (error, _next, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });
  const set = (names: string[], on: boolean) => {
    const next = new Set(disabled);
    for (const name of names) if (on) next.delete(name);
    else next.add(name);
    save.mutate(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        채팅 패널의 AI와 터미널의 <code>loca tools</code>·<code>loca call</code>이 같은 도구를 씁니다. 끈 도구는 AI에게 보이지 않습니다. 터미널의 읽기 명령(lines, stats, context, export …)과 워크플로에는 영향이 없습니다.
      </p>
      <div className="rounded-lg border">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center gap-2 border-b px-2 py-1.5 text-xs text-muted-foreground">
          <span className="pl-7">대상</span>
          {ACTIONS.map((action) => (
            <span key={action} className="text-center" title={AGENT_TOOL_ACTIONS[action].description}>
              {AGENT_TOOL_ACTIONS[action].label}
            </span>
          ))}
        </div>
        <ul className="divide-y">
          {TARGETS.map((target) => (
            <li key={target}>
              <Collapsible className="group/tools">
                <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center gap-2 px-2 py-1">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="row" className="min-w-0" aria-label={`${AGENT_TOOL_TARGETS[target]} 도구 보기`}>
                      <ChevronRight className="text-muted-foreground transition-transform group-data-[state=open]/tools:rotate-90" />
                      <span className="truncate text-sm font-medium">{AGENT_TOOL_TARGETS[target]}</span>
                    </Button>
                  </CollapsibleTrigger>
                  {ACTIONS.map((action) => {
                    const names = toolsIn(target, action);
                    if (!names.length) return <span key={action} className="text-center text-xs text-muted-foreground">–</span>;
                    const on = names.filter((name) => !disabled.has(name)).length;
                    return (
                      <span key={action} className="flex items-center justify-center gap-1.5">
                        <Switch checked={on > 0} disabled={!loaded || save.isPending} onCheckedChange={(next) => set(names, next)} aria-label={`${AGENT_TOOL_TARGETS[target]} ${AGENT_TOOL_ACTIONS[action].label}`} />
                        {loaded && on > 0 && on < names.length && <span className="text-xs text-muted-foreground tabular-nums">{on}/{names.length}</span>}
                      </span>
                    );
                  })}
                </div>
                <CollapsibleContent>
                  {/* The same rows on a darker ground: each tool's switch sits in its own column, under the cell that switches them together. */}
                  <ul className="divide-y border-t bg-muted/60">
                    {toolsIn(target).map((name) => (
                      <li key={name} className="grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center gap-2 px-2 py-1">
                        <span className="flex h-8 min-w-0 items-center pl-9 text-sm" title={name}>
                          <span className="truncate">{AGENT_TOOLS[name]!.label}</span>
                        </span>
                        {ACTIONS.map((action) =>
                          AGENT_TOOLS[name]!.action === action ? (
                            <span key={action} className="flex justify-center">
                              <Switch checked={!disabled.has(name)} disabled={!loaded || save.isPending} onCheckedChange={(on) => set([name], on)} aria-label={AGENT_TOOLS[name]!.label} />
                            </span>
                          ) : (
                            <span key={action} />
                          ),
                        )}
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
