import type { Group, KnowledgeItem, ProjectInput, SourceUnit, Term } from '@workbench/contracts';

/** Original synthetic PROCESS_REVIEW sample; translations are explicit mock data. */
interface DemoSource {
  id: string;
  group: string;
  speaker: string;
  text: string;
  order: number;
  branch: 'common' | 'A' | 'B';
  termIds?: string[];
  expectedKorean: string;
}

const mockRows: DemoSource[] = [
  { id: 'S0-01', group: 'S0', speaker: 'Mira', text: 'The Watch Office sent me.', order: 1, branch: 'common', termIds: ['watch-office'], expectedKorean: '감시국에서 저를 보냈어요.' },
  { id: 'S0-02', group: 'S0', speaker: 'Jun', text: 'Then you know about the night train.', order: 2, branch: 'common', termIds: ['night-train'], expectedKorean: '그럼 야간열차에 대해서도 아시겠네요.' },
  { id: 'S0-03', group: 'S0', speaker: 'Mira', text: 'Only that it stopped running.', order: 3, branch: 'common', expectedKorean: '운행을 멈췄다는 것만요.' },
  { id: 'S0-04', group: 'S0', speaker: 'Jun', text: 'Some things still arrive on time.', order: 4, branch: 'common', expectedKorean: '아직도 제시간에 도착하는 것들이 있어요.' },
  { id: 'A-01', group: 'S1A', speaker: 'Mira', text: 'Show me the record.', order: 5, branch: 'A', expectedKorean: '기록을 보여 주세요.' },
  { id: 'A-02', group: 'S1A', speaker: 'Jun', text: 'I copied it before they sealed the cabinet.', order: 6, branch: 'A', expectedKorean: '그들이 보관함을 봉인하기 전에 복사해 뒀어요.' },
  { id: 'A-03', group: 'S1A', speaker: 'Jun', text: 'The archive code is 731.', order: 7, branch: 'A', expectedKorean: '기록 보관소 코드는 731이에요.' },
  { id: 'A-04', group: 'S1A', speaker: 'Mira', text: "I'll keep that between us.", order: 8, branch: 'A', expectedKorean: '우리 둘만 아는 걸로 하죠.' },
  { id: 'B-01', group: 'S1B', speaker: 'Mira', text: 'Keep the record. Tell me where to wait.', order: 9, branch: 'B', expectedKorean: '기록은 가지고 계세요. 어디서 기다리면 되죠?' },
  { id: 'B-02', group: 'S1B', speaker: 'Jun', text: 'By the east gate, after the bell.', order: 10, branch: 'B', expectedKorean: '종이 울린 뒤에 동문 옆에서요.' },
  { id: 'B-03', group: 'S1B', speaker: 'Jun', text: 'Watch your step near the harbor.', order: 11, branch: 'B', expectedKorean: '항구 근처에서는 발밑을 조심하세요.' },
  { id: 'B-04', group: 'S1B', speaker: 'Mira', text: "I won't ask about the cabinet.", order: 12, branch: 'B', expectedKorean: '보관함에 대해서는 묻지 않을게요.' },
  { id: 'S2-01', group: 'S2', speaker: 'Vale', text: 'Did you get what you needed?', order: 13, branch: 'common', expectedKorean: '필요한 건 얻었나?' },
  { id: 'S2-02', group: 'S2', speaker: 'Mira', text: 'Enough to continue.', order: 14, branch: 'common', expectedKorean: '계속할 만큼은요.' },
  { id: 'S3-01', group: 'S3', speaker: 'Vale', text: 'The night train was never a train.', order: 15, branch: 'common', termIds: ['night-train'], expectedKorean: '야간열차는 처음부터 열차가 아니었다.' },
  { id: 'S3-02', group: 'S3', speaker: 'Vale', text: 'It was our name for moving people off the record.', order: 16, branch: 'common', expectedKorean: '기록을 남기지 않고 사람들을 이송하는 일을 그렇게 불렀지.' },
  { id: 'S3-03', group: 'S3', speaker: 'Mira', text: 'The Watch Office made them disappear?', order: 17, branch: 'common', termIds: ['watch-office'], expectedKorean: '감시국이 그 사람들을 사라지게 한 건가요?' },
  { id: 'S3-04', group: 'S3', speaker: 'Vale', text: "That's what the report will say.", order: 18, branch: 'common', expectedKorean: '보고서에는 그렇게 적힐 거다.' },
  { id: 'D01', group: 'documents', speaker: '', text: 'Watch Office Notice\nCabinet access requires written authorization.', order: 19, branch: 'common', termIds: ['watch-office'], expectedKorean: '감시국 공지\n보관함에 접근하려면 서면 허가가 필요합니다.' },
  { id: 'D02', group: 'documents', speaker: '', text: 'Transfer log\nOperation NIGHT TRAIN — list removed.', order: 20, branch: 'common', termIds: ['night-train'], expectedKorean: '이송 기록\n야간열차 작전 — 명단 삭제됨.' },
  { id: 'U01', group: 'ui', speaker: '', text: 'Open {document_name}', order: 21, branch: 'common', expectedKorean: '{document_name} 열기' },
  { id: 'U02', group: 'ui', speaker: '', text: '<b>Watch Office</b>: {count} unread', order: 22, branch: 'common', termIds: ['watch-office'], expectedKorean: '<b>감시국</b>: 읽지 않음 {count}개' },
];

