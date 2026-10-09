import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AGENT_TOOL_GROUPS, AGENT_TOOLS, type AgentToolGroup } from '@tw/shared';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

/**
 * Which tools the project agent gets. One list for the in-app chat (API or pi) and external
 * agents over MCP. Changes never apply without a card, whatever is switched on here.
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
    <div className="mt-3 max-w-3xl space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">에이전트 도구</h2>
          <p className="text-xs text-muted-foreground">
            채팅(API·pi)과 MCP로 연결한 외부 에이전트가 이 프로젝트에서 쓸 수 있는 도구입니다. 끈 도구는 에이전트에게 아예 보이지 않습니다. 변경 도구는 켜 두어도 항상 수락 카드를 거칩니다.
          </p>
        </div>
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
      <McpInfo projectId={projectId} />
    </div>
  );
}

/**
 * The project's agent tools over MCP for agents running outside the app. Reading runs at once;
 * changes arrive as proposals in the chat panel.
 */
function McpInfo({ projectId }: { projectId: string }) {
  const url = `${window.location.origin}/api/projects/${projectId}/mcp`;
  const commands = [
    { label: 'Claude Code', text: `claude mcp add --transport http workbench ${url}` },
    { label: 'Codex', text: `codex mcp add workbench --url ${url}` },
  ];
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success('복사했습니다.'),
      () => toast.error('복사하지 못했습니다.'),
    );
  };
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">외부 에이전트 연결 (MCP)</h2>
      <p className="text-xs text-muted-foreground">
        이 프로젝트의 에이전트 도구(대본·용어·인물 읽기, 프로필·문서·번역 제안)를 MCP로 열어 둡니다. Claude Code·Codex 같은 에이전트에 연결하면 그쪽에서 대본을 읽고, 바꾸자는 내용은 이 작업실 채팅
        패널에 수락/거절 카드로 올라옵니다. 이 컴퓨터(localhost)에서만 접속됩니다.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{url}</code>
        <Button size="sm" variant="outline" onClick={() => copy(url)}>
          주소 복사
        </Button>
      </div>
      {commands.map((command) => (
        <div key={command.label} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">{command.label}</span>
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{command.text}</code>
          <Button size="sm" variant="ghost" onClick={() => copy(command.text)}>
            복사
          </Button>
        </div>
      ))}
    </section>
  );
}
