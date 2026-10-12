/**
 * A deterministic project that looks like a real game, for cost and scale checks (`pnpm samples -- --profile realistic --size 9000`).
 * What the synthetic graph lacks and real games have:
 *   - heavy-tailed scene sizes: ~40% of scenes have 1-3 lines, ~40% 4-30, ~20% 31-200
 *   - hub nodes that belong to no scene and connect many scenes (menus, return points)
 *   - characters with aliases (one is the silent player), relationships, ~200 terms, documents
 *   - listeners on part of the lines and translations on ~20% of them
 */
import type { ImportFileInput } from '../packages/shared/src/index.ts';
import { makeRand } from './mock-llm-core.ts';

type Graph = NonNullable<ImportFileInput['graph']>;

const NODE_TYPES: Graph['nodeTypes'] = {
  ChatMessageState: { kind: 'script', label: '대화 문장', description: '대화 메시지를 표시합니다.' },
  ChoiceState: { kind: 'condition', label: '선택지 분기', description: '플레이어 선택에 따라 출력 연결 하나를 고릅니다.' },
  EmptyState: { kind: 'connector', label: '통과 연결', description: '아무 동작 없이 다음 연결로 진행합니다.' },
  HubState: { kind: 'connector', label: '허브', description: '여러 장면이 모였다 갈라지는 메뉴·복귀 지점입니다.' },
};

const NAMES = ['MIRA', 'JONAS', 'OFFICER VANCE', 'RADIO', 'DR. HALE', 'TESS', 'BRAM', 'KOVAL', 'IRIS', 'OLLIE', 'MARSHAL REED', 'WREN', 'SABLE', 'DEX', 'NOOR', 'PELL', 'QUILL', 'ROOK', 'NARRATOR'];
const PLAYER = 'KAI';
const ALIASES: Record<string, string[]> = { MIRA: ['Mira', 'Corporal Mira'], JONAS: ['Jonas'], 'OFFICER VANCE': ['Vance', 'the Officer'], 'DR. HALE': ['Hale', 'Doc'], TESS: ['Tess'], BRAM: ['Bram', 'Old Bram'], [PLAYER]: ['Player', 'you'] };
const RELATION_KINDS = ['동료', '가족', '상관과 부하', '친구', '적대', '스승과 제자', '채무', '연인'];
const LEVELS = ['hae', 'haeyo', 'hasipsio', 'haera', 'hao', 'hage'] as const;

const OPEN = ['Listen', 'Wait', 'Look', 'Please', 'Honestly', 'Fine', 'Well', 'Right', 'No', 'Yes', 'Hey', 'Easy'];
const SUBJ = ['the signal', 'the door', 'that crate', 'the old route', 'our orders', 'the engine', 'the lamp', 'my brother', 'the captain', 'this map', 'the ledger', 'the tide', 'the guard', 'your plan'];
const PRED = ['is not what it seems', 'has been moved again', 'will not hold much longer', 'was never on the list', 'smells of smoke', 'should stay between us', 'costs more than we have', 'is waiting past the ridge', 'does not answer anymore', 'keeps humming at night'];
const TAIL = ['Trust me.', 'We should go.', 'I mean it.', 'Not a word.', 'Do you understand?', 'Keep moving.', 'Who else knows?', 'Just this once.', 'Think about it.', 'Is that clear?'];
const NARR = ['Rain taps the window.', 'The corridor hums with static.', 'A door slams somewhere below.', 'Dust drifts through the lamplight.', 'Nobody speaks for a moment.', 'The floor trembles, then settles.'];
const STEMS = ['Varn', 'Orel', 'Kest', 'Maru', 'Thal', 'Brin', 'Cosk', 'Dael', 'Fenn', 'Gorm', 'Hesk', 'Ilan', 'Jorv', 'Lume', 'Nyra', 'Pask', 'Rhee', 'Sundar', 'Tolk', 'Ulme'];
const KINDS = ['Gate', 'Harbor', 'Guild', 'Lamp', 'Order', 'Pass', 'Tower', 'Ward', 'Market', 'Archive'];
const KO = ['바', '르', '오', '켈', '스', '마', '탈', '린', '코', '드', '펜', '고', '헤', '일', '노', '파', '쿠', '룩'];