export const demoKnowledgeBoard = {
  provenance: 'explicit_mock' as const,
  title: '야간 이송 기록',
  summary: {
    text: 'Mira가 Jun을 조사하며 기록 확인과 접선 약속 중 한 경로를 거친다. 공통 보고 이후 Vale가 야간열차라는 이름의 의미를 설명한다. 그의 보고서 발언은 감시국의 유죄를 확정하는 객관적 증거가 아니다.',
    sourceIds: ['S0-01', 'A-01', 'B-01', 'S2-01', 'S3-01', 'S3-02', 'S3-04'],
    scope: 'translator_whole_work',
  },
  characters: [
    { id: 'Mira', name: 'Mira', role: '조사관', voice: '간결한 질문. 샘플 번역에서는 해요체.', sourceIds: ['S0-01', 'S0-03', 'S2-02'], status: 'provisional' },
    { id: 'Jun', name: 'Jun', role: '기록 담당', voice: '조심스러운 응답. 샘플 번역에서는 해요체.', sourceIds: ['S0-02', 'A-02', 'B-02'], status: 'provisional' },
    { id: 'Vale', name: 'Vale', role: '상관', voice: '권위적인 짧은 발언. 샘플 번역에서는 해라체.', sourceIds: ['S2-01', 'S3-01', 'S3-04'], status: 'provisional' },
  ],
  terms: [
    { id: 'watch-office', source: 'Watch Office', aliases: [] as string[], korean: '감시국', version: 1, status: 'provisional', definition: '샘플에 등장하는 기관명. Watch라는 동사의 사용과 구분한다.', sourceIds: ['S0-01', 'S3-03', 'D01', 'U02'] },
    { id: 'night-train', source: 'night train', aliases: ['NIGHT TRAIN'], korean: '야간열차', version: 1, status: 'provisional', definition: '초반에는 모호한 표현으로 보존한다. 후반에 Vale가 기록 없는 사람 이송을 가리킨다고 설명한다.', sourceIds: ['S0-02', 'S3-01', 'D02'] },
  ],
  knowledge: [
    { id: 'archive-code-heard', kind: 'fact', text: '경로 A에서 Mira는 Jun이 기록 보관소 코드를 731이라고 말하는 것을 듣는다.', sourceIds: ['A-03'], scope: { branch: 'A', fromGroup: 'S1A', observers: ['Mira', 'Jun'] } },
    { id: 'archive-code-claim', kind: 'claim', text: '기록 보관소 코드는 731이라는 Jun의 발언.', sourceIds: ['A-03'], scope: { branch: 'A', fromGroup: 'S1A', observers: ['Mira', 'Jun'] } },
    { id: 'meeting-arrangement', kind: 'fact', text: '경로 B에서 Jun은 종이 울린 뒤 동문 옆에서 기다리라고 Mira에게 말한다.', sourceIds: ['B-01', 'B-02'], scope: { branch: 'B', fromGroup: 'S1B', observers: ['Mira', 'Jun'] } },
    { id: 'night-train-explanation', kind: 'claim', text: 'Vale는 야간열차가 기록 없이 사람들을 이송하는 일의 이름이었다고 말한다.', sourceIds: ['S3-01', 'S3-02'], scope: { branch: 'common', fromGroup: 'S3', observers: ['Mira', 'Vale'] } },
    { id: 'report-future-wording', kind: 'claim', text: 'Vale는 보고서에 감시국이 사람들을 사라지게 했다고 적힐 것이라고 말한다. 실제 책임을 확정하지 않는다.', sourceIds: ['S3-03', 'S3-04'], scope: { branch: 'common', fromGroup: 'S3', observers: ['Mira', 'Vale'] } },
  ],
  documentAvailability: [
    { sourceId: 'D01', fromGroup: 'S0', branch: 'common' },
    { sourceId: 'D02', fromGroup: 'S3', branch: 'common' },
  ],
  scopeRules: [
    '전체 자료는 번역자 참고용이며 현재 등장인물의 지식과 구분한다.',
    'S1A와 S1B는 배타적이다. 합류 후에도 한 경로의 기억을 다른 경로로 옮기지 않는다.',
    'S2의 공통 원문은 경로별 사용처를 가지며 내보낼 번역은 하나다.',
    'S0의 야간열차 정체를 초반 번역에 추가하지 않는다.',
  ],
};

export const demoTranslations: Record<string, string> = Object.fromEntries(
  mockRows.map((row) => [row.id, row.expectedKorean]),
);

