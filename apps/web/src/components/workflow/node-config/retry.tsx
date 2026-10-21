/** 재요청: sends lines that failed back to an AI node, in smaller requests. */
import { NumberInput } from '@loca/ui';
import { ITEM_ERROR_KINDS, ITEM_ERROR_KIND_IDS, type WorkflowNode } from '@tw/shared';
import { CheckItem, Field } from '@/components/workflow/node-config/shared';

type RetryNode = Extract<WorkflowNode, { type: 'retry' }>;

export function RetryConfig({ node, onChange }: { node: RetryNode; onChange: (node: WorkflowNode) => void }) {
  const { kinds, scale, maxTimes } = node.config;
  const set = (patch: Partial<RetryNode['config']>) => onChange({ ...node, config: { ...node.config, ...patch } });
  return (
    <>
      <Field label="다시 보낼 오류" hint="고른 오류로 실패한 대사만 다시 보냅니다. 나머지는 '오류' 출구로 나갑니다." help="오류 종류는 대사가 AI 노드의 '오류' 출구로 나올 때 정해집니다. 출력 잘림은 답이 모델의 출력 한도에서 끊긴 경우입니다.">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ITEM_ERROR_KIND_IDS.map((kind) => (
            <CheckItem key={kind} id={`retry-${node.id}-${kind}`} label={ITEM_ERROR_KINDS[kind]} checked={kinds.includes(kind)} onChange={(on) => set({ kinds: ITEM_ERROR_KIND_IDS.filter((id) => (id === kind ? on : kinds.includes(id))) })} />
          ))}
        </div>
      </Field>
      <Field label="크기 비율" hint="0.1~0.9. 0.5면 절반 크기로 보냅니다." help="다시 보낼 때 AI 노드의 요청 크기에 곱합니다. 다시 실패해 또 보내면 이 비율이 거듭 곱해져 더 작아집니다.">
        <NumberInput integer={false} min={0.1} max={0.9} step={0.1} className="w-28" value={scale} onValueChange={(next) => next !== undefined && set({ scale: next })} />
      </Field>
      <Field label="최대 횟수" hint="1~5번." help="한 대사를 이 노드에서 다시 보내는 횟수입니다. 넘으면 '오류' 출구로 나갑니다.">
        <NumberInput min={1} max={5} className="w-28" value={maxTimes} onValueChange={(next) => next !== undefined && set({ maxTimes: next })} />
      </Field>
    </>
  );
}
