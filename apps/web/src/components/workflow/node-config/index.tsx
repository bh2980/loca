/** Edits one workflow node's config; the node kinds live beside this file. */
import { useState } from 'react';
import { RequestPreview } from './request-preview';
import { Trash2 } from 'lucide-react';
import { AI_OUTPUTS, AI_SCOPES, CHOICE_SOURCES, INPUT_TYPES, JSON_FIELD_TYPE_LABELS, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, NODE_TYPES, nodeName, nodePorts, TERM_MARK_IDS, WORKFLOW_SUBJECT_IDS, type AutoMark, type JsonField, type WorkflowSubject, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { Box, Button, Icon as GlyphIcon, SelectField, SelectItem, Inspector, Text, InspectorHeader, InspectorList, InspectorTabs, StatusIcon, Checkbox, Input, ListItem, Section, Field, KeyValue, KeyValueRow, SectionHeading } from '@loca/ui';
import { nodeIcon } from '../node-view';
import { AiConfig } from '@/components/workflow/node-config/ai';
import { ConditionEditor } from '@/components/workflow/node-config/condition';
import { GatherConfig } from '@/components/workflow/node-config/gather';
import { CallConfig } from '@/components/workflow/node-config/call';
import { RetryConfig } from '@/components/workflow/node-config/retry';
import { FunctionConfig } from '@/components/workflow/node-config/function';
import { type NodeRefs } from '@/components/workflow/node-config/shared';

export type { NodeRefs };

/** Nested fields as flat rows: a list's item fields are indented under it. */
const fieldRows = (fields: JsonField[], depth = 0): { key: string; label: string; description: string }[] =>
  fields.flatMap((field, index) => [
    { key: `${depth}:${field.name}:${index}`, label: `${'· '.repeat(depth)}${field.name} · ${JSON_FIELD_TYPE_LABELS[field.type]}`, description: field.description || '설명 없음' },
    ...(field.type === 'list' ? fieldRows(field.fields ?? [], depth + 1) : []),
  ]);
export type NodeConfigTab = 'settings' | 'io' | 'errors';

/** Edits one node. Every change goes straight into the draft; saving is separate. */
export function NodeConfig({ node, issues, refs, readOnly, onChange, onDelete, onClose, tab, onTab }: {
  node: WorkflowNode;
  issues: WorkflowIssue[];
  refs: NodeRefs;
  readOnly?: boolean;
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onClose: () => void;
  tab?: NodeConfigTab;
  onTab?: (tab: NodeConfigTab) => void;
}) {
  const [localTab, setLocalTab] = useState<NodeConfigTab>('settings');
  const activeTab = tab ?? localTab;
  const changeTab = onTab ?? setLocalTab;
  const Glyph = nodeIcon(node);
  const incoming = refs.edges?.filter((edge) => edge.target === node.id) ?? [];
  const outgoing = refs.edges?.filter((edge) => edge.source === node.id) ?? [];
  const outgoingPorts = nodePorts(node);

  return (
    <Inspector bare flush footerStart={!readOnly && node.type !== 'entry' ? (<><Button variant="ghost" tone="danger" onClick={onDelete}>
                <Trash2 /> 노드 삭제
              </Button></>) : undefined}
      header={<InspectorHeader icon={<GlyphIcon icon={Glyph} size="md" marginTop="hair" shrink={false} tone="muted" />} kind={NODE_TYPES[node.type].label} name={nodeName(node)} onClose={onClose} />}
      tabs={<InspectorTabs<NodeConfigTab> value={activeTab} onChange={changeTab} items={[{ value: 'settings', label: '설정' }, { value: 'io', label: '입출력' }, { value: 'errors', label: issues.length ? `오류 ${issues.length}` : '오류' }]} />}
    >
      {activeTab === 'settings' && (
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
      )}

      {activeTab === 'io' && (
        <Box minWidth={0}>
          {node.type === 'ai' && <RequestPreview projectId={refs.projectId} workflowId={refs.workflowId} node={node} />}
          <Section title="입력">
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
          </Section>
          <Section title="출력">
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
            {node.type === 'condition' && <KeyValue><KeyValueRow label="조건">{node.config.description || '조건식'}</KeyValueRow></KeyValue>}
            {node.type === 'ai' && (
              <Box marginTop="normal" spaceY="condensed">
                <SectionHeading level="group">결과 · {AI_OUTPUTS[node.config.output].label}</SectionHeading>
                {node.config.output === 'json' && <KeyValue><KeyValueRow label="출력 단위">{AI_SCOPES[node.config.scope]}</KeyValueRow>{fieldRows(node.config.fields).map((row) => <KeyValueRow key={row.key} label={row.label}>{row.description}</KeyValueRow>)}</KeyValue>}
                {node.config.output === 'choice' && <KeyValue><KeyValueRow label="선택지">{node.config.choice.source === 'custom' ? node.config.choice.values.join(' · ') || '없음' : CHOICE_SOURCES[node.config.choice.source]}</KeyValueRow><KeyValueRow label="없음 허용">{node.config.choice.allowNone ? '예' : '아니오'}</KeyValueRow></KeyValue>}
              </Box>
            )}
          </Section>
        </Box>
      )}

      {activeTab === 'errors' && (
        <Section>
          {issues.length === 0 ? <Text as="p" variant="body" tone="muted">현재 설정에서 발견된 문제가 없습니다.</Text> : (
            <InspectorList>
              {issues.map((issue, index) => <ListItem key={index} paddingY="condensed" variant="body" tone={issue.level === 'error' ? 'danger' : 'warning'}><Text weight="medium">{issue.level === 'error' ? '오류' : '경고'} · </Text>{issue.message}</ListItem>)}
            </InspectorList>
          )}
        </Section>
      )}
    </Inspector>
  );
}
