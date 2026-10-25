import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { AI_OUTPUTS, CONTEXT_ITEM_KINDS, CONTEXT_PRIORITY, INPUT_TYPES, JSON_FIELD_TYPE_LABELS, type AiNode, type AiOutput, type BatchConfig } from '@tw/shared';
import { Box, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Inline, RequestDetails, RequestPart as Part, Combobox, Skeleton, Text, Section } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

type Request = InferResponseType<(typeof client.workflows)[':id']['nodes'][':nodeId']['request']['$get'], 200>;

/** The request one AI node sends (no model call): the prompt itself first, then what it is made of. */
export function PromptView({ request, title }: { request: Request; title: string }) {
  const [large, setLarge] = useState(false);
  const unit = INPUT_TYPES[request.subject].unit;
  const text = `${request.system}\n\n${request.prompt}`;
  const byKind = CONTEXT_PRIORITY.map((kind) => ({ kind, items: request.context.filter((item) => item.kind === kind && item.included) })).filter((group) => group.items.length);
  if (!request.sample) return <Text as="p" variant="body" tone="muted">보낼 항목이 없습니다.</Text>;
  return (
    <Box spaceY="condensed">
      <Inline gap="condensed">
        <Text as="p" minWidth={0} grow variant="caption" tone="muted">
          요청 1건 · {request.total.toLocaleString()}{unit} · 약 {request.promptTokens.toLocaleString()} 토큰
        </Text>
        <Button variant="ghost" onClick={() => setLarge(true)}>크게 보기</Button>
      </Inline>
      <Box as="pre" maxHeight="scroll-xl" overflow="auto" radius="md" background="sunken" padding="condensed" variant="caption" preserveLines>{text}</Box>
      <Dialog open={large} onOpenChange={setLarge}>
        <DialogContent height="dialog-lg">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <Box as="pre" minHeight={0} grow overflow="auto" radius="md" background="sunken" padding="normal" variant="caption" preserveLines>{text}</Box>
        </DialogContent>
      </Dialog>
      <RequestDetails title="상세">
          <Part title="지시문" size={`${request.instructions.length.toLocaleString()}자`}>
            <Text as="p" variant="body" preserveLines>{request.instructions || '비어 있음'}</Text>
          </Part>
          <Part title="답 형식" size={request.output === 'json' ? `칸 ${request.fields.length}개` : AI_OUTPUTS[request.output].label}>
            {request.output === 'json' ? (
              <Box as="ul" spaceY="tight" variant="body">
                {request.fields.map((field) => (
                  <li key={field.name}>
                    <Text weight="medium">{field.name}</Text> <Text variant="caption" tone="muted">{JSON_FIELD_TYPE_LABELS[field.type]}</Text>
                    {field.description && <Text as="p" variant="caption" tone="muted">{field.description}</Text>}
                  </li>
                ))}
              </Box>
            ) : (
              <Text as="p" variant="body" tone="muted">{AI_OUTPUTS[request.output].description}</Text>
            )}
          </Part>
          <Part title="문맥" size={byKind.length ? byKind.map((group) => `${CONTEXT_ITEM_KINDS[group.kind]} ${group.items.length}`).join(' · ') : '없음'}>
            {byKind.length ? (
              <Box spaceY="condensed">
                {byKind.map((group) => (
                  <div key={group.kind}>
                    <Text as="p" variant="caption" weight="medium">{CONTEXT_ITEM_KINDS[group.kind]}</Text>
                    <Box as="ul" variant="body" tone="muted">
                      {group.items.slice(0, 20).map((item, index) => <Box as="li" key={`${item.label}-${index}`} truncate title={item.reason}>{item.label}</Box>)}
                      {group.items.length > 20 && <Box as="li" variant="caption">외 {(group.items.length - 20).toLocaleString()}개</Box>}
                    </Box>
                  </div>
                ))}
              </Box>
            ) : (
              <Text as="p" variant="body" tone="muted">항목 외에 넣는 문맥이 없습니다.</Text>
            )}
          </Part>
          <Part title="항목" size={`${request.total.toLocaleString()}${unit}`}>
            <Box as="ul" spaceY="tight" variant="body">
              {request.items.map((item) => (
                <Box as="li" key={item.label} truncate>
                  <Text variant="caption" tone="muted">{item.label}</Text> {item.text}
                </Box>
              ))}
              {request.total > request.items.length && <Box as="li" variant="caption" tone="muted">외 {(request.total - request.items.length).toLocaleString()}{unit}</Box>}
            </Box>
          </Part>
      </RequestDetails>
    </Box>
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
    <Combobox
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
    <Section title="AI 프롬프트">
      <Box spaceY="condensed">
        {data && <SamplePicker projectId={projectId} subject={data.subject} value={data.sample?.value} label={data.sample?.label} onPick={setSample} />}
        {request.isError ? <Text as="p" variant="body" tone="danger">{request.error.message}</Text> : !data ? <Skeleton height="placeholder-xl" /> : <PromptView request={data} title={`AI 프롬프트 · ${node.label ?? node.id}`} />}
      </Box>
    </Section>
  );
}