/** Fixed-seed random numbers: same inputs, same file. */
export function realistic(size: number): { file: ImportFileInput; report: string } {
  const rand = makeRand(20261012);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

  // ── terms (~200) ──
  const terms: { source: string; target: string; note: string }[] = [];
  const termSources = new Set<string>();
  for (const stem of STEMS) for (const kind of KINDS) termSources.add(`${stem} ${kind}`);
  for (const stem of STEMS) termSources.add(stem);
  for (const source of [...termSources].slice(0, 200)) {
    const target = Array.from({ length: 2 + (source.length % 3) }, (_, index) => KO[(source.charCodeAt(index) + index) % KO.length]).join('');
    terms.push({ source, target, note: source.includes(' ') ? '장소·조직 이름' : '고유명사' });
  }

  // ── scene sizes ──
  const sizes: number[] = [];
  for (let total = 0; total < size; ) {
    const r = rand();
    let n = r < 0.4 ? int(1, 3) : r < 0.8 ? int(4, 30) : 31 + Math.floor(169 * rand() ** 2);
    n = Math.min(n, size - total);
    sizes.push(n);
    total += n;
  }

  // ── characters ──
  const cast = [...NAMES, PLAYER];
  const popularity = (index: number) => 1 / (index + 1.5);
  const weighted = (pool: string[]) => {
    const weights = pool.map((name) => popularity(NAMES.indexOf(name) < 0 ? 0 : NAMES.indexOf(name)));
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (const [index, weight] of weights.entries()) if ((r -= weight) <= 0) return pool[index];
    return pool[pool.length - 1];
  };
  const talkers = NAMES.filter((name) => name !== 'NARRATOR');

  const groups: ImportFileInput['groups'] = [];
  const units: ImportFileInput['units'] = [];
  const nodes: Graph['nodes'] = [];
  const edges: Graph['edges'] = [];
  const first: string[] = [];
  const last: string[] = [];
  const sceneKeys: string[][] = [];
  const pairSeen = new Map<string, number>();

  sizes.forEach((count, scene) => {
    const key = `s${scene}`;
    const chapter = Math.floor(scene / 25);
    groups.push({ key, title: `Scene ${scene + 1}`, section: `Chapter ${chapter + 1}`, order: scene });
    const present = Array.from({ length: count <= 3 ? int(1, 2) : int(2, 4) }, () => weighted(talkers));
    const people = [...new Set(present)];
    const keys: string[] = [];
    let previousSpeaker = '';
    for (let line = 1; line <= count; line++) {
      const narration = rand() < 0.08;
      const speaker = narration ? 'NARRATOR' : people.length > 1 && rand() < 0.75 ? pick(people.filter((name) => name !== previousSpeaker)) : pick(people);
      previousSpeaker = speaker;
      const term = rand() < 0.12 ? pick(terms).source : '';
      let source: string;
      if (narration) source = rand() < 0.5 ? pick(NARR) : `${pick(NARR)} ${term ? `The ${term} is close.` : ''}`.trim();
      else {
        const body = `${pick(OPEN)}, ${pick(SUBJ)} ${pick(PRED)}${term ? ` near the ${term}` : ''}. ${rand() < 0.6 ? pick(TAIL) : ''}`.trim();
        source = rand() < 0.04 ? `${body} {player}` : rand() < 0.04 ? `<b>${body}</b>` : rand() < 0.03 ? `${body}\n${pick(TAIL)}` : body;
      }
      const unitKey = `${key}.l${line}`;
      const others = [...people.filter((name) => name !== speaker), ...(rand() < 0.3 ? [PLAYER] : [])];
      const listener = !narration && others.length && rand() < 0.4 ? pick(others) : undefined;
      if (listener) pairSeen.set(`${speaker}|${listener}`, (pairSeen.get(`${speaker}|${listener}`) ?? 0) + 1);
      units.push({ key: unitKey, group: key, speaker, ...(listener ? { listener } : {}), source });
      nodes.push({ key: `n.${unitKey}`, type: 'ChatMessageState', units: [unitKey] });
      if (line > 1) edges.push({ from: `n.${key}.l${line - 1}`, to: `n.${unitKey}` });
      keys.push(unitKey);
    }
    sceneKeys.push(keys);
    first.push(`n.${keys[0]}`);
    last.push(`n.${keys[keys.length - 1]}`);
  });

  // UI strings (their own group, not in the graph).
  groups.push({ key: 'ui', kind: 'ui', title: '메뉴 UI', order: sizes.length });
  for (let index = 0; index < 40; index++) units.push({ key: `ui.${index}`, group: 'ui', kind: 'ui', source: pick(['Continue', 'Save & Quit', 'Options', 'Resume', 'Back', 'Inventory', 'Map', 'Controls']) + ` ${index}` });

  // ── scene flow: mostly linear, some choices that rejoin ──
  let joins = 0;
  for (let scene = 0; scene < sizes.length - 1; ) {
    if (rand() < 0.1 && scene + 3 < sizes.length) {
      const choice = `c.${joins}`;
      const join = `j.${joins++}`;
      nodes.push({ key: choice, type: 'ChoiceState', meta: { options: [`s${scene + 1}`, `s${scene + 2}`] } }, { key: join, type: 'EmptyState' });
      edges.push({ from: last[scene], to: choice }, { from: choice, to: first[scene + 1], label: `A${joins}` }, { from: choice, to: first[scene + 2], label: `B${joins}` });
      edges.push({ from: last[scene + 1], to: join }, { from: last[scene + 2], to: join }, { from: join, to: first[scene + 3] });
      scene += 3;
    } else {
      edges.push({ from: last[scene], to: first[scene + 1] });
      scene++;
    }
  }

  // ── hubs: belong to no scene; many scenes end in them and many start from them ──
  const hubCount = Math.max(3, Math.round(size / 600));
  let hubEdges = 0;
  for (let hub = 0; hub < hubCount; hub++) {
    const key = `hub.${hub}`;
    nodes.push({ key, type: 'HubState', label: hub % 2 ? '메뉴' : '복귀 지점' });
    const degree = Math.min(sizes.length, int(15, 60));
    const picked = new Set<number>();
    while (picked.size < degree) picked.add(int(0, sizes.length - 1));
    for (const scene of picked) {
      edges.push({ from: last[scene], to: key });
      hubEdges++;
    }
    const targets = new Set<number>();
    while (targets.size < degree) targets.add(int(0, sizes.length - 1));
    for (const scene of targets) {
      edges.push({ from: key, to: first[scene] });
      hubEdges++;
    }
  }

  // ── translations on ~20% of lines (whole scenes, as a half-translated game would be) ──
  const order = sizes.map((_, scene) => scene).sort(() => rand() - 0.5);
  const translated = new Set<number>();
  let done = 0;
  for (const scene of order) {
    if (done >= size * 0.2) break;
    translated.add(scene);
    done += sizes[scene];
  }
  const bySceneKey = new Map(sceneKeys.flat().map((key) => [key, Number(key.slice(1, key.indexOf('.')))]));
  for (const unit of units) {
    const scene = bySceneKey.get(unit.key);
    if (scene !== undefined && translated.has(scene)) unit.translation = `[KO] ${unit.source}`;
  }

  // ── knowledge ──
  const characters = cast.map((name) => ({
    name,
    aliases: ALIASES[name] ?? [],
    profile: name === 'NARRATOR' ? '화자가 아닌 서술.' : name === PLAYER ? '플레이어가 조작하는 말없는 주인공. 다른 인물이 "you"로 부른다.' : `${name}: 이야기에 자주 나오는 인물.`,
    speech: name === PLAYER ? '' : pick(['짧고 단정함', '농담이 많음', '격식 있음', '거칠고 빠름']),
    player: name === PLAYER,
  }));
  const pairs = [...pairSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const relationships = pairs.map(([pair], index) => {
    const [from, to] = pair.split('|');
    return {
      from,
      to,
      kind: pick(RELATION_KINDS),
      description: '자주 대화하는 사이.',
      mutual: index % 3 === 0,
      changes: index % 5 === 0 ? [{ at: `s${index}.l1`, change: '관계가 달라짐', cause: '' }].filter((change) => units.some((unit) => unit.key === change.at)) : [],
    };
  });
  const speechRules = pairs.slice(0, 10).map(([pair], index) => {
    const [from, to] = pair.split('|');
    return { from, to, level: LEVELS[index % LEVELS.length], address: '', note: '샘플 규칙' };
  });
  const documents = [
    { title: '세계관', kind: 'world' as const, body: `${pick(STEMS)} 일대는 길드와 항구 도시가 얽힌 지역이다. ${terms.slice(0, 5).map((term) => term.source).join(', ')} 같은 장소가 자주 나온다.`, alwaysInclude: true },
    { title: '문체', kind: 'style' as const, body: '대사는 구어체. 내레이션은 "-다" 체. 인물마다 말투를 유지한다.', alwaysInclude: true },
    { title: '줄거리 메모', kind: 'story' as const, body: '신호의 출처를 쫓다가 길드의 비밀을 알게 되는 이야기.', alwaysInclude: false },
  ];

  const bins = { '1-3': 0, '4-30': 0, '31-200': 0 };
  for (const n of sizes) bins[n <= 3 ? '1-3' : n <= 30 ? '4-30' : '31-200']++;
  const lineCount = units.filter((unit) => unit.kind !== 'ui').length;
  const report = [
    `scenes ${sizes.length}: ${Object.entries(bins).map(([range, n]) => `${range} lines ${n} (${Math.round((n / sizes.length) * 100)}%)`).join(', ')}; largest ${Math.max(...sizes)}`,
    `hubs ${hubCount} (${hubEdges} hub edges), choices ${joins}, characters ${characters.length}, terms ${terms.length}, relationships ${relationships.length}`,
    `listeners ${units.filter((unit) => unit.listener).length}, translated ${units.filter((unit) => unit.translation).length}/${lineCount} lines`,
  ].join('\n');

  return {
    report,
    file: {
      format: 'loca/v1',
      project: { name: `현실형 샘플 ${size.toLocaleString()}줄`, description: '짧은 장면·허브·인물·용어가 있는 현실형 합성 데이터 (비용·규모 검증용)', sourceLanguage: 'en', targetLanguage: 'ko' },
      groups,
      units,
      graph: { nodeTypes: NODE_TYPES, nodes, edges },
      characters,
      relationships,
      documents,
      terms,
      speechRules,
    },
  };
}
