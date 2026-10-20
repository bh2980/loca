import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AI_OUTPUTS, CONTEXT_ITEM_KINDS, CONTEXT_PRIORITY, INPUT_TYPES, JSON_FIELD_TYPE_LABELS, type AiNode } from '@tw/shared';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Input, InspectorSection, Skeleton } from '@loca/ui';
import { client, unwrap } from '@/lib/api';

/** One folded part: its name and size are visible, the content opens on demand. */
function Part({ title, size, children }: { title: string; size: ReactNode; children: ReactNode }) {
  return (
    <Collapsible className="border-b border-border-subtle last:border-b-0">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 py-2 text-left text-sm">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{size}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3 pl-5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * 보낼 내용: what this AI node sends in one request for a sample item, read from the saved workflow
 * (no model call). The summary line gives its size; each part opens on demand, so a long script
 * never shows more than one request, and the full text is the last part.
 */
export function RequestPreview({ workflowId, node }: { workflowId?: string; node: AiNode }) {
  const [draft, setDraft] = useState('');
  const [sample, setSample] = useState<string | undefined>();
  const request = useQuery({
    queryKey: ['workflows', 'request-preview', workflowId, node.id, sample ?? ''],
    queryFn: () => unwrap(client.workflows[':id'].nodes[':nodeId'].request.$get({ param: { id: workflowId!, nodeId: node.id }, query: sample ? { sample } : {} })),
    enabled: Boolean(workflowId),
  });
  if (!workflowId) return null;
  const data = request.data;
  const unit = data ? INPUT_TYPES[data.subject].unit : '';
  const byKind = CONTEXT_PRIORITY.map((kind) => ({ kind, items: (data?.context ?? []).filter((item) => item.kind === kind && item.included) })).filter((group) => group.items.length);
  return (
    <InspectorSection title="보낼 내용">
      <div className="space-y-2">
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            setSample(draft.trim() || undefined);
          }}
        >
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={data?.subject === 'terms' ? '용어 id (비우면 첫 용어)' : '대사 키 (비우면 첫 대사)'} aria-label="샘플" className="h-8 text-sm" />
          <Button type="submit" size="sm" variant="outline">보기</Button>
        </form>
        {request.isError ? (
          <p className="text-sm text-destructive">{request.error.message}</p>
        ) : !data ? (
          <Skeleton className="h-24" />
        ) : !data.sample ? (
          <p className="text-sm text-muted-foreground">보낼 항목이 없습니다.</p>
        ) : (
          <>
            <p className="text-sm">
              <b className="font-medium">{data.sample.label}</b>이(가) 든 요청 1건: {data.total.toLocaleString()}{unit} · 약 {data.promptTokens.toLocaleString()} 토큰
            </p>
            <p className="text-xs text-muted-foreground">저장된 워크플로 기준입니다. 실제 실행에서는 범위에 따라 같은 요청에 드는 항목이 달라집니다.</p>
            <div>
              <Part title="지시문" size={`${data.instructions.length.toLocaleString()}자`}>
                <p className="text-sm whitespace-pre-wrap">{data.instructions || '비어 있음'}</p>
              </Part>
              <Part title="답 형식" size={data.output === 'json' ? `칸 ${data.fields.length}개` : AI_OUTPUTS[data.output].label}>
                {data.output === 'json' ? (
                  <ul className="space-y-1 text-sm">
                    {data.fields.map((field) => (
                      <li key={field.name}>
                        <span className="font-medium">{field.name}</span> <span className="text-xs text-muted-foreground">{JSON_FIELD_TYPE_LABELS[field.type]}</span>
                        {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{AI_OUTPUTS[data.output].description}</p>
                )}
              </Part>
              <Part title="문맥" size={byKind.length ? byKind.map((group) => `${CONTEXT_ITEM_KINDS[group.kind]} ${group.items.length}`).join(' · ') : '없음'}>
                {byKind.length ? (
                  <div className="space-y-2">
                    {byKind.map((group) => (
                      <div key={group.kind}>
                        <p className="text-xs font-medium">{CONTEXT_ITEM_KINDS[group.kind]}</p>
                        <ul className="text-sm text-muted-foreground">
                          {group.items.slice(0, 20).map((item, index) => <li key={`${item.label}-${index}`} className="truncate" title={item.reason}>{item.label}</li>)}
                          {group.items.length > 20 && <li className="text-xs">외 {(group.items.length - 20).toLocaleString()}개</li>}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">항목 외에 넣는 문맥이 없습니다.</p>
                )}
              </Part>
              <Part title="항목" size={`${data.total.toLocaleString()}${unit}`}>
                <ul className="space-y-1 text-sm">
                  {data.items.map((item) => (
                    <li key={item.label} className="truncate">
                      <span className="text-xs text-muted-foreground">{item.label}</span> {item.text}
                    </li>
                  ))}
                  {data.total > data.items.length && <li className="text-xs text-muted-foreground">외 {(data.total - data.items.length).toLocaleString()}{unit}</li>}
                </ul>
              </Part>
              <Part title="원문 그대로" size="AI에게 가는 글 전체">
                <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{`${data.system}\n\n${data.prompt}`}</pre>
              </Part>
            </div>
          </>
        )}
      </div>
    </InspectorSection>
  );
}
