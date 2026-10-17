import { ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { CONTEXT_ITEM_KINDS, CONTEXT_PRIORITY, type ContextItem } from '@tw/shared';
import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { cn } from '@/lib/utils';

const tokens = (value: number) => `약 ${value.toLocaleString()}`;

/** What went into an AI call besides the lines: grouped in fill order, dropped items struck through. */
export function ContextItemList({ items, budget }: { items: ContextItem[]; budget?: { limit: number; used: number } }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">대사 말고 넣은 문맥이 없습니다.</p>;
  const dropped = items.filter((item) => !item.included);
  return (
    <div className="space-y-3">
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
          <div key={kind}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {CONTEXT_ITEM_KINDS[kind]} {group.length}
            </p>
            <ul className="space-y-1">
              {group.map((item, index) => (
                <li key={`${item.label}-${index}`} className={cn('rounded-md border px-2 py-1.5 text-xs', !item.included && 'bg-muted/40 text-muted-foreground')}>
                  <div className="flex items-center gap-2">
                    <span className={cn('min-w-0 flex-1 truncate font-medium', !item.included && 'line-through')} title={item.label}>
                      {item.label}
                    </span>
                    {!item.included && (
                      <Badge variant="outline" className="px-1.5 py-0 text-xs text-warning">
                        상한 초과로 뺌
                      </Badge>
                    )}
                    <span className="shrink-0 tabular-nums text-muted-foreground">{tokens(item.tokens)}</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{item.reason}</p>
                </li>
              ))}
            </ul>
          </div>
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
        <li key={line.key} className="text-xs">
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
export function AiContextPanel({ projectId, unitKey, aiNode, onAiNode }: { projectId: string; unitKey: string; aiNode?: string; onAiNode: (value: string) => void }) {
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
          모델을 부르지 않고, 실행할 때와 같은 방식으로 만든 문맥입니다. 이 대사가 속한 장면에서 {inBatch}줄을 한 번에 보낸다고 보고 계산했습니다
          {data.batch.mode === 'count' ? '(‘개수’ 묶음은 실제로는 장면을 넘을 수 있음)' : ''}. 실행 범위와 진입 상태에 따라 묶음이 더 작을 수 있습니다. 프롬프트 전체 {tokens(data.promptTokens)} 토큰(추정).
        </p>
      </div>

      <section>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">이 대사의 앞 대사</h3>
        {!data.preceding ? (
          <p className="text-xs text-muted-foreground">
            {data.precedingLines === 0 ? '이 노드는 앞 대사를 넣지 않도록 설정되어 있습니다.' : '따로 넣지 않습니다. 앞 대사가 같은 묶음 안에 있거나, 묶음의 더 앞 대사에 이미 붙었습니다.'}
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
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">묶음 전체에 넣는 문맥</h3>
        <ContextItemList items={data.items} budget={data.budget} />
      </section>

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        실제 프롬프트</CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-96 overflow-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">{`${data.system}\n\n${data.prompt}`}</pre>
      </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
