import { describe, expect, it } from 'vitest';
import { editorAiSchema, editorNodeConfig } from './editor-ai.ts';
import { chatTitle } from './agent.ts';
import { checkFormat, compileFormatRules, matchTokens } from './format-check.ts';
import { importFileSchema, importWarnings, summarizeImport } from './import-format.ts';
import { politenessOf, speechLevelOf, styleInstruction, styleNames } from './knowledge.ts';
import { ANALYSIS_WORKFLOW, analysisTemplate, defaultWorkflows, draftTranslationTemplate, eventExtractionTemplate, listenerTemplate, MODEL_TEMPLATES, peopleRelationsTemplate, speechFixTemplate, termExtractionTemplate, translationTemplate } from './defaults.ts';
import { APPLY_TARGETS } from './functions.ts';
import { AI_PRESETS, presetConfig } from './presets.ts';
import { applyIssues, nodePorts, pickPaths, readinessUses, validateWorkflow, workflowDefinitionSchema, workflowNodeSchema, type WorkflowDefinition } from './workflow.ts';

const model = { connectionId: 'c', model: 'm' };
const ids = { model, untranslated: 's0', draft: 's1', needsReview: 's2', confirmed: 's3' };
const refs = { connections: new Map([['c', 'openai']]), statusIds: new Set(['s0', 's1', 's2', 's3']), tagIds: new Set<string>(), toolConnectionIds: new Set<string>() };

describe('workflow validation', () => {
  it('accepts the draft translation template', () => {
    const template = workflowDefinitionSchema.parse(draftTranslationTemplate({ model, untranslated: ids.untranslated, draft: ids.draft }));
    expect(validateWorkflow(template, refs).filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('accepts the default template', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    expect(validateWorkflow(template, refs).filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('reports a deleted connection and an unconnected exit on the node', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const broken: WorkflowDefinition = { ...template, edges: template.edges.filter((edge) => edge.id !== 'check-pass-review') };
    const issues = validateWorkflow(broken, { ...refs, connections: new Map() });
    expect(issues).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'translate' }));
    expect(issues).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'check', message: expect.stringContaining('통과') }));
  });

  it('lets an exit send lines down several branches that end apart, with one changing the line', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const node = (id: string, config: Record<string, unknown>, type = 'function') => workflowNodeSchema.parse({ id, type, position: { x: 0, y: 0 }, config });
    const side = [node('terms', { output: 'json', scope: 'batch', fields: [{ name: 'terms', type: 'list', fields: [{ name: 'source', type: 'string' }] }], model }, 'ai'), node('add', { fn: 'saveTerms', params: { fromNodeId: 'terms', list: 'terms', map: { source: 'source' } } })];
    const sideEdges = [
      { id: 's1', source: 'review', sourceHandle: 'pass', target: 'terms' },
      { id: 's2', source: 'terms', sourceHandle: 'out', target: 'add' },
    ];
    const ok: WorkflowDefinition = { ...template, nodes: [...template.nodes, ...side], edges: [...template.edges, ...sideEdges] };
    expect(validateWorkflow(ok, refs).filter((issue) => issue.level === 'error')).toEqual([]);
    // Meeting at a node that does work: the line would be handled twice.
    const rejoined: WorkflowDefinition = { ...ok, edges: [...ok.edges, { id: 's3', source: 'add', sourceHandle: 'out', target: 'confirm' }] };
    expect(validateWorkflow(rejoined, refs)).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'review', message: expect.stringContaining('다시 만납니다') }));
    // Both branches setting the status.
    const twice: WorkflowDefinition = { ...ok, nodes: ok.nodes.map((n) => (n.id === 'add' ? node('add', { fn: 'setStatus', params: { statusId: 's1' } }) : n)) };
    expect(validateWorkflow(twice, refs)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('상태를 바꿉니다') }));
  });

  it('asks for a model on an AI node that has none yet', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate({ ...ids, model: { connectionId: '', model: '' } }));
    expect(validateWorkflow(template, refs)).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'translate', message: 'AI 연결과 모델을 고르세요.' }));
  });

  it('flags a deleted connection among the models sharing a node', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const shared: WorkflowDefinition = { ...template, nodes: template.nodes.map((n) => (n.type === 'ai' && n.id === 'review' ? { ...n, config: { ...n.config, extraModels: [{ connectionId: 'gone', model: 'm' }] } } : n)) };
    expect(validateWorkflow(shared, refs)).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'review', message: expect.stringContaining('추가한 모델') }));
  });

  it('warns about a loop that nothing can leave', () => {
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'a', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'setStatus' } },
        { id: 'b', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'setStatus' } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'a' },
        { id: '2', source: 'a', sourceHandle: 'out', target: 'b' },
        { id: '3', source: 'b', sourceHandle: 'out', target: 'a' },
      ],
    });
    expect(validateWorkflow(definition, refs)).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('순환') }));
  });
});

