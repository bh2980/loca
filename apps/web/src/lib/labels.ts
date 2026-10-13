export const ITEM_STATE = { queued: '대기', running: '처리 중', done: '완료', failed: '실패', cancelled: '취소' } as const;
export const GROUP_KIND = { scene: '장면', document: '문서', ui: 'UI' } as const;
export const DOCUMENT_KIND = { story: '스토리', world: '세계관', style: '문체', note: '메모' } as const;
export const STATUS_KIND = { initial: '시작', normal: '중간', final: '최종' } as const;
