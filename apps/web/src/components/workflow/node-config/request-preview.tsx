import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { AI_OUTPUTS, CONTEXT_ITEM_KINDS, CONTEXT_PRIORITY, INPUT_TYPES, JSON_FIELD_TYPE_LABELS, type AiNode } from '@tw/shared';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, DialogContent, DialogHeader, DialogTitle, InspectorSection, SearchableSelect, Skeleton } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

type Request = InferResponseType<(typeof client.workflows)[':id']['nodes'][':nodeId']['request']['$get'], 200>;

/** One folded part of 상세: its name and size are visible, the content opens on demand. */
function Part({ title, size, children }: { title: string; size: ReactNode; children: ReactNode }) {
  return (
    <Collapsible className="border-b border-border-subtle last:border-b-0">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 py-2 text-left text-sm">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto truncate pl-2 text-xs text-muted-foreground tabular-nums">{size}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3 pl-5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** The request one AI node sends (no model call): the prompt itself first, then what it is made of. */
export function PromptView({ request, title }: { request: Request; title: string }) {
  const [large, setLarge] = useState(false);
  const unit = INPUT_TYPES[request.subject].unit;
  const text = `${request.system}\n\n${request.prompt}`;
  const byKind = CONTEXT_PRIORITY.map((kind) => ({ kind, items: request.context.filter((item) => item.kind === kind && item.included) })).filter((group) => group.items.length);
  if (!request.sample) return <p className="text-sm text-muted-foreground">보낼 항목이 없습니다.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          요청 1건 · {request.total.toLocaleString()}{unit} · 약 {request.promptTokens.toLocaleString()} 토큰
        </p>
        <Button size="sm" variant="ghost" onClick={() => setLarge(true)}>크게 보기</Button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">{text}</pre>
      <Dialog open={large} onOpenChange={setLarge}>
        <DialogContent className="flex h-[85vh] max-w-4xl flex-col">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{text}</pre>
        </DialogContent>
      </Dialog>
      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-semibold">
          <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          상세
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1">
          <Part title="지시문" size={`${request.instructions.length.toLocaleString()}자`}>
            <p className="text-sm whitespace-pre-wrap">{request.instructions || '비어 있음'}</p>
          </Part>
          <Part title="답 형식" size={request.output === 'json' ? `칸 ${request.fields.length}개` : AI_OUTPUTS[request.output].label}>
            {request.output === 'json' ? (
              <ul className="space-y-1 text-sm">
                {request.fields.map((field) => (
                  <li key={field.name}>
                    <span className="font-medium">{field.name}</span> <span className="text-xs text-muted-foreground">{JSON_FIELD_TYPE_LABELS[field.type]}</span>
                    {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{AI_OUTPUTS[request.output].description}</p>
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
          <Part title="항목" size={`${request.total.toLocaleString()}${unit}`}>
            <ul className="space-y-1 text-sm">
              {request.items.map((item) => (
                <li key={item.label} className="truncate">
                  <span className="text-xs text-muted-foreground">{item.label}</span> {item.text}
                </li>
              ))}
              {request.total > request.items.length && <li className="text-xs text-muted-foreground">외 {(request.total - request.items.length).toLocaleString()}{unit}</li>}
            </ul>
          </Part>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The request of one saved AI node that holds `sample` (a line key, or a term id; none = the first item). */
export function useRequestPreview(workflowId: string | undefined, nodeId: string | undefined, sample: string | undefined) {
  return useQuery({
    queryKey: ['workflows', 'request-preview', workflowId, nodeId, sample ?? ''],
    queryFn: () => unwrap(client.workflows[':id'].nodes[':nodeId'].request.$get({ param: { id: workflowId!, nodeId: nodeId! }, query: sample ? { sample } : {} })),
    enabled: Boolean(workflowId && nodeId),
    placeholderData: keepPreviousData,
  });
}

/** Which item the preview is built for: lines searched by source, translation or key on the server, terms from the glossary. */
function SamplePicker({ projectId, subject, value, label, onPick }: { projectId: string; subject: 'lines' | 'terms'; value?: string; label?: string; onPick: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const lines = useQuery({
    queryKey: ['units', 'sample-search', projectId, query],
    queryFn: () => unwrap(client.projects[':projectId'].lines.find.$post({ param: { projectId }, json: { offset: 0, limit: 30, ...(query.trim() && { q: query.trim() }) } })),
    enabled: subject === 'lines',
    placeholderData: keepPreviousData,
  });
  const terms = useQuery({ ...q.terms(projectId), enabled: subject === 'terms' });
  const options =
    subject === 'lines'
      ? (lines.data?.rows ?? []).map((row) => ({ value: row.key, label: `${row.key} · ${row.speaker ? `${row.speaker}: ` : ''}${row.translation || row.source}` }))
      : (terms.data ?? []).filter((term) => term.status !== 'rejected').map((term) => ({ value: term.id, label: term.target ? `${term.source} → ${term.target}` : term.source, searchText: `${term.source} ${term.target}` }));
  return (
    <SearchableSelect
      ariaLabel="샘플"
      value={value}
      selectedLabel={label}
      onValueChange={onPick}
      options={options}
      placeholder={subject === 'lines' ? '대사 고르기' : '용어 고르기'}
      searchPlaceholder={subject === 'lines' ? '원문·번역으로 찾기' : '원문·번역으로 찾기'}
      {...(subject === 'lines' && { onSearch: setQuery })}
    />
  );
}

/**
 * AI 프롬프트 of a node in the workflow editor: what it sends for a sample item picked from the
 * script or the glossary (no model call), read from the saved workflow.
 */
export function RequestPreview({ projectId, workflowId, node }: { projectId: string; workflowId?: string; node: AiNode }) {
  const [sample, setSample] = useState<string | undefined>();
  const request = useRequestPreview(workflowId, node.id, sample);
  if (!workflowId) return null;
  const data = request.data;
  return (
    <InspectorSection title="AI 프롬프트">
      <div className="space-y-2">
        {data && <SamplePicker projectId={projectId} subject={data.subject} value={data.sample?.value} label={data.sample?.label} onPick={setSample} />}
        {request.isError ? <p className="text-sm text-destructive">{request.error.message}</p> : !data ? <Skeleton className="h-40" /> : <PromptView request={data} title={`AI 프롬프트 · ${node.label ?? node.id}`} />}
      </div>
    </InspectorSection>
  );
}