const groups: Group[] = [
  { id: 'S0', title: '조사 시작', description: 'D01을 볼 수 있다. 야간열차의 정체는 아직 공개되지 않는다.', order: 1, branch: 'common', kind: 'scene', nextIds: ['S1A', 'S1B'] },
  { id: 'S1A', title: '기록 확인 · 경로 A', description: '경로 B와 배타적. Mira가 Jun에게 코드 731을 듣는다.', order: 2, branch: 'A', kind: 'scene', nextIds: ['S2'] },
  { id: 'S1B', title: '접선 약속 · 경로 B', description: '경로 A와 배타적. 종이 울린 뒤 동문 옆에서 기다리는 약속.', order: 3, branch: 'B', kind: 'scene', nextIds: ['S2'] },
  { id: 'S2', title: '공통 보고', description: 'A/B의 사용처는 별개이며 공통 원문·번역은 하나. 두 경로의 기억을 합치지 않는다.', order: 4, branch: 'common', kind: 'scene', nextIds: ['S3'] },
  { id: 'S3', title: '후반 공개', description: 'D02 공개. Vale의 설명·보고서 발언을 객관적 사실로 확정하지 않는다.', order: 5, branch: 'common', kind: 'scene', nextIds: [] },
  { id: 'documents', title: '문서', description: 'D01은 S0, D02는 S3부터 공개. 번역자는 전체 분석에서 모두 참고할 수 있다.', order: 6, branch: 'common', kind: 'document', nextIds: [] },
  { id: 'ui', title: '공용 UI', description: '자리표시자와 태그를 보존한다.', order: 7, branch: 'common', kind: 'ui', nextIds: [] },
];

const units: SourceUnit[] = mockRows.map((row) => ({
  id: row.id,
  groupId: row.group,
  order: row.order,
  ...(row.speaker ? { speaker: row.speaker } : {}),
  source: row.text,
  kind: row.group === 'documents' ? 'document' : row.group === 'ui' ? 'ui' : 'dialogue',
  branch: row.branch,
  termIds: row.termIds ?? [],
  contextNotes: row.id === 'D01' ? ['플레이어 공개 시점: S0']
    : row.id === 'D02' ? ['플레이어 공개 시점: S3. 앞 장면의 등장인물 지식으로 사용하지 않는다.']
    : row.group === 'S2' ? ['경로 A/B에서 공통 사용. 이전 경로의 기억은 합치지 않는다.']
    : [],
}));

const terms: Term[] = demoKnowledgeBoard.terms.map((term) => ({
  id: term.id, source: term.source, target: term.korean,
  description: term.definition, version: term.version, unitIds: [...term.sourceIds],
  aliases: [...term.aliases], status: 'provisional',
}));

const knowledge: KnowledgeItem[] = [
  { id: 'work-summary', kind: 'summary', title: '작품 개요 · 모의 분석', content: demoKnowledgeBoard.summary.text, evidenceIds: [...demoKnowledgeBoard.summary.sourceIds], branch: 'common', visibility: 'translator' },
  ...demoKnowledgeBoard.characters.map((character): KnowledgeItem => ({
    id: `character-${character.id}`, kind: 'character', title: `${character.name} · ${character.role}`,
    content: `${character.voice} 임시 말투안이며 원문에 없는 감정·사실을 추가하지 않는다.`,
    evidenceIds: [...character.sourceIds], branch: 'common', visibility: 'translator',
  })),
  ...demoKnowledgeBoard.knowledge.map((item): KnowledgeItem => ({
    id: item.id, kind: item.kind === 'claim' ? 'rule' : 'fact',
    title: item.kind === 'claim' ? '발언·주장 / 사실로 확정하지 않음' : '장면에서 확인한 발언 사건',
    content: `${item.text} 적용 시점: ${item.scope.fromGroup}. 관찰자: ${item.scope.observers.join(', ')}.`,
    evidenceIds: [...item.sourceIds], branch: item.scope.branch as KnowledgeItem['branch'], visibility: 'translator',
  })),
  ...demoKnowledgeBoard.scopeRules.map((content, index): KnowledgeItem => ({
    id: `scope-rule-${index + 1}`, kind: 'rule', title: '분기·정보 공개 규칙', content,
    evidenceIds: index === 1 ? ['A-03', 'B-02', 'S2-02'] : index === 2 ? ['S2-01', 'S2-02'] : ['S0-02', 'S3-01', 'S3-02'],
    branch: 'common', visibility: 'translator',
  })),
];

export const demoFixture: ProjectInput = {
  schemaVersion: 1,
  project: {
    id: 'night-transfer-demo', title: '야간 이송 기록',
    description: '가상 원문 22개와 명시적 모의 응답을 사용하는 프로세스 검토. 실제 모델 호출이나 번역 정답 데이터가 아니다.',
    sourceLanguage: 'en', targetLanguage: 'ko',
  },
  groups, units, terms, knowledge,
};
