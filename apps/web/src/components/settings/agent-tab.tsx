import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_TOOL_ACTIONS, AGENT_TOOL_TARGETS, AGENT_TOOLS, agentSettingsSchema, type AgentToolAction, type AgentToolTarget, type PermissionMode } from '@tw/shared';
import { PermissionModePicker } from '@/components/chat/permission-mode';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Field, FieldDescription, FieldLabel, Input, Switch } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';
import { useFormFrom } from '@/lib/use-form-from';

const TARGETS = Object.keys(AGENT_TOOL_TARGETS) as AgentToolTarget[];
const ACTIONS = Object.keys(AGENT_TOOL_ACTIONS) as AgentToolAction[];
const toolsIn = (target: AgentToolTarget, action?: AgentToolAction) => Object.keys(AGENT_TOOLS).filter((name) => AGENT_TOOLS[name]!.target === target && (!action || AGENT_TOOLS[name]!.action === action));

/**
 * Which tools the project's AI agent gets, as a grid: what a tool acts on (rows) by how far it goes
 * (read / propose a change / run). One switch per cell, so a whole column ("nothing runs") or a whole
 * target (everything about workflows) is one look; a row opens to its single tools. A tool switched
 * off is invisible to the AI; whether a change asks first is the conversation's permission mode.
 */
export function AgentTab() {
  const { projectId } = useParams({ from: '/p/$projectId/agent' });
  const queryClient = useQueryClient();
  const project = useQuery(q.project(projectId));
  const loaded = !!project.data;
  // Parsed, so settings saved before a field existed come with its default (the whole object is saved back).
  const settings = agentSettingsSchema.parse(project.data?.agentSettings ?? {});
  const disabled = new Set(settings.disabledTools);
  const defaultMode: PermissionMode = settings.defaultPermissionMode;
  const { bypassLimits } = settings;
  const { draft: changesDraft, setDraft: setChangesDraft } = useFormFrom(String(bypassLimits.changes), `agent-bypass-changes.${projectId}`);
  const { draft: costDraft, setDraft: setCostDraft } = useFormFrom(bypassLimits.costUsd === null ? '' : String(bypassLimits.costUsd), `agent-bypass-cost.${projectId}`);
  // The whole settings object goes each time: a field left out would fall back to its default.
  const save = useMutation({
    mutationFn: (next: typeof settings) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { agentSettings: next } })),
    // Switches flip at once; the projects change event brings the saved settings.
    onMutate: async (next) => ({
      undo: await optimistic(queryClient, [{ key: ['units', 'project', projectId], update: (data: { agentSettings: object }) => ({ ...data, agentSettings: { ...data.agentSettings, ...next } }) }]),
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
    save.mutate({ ...settings, disabledTools: [...next] });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        채팅 패널의 AI와 터미널의 <code>loca tools</code>·<code>loca call</code>이 같은 도구를 씁니다. 끈 도구는 AI에게 보이지 않습니다. 터미널의 읽기 명령(lines, stats, context, export …)과 워크플로에는 영향이 없습니다.
      </p>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">새 대화의 권한 모드</p>
          <p className="text-xs text-muted-foreground">대화마다 입력창 아래에서 바꿀 수 있습니다. 어느 모드든 변경은 제안 기록으로 남습니다.</p>
        </div>
        <PermissionModePicker className="w-40 shrink-0" value={defaultMode} onChange={(mode) => save.mutate({ ...settings, disabledTools: [...disabled], defaultPermissionMode: mode })} />
      </div>
      <div className="rounded-lg border px-3 py-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="bypass-changes">우회 모드 한도 — 대화당 바로 반영할 변경 수</FieldLabel>
            <Input id="bypass-changes" type="number" min={1} max={10_000} step={1} value={changesDraft} disabled={!loaded || save.isPending} onChange={(event) => setChangesDraft(event.target.value)} onBlur={() => {
              const changes = Math.max(1, Math.min(10_000, Math.round(Number(changesDraft) || 1)));
              setChangesDraft(String(changes));
              if (changes !== bypassLimits.changes) save.mutate({ ...settings, bypassLimits: { ...bypassLimits, changes } });
            }} />
          </Field>
          <Field>
            <FieldLabel htmlFor="bypass-cost">대화당 비용(USD, 비우면 제한 없음)</FieldLabel>
            <Input id="bypass-cost" type="number" min={0} step="any" value={costDraft} disabled={!loaded || save.isPending} onChange={(event) => setCostDraft(event.target.value)} onBlur={() => {
              const costUsd = costDraft === '' ? null : Math.max(0, Number(costDraft) || 0);
              setCostDraft(costUsd === null ? '' : String(costUsd));
              if (costUsd !== bypassLimits.costUsd) save.mutate({ ...settings, bypassLimits: { ...bypassLimits, costUsd } });
            }} />
          </Field>
        </div>
        <FieldDescription className="mt-2">비용은 연결이 보고한 것만 셉니다(구독 CLI는 0). 한도에 닿으면 이후 변경은 카드로 묻습니다.</FieldDescription>
      </div>
      <div className="rounded-lg border">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,5.5rem)] items-center gap-2 border-b px-2 py-1.5 text-xs text-muted-foreground">
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
                <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,5.5rem)] items-center gap-2 px-2 py-1">
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
                      <li key={name} className="grid grid-cols-[minmax(0,1fr)_repeat(4,5.5rem)] items-center gap-2 px-2 py-1">
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
