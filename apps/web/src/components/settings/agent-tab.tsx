import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_TOOLS, type AgentToolGroup } from '@tw/shared';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';

/** The tool groups shown to the user, in order. */
const GROUPS: { group: AgentToolGroup; title: string; description: string }[] = [
  { group: 'read', title: '프로젝트 읽기', description: '대본·인물·사건·용어·문서·워크플로·실행 기록을 읽습니다.' },
  { group: 'change', title: '변경 제안', description: '무엇이든 고치자는 제안은 항상 수락·거절 카드로만 나타납니다.' },
  { group: 'run', title: '워크플로 실행 제안', description: '실행을 제안합니다. 수락하면 시작되고 AI 비용이 듭니다.' },
  { group: 'web', title: '웹 검색', description: '인터넷을 검색하고 페이지를 읽습니다.' },
  { group: 'editor', title: '워크플로 편집기 연동', description: '열려 있는 편집기의 노드를 고칩니다. 저장은 사람이 합니다.' },
];

const toolNames = (group: AgentToolGroup) => Object.keys(AGENT_TOOLS).filter((name) => AGENT_TOOLS[name]!.group === group);

/**
 * Which tools the project's AI gets. One switch per group; a group opens (closed by default) to
 * its single tools. A tool switched off is invisible to the AI; changes never apply without a card.
 */
export function AgentTab() {
  const { projectId } = useParams({ from: '/p/$projectId/settings/agent' });
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
    <div className="max-w-3xl space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        채팅 패널의 AI(연결 종류와 관계없이)와 터미널의 <code>loca tools</code>·<code>loca call</code>이 쓸 수 있는 도구입니다. 끈 도구는 AI에게 보이지 않습니다. CLI의 읽기 명령(lines, stats, context, export …)과 워크플로에는 영향이 없습니다.
      </p>
      <ul className="divide-y rounded-lg border">
        {GROUPS.map(({ group, title, description }) => {
          const names = toolNames(group);
          const onCount = names.filter((name) => !disabled.has(name)).length;
          return (
            <li key={group}>
              <Collapsible className="group/tools">
                <div className="flex items-center gap-3 px-2 py-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="row" className="min-w-0 flex-1 items-start py-1.5" aria-label={`${title} 도구 보기`}>
                      <ChevronRight className="mt-0.5 text-muted-foreground transition-transform group-data-[state=open]/tools:rotate-90" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {title} <span className="text-xs font-normal text-muted-foreground tabular-nums">{loaded ? `${onCount}/${names.length}` : ''}</span>
                        </span>
                        <span className="block text-xs text-muted-foreground">{description}</span>
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <Switch className="mr-2" checked={onCount > 0} disabled={!loaded || save.isPending} onCheckedChange={(on) => set(names, on)} aria-label={`${title} 전체`} />
                </div>
                <CollapsibleContent>
                  <ul className="mb-2 ml-9 mr-4 divide-y border-t">
                    {names.map((name) => (
                      <li key={name} className="flex items-center gap-3 py-2 pr-2">
                        <span className="min-w-0 flex-1 truncate text-sm">{AGENT_TOOLS[name]!.label}</span>
                        <span className="w-48 shrink-0 truncate font-mono text-xs text-muted-foreground">{name}</span>
                        <Switch checked={!disabled.has(name)} disabled={!loaded || save.isPending} onCheckedChange={(on) => set([name], on)} aria-label={AGENT_TOOLS[name]!.label} />
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
