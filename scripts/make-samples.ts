/**
 * Writes standard-format sample projects.
 *   samples/relay-station.json   small curated story: branch, join, loop, characters, documents, glossary
 *   samples/synthetic-9k.json    ~9,000-node synthetic script graph for layout/performance checks (not committed)
 *   samples/realistic-<n>k.json  short scenes, hubs, characters, terms, documents, listeners, translations (not committed)
 * Usage: pnpm samples                                        relay-station + synthetic-9k
 *        pnpm samples -- --profile realistic --size 9000     only realistic-9k.json (also 50000)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importFileSchema, type ImportFileInput } from '../packages/shared/src/index.ts';
import { realistic } from './realistic-sample.ts';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../samples');
mkdirSync(out, { recursive: true });

function write(name: string, file: ImportFileInput) {
  importFileSchema.parse(file); // never ship a sample the importer would reject
  writeFileSync(path.join(out, name), JSON.stringify(file, null, 1));
  console.log(`${name}: ${file.units.length} lines, ${file.graph?.nodes.length ?? 0} nodes`);
}

const flag = (name: string) => {
  const args = process.argv.slice(2);
  const at = args.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  return at < 0 ? undefined : args[at].includes('=') ? args[at].split('=')[1] : args[at + 1];
};
if (flag('profile') !== undefined) {
  if (flag('profile') !== 'realistic') throw new Error(`unknown --profile "${flag('profile')}" (known: realistic)`);
  const size = Number(flag('size') ?? 9000);
  if (!Number.isInteger(size) || size < 100) throw new Error(`--size must be an integer of at least 100, got "${flag('size')}"`);
  const { file, report } = realistic(size);
  write(`realistic-${size % 1000 === 0 ? `${size / 1000}k` : size}.json`, file);
  console.log(report);
  process.exit(0);
}

/** A converter ships one entry per original node class: display kind + what it means. */
const SAMPLE_NODE_TYPES = {
  ChatMessageState: { kind: 'script', label: '대화 문장', description: '대화 메시지를 표시합니다.' },
  ChoiceState: { kind: 'condition', label: '선택지 분기', description: '플레이어 선택에 따라 출력 연결 하나를 고릅니다.' },
  EmptyState: { kind: 'connector', label: '통과 연결', description: '아무 동작 없이 다음 연결로 진행합니다.' },
  WaitState: { kind: 'wait', label: '이벤트 대기', description: '지정한 흐름 이벤트가 올 때까지 기다립니다.' },
  OnGameEventCallbackState: { kind: 'event', label: '게임 이벤트 조건', description: '지정한 게임 이벤트가 발생했는지 확인합니다.' },
  UnlockToolState: { kind: 'state', label: '도구 해제', description: '지정한 도구를 사용할 수 있게 합니다.' },
} as const;

// ── small curated sample ─────────────────────────────────────────────
const scenes = [
  { key: 'arrival', title: '중계소 도착', lines: [
    ['MIRA', 'The relay station is dark. Someone cut the power, {player}.'],
    ['JONAS', "Or it's just old. Nothing out here lasts."],
    ['MIRA', 'Check the <b>breaker panel</b>. I will watch the door.'],
  ] },
  { key: 'panel', title: '차단기 패널', lines: [
    ['JONAS', 'The fuses are fine. This was switched off by hand.'],
    ['MIRA', 'Then they are still here.'],
  ] },
  { key: 'logbook', title: '근무 일지', lines: [
    ['NARRATOR', 'A logbook lies open. The last entry is dated three days ago.'],
    ['MIRA', '"Signal from the north tower again. Ignoring orders."'],
    ['JONAS', 'Ignoring whose orders?'],
  ] },
  { key: 'tower', title: '북쪽 송신탑', lines: [
    ['MIRA', 'The tower light is blinking. %d short, %d long.'],
    ['JONAS', "That's not a fault. That's a code."],
    ['MIRA', 'Write it down. Every pulse.'],
  ] },
  { key: 'ending', title: '새벽', lines: [
    ['NARRATOR', 'Dawn comes slowly over the ridge.'],
    ['JONAS', 'We tell the Directorate nothing.\nAgreed?'],
    ['MIRA', 'Agreed.'],
  ] },
];
const units: ImportFileInput['units'] = [];
const nodes: NonNullable<ImportFileInput['graph']>['nodes'] = [];
const edges: NonNullable<ImportFileInput['graph']>['edges'] = [];
for (const scene of scenes)
  scene.lines.forEach(([speaker, source], index) => {
    const key = `${scene.key}.${index + 1}`;
    units.push({ key, group: scene.key, speaker, source });
    nodes.push({ key: `n.${key}`, type: 'ChatMessageState', units: [key] });
    if (index > 0) edges.push({ from: `n.${scene.key}.${index}`, to: `n.${key}` });
  });
