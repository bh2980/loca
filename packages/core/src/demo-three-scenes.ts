import type { GraphEdge, GraphNode, ProjectInput } from '@workbench/contracts';

// Original synthetic material; translations are explicit mock fixtures.
const rows: [string, string, string, string][] = [
  ['Mira', 'The relay station went silent at midnight.', '자정에 중계소의 신호가 끊겼어요.', 'common'],
  ['Jun', 'The Courier was the last person inside.', '안에 마지막으로 남아 있던 사람은 운반책이에요.', 'common'],
  ['Mira', 'A name, or a job?', '이름인가요, 직책인가요?', 'common'],
  ['Jun', 'A job. Nobody here knows the name.', '직책이죠. 여기서는 아무도 이름을 몰라요.', 'common'],
  ['Control', 'We need a report before dawn.', '동트기 전에 보고서를 제출해라.', 'common'],
  ['Jun', 'The archive may still have a copy of the signal.', '기록실에 신호 사본이 남아 있을지도 몰라요.', 'common'],
  ['Mira', 'And if I go straight to Control?', '바로 관제실로 가면요?', 'common'],
  ['Jun', 'Then report only what we know.', '그럼 우리가 아는 것만 보고하세요.', 'common'],
  ['Mira', 'The archive door is open.', '기록실 문이 열려 있어요.', 'archive'],
  ['Jun', 'I left it that way for the Courier.', '운반책이 들어올 수 있게 열어 뒀어요.', 'archive'],
  ['Mira', 'This recording starts before midnight.', '이 녹음은 자정 전에 시작됐네요.', 'archive'],
  ['Jun', 'Wait for the second bell.', '두 번째 종소리까지 기다려 보세요.', 'archive'],
  ['Mira', 'There. Someone asked the relay station to shut down.', '여기요. 누군가 중계소에 송신 중단을 요청했어요.', 'archive'],
  ['Jun', 'That is not the Courier’s voice.', '저건 운반책의 목소리가 아니에요.', 'archive'],
  ['Mira', 'I will attach the recording, not a guess.', '추측 대신 녹음을 첨부할게요.', 'archive'],
  ['Jun', 'Keep the original time stamp.', '원래 시각 표시는 그대로 두세요.', 'archive'],
  ['Control', 'What happened at the relay station?', '중계소에서 무슨 일이 있었나?', 'common'],
  ['Mira', 'I can confirm when the signal stopped.', '신호가 끊긴 시각은 확인할 수 있어요.', 'common'],
  ['Mira', 'The archive recording contains a shutdown request.', '기록실 녹음에 송신 중단 요청이 담겨 있어요.', 'archive'],
  ['Mira', 'I have not checked the archive. The cause is unconfirmed.', '기록실은 확인하지 않았어요. 원인은 아직 몰라요.', 'shortcut'],
  ['Control', 'Does that identify the Courier?', '그걸로 운반책의 신원을 알 수 있나?', 'common'],
  ['Mira', 'No. A role is not a name.', '아뇨. 직책만으로는 이름을 알 수 없어요.', 'common'],
  ['Control', 'Leave that question open in the report.', '그 문제는 보고서에 미해결로 남겨라.', 'common'],
  ['Mira', 'Understood. I will separate evidence from assumptions.', '알겠어요. 증거와 추측을 구분해서 적을게요.', 'common'],
];
const groupIds = ['demo-briefing', 'demo-archive', 'demo-report'];
const unitId = (index: number) => `relay-${String(index + 1).padStart(2, '0')}`;
const nodeId = (index: number) => `node-${unitId(index)}`;
const units = rows.map(([speaker, source, , branch], index) => ({
  id: unitId(index), groupId: groupIds[Math.floor(index / 8)], order: index % 8 + 1,
  speaker, source, kind: 'dialogue' as const, branch,
  termIds: [...(source.includes('Courier') ? ['relay-courier'] : []), ...(source.includes('relay station') ? ['relay-station'] : [])],
  graphNodeIds: [nodeId(index)], contextNotes: index === 18 ? ['기록실 방문 경로에서만 등장한다.'] : index === 19 ? ['기록실을 생략한 경로에서만 등장한다.'] : [],
}));
const nodes: GraphNode[] = units.map(unit => ({ id: unit.graphNodeIds[0], unitIds: [unit.id], groupIds: [unit.groupId], kind: 'dialogue' }));
nodes.push(
  { id: 'relay-choice', unitIds: [], groupIds: [groupIds[0]], kind: 'condition', conditions: { flag: 'visit_archive' } },
  { id: 'relay-wait', unitIds: [], groupIds: [groupIds[1]], kind: 'delay', metadata: { seconds: 2, description: '두 번째 종소리 대기' } },
  { id: 'relay-evidence', unitIds: [], groupIds: [groupIds[2]], kind: 'condition', conditions: { flag: 'archive_visited' } },
  { id: 'relay-join', unitIds: [], groupIds: [groupIds[2]], kind: 'connector' },
);
const edges: GraphEdge[] = [];
function edge(from: string, to: string, conditions?: unknown) { edges.push({ id: `relay-edge-${edges.length + 1}`, from, to, kind: conditions ? 'branch' : 'next', ...(conditions ? { conditions } : {}) }); }
for (let i = 0; i < 7; i++) edge(nodeId(i), nodeId(i + 1));
edge(nodeId(7), 'relay-choice'); edge('relay-choice', nodeId(8), { visit_archive: true }); edge('relay-choice', nodeId(16), { visit_archive: false });
for (let i = 8; i < 15; i++) { if (i === 11) { edge(nodeId(i), 'relay-wait'); edge('relay-wait', nodeId(i + 1)); } else edge(nodeId(i), nodeId(i + 1)); }
edge(nodeId(15), nodeId(16), { archive_visited: true }); edge(nodeId(16), nodeId(17)); edge(nodeId(17), 'relay-evidence');
edge('relay-evidence', nodeId(18), { archive_visited: true }); edge('relay-evidence', nodeId(19), { archive_visited: false });
edge(nodeId(18), 'relay-join'); edge(nodeId(19), 'relay-join'); edge('relay-join', nodeId(20));
for (let i = 20; i < 23; i++) edge(nodeId(i), nodeId(i + 1));

