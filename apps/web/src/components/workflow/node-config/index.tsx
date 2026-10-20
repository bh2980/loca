/** Edits one workflow node's config; the node kinds live beside this file. */
import { useState } from 'react';
import { RequestPreview } from './request-preview';
import { Trash2 } from 'lucide-react';
import { AI_OUTPUTS, AI_SCOPES, CHOICE_SOURCES, INPUT_TYPES, JSON_FIELD_TYPE_LABELS, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, NODE_TYPES, nodeName, nodePorts, TERM_MARK_IDS, WORKFLOW_SUBJECT_IDS, type AutoMark, type JsonField, type WorkflowSubject, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Inspector, InspectorHeader, InspectorBlock, InspectorList, InspectorSection, InspectorTabs, PropertyGrid, PropertyRow, StatusIcon, Checkbox, Input, GroupHeading } from '@loca/ui';
import { nodeIcon } from '../node-view';
import { AiConfig } from '@/components/workflow/node-config/ai';
import { ConditionEditor } from '@/components/workflow/node-config/condition';
import { GatherConfig } from '@/components/workflow/node-config/gather';
import { FunctionConfig } from '@/components/workflow/node-config/function';
import { Field, type NodeRefs } from '@/components/workflow/node-config/shared';

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
  const Icon = nodeIcon(node);
  const incoming = refs.edges?.filter((edge) => edge.target === node.id) ?? [];
  const outgoing = refs.edges?.filter((edge) => edge.source === node.id) ?? [];
  const outgoingPorts = nodePorts(node);

  return (
    <Inspector footerStart={!readOnly && node.type !== 'entry' ? (<><Button variant="ghost" className="text-destructive" onClick={onDelete}>
                <Trash2 /> 노드 삭제
              </Button></>) : undefined}
      className="min-w-0 border-l-0"
      header={<InspectorHeader icon={<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />} kind={NODE_TYPES[node.type].label} name={nodeName(node)} onClose={onClose} />}
      tabs={<InspectorTabs<NodeConfigTab> value={activeTab} onChange={changeTab} items={[{ value: 'settings', label: '설정' }, { value: 'io', label: '입출력' }, { value: 'errors', label: issues.length ? `오류 ${issues.length}` : '오류' }]} />}
      bodyClassName="space-y-0 p-0"
    >
      {activeTab === 'settings' && (
        <fieldset disabled={readOnly} className="min-w-0">
          <InspectorSection title="기본">
            <Field label="이름">
              <Input value={node.label ?? ''} placeholder={nodeName({ ...node, label: undefined } as WorkflowNode)} onChange={(event) => onChange({ ...node, label: event.target.value || undefined })} />
            </Field>
            {node.type === 'ai' && <AiConfig part="model" node={node} refs={refs} onChange={onChange} />}
            {node.type === 'entry' && (
              <>
                <Field label="입력" hint="이 워크플로에 들어오는 것. 노드마다 이 입력에 맞는 칸과 노드만 보입니다. 어떤 대사·용어를 넣을지는 실행할 때 고릅니다.">
                  <Select value={node.config.input} onValueChange={(input) => onChange({ ...node, config: { ...node.config, input: input as WorkflowSubject } })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{WORKFLOW_SUBJECT_IDS.map((id) => <SelectItem key={id} value={id}>{INPUT_TYPES[id].label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </>
            )}
          </InspectorSection>

          {node.type === 'ai' ? (
            <AiConfig part="rest" node={node} refs={refs} onChange={onChange} />
          ) : node.type === 'function' || node.type === 'condition' || node.type === 'gather' ? (
            <InspectorSection title={NODE_TYPES[node.type].label}>
              {node.type === 'function' && <FunctionConfig node={node} refs={refs} readOnly={readOnly} onChange={onChange} />}
              {node.type === 'gather' && <GatherConfig node={node} refs={refs} onChange={onChange} />}
              {node.type === 'condition' && <ConditionEditor node={node} nodes={refs.nodes} refs={refs} readOnly={readOnly} onChange={onChange} />}
            </InspectorSection>
          ) : null}
        </fieldset>
      )}

      {activeTab === 'io' && (
        <div className="min-w-0">
          {node.type === 'ai' && <RequestPreview projectId={refs.projectId} workflowId={refs.workflowId} node={node} />}
          <InspectorSection title="입력">
            {node.type === 'entry' && (
              <PropertyGrid>
                <PropertyRow label="입력">{INPUT_TYPES[node.config.input].label}</PropertyRow>
              </PropertyGrid>
            )}
            {refs.edges ? incoming.length ? (
              <PropertyGrid>
                {incoming.map((edge) => {
                  const source = refs.nodes.find((item) => item.id === edge.source);
                  const port = source && nodePorts(source).find((item) => item.id === edge.sourceHandle);
                  return (
                    <PropertyRow key={edge.id} label={port?.label ?? edge.sourceHandle}>
                      <span className="block break-words" title={source ? nodeName(source) : edge.source}>
                        {source ? nodeName(source) : `삭제된 노드 (${edge.source})`}
                      </span>
                    </PropertyRow>
                  );
                })}
              </PropertyGrid>
            ) : <p className="text-sm text-muted-foreground">연결된 입력이 없습니다.</p> : <p className="text-sm text-muted-foreground">연결 정보를 불러올 수 없습니다.</p>}
          </InspectorSection>
          <InspectorSection title="출력">
            <PropertyGrid>
              {outgoingPorts.length ? outgoingPorts.map((port) => {
                const targets = outgoing.filter((edge) => edge.sourceHandle === port.id).map((edge) => refs.nodes.find((item) => item.id === edge.target));
                return (
                  <PropertyRow key={port.id} label={port.label}>
                    {targets.length ? (
                      targets.map((target, index) => (
                        <span key={`${target?.id ?? index}`} className="block break-words" title={target ? nodeName(target) : '삭제된 노드'}>
                          {target ? nodeName(target) : '삭제된 노드'}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">연결 없음</span>
                    )}
                  </PropertyRow>
                );
              }) : <PropertyRow label="출구">없음</PropertyRow>}
            </PropertyGrid>
            {node.type === 'condition' && <PropertyGrid><PropertyRow label="조건">{node.config.description || '조건식'}</PropertyRow></PropertyGrid>}
            {node.type === 'ai' && (
              <div className="mt-3 space-y-2">
                <GroupHeading>결과 · {AI_OUTPUTS[node.config.output].label}</GroupHeading>
                {node.config.output === 'json' && <PropertyGrid><PropertyRow label="출력 단위">{AI_SCOPES[node.config.scope]}</PropertyRow>{fieldRows(node.config.fields).map((row) => <PropertyRow key={row.key} label={row.label}>{row.description}</PropertyRow>)}</PropertyGrid>}
                {node.config.output === 'choice' && <PropertyGrid><PropertyRow label="선택지">{node.config.choice.source === 'custom' ? node.config.choice.values.join(' · ') || '없음' : CHOICE_SOURCES[node.config.choice.source]}</PropertyRow><PropertyRow label="없음 허용">{node.config.choice.allowNone ? '예' : '아니오'}</PropertyRow></PropertyGrid>}
              </div>
            )}
          </InspectorSection>
        </div>
      )}

      {activeTab === 'errors' && (
        <InspectorBlock>
          {issues.length === 0 ? <p className="text-sm text-muted-foreground">현재 설정에서 발견된 문제가 없습니다.</p> : (
            <InspectorList>
              {issues.map((issue, index) => <li key={index} className={`py-2 text-sm first:pt-0 last:pb-0 ${issue.level === 'error' ? 'text-destructive' : 'text-warning'}`}><span className="font-medium">{issue.level === 'error' ? '오류' : '경고'} · </span>{issue.message}</li>)}
            </InspectorList>
          )}
        </InspectorBlock>
      )}
    </Inspector>
  );
}
