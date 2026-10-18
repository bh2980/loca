import { ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { CONTEXT_ITEM_KINDS, CONTEXT_PRIORITY, type ContextItem } from '@tw/shared';
import { Badge, Group, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
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
                        상한 초과로 뺌
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

interface PrecedingLine {
  key: string;
  speaker: string | null;
  source: string;
}

function Lines({ lines }: { lines: PrecedingLine[] }) {
  return (
    <ol className="space-y-0.5">
      {lines.map((line) => (
        <li key={line.key} className="text-sm">
          <span className="text-muted-foreground">{line.speaker ? `${line.speaker}: ` : ''}</span>
          {line.source}
        </li>
      ))}
    </ol>
  );
}

/**
 * The line panel's "AI 문맥" tab: what the chosen AI node would send for this line, built the way
 * a run builds it, without calling a model.
 */
export function AiContextPanel({ projectId, unitKey, unitKind = 'dialogue', aiNode, onAiNode }: { projectId: string; unitKey: string; unitKind?: 'dialogue' | 'document' | 'ui'; aiNode?: string; onAiNode: (value: string) => void }) {
  const [workflowId, nodeId] = aiNode?.split(':') ?? [];
  const preview = useQuery({
    // Context is read from lines, knowledge, glossary and workflows; it refetches with line changes and on open.
    queryKey: ['units', 'ai-context', projectId, unitKey, aiNode ?? ''],
    queryFn: () => unwrap(client.projects[':projectId'].lines[':key']['ai-context'].$get({ param: { projectId, key: unitKey }, query: { workflowId, nodeId } })),
  });
  if (!preview.data)
    return (
      <div className="space-y-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-24" />
      </div>
    );
  const data = preview.data;
  if (!data.picked) return <p className="text-sm text-muted-foreground">AI 노드가 있는 워크플로가 없습니다.</p>;
  const value = `${data.picked.workflowId}:${data.picked.nodeId}`;
  const inBatch = data.batch.keys.length;
  const batchName = unitKind === 'dialogue' ? '장면' : '묶음';
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Select value={value} onValueChange={onAiNode}>
          <SelectTrigger size="sm" className="w-full" aria-label="문맥을 볼 AI 노드">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.choices.map((choice) => (
              <SelectItem key={`${choice.workflowId}:${choice.nodeId}`} value={`${choice.workflowId}:${choice.nodeId}`}>
                {choice.workflowName} › {choice.nodeName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {batchName} 기준 {inBatch}줄을 한 번에 보내는 경우{data.batch.mode === 'count' ? ' (‘개수’ 묶음은 장면을 넘을 수 있음)' : ''} · 프롬프트 전체 {tokens(data.promptTokens)} 토큰(추정)
        </p>
      </div>

      <Group title="이 줄보다 앞서 포함된 대사">
        {!data.preceding ? (
          <p className="text-sm text-muted-foreground">
            {data.precedingLines === 0 ? '넣지 않습니다.' : '따로 넣지 않습니다.'}
          </p>
        ) : (
          <div className="space-y-2 rounded-md border p-2">
            {data.preceding.lines.length > 0 && <Lines lines={data.preceding.lines} />}
            {data.preceding.branches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-warning">갈래가 합쳐지는 곳입니다. 플레이어는 이 중 한 갈래를 거쳐 왔습니다.</p>
                {data.preceding.branches.map((branch) => (
                  <div key={branch.label}>
                    <Badge variant="outline" className="mb-1 px-1.5 py-0 text-xs">
                      {branch.label}
                    </Badge>
                    <Lines lines={branch.lines} />
                  </div>
                ))}
                {data.preceding.moreBranches > 0 && <p className="text-xs text-muted-foreground">그 밖의 갈래 {data.preceding.moreBranches}개는 넣지 않았습니다.</p>}
              </div>
            )}
          </div>
        )}
      </Group>

      <Group title="묶음 전체에 넣는 문맥">
        <ContextItemList items={data.items} budget={data.budget} />
      </Group>

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-semibold text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        실제 프롬프트</CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-96 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{`${data.system}\n\n${data.prompt}`}</pre>
      </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