export const threeSceneDemoTranslations: Record<string, string> = Object.fromEntries(rows.map((row, index) => [unitId(index), row[2]]));
export const threeSceneDemo: ProjectInput = {
  schemaVersion: 2,
  project: { id: 'relay-three-scenes-demo', title: '중계소의 밤 · 3장면 데모', sourceLanguage: 'en', targetLanguage: 'ko', description: '직접 작성한 가상 원문 24개. 조사 브리핑 → 기록실(선택) → 관제실 보고. 모의 응답으로 UI와 하네스를 검증합니다.' },
  groups: groupIds.map((id, index) => ({ id, title: ['01 조사 브리핑', '02 기록실 조사', '03 관제실 보고'][index], order: index + 1, kind: 'scene', branch: index === 1 ? 'archive' : 'common',
    description: ['기록실을 조사하거나 곧바로 보고한다.', '녹음에서 송신 중단 요청을 확인한다. 정체는 확정하지 않는다.', '기록실 방문 여부에 따라 보고 내용이 갈라지고 다시 합류한다.'][index],
    nextIds: index === 0 ? [groupIds[1], groupIds[2]] : index === 1 ? [groupIds[2]] : [], graphNodeIds: nodes.filter(node => node.groupIds.includes(id)).map(node => node.id), graphFlowIds: ['relay-story'] })), units,
  graph: { version: 1, nodes, edges, flows: [{ id: 'relay-story', title: '중계소 조사와 보고', rootIds: [nodeId(0)], nodeIds: nodes.map(node => node.id) }], orderingNote: '위에서 아래로 진행. 기록실은 선택 방문이며 보고 장면의 두 증언은 서로 배타적입니다.' },
  terms: [
    { id: 'relay-courier', source: 'Courier', target: '운반책', aliases: [], description: '인물이 맡은 직책. 고유 이름으로 확정하지 않는다.', status: 'confirmed', version: 1, unitIds: units.filter(u => u.termIds.includes('relay-courier')).map(u => u.id) },
    { id: 'relay-station', source: 'relay station', target: '중계소', aliases: [], description: '신호 중계를 담당하는 시설.', status: 'confirmed', version: 1, unitIds: units.filter(u => u.termIds.includes('relay-station')).map(u => u.id) },
  ],
  knowledge: [
    { id: 'relay-summary', kind: 'summary', title: '줄거리 · 신호가 끊긴 밤', content: 'Mira와 Jun이 중계소의 침묵을 조사한다. 기록실은 선택 경로다. 기록을 확인한 경우에만 송신 중단 요청을 보고할 수 있다. 운반책의 정체는 끝까지 미확인이다.', evidenceIds: ['relay-01', 'relay-19', 'relay-20', 'relay-22'], branch: 'common', visibility: 'translator' },
    { id: 'relay-mira', kind: 'character', title: 'Mira · 조사관의 말투와 관계', content: 'Jun에게는 질문을 하고 Control에게는 결과를 보고한다. 간결한 해요체. 증거와 추측을 구분하며 모르는 사실은 확정하지 않는다.', evidenceIds: ['relay-03', 'relay-15', 'relay-24'], branch: 'common', visibility: 'translator' },
    { id: 'relay-jun', kind: 'character', title: 'Jun · 기록 담당', content: 'Mira의 조사를 돕는다. 해요체로 조심스럽게 정보를 제공한다. Control의 지시를 대신 단정하지 않는다.', evidenceIds: ['relay-04', 'relay-08', 'relay-16'], branch: 'common', visibility: 'translator' },
    { id: 'relay-control', kind: 'character', title: 'Control · 관제실 책임자', content: 'Mira에게 보고를 요구한다. 짧은 해라체. 미확인 사안을 보고서에서 열린 질문으로 남기도록 지시한다.', evidenceIds: ['relay-05', 'relay-21', 'relay-23'], branch: 'common', visibility: 'translator' },
    { id: 'relay-recording', kind: 'fact', title: '기록실에서 확인한 증거', content: '녹음에 송신 중단 요청이 있다. Jun은 운반책의 목소리가 아니라고 말한다. 이 발언만으로 화자의 신원을 확정할 수 없다.', evidenceIds: ['relay-13', 'relay-14'], branch: 'archive', visibility: 'character' },
    { id: 'relay-rule', kind: 'rule', title: '경로별 기억과 정보 공개', content: '기록실 생략 경로의 Mira에게 녹음의 내용을 알려 주지 않는다. 번역자가 전체 줄거리를 알아도 등장인물의 발언에 미래 정보를 추가하지 않는다.', evidenceIds: ['relay-19', 'relay-20'], branch: 'common', visibility: 'translator' },
  ],
};
