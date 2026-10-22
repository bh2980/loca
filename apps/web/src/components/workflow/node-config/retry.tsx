/** 재요청: sends lines that failed back to the AI node, smaller, after a wait, or on another model. */
import { NumberInput, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@loca/ui';
import { ITEM_ERROR_KINDS, ITEM_ERROR_KIND_IDS, retryScaleText, retrySummary, type WorkflowNode } from '@tw/shared';
import { ModelPicker } from '@/components/model-picker';
import { CheckItem, Field } from '@/components/workflow/node-config/shared';

type RetryNode = Extract<WorkflowNode, { type: 'retry' }>;

export function RetryConfig({ node, onChange }: { node: RetryNode; onChange: (node: WorkflowNode) => void }) {
  const { kinds, scale, maxTimes, wait, model } = node.config;
  const set = (patch: Partial<RetryNode['config']>) => onChange({ ...node, config: { ...node.config, ...patch } });
  return (
    <>
      <p className="text-xs text-muted-foreground">{retrySummary(node.config)}</p>
      <Field label="다시 보낼 오류" hint="고른 오류로 실패한 대사만 다시 보냅니다. 나머지는 '오류' 출구로 나갑니다." help="오류 종류는 대사가 AI 노드의 '오류' 출구로 나올 때 정해집니다. 출력 잘림은 답이 모델의 출력 한도에서 끊긴 경우, 사용량 한도는 API의 요청 한도나 구독 사용량이 다 찬 경우, 연결 끊김은 네트워크나 CLI 연결이 끊긴 경우입니다. '오류' 출구에 재요청을 하나 더 이어 다른 오류를 따로 다룰 수 있습니다.">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ITEM_ERROR_KIND_IDS.map((kind) => (
            <CheckItem key={kind} id={`retry-${node.id}-${kind}`} label={ITEM_ERROR_KINDS[kind]} checked={kinds.includes(kind)} onChange={(on) => set({ kinds: ITEM_ERROR_KIND_IDS.filter((id) => (id === kind ? on : kinds.includes(id))) })} />
          ))}
        </div>
      </Field>
      <Field label="크기 비율" hint={`0.1~1. 지금: ${retryScaleText(scale)}`} help="다시 보낼 때 AI 노드의 요청 크기에 곱합니다. 다시 실패해 또 보내면 이 비율이 거듭 곱해져 더 작아집니다. 1은 크기를 바꾸지 않습니다(사용량 한도·연결 끊김처럼 요청 크기와 상관없는 오류).">
        <NumberInput integer={false} min={0.1} max={1} step={0.1} className="w-28" value={scale} onValueChange={(next) => next !== undefined && set({ scale: next })} />
      </Field>
      <Field label="기다릴 시간(초)" hint="0이면 바로 다시 보냅니다." help="오류가 난 뒤 이 시간이 지나야 다시 보냅니다. 기다리는 동안 실행은 멈추지 않고, 이 대사들만 시간이 될 때까지 쉽니다. 일시정지하거나 취소해도 그대로 동작합니다.">
        <NumberInput min={0} max={3600} className="w-28" value={wait} onValueChange={(next) => next !== undefined && set({ wait: next })} />
      </Field>
      <Field label="모델" hint="다시 보낼 때 쓸 모델입니다." help="'같은 모델'은 AI 노드에 정한 모델(여러 개면 그 모델들)로 보냅니다. 다른 모델을 고르면 이 대사들만 그 모델로 같은 AI 노드에 다시 보냅니다. 모델이 같은 대사끼리 묶어 보냅니다.">
        <div className="space-y-1.5">
          <Select value={model ? 'other' : 'same'} onValueChange={(next) => set({ model: next === 'other' ? { connectionId: '', model: '' } : null })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="same">같은 모델</SelectItem>
              <SelectItem value="other">다른 모델</SelectItem>
            </SelectContent>
          </Select>
          {model && <ModelPicker need={['generate', 'judge']} value={model} onChange={(next) => set({ model: next })} />}
        </div>
      </Field>
      <Field label="최대 횟수" hint="1~5번." help="한 대사를 이 노드에서 다시 보내는 횟수입니다. 재요청을 이어 두면 노드마다 따로 셉니다. 넘으면 '오류' 출구로 나갑니다.">
        <NumberInput min={1} max={5} className="w-28" value={maxTimes} onValueChange={(next) => next !== undefined && set({ maxTimes: next })} />
      </Field>
    </>
  );
}
