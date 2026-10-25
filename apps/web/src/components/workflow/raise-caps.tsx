import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import { Button, NumberInput, Spinner, NoticeRow, Field } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { resumeLimits, type Caps } from '@/lib/run-limits';

/** In the pause notice of a run a cap stopped: the caps, changeable, and a resume that takes them. */
export function RaiseCaps({ runId, limits }: { runId: string; limits: Caps & { hit?: 'calls' | 'input' } }) {
  const [calls, setCalls] = useState(limits.maxCalls);
  const [input, setInput] = useState(limits.maxInputTokens);
  const resume = useMutation({
    mutationFn: () =>
      unwrap(
        client.runs[':id'][':action{pause|resume|cancel}'].$post(
          { param: { id: runId, action: 'resume' } },
          { init: { body: JSON.stringify({ limits: resumeLimits(limits, { maxCalls: calls, maxInputTokens: input }) }), headers: { 'content-type': 'application/json' } } },
        ),
      ),
    onError: (error) => toast.error(error.message),
  });
  return (
    // In the Notice's grid, beside the icon like its title and description; the fields keep the normal text colour.
    <NoticeRow marginTop="normal" wrap align="end" gap="normal" tone="default">
      <Field width="field" label="호출 상한" description="비우면 상한 없음." help="이만큼 쓰면 실행을 멈춥니다. 지금까지 쓴 호출도 셉니다.">
        <NumberInput optional min={1} value={calls} onValueChange={setCalls} />
      </Field>
      <Field width="field-lg" label="입력 상한" description="비우면 상한 없음." help="실행 전체가 보낸 입력 토큰(캐시 포함)이 이만큼 되기 전에 멈춥니다. 지금까지 쓴 것도 셉니다.">
        <NumberInput optional min={1} value={input} onValueChange={setInput} />
      </Field>
      <Button disabled={resume.isPending} onClick={() => resume.mutate()}>
        {resume.isPending ? <Spinner /> : <Play />} 상한 늘려 재개
      </Button>
    </NoticeRow>
  );
}
