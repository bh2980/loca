import { contextMeter } from '@tw/shared';
import { ContextMeterView } from '@loca/ui';

export interface ChatUsage {
  lastInputTokens: number | null;
  window: number | null;
  calls: number;
  tokens: number;
  costUsd: number | null;
}

/**
 * "문맥 N%": how much of the model's window the last answer's input used. Hidden when the window
 * (or the last input) is unknown. The tooltip gives the numbers and this conversation's total.
 */
export function ContextMeter({ usage }: { usage: ChatUsage | null | undefined }) {
  const meter = usage ? contextMeter({ inputTokens: usage.lastInputTokens, window: usage.window }) : null;
  if (!usage || !meter) return null;
  return (
    <ContextMeterView percent={meter.percent} level={meter.level}>
      {meter.percent === null ? (
        <p>마지막 답은 에이전트가 여러 번 나눠 읽어 입력이 합쳐 {meter.tokens.toLocaleString()} 토큰으로 왔습니다. 한 번에 읽은 양이 아니라 문맥 창({meter.window.toLocaleString()} 토큰)이 얼마나 찼는지는 알 수 없습니다.</p>
      ) : (
        <p>
          마지막 답이 읽은 입력 {meter.tokens.toLocaleString()} / 문맥 창 {meter.window.toLocaleString()} 토큰
        </p>
      )}
      <p>
        이 대화 요청 {usage.calls.toLocaleString()}회 · 토큰 {usage.tokens.toLocaleString()}
        {usage.costUsd !== null && ` · 비용 $${usage.costUsd.toFixed(usage.costUsd < 0.01 ? 4 : 2)}`}
      </p>
      {meter.level !== 'ok' && <p>가득 차면 앞 대화를 요약해 이어갑니다.</p>}
    </ContextMeterView>
  );
}