nodes.push(
  { key: 'c.choice', type: 'ChoiceState', meta: { options: ['panel', 'logbook'] } },
  { key: 'j.join', type: 'EmptyState' },
  { key: 'w.signal', type: 'WaitState', meta: { event: 'SignalDecoded' } },
  { key: 'e.dawn', type: 'OnGameEventCallbackState', meta: { event: 'TimeOfDay', value: 'dawn' } },
);
edges.push(
  { from: 'n.arrival.3', to: 'c.choice' },
  { from: 'c.choice', to: 'n.panel.1', label: 'panel' },
  { from: 'c.choice', to: 'n.logbook.1', label: 'logbook' },
  { from: 'n.panel.2', to: 'j.join' },
  { from: 'n.logbook.3', to: 'j.join' },
  { from: 'j.join', to: 'n.tower.1' },
  { from: 'n.tower.3', to: 'w.signal' },
  { from: 'w.signal', to: 'n.tower.1', label: 'repeat' },
  { from: 'w.signal', to: 'e.dawn', label: 'decoded' },
  { from: 'e.dawn', to: 'n.ending.1' },
);
write('relay-station.json', {
  format: 'loca/v1',
  project: { name: '중계소 (샘플)', description: '분기·합류·반복이 있는 작은 샘플 프로젝트', sourceLanguage: 'en', targetLanguage: 'ko' },
  groups: [...scenes.map((scene, order) => ({ key: scene.key, title: scene.title, order })), { key: 'ui', kind: 'ui', title: '메뉴 UI', order: scenes.length }],
  units: [...units, { key: 'ui.continue', group: 'ui', kind: 'ui', source: 'Continue' }, { key: 'ui.save', group: 'ui', kind: 'ui', source: 'Save & Quit' }],
  graph: { flow: 'complete', nodeTypes: SAMPLE_NODE_TYPES, nodes, edges },
  characters: [
    { name: 'MIRA', aliases: ['Mira'], profile: '전직 통신병. 침착하고 짧게 말한다. 존댓말을 쓰지 않는다.' },
    { name: 'JONAS', aliases: ['Jonas'], profile: '정비공. 회의적이고 농담이 많다. 미라에게 반말.' },
  ],
  relationships: [{ from: 'MIRA', to: 'JONAS', kind: '동료', description: '오래 함께 근무한 사이. 서로 반말.', mutual: true }],
  documents: [
    { title: '세계관', kind: 'world', body: '감시 국가 "Directorate"가 통신을 통제한다. 중계소는 국경의 무인 시설이다.', alwaysInclude: true },
    { title: '문체', kind: 'style', body: '대사는 구어체 반말. 내레이션은 "-다" 체.', alwaysInclude: true },
  ],
  terms: [
    { source: 'Directorate', target: '총국', note: '정부 기관 이름' },
    { source: 'relay station', target: '중계소' },
  ],
});

// ── synthetic 9k graph ───────────────────────────────────────────────
function synthetic(target: number): ImportFileInput {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const groups: ImportFileInput['groups'] = [];
  const lines: ImportFileInput['units'] = [];
  const graphNodes: NonNullable<ImportFileInput['graph']>['nodes'] = [];
  const graphEdges: NonNullable<ImportFileInput['graph']>['edges'] = [];
  const speakers = ['MIRA', 'JONAS', 'OFFICER', 'RADIO', 'NARRATOR'];
  let scene = -1, inScene = 0;
  const script = () => {
    if (scene < 0 || inScene > 12 + rand() * 30) {
      scene++;
      inScene = 0;
      groups.push({ key: `s${scene}`, title: `Scene ${scene + 1}`, order: scene });
    }
    inScene++;
    const key = `s${scene}.l${inScene}`;
    lines.push({ key, group: `s${scene}`, speaker: speakers[Math.floor(rand() * speakers.length)], source: `Line ${inScene} of scene ${scene + 1}.` });
    graphNodes.push({ key: `n.${key}`, type: 'ChatMessageState', units: [key] });
    return `n.${key}`;
  };
  const TYPE = { condition: 'ChoiceState', wait: 'WaitState', event: 'OnGameEventCallbackState', connector: 'EmptyState', state: 'UnlockToolState' } as const;
  const control = (kind: keyof typeof TYPE) => {
    const key = `${kind}.${graphNodes.length}`;
    graphNodes.push({ key, type: TYPE[kind] });
    return key;
  };
  const link = (from: string, to: string) => graphEdges.push({ from, to });
  const flows = 8;
  const perFlow = Math.floor((target * 0.95) / flows);
  for (let flow = 0; flow < flows; flow++) {
    const start = graphNodes.length;
    let previous = script();
    const history = [previous];
    while (graphNodes.length - start < perFlow) {
      const r = rand();
      if (r < 0.08) {
        const branch = control('condition');
        link(previous, branch);
        const arms = 2 + Math.floor(rand() * 2), ends: string[] = [];
        for (let arm = 0; arm < arms; arm++) {
          let tail = branch;
          for (let step = 0, length = 1 + Math.floor(rand() * 6); step < length; step++) {
            const next = script();
            link(tail, next);
            tail = next;
          }
          ends.push(tail);
        }
        const join = control('connector');
        for (const end of ends) link(end, join);
        previous = join;
      } else if (r < 0.1 && history.length > 20) {
        const wait = control('wait');
        link(previous, wait);
        link(wait, history[history.length - 2 - Math.floor(rand() * 15)]);
        const next = script();
        link(wait, next);
        previous = next;
      } else {
        const next = rand() < 0.03 ? control('event') : rand() < 0.02 ? control('state') : script();
        link(previous, next);
        previous = next;
      }
      history.push(previous);
    }
  }
  groups.push({ key: 'loose', title: 'Unconnected lines' });
  while (graphNodes.length < target) {
    const key = `loose.${graphNodes.length}`;
    lines.push({ key, group: 'loose', source: `Loose line ${graphNodes.length}.` });
    graphNodes.push({ key: `n.${key}`, type: 'ChatMessageState', units: [key] });
  }
  return {
    format: 'loca/v1',
    project: { name: `합성 그래프 ${target.toLocaleString()}노드`, description: '배치·성능 확인용 합성 데이터' },
    groups,
    units: lines,
    graph: { flow: 'complete', nodeTypes: SAMPLE_NODE_TYPES, nodes: graphNodes, edges: graphEdges },
  };
}
write('synthetic-9k.json', synthetic(9000));
