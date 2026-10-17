/** Edits one workflow node's config; the node kinds live beside this file. */
import { Trash2 } from 'lucide-react';
import { AI_OUTPUTS, CONNECTION_KIND_INFO, FUNCTIONS, NODE_TYPES, nodeName, type FunctionName, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
import { StatusDot } from '@/components/status';
import { PaneHeader, Button, Checkbox, Input, ScrollArea } from '@loca/ui';
import { nodeIcon } from '../node-view';
import { AiConfig } from '@/components/workflow/node-config/ai';
import { ConditionEditor } from '@/components/workflow/node-config/condition';
import { FunctionConfig } from '@/components/workflow/node-config/function';
import { Field, type NodeRefs } from '@/components/workflow/node-config/shared';

export type { NodeRefs };

/** Edits one node's config. Every change goes straight into the draft; saving is separate. */
export function NodeConfig({ node, issues, refs, readOnly, onChange, onDelete, onClose }: {
  node: WorkflowNode;
  issues: WorkflowIssue[];
  refs: NodeRefs;
  readOnly?: boolean;
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const Icon = nodeIcon(node);
  const description = node.type === 'function' ? (FUNCTIONS[node.config.fn as FunctionName]?.description ?? '') : node.type === 'ai' ? AI_OUTPUTS[node.config.output].description : NODE_TYPES[node.type].description;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <PaneHeader icon={<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />} title={nodeName(node)} subtitle={description} onClose={onClose} />
      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        {/* A fieldset is as wide as its widest content by default (min-width: min-content): min-w-0 keeps it to the panel. */}
        <fieldset disabled={readOnly} className="min-w-0 space-y-5 p-4">
          {issues.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
              {issues.map((issue, index) => (
                <li key={index} className={issue.level === 'error' ? 'text-destructive' : 'text-warning'}>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          <Field label="이름" hint={<span className="font-mono">id: {node.id}</span>}>
            <Input value={node.label ?? ''} placeholder={nodeName({ ...node, label: undefined } as WorkflowNode)} onChange={(event) => onChange({ ...node, label: event.target.value || undefined })} />
          </Field>

          {node.type === 'entry' && (
            <Field label="들어올 대사의 상태" hint="선택한 상태 중 하나인 대사만 실행 대상이 됩니다. 아무것도 고르지 않으면 범위 안의 모든 대사.">
              <div className="space-y-1.5">
                {refs.statuses.map((status) => (
                  <label key={status.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={node.config.statusIds.includes(status.id)}
                      onCheckedChange={(checked) => onChange({ ...node, config: { statusIds: checked ? [...node.config.statusIds, status.id] : node.config.statusIds.filter((id) => id !== status.id) } })}
                    />
                    <StatusDot color={status.color} /> {status.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          {node.type === 'ai' && <AiConfig node={node} refs={refs} onChange={onChange} />}
          {node.type === 'function' && <FunctionConfig node={node} refs={refs} readOnly={readOnly} onChange={onChange} />}
          {node.type === 'condition' && <ConditionEditor node={node} nodes={refs.nodes} readOnly={readOnly} onChange={onChange} />}
        </fieldset>
      </ScrollArea>
      {!readOnly && node.type !== 'entry' && (
        <div className="border-t p-3">
          <Button variant="ghost" className="text-destructive" onClick={onDelete}>
            <Trash2 /> 노드 삭제
          </Button>
        </div>
      )}
    </div>
  );
}
