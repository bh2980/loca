import { BATCH_MODE_LABELS } from '@tw/shared';

/** The part of a preflight node estimate these lines read (NodeSplit in the server's preflight). */
interface Split {
  requests: number;
  mode: string;
  linesTokens: number | null;
  budgetBy: 'node' | 'auto';
  cap: { by: 'grown' | 'cut-off'; tokens: number } | null;
  input: { tokens: number | null; by: 'human' | 'api' | null };
  output: { tokens: number | null; by: 'human' | 'api' | 'assumed' | null };
}

const SOURCE = { human: '직접 입력', api: '모델 정보', assumed: '기본값' } as const;

/** "노드 · 묶음 방식 · 요청 N회 · 한 번에 약 N토큰": how many requests a node sends. */
export function splitTitle(name: string, split: Split): string {
  const mode = BATCH_MODE_LABELS[split.mode as keyof typeof BATCH_MODE_LABELS] ?? split.mode;
  return `${name} · ${mode} · 요청 ${split.requests.toLocaleString()}회${split.linesTokens !== null ? ` · 한 번에 약 ${split.linesTokens.toLocaleString()}토큰` : ''}`;
}

/**
 * Why a node's requests are that size, as one sentence: the one thing that decided it (the node's own
 * number, a cap from past requests, missing limits, or the connection's limits), never the arithmetic.
 */
export function splitBasis(split: Split): string {
  if (split.budgetBy === 'node') return '노드에서 정한 크기입니다.';
  if (split.cap?.by === 'cut-off') return '지난 실행에서 답이 잘려 더 작게 나눕니다.';
  if (split.cap?.by === 'grown') return '지난 실행 결과를 보고 조금씩 늘리는 중입니다.';
  if (split.input.tokens === null && split.output.tokens === null) return '연결에 입력·출력 토큰이 없어 기본 크기로 나눕니다.';
  const part = (label: string, limit: { tokens: number | null; by: keyof typeof SOURCE | null }) =>
    limit.tokens === null ? [] : [`${label} ${limit.tokens.toLocaleString()}${limit.by ? ` (${SOURCE[limit.by]})` : ''}`];
  return `${[...part('입력', split.input), ...part('출력', split.output)].join(' · ')} 기준입니다.`;
}
