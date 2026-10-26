/** What went into an AI call besides the lines, why, and how big it was. Kept with every run step. */
export const CONTEXT_ITEM_KINDS = {
  term: '확정 용어',
  speech: '청자·말투',
  cast: '인물 명단',
  pair: '대화 쌍',
  preceding: '앞 대사',
  character: '인물',
  relationship: '관계',
  scene: '장면',
  previousScene: '이전 장면',
  document: '노트',
} as const;
export type ContextItemKind = keyof typeof CONTEXT_ITEM_KINDS;

/**
 * The AI context options as the editor names and explains them (a "?" beside each): one place for the
 * workflow AI node and the editor's AI settings.
 */
export const CONTEXT_FIELDS = {
  candidate: { label: '지금 번역', help: '항목의 지금 번역(용어는 지금 표기)을 함께 보냅니다. 끄면 원문만 보고 새로 번역합니다. 판정(검수) 출력은 늘 보냅니다.' },
  glossary: { label: '확정 용어', help: '보내는 원문에 나오는 확정된 용어와 그 표기를 함께 보냅니다.' },
  speech: { label: '청자·말투', help: '대사마다 누구에게 하는 말인지와, 그 화자→청자에게 확정된 말투 규칙을 보냅니다.' },
  precedingLines: { label: '앞 대사', help: '보내는 대사들 바로 앞의 대사를 원문으로 함께 보냅니다. 흐름과 말투를 이어가게 합니다.' },
  precedingTranslations: { label: '앞 대사 번역', help: '앞 대사의 지금 번역도 함께 보냅니다(상태와 상관없이 있는 그대로).' },
  previousScenes: { label: '이전 장면', help: '대사 그래프상 바로 앞 장면의 설명(가져오기 파일이나 원문 편집에서 쓴 장면 설명)을 보냅니다. 설명이 없는 장면은 보내지 않습니다.' },
  examples: { label: '나온 대사', help: '용어마다 그 용어가 나온 대사를 지금 번역과 함께 보냅니다.' },
  pairs: { label: '대화 쌍', help: '보내는 대사에서 서로 말을 주고받은 두 사람(청자가 있으면 화자→청자, 없으면 바로 이어 말한 사람)과 횟수를 보냅니다. 이 횟수 이상인 쌍만 보냅니다. 앞 단계 결과를 합치는 노드(대사를 읽지 않는 노드)에서는 이번 실행이 읽은 모든 대사에서 셉니다.' },
  cast: { label: '인물 명단', help: '확정된 인물 전체의 이름·별칭·플레이어 여부·성별·나이대를 보냅니다.' },
  characters: { label: '인물 프로필', help: '보내는 원문에 나오는 확정된 인물의 소개(프로필·말버릇·역할)를 보냅니다.' },
  relationships: { label: '인물 관계', help: '보내는 원문에 함께 나오는 인물 사이의 확정된 관계를 보냅니다.' },
  documents: { label: '노트', help: '"번역 문맥에 넣기"를 켠 확정 노트(세계관·줄거리 등)를 보냅니다.' },
} as const;

/** Filled in this order until the token cap; later kinds are dropped first. */
export const CONTEXT_PRIORITY = Object.keys(CONTEXT_ITEM_KINDS) as ContextItemKind[];

export interface ContextItem {
  kind: ContextItemKind;
  label: string;
  /** Why it was picked, in the words of the rule that picked it. */
  reason: string;
  /** Estimated tokens (UTF-8 bytes / 4). Models count differently. */
  tokens: number;
  included: boolean;
}

/** Rough token count: about 4 bytes of UTF-8 per token. Only for budgets and display; label it as an estimate. */
export const estimateTokens = (value: unknown) => Math.ceil(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length / 4);
