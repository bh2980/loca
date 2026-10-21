/** 워크플로 호출: runs another saved workflow of the same input at this spot. */
import { Link } from '@tanstack/react-router';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@loca/ui';
import { workflowInput, type WorkflowNode } from '@tw/shared';
import { Field, type NodeRefs } from '@/components/workflow/node-config/shared';

type CallNode = Extract<WorkflowNode, { type: 'call' }>;
/** The select's empty choice (a Select item cannot have an empty value). */
const NONE = '__none__';

export function CallConfig({ node, refs, onChange }: { node: CallNode; refs: NodeRefs; onChange: (node: WorkflowNode) => void }) {
  const input = workflowInput({ nodes: refs.nodes });
  const picked = node.config.workflowId;
  // Only workflows with the same input can be called, and not this one. A pick that no longer qualifies stays listed so it can be seen and changed.
  const choices = (refs.workflows ?? []).filter((workflow) => workflow.id !== refs.workflowId && (workflow.input === input || workflow.id === picked));
  return (
    <Field
      label="부를 워크플로"
      hint="고른 워크플로를 이 자리에서 돌립니다. 끝까지 가면 완료, 실패하면 오류로 나옵니다."
      help="실행을 시작할 때의 내용으로 돌립니다. 이 워크플로의 연속 실패·노드 방문 상한이 적용됩니다."
      action={picked && choices.some((workflow) => workflow.id === picked) ? (
        <Button variant="ghost" size="sm" asChild>
          <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId: refs.projectId, workflowId: picked }}>열기</Link>
        </Button>
      ) : undefined}
    >
      <Select value={picked || NONE} onValueChange={(workflowId) => onChange({ ...node, config: { ...node.config, workflowId: workflowId === NONE ? '' : workflowId } })}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>워크플로를 고르세요</SelectItem>
          {choices.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}
