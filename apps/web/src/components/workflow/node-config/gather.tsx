/** 모으기: waits for every request of an earlier node and passes its answers on as one combined result. */
import { nodeName } from '@tw/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@loca/ui';
import { Field, ToggleRow, outputFieldNames, upstreamSources, type NodeRefs } from '@/components/workflow/node-config/shared';
import type { WorkflowNode } from '@tw/shared';

type GatherNode = Extract<WorkflowNode, { type: 'gather' }>;

export function GatherConfig({ node, refs, onChange }: { node: GatherNode; refs: NodeRefs; onChange: (node: WorkflowNode) => void }) {
  const sources = upstreamSources(node, refs);
  const from = sources.find((other) => other.id === node.config.from);
  // The output's top-level fields, plus deeper paths already set (e.g. people.name, set from the CLI or a template).
  const names = from ? [...new Set([...outputFieldNames(from), ...node.config.fields])] : [];
  const set = (patch: Partial<GatherNode['config']>) => onChange({ ...node, config: { ...node.config, ...patch } });
  return (
    <>
      <p className="text-sm text-muted-foreground">앞 노드의 요청이 모두 끝나면 결과를 모아 하나로 넘깁니다. 모은 뒤에는 대사·용어가 아니라 합친 결과 하나가 흐릅니다.</p>
      <Field label="모을 노드">
        <Select value={from?.id ?? ''} onValueChange={(value) => set({ from: value, fields: [] })}>
          <SelectTrigger className="w-full"><SelectValue placeholder="노드를 고르세요" /></SelectTrigger>
          <SelectContent>
            {sources.map((other) => <SelectItem key={other.id} value={other.id}>{nodeName(other)}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {from && names.length > 0 && (
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
