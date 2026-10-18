export const ITEM_STATE = { queued: '대기', running: '처리 중', done: '완료', failed: '실패', cancelled: '취소' } as const;
export const GROUP_KIND = { scene: '장면', document: '문서', ui: 'UI' } as const;
export const SOURCE_UNIT_LABEL = { scene: '대사', ui: 'UI 문자열', document: '문서 원문' } as const;
export const SOURCE_GROUP_LABEL = { scene: '장면', ui: 'UI 묶음', document: '문서' } as const;
/** The translation screen's views, one per group kind: scenes hold the dialogue. */
export const SCRIPT_VIEW = { scene: '대사', document: '문서', ui: 'UI' } as const;
export const DOCUMENT_KIND = { story: '스토리', world: '세계관', style: '문체', note: '메모' } as const;
export const STATUS_KIND = { initial: '시작', normal: '중간', final: '최종' } as const;
