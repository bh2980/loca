/** 모으기: waits for every request of the step before it and passes their results on as one combined result. */
import { nodeName, previousSteps } from '@tw/shared';
import { Field, ToggleRow, outputFieldNames, type NodeRefs } from '@/components/workflow/node-config/shared';
import type { WorkflowNode } from '@tw/shared';

type GatherNode = Extract<WorkflowNode, { type: 'gather' }>;

export function GatherConfig({ node, refs, onChange }: { node: GatherNode; refs: NodeRefs; onChange: (node: WorkflowNode) => void }) {
  const steps = previousSteps({ nodes: refs.nodes, edges: refs.edges ?? [] }, node.id);
  // The results' top-level fields, plus deeper paths already set (e.g. people.name, set from the CLI or a template).
  const names = [...new Set([...steps.flatMap(outputFieldNames), ...node.config.fields])];
  const set = (patch: Partial<GatherNode['config']>) => onChange({ ...node, config: { ...node.config, ...patch } });
  return (
    <>
      <p className="text-sm text-muted-foreground">앞 단계의 요청이 모두 끝나면 결과를 모아 하나로 넘깁니다. 모은 뒤에는 대사·용어가 아니라 합친 결과 하나가 흐릅니다.</p>
      <Field label="모을 결과">
        <p className="text-sm">{steps.length ? `← ${steps.map(nodeName).join(', ')}` : '앞 단계에 결과를 내는 노드가 없습니다. AI·스크립트 노드 뒤에 이으세요.'}</p>
      </Field>
      {steps.length > 0 && names.length > 0 && (
        <Field label="남길 필드" hint="하나도 고르지 않으면 결과 전체를 모읍니다.">
          <div className="space-y-2">
            {names.map((name) => (
              <ToggleRow key={name} label={name} checked={node.config.fields.includes(name)} onChange={(on) => set({ fields: on ? [...node.config.fields, name] : node.config.fields.filter((field) => field !== name) })} />
            ))}
          </div>
        </Field>
      )}
    </>
  );
}
