import { useQuery } from '@tanstack/react-query';
import { CONTEXT_ITEM_KINDS, CONTEXT_PRIORITY, type ContextItem } from '@tw/shared';
import { Badge, Group, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from '@loca/ui';
import { PromptView, useRequestPreview } from '@/components/workflow/node-config/request-preview';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

const tokens = (value: number) => `약 ${value.toLocaleString()}`;

/** What went into an AI call besides the lines: grouped in fill order, dropped items struck through. */
export function ContextItemList({ items, budget }: { items: ContextItem[]; budget?: { limit: number; used: number } }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">현재 줄 외에 따로 넣은 문맥이 없습니다.</p>;
  const dropped = items.filter((item) => !item.included);
  return (
    <div className="space-y-4">
      {budget && (
        <p className="text-xs text-muted-foreground">
          문맥 {tokens(budget.used)} / 상한 {budget.limit.toLocaleString()} 토큰 (추정)
          {dropped.length > 0 && <span className="text-warning"> · 상한을 넘어 {dropped.length}개를 뺌</span>}
        </p>
      )}
      {CONTEXT_PRIORITY.map((kind) => {
        const group = items.filter((item) => item.kind === kind);
        if (!group.length) return null;
        return (
          <Group key={kind} title={<>{CONTEXT_ITEM_KINDS[kind]} <span className="font-normal text-muted-foreground tabular-nums">{group.length}</span></>}>
            <ul className="space-y-1.5">
              {group.map((item, index) => (
                <li key={`${item.label}-${index}`} className={cn('rounded-md border px-2.5 py-2 text-sm', !item.included && 'bg-muted text-muted-foreground')}>
                  <div className="flex items-center gap-2">
                    <span className={cn('min-w-0 flex-1 truncate font-medium', !item.included && 'line-through')} title={item.label}>
                      {item.label}
                    </span>
                    {!item.included && (
                      <Badge variant="outline" className="px-1.5 py-0 text-xs text-warning">
                        상한 초과
                      </Badge>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tokens(item.tokens)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.reason}</p>
                </li>
              ))}
            </ul>
          </Group>
        );
      })}
    </div>
  );
}

/**
 * The line panel's "AI 프롬프트": what the chosen AI node of a lines workflow would send in the request
 * that holds this line, built the way a run builds it, without calling a model (the same view as the
 * workflow editor's).
 */
export function AiContextPanel({ projectId, unitKey, aiNode, onAiNode }: { projectId: string; unitKey: string; unitKind?: 'dialogue' | 'document' | 'ui'; aiNode?: string; onAiNode: (value: string) => void }) {
  const workflows = useQuery(q.workflows(projectId));
  const choices = (workflows.data ?? []).filter((workflow) => workflow.input === 'lines').flatMap((workflow) => workflow.aiNodes.map((node) => ({ value: `${workflow.id}:${node.id}`, label: `${workflow.name} › ${node.name}` })));
  const picked = choices.find((choice) => choice.value === aiNode) ?? choices[0];
  const [workflowId, nodeId] = picked?.value.split(':') ?? [];
  const request = useRequestPreview(workflowId, nodeId, unitKey);
  if (workflows.data && !choices.length) return <p className="text-sm text-muted-foreground">AI 노드가 있는 대사 워크플로가 없습니다.</p>;
  return (
    <div className="space-y-2">
      {picked && (
        <Select value={picked.value} onValueChange={onAiNode}>
          <SelectTrigger size="sm" className="w-full" aria-label="프롬프트를 볼 AI 노드">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {request.isError ? <p className="text-sm text-destructive">{request.error.message}</p> : !request.data ? <Skeleton className="h-40" /> : <PromptView request={request.data} title={`AI 프롬프트 · ${unitKey} · ${picked?.label ?? ''}`} />}
    </div>
  );
}