describe('node exits', () => {
  it('derive from config', () => {
    const verdict = workflowNodeSchema.parse({ id: 'a', type: 'ai', position: { x: 0, y: 0 }, config: { output: 'verdict' } });
    expect(nodePorts(verdict).map((port) => port.id)).toEqual(['pass', 'fail', 'error']);
    const script = workflowNodeSchema.parse({ id: 's', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'script', params: { ports: ['keep', 'retry'] } } });
    expect(nodePorts(script).map((port) => port.id)).toEqual(['keep', 'retry', 'error']);
  });

  it('flags an http node without a connection and an unknown function', () => {
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'h', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'http' } },
        { id: 'x', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'nope' } },
        { id: 'end', type: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'h' },
        { id: '2', source: 'h', sourceHandle: 'out', target: 'x' },
      ],
    });
    const issues = validateWorkflow(definition, refs);
    expect(issues).toContainEqual(expect.objectContaining({ nodeId: 'h', message: expect.stringContaining('HTTP') }));
    expect(issues).toContainEqual(expect.objectContaining({ nodeId: 'x', message: expect.stringContaining('알 수 없는 함수') }));
  });
});

describe('import format', () => {
  const base = {
    format: 'loca/v1',
    project: { name: 'Demo' },
    groups: [{ key: 'g1', title: 'Scene 1' }],
    units: [{ key: 'u1', group: 'g1', source: 'Hello' }],
  };

  it('fills defaults', () => {
    const file = importFileSchema.parse(base);
    expect(file.units[0].kind).toBe('dialogue');
    expect(file.project.targetLanguage).toBe('ko');
  });

  it('rejects dangling references with a path', () => {
    const result = importFileSchema.safeParse({
      ...base,
      units: [{ key: 'u1', group: 'missing', source: 'x' }],
      graph: { nodes: [{ key: 'n1', units: ['u9'] }], edges: [{ from: 'n1', to: 'n2' }] },
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['units.0.group', 'graph.nodes.0.units', 'graph.edges.0.to']));
  });

  it('only takes the current format name', () => {
    expect(importFileSchema.safeParse({ ...base, format: 'translation-workbench/v1' }).success).toBe(false);
  });

  it('checks the line keys that speech rules, relationship changes and events point to', () => {
    const result = importFileSchema.safeParse({
      ...base,
      characters: [{ name: 'A' }, { name: 'B', player: true }],
      relationships: [{ from: 'A', to: 'B', kind: 'friend', changes: [{ at: 'u9', change: 'falls out' }] }],
      speechRules: [{ from: 'A', to: 'B', level: 'haeyo' }, { from: 'A', to: 'B', level: 'hae', start: 'u9' }],
      events: [{ title: 'Fight', evidence: ['u1', 'u8'] }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toEqual(['relationships.0.changes.0.at', 'speechRules.1.start', 'events.0.evidence.1']);
  });

  it('warns about lines outside the graph and unknown speakers, and counts sources not for translation', () => {
    const file = importFileSchema.parse({
      ...base,
      units: [
        { key: 'u1', group: 'g1', speaker: 'Alice', source: 'Hi' },
        { key: 'u2', group: 'g1', speaker: 'Bob', source: ' ' },
      ],
      graph: { nodes: [{ key: 'n1', units: ['u1'] }], edges: [] },
      characters: [{ name: 'Alice' }],
    });
    expect(importWarnings(file).map((warning) => warning.examples)).toEqual([['u2'], ['Bob']]);
    expect(summarizeImport(file)).toMatchObject({ excluded: 1, excludedBy: { empty: 1 } });
  });
});

describe('format check', () => {
  const all = { placeholders: true, tags: true, newlines: true, emptyText: true };
  it('passes when tokens are preserved in another order', () => {
    expect(checkFormat('<b>{name}</b> has %d items', '%d개를 가진 <b>{name}</b>', all)).toEqual([]);
  });
  it('flags missing placeholder, tag and newline', () => {
    const codes = checkFormat('Hi {name}\n<color=red>x</color>', '안녕', all).map((issue) => issue.code);
    expect(codes).toEqual(['placeholder', 'tag', 'newline']);
  });
  it('flags numbers that did not come through, ignoring those inside tokens', () => {
    const extra = { ...all, numbers: true };
    expect(checkFormat('AUG 15TH, 2038 {0}', '2038년 8월 15일 {0}', extra)).toEqual([]);
    expect(checkFormat('PM 08:29 <size=12>', '오후 8:29 <size=12>', extra).map((issue) => issue.code)).toEqual(['number']);
  });
  it('flags doubled and edge spaces the source does not have', () => {
    const extra = { ...all, spaces: true };
    expect(checkFormat('Hello there', '안녕  하세요 ', extra)[0]?.message).toContain('이중 공백 · 뒤 공백');
    expect(checkFormat(' Hello', ' 안녕', extra)).toEqual([]);
  });
  it('flags a particle after a variable unless it is the combined form', () => {
    const extra = { ...all, particles: true };
    expect(checkFormat('Take {item}.', '{item}을 가져가.', extra).map((issue) => issue.code)).toEqual(['particle']);
    expect(checkFormat('Take {item}.', '{item}을(를) 가져가.', extra)).toEqual([]);
    expect(checkFormat('Hi {name}', '{name} 씨, 안녕', extra)).toEqual([]);
    expect(checkFormat('{name} is here', '{name}이다', extra)).toEqual([]);
  });
  it('does not treat comparisons as tags', () => {
    expect(checkFormat('x < 3 and y > 2', 'x는 3 미만, y는 2 초과', { ...all, newlines: false })).toEqual([]);
  });
});

describe('templates', () => {
  const kinds = (definition: WorkflowDefinition) => definition.nodes.map((node) => (node.type === 'function' ? node.config.fn : node.type));
  const errors = (definition: WorkflowDefinition) => validateWorkflow(workflowDefinitionSchema.parse(definition), refs).filter((issue) => issue.level === 'error');

  it('term extraction template is entry → AI → save terms, proposing', () => {
    const definition = workflowDefinitionSchema.parse(termExtractionTemplate({ model }));
    expect(errors(definition)).toEqual([]);
    expect(kinds(definition)).toEqual(['entry', 'ai', 'saveTerms', 'condition', 'fail']);
    expect(definition.nodes[2]).toMatchObject({ config: { params: { fromNodeId: 'terms', list: 'terms', propose: true, map: { source: 'source', target: 'target', kind: 'kind', meaning: 'meaning', evidence: 'evidence' } } } });
  });

  it('every default workflow and template is valid, with every apply node mapped from the AI node it names', () => {
    const all = [
      ...defaultWorkflows({ model, untranslated: 's0', draft: 's1' }).map((row) => row.definition),
      ...Object.values(MODEL_TEMPLATES).map((make) => make({ model })),
      translationTemplate(ids),
      peopleRelationsTemplate({ model }),
      eventExtractionTemplate({ model }),
      speechFixTemplate({ model }),
    ];
    for (const definition of all) {
      expect(errors(definition)).toEqual([]);
      for (const node of definition.nodes) if (node.type === 'function' && node.config.fn in APPLY_TARGETS) expect(applyIssues(definition, node.config.fn as keyof typeof APPLY_TARGETS, node.config.params as never)).toEqual([]);
    }
    expect(defaultWorkflows({ model }).map((row) => row.name)).toEqual(['청자 추정', '용어 추출', '용어 번역', '인물·관계 추출', '사건 추출', ANALYSIS_WORKFLOW]);
  });

  it('maps every field an analysis list produces that its save node accepts', () => {
    const analysis = analysisTemplate({ model });
    for (const node of analysis.nodes) {
      if (node.type !== 'function' || !(node.config.fn in APPLY_TARGETS) || !node.config.params.list) continue;
      // Each save reads its own source: the analysis itself, or the node that combines its parts.
      const fields = node.config.params.fromNodeId === 'merge' ? AI_PRESETS.analysisMerge.fields : AI_PRESETS.analysis.fields;
      const items = fields.find((field) => field.name === node.config.params.list)?.fields?.map((field) => field.name) ?? [];
      const accepted = APPLY_TARGETS[node.config.fn as keyof typeof APPLY_TARGETS].fields.map((field) => field.name).filter((name) => items.includes(name));
      expect(Object.keys(node.config.params.map as object)).toEqual(expect.arrayContaining(accepted));
    }
  });

  it('writes translations itself in the translation templates and keeps the listener flow explicit', () => {
    expect(kinds(draftTranslationTemplate({ model, untranslated: 's0', draft: 's1' }))).toEqual(['entry', 'ai', 'saveCandidate', 'formatCheck', 'setStatus', 'condition', 'fail']);
    const saved = translationTemplate(ids).nodes.find((node) => node.id === 'save');
    expect(saved).toMatchObject({ config: { fn: 'saveCandidate', params: { propose: false, asCandidate: false, map: { text: 'text' } } } });
    const listener = listenerTemplate({ model });
    expect(kinds(listener)).toEqual(['entry', 'condition', 'ai', 'condition', 'setListener', 'condition', 'fail']);
    expect(listener.nodes.find((node) => node.id === 'set-listener')).toMatchObject({ config: { params: { map: { listener: 'value', confidence: 'confidence' } } } });
  });

  it('checkFormat supports customRules and particlesPattern', () => {
    const issues = checkFormat(
      'Welcome to {city} [RANK_1]!',
      '환영합니다 {city}을!',
      {
        placeholders: true,
        tags: true,
        newlines: true,
        emptyText: true,
        particles: true,
        customRules: [
          { label: '영어 잔존 금지', kind: 'forbidden', pattern: '[A-Za-z]{4,}' },
          { label: '랭크 보존', kind: 'preserve', pattern: '\\[RANK_\\d+\\]' },
          { label: '마침표 필수', kind: 'targetRequired', pattern: '[.!]$' },
        ],
      },
    );
    expect(issues.map((i) => i.code)).toContain('particle');
    expect(issues.some((i) => i.code === 'custom' && i.message.includes('랭크 보존'))).toBe(true);
  });
});

describe('speech level guess', () => {
  it('reads the last sentence ending and ignores tags and trailing punctuation', () => {
    expect(speechLevelOf('알겠습니다.')).toBe('hasipsio');
    expect(speechLevelOf('<b>정말요?</b>')).toBe('haeyo');
    expect(speechLevelOf('그만해, {name}!')).toBe('hae');
    expect(speechLevelOf('어서 가거라.')).toBe('haera');
    expect(speechLevelOf('아냐')).toBe('hae');
    expect(speechLevelOf('자네도 왔는가?')).toBe('hage');
    expect(speechLevelOf('어서 오시오.')).toBe('hao');
    expect(speechLevelOf('OK')).toBeNull();
  });

  it.each([
    // [text, level]
    ['그렇죠?', 'haeyo'], ['이리 오시죠', 'haeyo'], ['누구시죠', 'haeyo'], ['그렇지요.', 'haeyo'],
    ['전하, 소신이 아뢰나이다.', 'hasoseo'], ['어찌하오리까... 아니, 어찌하나이까?', 'hasoseo'], ['굽어살피소서', 'hasoseo'],
    ['갑시다', 'hasipsio'], ['조사를 시작합시다', 'hasipsio'], ['앉읍시다.', 'hasipsio'], ['합니까?', 'hasipsio'],
    ['네.', null], ['예, 수사관님.', null], ['수사관님!', null], ['응', null], ['예', null],
    ['주소.', null], ['라디오', null], ['용의자.', null], ['아버지', null], ['한국어', null], ['그러니까', null],
    ['그랬던가?', 'hae'], ['뭐하는가?', 'hage'],
    ['안산다', 'haera'], ['저녁먹는다!', 'haera'], ['같이 가자.', 'haera'], ['가자', 'haera'],
    ['괜찮아', 'hae'], ['그래, 맞지', 'hae'],
  ] as const)('guesses %j as %s', (text, level) => {
    expect(speechLevelOf(text)).toBe(level);
  });

  it('maps levels to the polite/plain axis and null when unsure', () => {
    expect(politenessOf('알겠습니다.')).toBe('polite');
    expect(politenessOf('정말요?')).toBe('polite');
    expect(politenessOf('어서 오시오.')).toBe('polite');
    expect(politenessOf('알았어.')).toBe('plain');
    expect(politenessOf('안산다')).toBe('plain');
    expect(politenessOf('자네도 왔는가?')).toBe('plain');
    expect(politenessOf('네.')).toBeNull();
    expect(politenessOf('OK')).toBeNull();
  });
});

describe('styleInstruction', () => {
  it('turns the picked axes into plain instructions and leaves 보통 out', () => {
    expect(styleInstruction({})).toBeUndefined();
    expect(styleInstruction({ length: 'concise', ornament: 'florid' })).toBe('Korean style: short sentences; few connectives and modifiers; rich modifiers, imagery and figures of speech.');
    expect(styleNames({ force: 'soft' })).toEqual(['우유체']);
  });
});

import { isIdentifierLabel } from './labels.ts';
describe('isIdentifierLabel', () => {
  it('flags identifiers and keeps human text', () => {
    for (const id of ['tps-01-game-intro', 'tps-01-game-rules1-hub0', 'rules-whotaughtyou=0', 'a_b', 'x.y']) expect(isIdentifierLabel(id)).toBe(true);
    expect(isIdentifierLabel('intro', new Set(['intro']))).toBe(true);
    for (const text of ['Half-goblin. Thief. Ok.', 'Late', 'Sibling 0']) expect(isIdentifierLabel(text)).toBe(false);
  });
});

describe('run readiness', () => {
  it('follows the context the AI nodes send, whatever they output', () => {
    expect(readinessUses(translationTemplate(ids))).toEqual({ speech: true, glossary: true });
    expect(readinessUses(analysisTemplate({ model }))).toEqual({ speech: false, glossary: false });
    expect(readinessUses(listenerTemplate({ model }))).toEqual({ speech: false, glossary: false });
    // Term extraction is sent the glossary (to skip known terms), so unreviewed terms matter to it.
    expect(readinessUses(termExtractionTemplate({ model }))).toEqual({ speech: false, glossary: true });
  });
});

describe('analysis workflow and presets', () => {
  it('keeps the default analysis workflow name', () => {
    expect(ANALYSIS_WORKFLOW).toBe('작품 분석');
  });

  it('builds the work analysis: per-part saves in a chain, people and the overview gathered and combined once', () => {
    const definition = workflowDefinitionSchema.parse(analysisTemplate({ model }));
    expect(definition.nodes.map((node) => (node.type === 'function' ? node.config.fn : node.type))).toEqual(['entry', 'ai', 'saveRelationships', 'saveSpeechRules', 'saveEvents', 'saveTerms', 'saveSceneListeners', 'gather', 'ai', 'saveCharacters', 'saveDocument', 'condition', 'fail', 'condition', 'fail']);
    // Per-part saves in a chain; people and the overview through 모으기 → 결과 합치기; a retry path behind each AI node.
    expect(definition.edges.filter((edge) => edge.source === 'analysis').map((edge) => [edge.sourceHandle, edge.target])).toEqual([['out', 'save-relationships'], ['out', 'gather'], ['error', 'analysis-again']]);
    expect(definition.nodes.find((node) => node.id === 'merge')).toMatchObject({ config: { preset: 'analysisMerge', input: { from: 'gather', lines: false } } });
    expect(validateWorkflow(definition, { statusIds: new Set(), connections: new Set(['c']) } as never).filter((issue) => issue.level === 'error').map((issue) => issue.message)).toEqual([]);
    expect(definition.nodes.find((node) => node.id === 'save-overview')).toMatchObject({ config: { params: { fromNodeId: 'merge', map: { title: 'overviewTitle', body: 'overview' } } } });
  });

  it('fills an analysis AI node from its preset: json, whole script, every rule in the visible instructions', () => {
    const config = presetConfig('analysis', model);
    expect(config).toMatchObject({ output: 'json', scope: 'batch', preset: 'analysis', batch: { mode: 'whole', maxTokens: null }, context: { cast: true } });
    expect(config.fields.map((field) => field.name)).toEqual(['overviewTitle', 'overview', 'characters', 'relationships', 'events', 'speechRules', 'sceneListeners', 'terms']);
    for (const word of ['Do NOT use prior knowledge', 'player character', 'hasoseo', 'exceptions', 'loanword']) expect(config.instructions).toContain(word);
    expect(workflowNodeSchema.parse({ id: 'a', type: 'ai', position: { x: 0, y: 0 }, config }).type).toBe('ai');
  });

  it('presets match their output forms', () => {
    expect(AI_PRESETS.listener).toMatchObject({ output: 'json', scope: 'line' });
    expect(AI_PRESETS.listener.fields.map((field) => field.name)).toEqual(['value', 'confidence', 'reason']);
    for (const id of ['terms', 'knowledge', 'events'] as const) expect(AI_PRESETS[id]).toMatchObject({ output: 'json', scope: 'batch' });
    expect(AI_PRESETS.review.output).toBe('verdict');
  });
});

describe('chatTitle', () => {
  it('names the topic instead of repeating the request', () => {
    expect(chatTitle('지금 진행 상황을 요약해줘')).toBe('진행 상황 요약');
    expect(chatTitle('MIRA 말투 규칙 확인해 주세요.')).toBe('MIRA 말투 규칙 확인');
    expect(chatTitle('용어집에 relay station 추가해줘')).toBe('용어집에 relay station 추가');
    expect(chatTitle('번역이 왜 멈췄어?')).toBe('번역이 왜 멈췄어');
    expect(chatTitle('첫 문장. 둘째 문장은 길다')).toBe('첫 문장');
    expect(chatTitle('a'.repeat(40))).toHaveLength(24);
    expect(chatTitle('해줘')).toBe('해줘');
  });
});

describe('printf placeholders', () => {
  it('match %s, %d, %1$s and %.2f but not a percent sign followed by a word', () => {
    const pattern = compileFormatRules({ presets: ['printf'], custom: [] }).placeholder;
    expect(matchTokens('Got %s and %d, %1$s at %.2f', pattern)).toEqual(['%s', '%d', '%1$s', '%.2f']);
    expect(matchTokens('A 50% interest rate, 100% done', pattern)).toEqual([]);
  });
});

describe('editor AI settings', () => {
  it('shares one model, context and time limit between AI 번역 and 다듬기, each with its preset instructions until changed', () => {
    const empty = editorAiSchema.parse({});
    expect(empty).toMatchObject({ model: { connectionId: '', model: '' }, timeoutMinutes: 2, translate: { instructions: AI_PRESETS.translate.instructions } });
    expect(empty.refine.include).toMatchObject({ candidate: true });
    expect(empty.complete).toMatchObject({ enabled: false, model: null, precedingLines: 3, glossary: true, speech: true, timeoutSeconds: 15, dailyCap: 200 });
    // The node a button makes: its preset's output with the shared settings.
    const refine = editorNodeConfig(empty, 'refine');
    expect(refine).toMatchObject({ preset: 'refine', output: 'json', timeoutMinutes: 2 });
    expect(refine.fields.map((field) => field.name)).toEqual(['text', 'changes']);
    const set = editorAiSchema.parse({ model: { connectionId: 'c', model: 'm' }, translate: { instructions: 'Mine.' }, complete: { enabled: true, model: { connectionId: 'c', model: 'fast' } } });
    expect(editorNodeConfig(set, 'translate')).toMatchObject({ model: { connectionId: 'c', model: 'm' }, instructions: 'Mine.', output: 'text' });
    expect(editorNodeConfig(set, 'refine').model).toEqual({ connectionId: 'c', model: 'm' });
    expect(set.complete).toMatchObject({ enabled: true, model: { connectionId: 'c', model: 'fast' }, timeoutSeconds: 15 });
  });
});

describe('AI node input', () => {
  it('trims an output to paths, through lists', () => {
    const output = { overview: 'x', characters: [{ name: 'A', aliases: ['a'], profile: 'p' }], terms: [] };
    expect(pickPaths(output, [])).toBe(output);
    expect(pickPaths(output, ['overview', 'characters.name', 'characters.aliases'])).toEqual({ overview: 'x', characters: [{ name: 'A', aliases: ['a'] }] });
    expect(pickPaths(output, ['characters'])).toEqual({ characters: output.characters });
  });

  it('takes only an earlier AI or script node, and sends no lines only for a json answer of the whole request', () => {
    const model = { connectionId: 'c', model: 'm' };
    const ai = (id: string, config: Record<string, unknown>) => ({ id, type: 'ai', position: { x: 0, y: 0 }, config: { model, instructions: 'x', ...config } });
    const check = (nodes: object[], edges: [string, string][]) =>
      validateWorkflow(workflowDefinitionSchema.parse({ nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, ...nodes], edges: edges.map(([source, target], i) => ({ id: String(i), source, sourceHandle: 'out', target })) }), { statusIds: new Set(), connections: new Set(['c']) } as never)
        .filter((issue) => issue.level === 'error')
        .map((issue) => issue.message);
    expect(check([ai('a', {}), ai('b', { input: { from: 'a' } })], [['entry', 'a'], ['a', 'b']])).toEqual([]);
    expect(check([ai('a', { input: { from: 'b' } }), ai('b', {})], [['entry', 'a'], ['a', 'b']])).toContainEqual(expect.stringContaining('앞에 있어야'));
    expect(check([ai('a', {}), ai('b', { input: { from: 'a', lines: false } })], [['entry', 'a'], ['a', 'b']])).toContainEqual(expect.stringContaining('대사 없이'));
  });
});
