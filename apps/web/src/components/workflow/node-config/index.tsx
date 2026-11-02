/** Edits one workflow node's config; the node kinds live beside this file. */
import { RequestPreview } from './request-preview';
import { Trash2 } from 'lucide-react';
import { INPUT_TYPES, NODE_TYPES, nodeName, nodePorts, WORKFLOW_SUBJECT_IDS, type WorkflowSubject, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
import { Button, Icon as GlyphIcon, SelectField, SelectItem, Inspector, Text, InspectorHeader, Input, Section, Group, Field, KeyValue, KeyValueRow, Notice } from '@loca/ui';
import { nodeIcon } from '../node-view';
import { AiConfig } from '@/components/workflow/node-config/ai';
import { ConditionEditor } from '@/components/workflow/node-config/condition';
import { GatherConfig } from '@/components/workflow/node-config/gather';
import { CallConfig } from '@/components/workflow/node-config/call';
import { RetryConfig } from '@/components/workflow/node-config/retry';
import { FunctionConfig } from '@/components/workflow/node-config/function';
import { type NodeRefs } from '@/components/workflow/node-config/shared';

export type { NodeRefs };

/**
 * Edits one node, in one scroll: what is wrong first, then 기본 → the kind's own settings (an AI node's
 * 지시문 · 입력 · 출력 · 문맥 · 고급, and the prompt it sends) → 연결. Every change goes straight into the
 * draft; saving is separate.
 */
export function NodeConfig({ node, issues, refs, readOnly, onChange, onDelete, onClose }: {
  node: WorkflowNode;
  issues: WorkflowIssue[];
  refs: NodeRefs;
  readOnly?: boolean;
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const Glyph = nodeIcon(node);
  const incoming = refs.edges?.filter((edge) => edge.target === node.id) ?? [];
  const outgoing = refs.edges?.filter((edge) => edge.source === node.id) ?? [];
  const outgoingPorts = nodePorts(node);

  return (
    <Inspector bare flush footerStart={!readOnly && node.type !== 'entry' ? (<><Button variant="ghost" tone="danger" onClick={onDelete}>
                <Trash2 /> 노드 삭제
              </Button></>) : undefined}
      header={<InspectorHeader icon={<GlyphIcon icon={Glyph} size="md" marginTop="hair" shrink={false} tone="muted" />} kind={NODE_TYPES[node.type].label} name={nodeName(node)} onClose={onClose} />}
    >
      {issues.length > 0 && (
        <Section>
          <Notice tone={issues.some((issue) => issue.level === 'error') ? 'danger' : 'warning'} role="alert">
            {issues.map((issue, index) => <Text as="p" key={index}><Text weight="medium">{issue.level === 'error' ? '오류' : '경고'} · </Text>{issue.message}</Text>)}
          </Notice>
        </Section>
      )}
      <Field.Set disabled={readOnly}>
          <Section title="기본">
            <Field label="이름">
              <Input value={node.label ?? ''} placeholder={nodeName({ ...node, label: undefined } as WorkflowNode)} onChange={(event) => onChange({ ...node, label: event.target.value || undefined })} />
            </Field>
            {node.type === 'ai' && <AiConfig part="model" node={node} refs={refs} onChange={onChange} />}
            {node.type === 'entry' && (
              <>
                <Field label="입력" help="이 워크플로가 다루는 것입니다. 노드마다 이 입력에 맞는 칸과 노드만 보입니다. 어떤 대사·용어를 넣을지는 실행할 때 고릅니다.">
                  <SelectField value={node.config.input} onValueChange={(input) => onChange({ ...node, config: { ...node.config, input: input as WorkflowSubject } })}>
                    {WORKFLOW_SUBJECT_IDS.map((id) => <SelectItem key={id} value={id}>{INPUT_TYPES[id].label}</SelectItem>)}
                  </SelectField>
                </Field>
              </>
            )}
          </Section>

          {node.type === 'ai' ? (
            <AiConfig part="rest" node={node} refs={refs} onChange={onChange} />
          ) : node.type === 'function' || node.type === 'condition' || node.type === 'gather' || node.type === 'retry' || node.type === 'call' ? (
            <Section title={NODE_TYPES[node.type].label}>
              {node.type === 'function' && <FunctionConfig node={node} refs={refs} readOnly={readOnly} onChange={onChange} />}
              {node.type === 'gather' && <GatherConfig node={node} refs={refs} onChange={onChange} />}
              {node.type === 'retry' && <RetryConfig node={node} onChange={onChange} />}
              {node.type === 'call' && <CallConfig node={node} refs={refs} onChange={onChange} />}
              {node.type === 'condition' && <ConditionEditor node={node} nodes={refs.nodes} refs={refs} readOnly={readOnly} onChange={onChange} />}
            </Section>
          ) : null}
      </Field.Set>

      {node.type === 'ai' && <RequestPreview projectId={refs.projectId} workflowId={refs.workflowId} node={node} />}

      {/* Which nodes it is joined to, by port: the lines on the canvas, read as names. */}
      <Section title="연결" collapsible persistKey="node.links">
        <Group title="들어오는 선">
            {node.type === 'entry' && (
              <KeyValue>
                <KeyValueRow label="입력">{INPUT_TYPES[node.config.input].label}</KeyValueRow>
              </KeyValue>
            )}
            {refs.edges ? incoming.length ? (
              <KeyValue>
                {incoming.map((edge) => {
                  const source = refs.nodes.find((item) => item.id === edge.source);
                  const port = source && nodePorts(source).find((item) => item.id === edge.sourceHandle);
                  return (
                    <KeyValueRow key={edge.id} label={port?.label ?? edge.sourceHandle}>
                      <Text display="block" breakWords title={source ? nodeName(source) : edge.source}>
                        {source ? nodeName(source) : `삭제된 노드 (${edge.source})`}
                      </Text>
                    </KeyValueRow>
                  );
                })}
              </KeyValue>
            ) : <Text as="p" variant="body" tone="muted">연결된 입력이 없습니다.</Text> : <Text as="p" variant="body" tone="muted">연결 정보를 불러올 수 없습니다.</Text>}
        </Group>
        <Group title="나가는 출구">
            <KeyValue>
              {outgoingPorts.length ? outgoingPorts.map((port) => {
                const targets = outgoing.filter((edge) => edge.sourceHandle === port.id).map((edge) => refs.nodes.find((item) => item.id === edge.target));
                return (
                  <KeyValueRow key={port.id} label={port.label}>
                    {targets.length ? (
                      targets.map((target, index) => (
                        <Text key={`${target?.id ?? index}`} display="block" breakWords title={target ? nodeName(target) : '삭제된 노드'}>
                          {target ? nodeName(target) : '삭제된 노드'}
                        </Text>
                      ))
                    ) : (
                      <Text tone="muted">연결 없음</Text>
                    )}
                  </KeyValueRow>
                );
              }) : <KeyValueRow label="출구">없음</KeyValueRow>}
            </KeyValue>
        </Group>
      </Section>
    </Inspector>
  );
}
