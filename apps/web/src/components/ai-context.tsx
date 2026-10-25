import { useQuery } from '@tanstack/react-query';
import { CONTEXT_ITEM_KINDS, CONTEXT_PRIORITY, type ContextItem } from '@tw/shared';
import { Badge, Box, Group, Inline, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Text } from '@loca/ui';
import { PromptView, useRequestPreview } from '@/components/workflow/node-config/request-preview';
import { q } from '@/lib/queries';

const tokens = (value: number) => `약 ${value.toLocaleString()}`;

/** What went into an AI call besides the lines: grouped in fill order, dropped items struck through. */
export function ContextItemList({ items, budget }: { items: ContextItem[]; budget?: { limit: number; used: number } }) {
  if (!items.length) return <Text as="p" variant="body" tone="muted">현재 줄 외에 따로 넣은 문맥이 없습니다.</Text>;
  const dropped = items.filter((item) => !item.included);
  return (
    <Box spaceY="comfortable">
      {budget && (
        <Text as="p" variant="caption" tone="muted">
          문맥 {tokens(budget.used)} / 상한 {budget.limit.toLocaleString()} 토큰 (추정)
          {dropped.length > 0 && <Text tone="warning"> · 상한을 넘어 {dropped.length}개를 뺌</Text>}
        </Text>
      )}
      {CONTEXT_PRIORITY.map((kind) => {
        const group = items.filter((item) => item.kind === kind);
        if (!group.length) return null;
        return (
          <Group key={kind} title={<>{CONTEXT_ITEM_KINDS[kind]} <Text weight="normal" tone="muted" tabular>{group.length}</Text></>}>
            <Box as="ul" spaceY="snug">
              {group.map((item, index) => (
                <Box as="li" key={`${item.label}-${index}`} radius="md" border="all" paddingX="cozy" paddingY="condensed" variant="body" background={item.included ? undefined : 'muted'} tone={item.included ? undefined : 'muted'}>
                  <Inline gap="condensed">
                    <Text minWidth={0} grow truncate weight="medium" lineThrough={!item.included} title={item.label}>
                      {item.label}
                    </Text>
                    {!item.included && (
                      <Box asChild paddingX="snug" paddingY="none" variant="caption" tone="warning">
                        <Badge variant="outline">
                          상한 초과
                        </Badge>
                      </Box>
                    )}
                    <Text shrink={false} variant="caption" tabular tone="muted">{tokens(item.tokens)}</Text>
                  </Inline>
                  <Text as="p" marginTop="hair" variant="caption" tone="muted">{item.reason}</Text>
                </Box>
              ))}
            </Box>
          </Group>
        );
      })}
    </Box>
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
  if (workflows.data && !choices.length) return <Text as="p" variant="body" tone="muted">AI 노드가 있는 대사 워크플로가 없습니다.</Text>;
  return (
    <Box spaceY="condensed">
      {picked && (
        <Select value={picked.value} onValueChange={onAiNode}>
          <Box asChild width="full"><SelectTrigger size="sm" aria-label="프롬프트를 볼 AI 노드">
            <SelectValue />
          </SelectTrigger></Box>
          <SelectContent>
            {choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {request.isError ? <Text as="p" variant="body" tone="danger">{request.error.message}</Text> : !request.data ? <Box asChild height={40}><Skeleton /></Box> : <PromptView request={request.data} title={`AI 프롬프트 · ${unitKey} · ${picked?.label ?? ''}`} />}
    </Box>
  );
}
