/** 재시도 규칙: how an AI node sends lines that failed back to itself, smaller, after a wait, or on another model. */
import { Trash2, Plus } from 'lucide-react';
import { Box, Button, ExpandableRow, NumberInput, SelectField, SelectItem, Stack, Text, Field } from '@loca/ui';
import { ITEM_ERROR_KINDS, ITEM_ERROR_KIND_IDS, RETRY_KIND_GROUPS, RETRY_SCALES, retryAction, retryRuleSchema, retryScaleTo, retryWaitText, retryWhen, type RetryRule } from '@tw/shared';
import { ModelPicker } from '@/components/model-picker';
import { CheckItem } from '@/components/workflow/node-config/shared';

const MAX_RULES = 5;

/** One rule's fields. */
function RetryRuleFields({ id, rule, onChange }: { id: string; rule: RetryRule; onChange: (rule: RetryRule) => void }) {
  const { kinds, scale, maxTimes, wait, model } = rule;
  const set = (patch: Partial<RetryRule>) => onChange({ ...rule, ...patch });
  // A rule saved with another ratio keeps it until the person picks one of these.
  const scales = (RETRY_SCALES as readonly number[]).includes(scale) ? RETRY_SCALES : [...RETRY_SCALES, scale];
  return (
    <>
      <Field label="다시 보낼 오류" description="고른 오류로 실패한 대사만 이 규칙이 다시 보냅니다." help="오류 종류는 AI 요청이 실패할 때 정해집니다. 출력 잘림은 답이 모델의 출력 한도에서 끊긴 경우, 사용량 한도는 API의 요청 한도나 구독 사용량이 다 찬 경우, 연결 끊김은 네트워크나 CLI 연결이 끊긴 경우입니다. 어느 규칙도 받지 않는 오류는 '오류' 출구로 나갑니다.">
        <Box spaceY="condensed">
          {RETRY_KIND_GROUPS.map((group) => (
            <Box key={group.name} spaceY="tight">
              <Text as="p" variant="caption" tone="muted">{group.name}</Text>
              <Stack direction="row" wrap gapX="comfortable" gapY="condensed">
                {group.kinds.map((kind) => (
                  <CheckItem key={kind} id={`${id}-${kind}`} label={ITEM_ERROR_KINDS[kind]} checked={kinds.includes(kind)} onChange={(on) => set({ kinds: ITEM_ERROR_KIND_IDS.filter((other) => (other === kind ? on : kinds.includes(other))) })} />
                ))}
              </Stack>
            </Box>
          ))}
        </Box>
      </Field>
      <Field label="한 번에 보내는 양" description="다시 보낼 때 요청 하나에 묶는 양입니다." help="출력 잘림이나 시간 초과는 작은 요청이면 풀릴 때가 많습니다. 다시 실패해 또 보내면 거듭 줄어듭니다. 사용량 한도·연결 끊김처럼 요청 크기와 상관없는 오류는 '그대로'가 맞습니다.">
        <SelectField value={String(scale)} onValueChange={(next) => set({ scale: Number(next) })}>
          {scales.map((option) => <SelectItem key={option} value={String(option)}>{option >= 1 ? '그대로' : retryScaleTo(option)}</SelectItem>)}
        </SelectField>
      </Field>
      <Field label="기다릴 시간(초)" description={wait > 0 ? `지금: ${retryWaitText(wait)} 뒤에 보냅니다.` : '0이면 바로 다시 보냅니다.'} help="오류가 난 뒤 이 시간이 지나야 다시 보냅니다. 기다리는 동안 실행은 멈추지 않고, 이 대사들만 시간이 될 때까지 쉽니다. 일시정지하거나 취소해도 그대로 동작합니다.">
        <Box asChild width="field"><NumberInput min={0} max={3600} value={wait} onValueChange={(next) => next !== undefined && set({ wait: next })} /></Box>
      </Field>
      <Field label="모델" description="다시 보낼 때 쓸 모델입니다." help="'같은 모델'은 AI 노드에 정한 모델로 보냅니다. 다른 모델을 고르면 이 대사들만 그 모델로 다시 보냅니다. 모델이 같은 대사끼리 묶어 보냅니다.">
        <Box spaceY="condensed">
          <SelectField value={model ? 'other' : 'same'} onValueChange={(next) => set({ model: next === 'other' ? { connectionId: '', model: '' } : null })}>
            <SelectItem value="same">같은 모델</SelectItem>
            <SelectItem value="other">다른 모델</SelectItem>
          </SelectField>
          {model && <ModelPicker need={['generate', 'judge']} value={model} onChange={(next) => set({ model: next })} />}
        </Box>
      </Field>
      <Field label="최대 횟수" description="1~5번." help="한 대사를 이 규칙으로 다시 보내는 횟수입니다. 규칙마다 따로 셉니다. 다 쓰면 다음 규칙이 받고, 받을 규칙이 없으면 '오류' 출구로 나갑니다.">
        <Box asChild width="field"><NumberInput min={1} max={5} value={maxTimes} onValueChange={(next) => next !== undefined && set({ maxTimes: next })} /></Box>
      </Field>
    </>
  );
}

/**
 * The rules in order, each a row that says when it acts and what it does, and opens to its fields: a failure goes to the
 * first rule that takes its kind and has times left. Up to five.
 */
export function RetryRules({ id, rules, onChange }: { id: string; rules: RetryRule[]; onChange: (rules: RetryRule[]) => void }) {
  return (
    <Box spaceY="condensed">
      {rules.length > 0 && (
        <div>
          {rules.map((rule, index) => (
            <ExpandableRow
              key={index}
              ruled
              toggle="chevron"
              label={`규칙 ${index + 1} 편집`}
              summary={
                <Box minWidth={0} paddingY="tight">
                  <Text as="p" breakWords="keep">{retryWhen(rule)}</Text>
                  <Text as="p" variant="caption" tone="muted" breakWords="keep">{retryAction(rule)}</Text>
                </Box>
              }
              meta={<Button variant="ghost" size="icon-xs" aria-label={`규칙 ${index + 1} 삭제`} title="삭제" onClick={() => onChange(rules.filter((_, at) => at !== index))}><Trash2 /></Button>}
            >
              <Box spaceY="normal">
                <RetryRuleFields id={`${id}-${index}`} rule={rule} onChange={(next) => onChange(rules.map((other, at) => (at === index ? next : other)))} />
              </Box>
            </ExpandableRow>
          ))}
        </div>
      )}
      <Button variant="ghost" disabledReason={rules.length >= MAX_RULES && `규칙은 ${MAX_RULES}개까지 둘 수 있습니다.`} onClick={() => onChange([...rules, retryRuleSchema.parse({})])}>
        <Plus /> 규칙 추가
      </Button>
    </Box>
  );
}
