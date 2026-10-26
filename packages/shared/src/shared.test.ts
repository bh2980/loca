import { describe, expect, it } from 'vitest';
import { editorAiSchema, editorNodeConfig } from './editor-ai.ts';
import { chatTitle } from './agent.ts';
import { checkFormat, compileFormatRules, matchTokens } from './format-check.ts';
import { importFileSchema, importWarnings, summarizeImport } from './import-format.ts';
import { politenessOf, speechLevelOf, styleInstruction, styleNames } from './knowledge.ts';
import { ANALYSIS_WORKFLOW, analysisTemplate, defaultWorkflows, eventExtractionTemplate, listenerTemplate, peopleRelationsTemplate, termExtractionTemplate, translationTemplate, WORKFLOW_TEMPLATES } from './defaults.ts';
import { APPLY_TARGETS } from './functions.ts';
import { AI_PRESETS, AI_PROMPTS, presetConfig } from './presets.ts';
import { CONTEXT_FIELDS } from './context.ts';
import { APPLY_PALETTE_ORDER, fieldsFromSample, FUNCTION_NAMES, functionGroup } from './functions.ts';
import { applyIssues, contextConfigSchema, nodeOutputFields, nodePorts, pickPaths, previousStepId, previousSteps, readinessUses, retrySummary, retryModel, retryOrigins, retryScaleText, resendsOf, definitionModels, ITEM_ERROR_KINDS, validateWorkflow, workflowDefinitionSchema, workflowNodeSchema, type RetryNode, type WorkflowDefinition, type WorkflowNode } from './workflow.ts';

const model = { connectionId: 'c', model: 'm' };
const ids = { model, untranslated: 's0', translated: 's1', needsReview: 's2', confirmed: 's3', aiFailedTag: 't0' };
const refs = { workflows: [], connections: new Map([['c', 'openai']]), statusIds: new Set(['s0', 's1', 's2', 's3']), tagIds: new Set(['t0']), toolConnectionIds: new Set<string>() };

describe('인물·관계 추출 template and the talking pairs', () => {
  it('turns 대화 쌍 on for the scene node and the merge node, and carries the pairs without a relationship through the gather to 관계 저장', () => {
    const definition = workflowDefinitionSchema.parse(peopleRelationsTemplate(ids));
    const node = (id: string) => definition.nodes.find((entry) => entry.id === id) as unknown as { config: Record<string, any> };
    expect(node('people').config.context).toMatchObject({ pairs: true, pairMinTurns: 3 });
    expect(node('merge').config.context).toMatchObject({ pairs: true, pairMinTurns: 3 });
    expect(node('gather').config.fields).toEqual(expect.arrayContaining(['pairsWithoutRelationship.between', 'pairsWithoutRelationship.reason']));
    expect(node('people').config.fields.map((field: { name: string }) => field.name)).toContain('pairsWithoutRelationship');
    expect(node('merge').config.fields.map((field: { name: string }) => field.name)).toContain('unresolvedPairs');
    expect(node('save-relationships').config.params.unresolved).toBe('unresolvedPairs');
    expect(node('people').config.instructions).toContain('pairsWithoutRelationship');
    expect(node('merge').config.instructions).toContain('unresolvedPairs');
    // Non-people and the kind of an unresolved pair ride the same way.
    expect(node('gather').config.fields).toEqual(expect.arrayContaining(['pairsWithoutRelationship.kind', 'notPeople.name', 'notPeople.reason']));
    for (const id of ['people', 'merge']) expect(node(id).config.fields.map((field: { name: string }) => field.name)).toContain('notPeople');
    for (const [id, list] of [['people', 'pairsWithoutRelationship'], ['merge', 'unresolvedPairs']] as const) {
      const kind = node(id).config.fields.find((field: { name: string }) => field.name === list).fields.find((field: { name: string }) => field.name === 'kind');
      expect(kind).toMatchObject({ required: true });
      expect(kind.description).toContain('notPerson, noEvidence, undecided');
    }
    expect(node('save-characters').config.params.notPeople).toBe('notPeople');
    expect(node('people').config.instructions).toContain('is not a character');
    expect(node('merge').config.instructions).toContain('Inspector Voltaire');
    expect(node('merge').config.instructions).toContain('never in "characters"');
  });

  it('keeps the 대화 쌍 setting inside its bounds and off by default', () => {
    expect(contextConfigSchema.parse({})).toMatchObject({ pairs: false, pairMinTurns: 3 });
    expect(contextConfigSchema.safeParse({ pairMinTurns: 0 }).success).toBe(false);
    expect(contextConfigSchema.safeParse({ pairMinTurns: 21 }).success).toBe(false);
    expect(CONTEXT_FIELDS.pairs.help).toContain('이 횟수 이상인 쌍만 보냅니다');
  });
});

describe('workflow validation', () => {
  it('every registry template validates without issues when all ids are given', () => {
    expect(WORKFLOW_TEMPLATES.map((template) => template.key)).toEqual(['translation', 'listener', 'people', 'events', 'terms', 'termTranslate']);
    for (const template of WORKFLOW_TEMPLATES) {
      const definition = workflowDefinitionSchema.parse(template.build({ ...ids, aiFailedTag: 't0' }));
      expect(validateWorkflow(definition, refs), template.key).toEqual([]);
    }
    expect(defaultWorkflows(ids).map((row) => row.name)).toEqual(['번역', '청자 추정', '인물·관계 추출', '사건 추출']);
  });

  it('accepts the default template', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    expect(validateWorkflow(template, refs).filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('wires the checks\' exits through 태그 붙이기 / 떼기 nodes: fail adds its kinds, pass removes only those', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const tag = (id: string) => (template.nodes.find((node) => node.id === id) as unknown as { config: { fn: string; params: { action: string; map: Record<string, string>; allKinds: boolean } } }).config;
    expect(tag('tag-format').params).toMatchObject({ action: 'add', map: { tag: 'kind' } });
    expect(tag('untag-format').params).toMatchObject({ action: 'remove', map: { tag: 'kind' }, allKinds: false });
    expect(tag('tag-review').params).toMatchObject({ action: 'add', map: { tag: 'categories' } });
    expect(tag('untag-review').params).toMatchObject({ action: 'remove', allKinds: true });
    const exit = (source: string, handle: string) => template.edges.find((edge) => edge.source === source && edge.sourceHandle === handle)?.target;
    expect([exit('check', 'fail'), exit('check', 'pass'), exit('review', 'fail'), exit('review', 'pass')]).toEqual(['tag-format', 'untag-format', 'tag-review', 'untag-review']);
    // A node that picks nothing to tag is told so.
    const empty = { ...template, nodes: template.nodes.map((node) => (node.id === 'tag-format' ? { ...node, config: { ...node.config, params: { action: 'add' } } } : node)) } as WorkflowDefinition;
    expect(validateWorkflow(empty, refs)).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'tag-format', message: expect.stringContaining('태그를 고르') }));
  });

  it('reports a deleted connection and an unconnected exit on the node', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const broken: WorkflowDefinition = { ...template, edges: template.edges.filter((edge) => edge.id !== 'check-pass-untag-format') };
    const issues = validateWorkflow(broken, { ...refs, connections: new Map() });
    expect(issues).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'translate' }));
    expect(issues).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'check', message: expect.stringContaining('통과') }));
  });

  it('lets an exit send lines down several branches that end apart, with one changing the line', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const node = (id: string, config: Record<string, unknown>, type = 'function') => workflowNodeSchema.parse({ id, type, position: { x: 0, y: 0 }, config });
    const side = [node('side-terms', { output: 'json', scope: 'batch', fields: [{ name: 'terms', type: 'list', fields: [{ name: 'source', type: 'string' }] }], model }, 'ai'), node('side-add', { fn: 'saveTerms', params: { list: 'terms', map: { source: 'source' } } })];
    const sideEdges = [
      { id: 's1', source: 'review', sourceHandle: 'pass', target: 'side-terms' },
      { id: 's2', source: 'side-terms', sourceHandle: 'out', target: 'side-add' },
    ];
    const ok: WorkflowDefinition = { ...template, nodes: [...template.nodes, ...side], edges: [...template.edges, ...sideEdges] };
    expect(validateWorkflow(ok, refs).filter((issue) => issue.level === 'error')).toEqual([]);
    // Meeting at a node that does work: the line would be handled twice.
    const rejoined: WorkflowDefinition = { ...ok, edges: [...ok.edges, { id: 's3', source: 'side-add', sourceHandle: 'out', target: 'confirm' }] };
    expect(validateWorkflow(rejoined, refs)).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'review', message: expect.stringContaining('다시 만납니다') }));
    // Both branches setting the status.
    const twice: WorkflowDefinition = { ...ok, nodes: ok.nodes.map((n) => (n.id === 'side-add' ? node('side-add', { fn: 'setStatus', params: { statusId: 's1' } }) : n)) };
    expect(validateWorkflow(twice, refs)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('상태를 바꿉니다') }));
  });

  it('asks for a model on an AI node that has none yet', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate({ ...ids, model: { connectionId: '', model: '' } }));
    expect(validateWorkflow(template, refs)).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'translate', message: 'AI 연결과 모델을 고르세요.' }));
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

  it('does not warn about the loop through a 재요청 node, which leaves after its count', () => {
    const definition = workflowDefinitionSchema.parse(translationTemplate(ids));
    expect(definition.nodes.some((node) => node.type === 'retry')).toBe(true);
    expect(validateWorkflow(definition, refs)).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('순환') }));
  });
});

describe('node exits', () => {
  it('derive from config', () => {
    const verdict = workflowNodeSchema.parse({ id: 'a', type: 'ai', position: { x: 0, y: 0 }, config: { output: 'verdict' } });
    expect(nodePorts(verdict).map((port) => port.id)).toEqual(['pass', 'fail', 'error']);
    const script = workflowNodeSchema.parse({ id: 's', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'script', params: { ports: ['keep', 'retry'] } } });
    expect(nodePorts(script).map((port) => port.id)).toEqual(['keep', 'retry', 'error']);
  });

  it('gives function nodes their own 동시 처리 수 and drops the old workflow-wide one', () => {
    const node = workflowNodeSchema.parse({ id: 'h', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'http' } });
    expect(node.type === 'function' && node.config.concurrency).toBe(2);
    expect(workflowNodeSchema.safeParse({ ...node, config: { ...node.config, concurrency: 9 } }).success).toBe(false);
    const definition = workflowDefinitionSchema.parse({ nodes: [], edges: [], settings: { maxVisitsPerNode: 4, concurrency: 8, maxConsecutiveFailures: 7 } });
    expect(definition.settings).toEqual({ maxVisitsPerNode: 4, maxConsecutiveFailures: 7 });
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
      relationships: [{ from: 'A', to: 'B', kind: 'friend', changes: [{ at: 'u9', kind: 'enemy' }] }],
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

  it('term extraction template is entry → AI (→ 재요청 → 재요청) → save terms, written directly', () => {
    const definition = workflowDefinitionSchema.parse(termExtractionTemplate(ids));
    expect(errors(definition)).toEqual([]);
    expect(kinds(definition)).toEqual(['entry', 'ai', 'retry', 'retry', 'tagLines', 'saveTerms']);
    expect(definition.nodes.find((node) => node.id === 'save-terms')).toMatchObject({ config: { params: { list: 'terms', map: { source: 'source', target: 'target', kind: 'kind', meaning: 'meaning', evidence: 'evidence' } } } });
  });

  it('people template gathers the people, relationships and speech rules of every scene, merges them once and saves each list once, the people as proposals where a person owns the profile', () => {
    const definition = workflowDefinitionSchema.parse(peopleRelationsTemplate(ids));
    expect(errors(definition)).toEqual([]);
    expect(kinds(definition)).toEqual(['entry', 'ai', 'retry', 'retry', 'tagLines', 'gather', 'ai', 'retry', 'retry', 'saveCharacters', 'saveRelationships', 'saveSpeechRules']);
    expect(definition.edges.filter((edge) => edge.sourceHandle === 'out').map((edge) => `${edge.source}>${edge.target}`)).toEqual([
      'entry>people', 'people>gather', 'gather>merge', 'merge>save-characters', 'save-characters>save-relationships', 'save-relationships>save-speech-rules',
    ]);
    // Nothing is saved before the merge.
    const saves = definition.nodes.filter((node) => node.type === 'function' && node.config.fn.startsWith('save'));
    const order = definition.nodes.map((node) => node.id);
    expect(saves.every((node) => order.indexOf(node.id) > order.indexOf('merge'))).toBe(true);
    expect(definition.nodes.find((node) => node.id === 'gather')).toMatchObject({
      config: { fields: expect.arrayContaining(['characters.name', 'characters.aliases', 'characters.newFacts.text', 'characters.newFacts.evidence', 'characters.newSpeech.text', 'relationships.between', 'relationships.views.from', 'relationships.views.changes.at', 'relationships.views.changes.kind', 'relationships.views.evidence', 'speechRules.fromName', 'speechRules.startKey', 'speechRules.evidence']) },
    });
    expect(definition.nodes.find((node) => node.id === 'merge')).toMatchObject({ config: { input: { previous: true, lines: false }, output: 'json', scope: 'batch' } });
    // 인물 저장 has no setting: new facts are always appended.
    expect((definition.nodes.find((node) => node.id === 'save-characters') as { config: { params: Record<string, unknown> } }).config.params).not.toHaveProperty('profiles');
    expect(definition.nodes.find((node) => node.id === 'save-characters')).toMatchObject({ config: { params: { map: { newFacts: 'newFacts', newSpeech: 'newSpeech' } } } });
    expect(APPLY_TARGETS.saveCharacters.fields.map((field) => field.name)).not.toContain('profile');
    // Every path the gather keeps is a field the scene AI produces, and the merge returns the same fields as the scene reading (people without evidence).
    const names = (preset: 'knowledge' | 'peopleMerge', list: string) => AI_PROMPTS[preset].fields.find((field) => field.name === list)!.fields!.map((field) => field.name);
    expect(names('peopleMerge', 'characters')).toEqual(names('knowledge', 'characters').filter((name) => name !== 'evidence'));
    expect(names('peopleMerge', 'relationships')).toEqual(names('knowledge', 'relationships'));
    expect(names('peopleMerge', 'speechRules')).toEqual(names('knowledge', 'speechRules'));
    expect(definition.nodes.find((node) => node.id === 'save-relationships')).toMatchObject({ config: { params: { list: 'relationships', map: { views: 'views' } } } });
  });

  it('every default workflow and template is valid, with every apply node mapped from the step before it', () => {
    const all = [
      ...defaultWorkflows(ids).map((row) => row.definition),
      ...WORKFLOW_TEMPLATES.map((template) => template.build(ids)),
      peopleRelationsTemplate(ids),
      eventExtractionTemplate(ids),
    ];
    for (const definition of all) {
      expect(errors(definition)).toEqual([]);
      for (const node of definition.nodes) if (node.type === 'function' && node.config.fn in APPLY_TARGETS) expect(applyIssues(definition, node.id, node.config.fn as keyof typeof APPLY_TARGETS, node.config.params as never)).toEqual([]);
    }
    expect(WORKFLOW_TEMPLATES.map((template) => template.name)).toEqual(['번역', '청자 추정', '인물·관계 추출', '사건 추출', '용어 추출', '용어 번역']);
  });

  it('maps every field an analysis list produces that its save node accepts', () => {
    const analysis = analysisTemplate(ids);
    for (const node of analysis.nodes) {
      if (node.type !== 'function' || !(node.config.fn in APPLY_TARGETS) || !node.config.params.list) continue;
      const fields = AI_PROMPTS.analysis.fields;
      const items = fields.find((field) => field.name === node.config.params.list)?.fields?.map((field) => field.name) ?? [];
      const accepted = APPLY_TARGETS[node.config.fn as keyof typeof APPLY_TARGETS].fields.map((field) => field.name).filter((name) => items.includes(name));
      expect(Object.keys(node.config.params.map as object)).toEqual(expect.arrayContaining(accepted));
    }
  });

  it('writes translations itself in the translation templates and keeps the listener flow explicit', () => {
    const saved = translationTemplate(ids).nodes.find((node) => node.id === 'save');
    expect(saved).toMatchObject({ config: { fn: 'saveCandidate', params: { map: { text: 'text' } } } });
    const listener = listenerTemplate(ids);
    expect(kinds(listener)).toEqual(['entry', 'ai', 'retry', 'retry', 'tagLines', 'setListener']);
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
    expect(readinessUses(analysisTemplate(ids))).toEqual({ speech: false, glossary: false });
    expect(readinessUses(listenerTemplate(ids))).toEqual({ speech: false, glossary: false });
    // Term extraction is sent the glossary (to skip known terms), so unreviewed terms matter to it.
    expect(readinessUses(termExtractionTemplate(ids))).toEqual({ speech: false, glossary: true });
  });
});

describe('재요청 node', () => {
  const retryNode = (id: string, config: object = {}): WorkflowNode => workflowNodeSchema.parse({ id, type: 'retry', position: { x: 0, y: 0 }, config });
  const aiNode = (id: string): WorkflowNode => workflowNodeSchema.parse({ id, type: 'ai', position: { x: 0, y: 0 }, config: { model } });
  const entry: WorkflowNode = { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { input: 'lines' } };
  const edge = (source: string, sourceHandle: string, target: string) => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target });

  it('fills defaults, keeps its limits and has the exits 다시 보냄 and 오류', () => {
    const node = retryNode('r');
    expect(node).toMatchObject({ config: { kinds: ['cut-off'], scale: 0.5, maxTimes: 2, wait: 0, model: null } });
    expect(nodePorts(node)).toEqual([{ id: 'retry', label: '다시 보냄' }, { id: 'error', label: '오류' }]);
    expect(workflowNodeSchema.safeParse({ ...node, config: { scale: 1.05 } }).success).toBe(false);
    expect(workflowNodeSchema.safeParse({ ...node, config: { scale: 0.05 } }).success).toBe(false);
    expect(workflowNodeSchema.safeParse({ ...node, config: { maxTimes: 6 } }).success).toBe(false);
    expect(workflowNodeSchema.safeParse({ ...node, config: { wait: -1 } }).success).toBe(false);
    expect(workflowNodeSchema.safeParse({ ...node, config: { wait: 3601 } }).success).toBe(false);
    expect(workflowNodeSchema.safeParse({ ...node, config: { kinds: ['nope'] } }).success).toBe(false);
  });

  it('accepts the new error kinds, a scale of 1 (그대로), a wait and another model', () => {
    const node = retryNode('r', { kinds: ['rate-limit', 'network'], scale: 1, wait: 60, maxTimes: 3, model: { connectionId: 'c', model: 'other', effort: 'low' } });
    expect(node).toMatchObject({ config: { kinds: ['rate-limit', 'network'], scale: 1, wait: 60, model: { connectionId: 'c', model: 'other', effort: 'low' } } });
    expect(ITEM_ERROR_KINDS['rate-limit']).toBe('사용량 한도');
    expect(ITEM_ERROR_KINDS.network).toBe('연결 끊김');
    expect(retryModel(node as RetryNode)).toEqual({ connectionId: 'c', model: 'other', effort: 'low' });
    expect(retryModel(retryNode('x', { model: { connectionId: '', model: '' } }) as RetryNode)).toBeNull();
  });

  it('is summarised in one line, wait and model included', () => {
    const node = retryNode('r') as RetryNode;
    expect(retrySummary(node.config)).toBe('출력 잘림 · 절반 크기 · 최대 2번');
    expect(retrySummary({ ...node.config, kinds: ['cut-off', 'too-long'], scale: 0.25, maxTimes: 3 })).toBe('출력 잘림·요청이 너무 김 · 25% 크기 · 최대 3번');
    expect(retrySummary({ ...node.config, kinds: ['rate-limit', 'network'], scale: 1, wait: 60, maxTimes: 3 })).toBe('사용량 한도·연결 끊김 · 같은 크기 · 1분 기다림 · 최대 3번');
    expect(retrySummary({ ...node.config, kinds: ['rate-limit'], scale: 1, wait: 90, model: { connectionId: 'c', model: 'gpt-x' }, maxTimes: 1 })).toBe('사용량 한도 · 같은 크기 · 1분 30초 기다림 · 다른 모델 gpt-x · 최대 1번');
    expect(retryScaleText(1)).toBe('그대로');
    expect(retryScaleText(0.5)).toBe('절반');
    expect(retryScaleText(0.3)).toBe('30%');
  });

  it('reports a 다시 보냄 exit that does not lead to an AI node, and accepts one that does', () => {
    const wrong = workflowDefinitionSchema.parse({
      nodes: [entry, aiNode('a'), retryNode('r'), { id: 'end', type: 'end', position: { x: 0, y: 0 }, config: {} }],
      edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'end'), edge('a', 'error', 'r'), edge('r', 'retry', 'end')],
    });
    expect(validateWorkflow(wrong, refs).filter((issue) => issue.level === 'error').map((issue) => issue.message)).toContain("'재요청'의 '다시 보냄'은 AI 노드로 이어져야 합니다.");
    const right = workflowDefinitionSchema.parse({ ...wrong, edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'end'), edge('a', 'error', 'r'), edge('r', 'retry', 'a')] });
    expect(validateWorkflow(right, refs).filter((issue) => issue.level === 'error').map((issue) => issue.message)).toEqual([]);
    // Left unconnected, the exit is reported like any other; 오류 may stay open.
    const open = workflowDefinitionSchema.parse({ ...wrong, edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'end'), edge('a', 'error', 'r')] });
    expect(validateWorkflow(open, refs).map((issue) => issue.message)).toContain("'다시 보냄' 출구가 연결되지 않았습니다.");
  });

  describe('chains', () => {
    const messages = (definition: WorkflowDefinition) => validateWorkflow(definition, refs).filter((issue) => issue.level === 'error').map((issue) => issue.message);
    const chain = (extra: Partial<WorkflowDefinition> = {}) =>
      workflowDefinitionSchema.parse({
        nodes: [entry, aiNode('a'), retryNode('r1'), retryNode('r2'), { id: 'end', type: 'end', position: { x: 0, y: 0 }, config: {} }],
        edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'end'), edge('a', 'error', 'r1'), edge('r1', 'retry', 'a'), edge('r1', 'error', 'r2'), edge('r2', 'retry', 'a')],
        ...extra,
      });

    it('accepts a 재요청 after another 재요청\'s 오류 exit, both leading back to the AI node', () => {
      expect(messages(chain())).toEqual([]);
      expect(retryOrigins(chain(), 'r2')).toEqual({ origins: ['a'], bad: false });
    });

    it('rejects a 재요청 that is not after an AI node\'s 오류 exit, directly or through other 재요청 nodes', () => {
      const afterOut = workflowDefinitionSchema.parse({ ...chain(), edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'r1'), edge('r1', 'retry', 'a'), edge('r1', 'error', 'r2'), edge('r2', 'retry', 'a')] });
      expect(messages(afterOut)).toContain('재요청은 AI 노드의 오류 출구(또는 다른 재요청의 오류 출구) 바로 뒤에만 둘 수 있습니다.');
      // The second is fed by the first's 다시 보냄 instead of its 오류: not a chain.
      const wrongExit = workflowDefinitionSchema.parse({ ...chain(), edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'end'), edge('a', 'error', 'r1'), edge('r1', 'retry', 'r2'), edge('r2', 'retry', 'a')] });
      expect(messages(wrongExit).length).toBeGreaterThan(0);
      // Nothing leads to it.
      const alone = workflowDefinitionSchema.parse({ ...chain(), edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'end')] });
      expect(messages(alone)).toContain('재요청은 AI 노드의 오류 출구(또는 다른 재요청의 오류 출구) 바로 뒤에만 둘 수 있습니다.');
      // A condition in between.
      const viaCondition = workflowDefinitionSchema.parse({
        ...chain(),
        nodes: [entry, aiNode('a'), retryNode('r1'), { id: 'c', type: 'condition', position: { x: 0, y: 0 }, config: { expression: true } }, { id: 'end', type: 'end', position: { x: 0, y: 0 }, config: {} }],
        edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'end'), edge('a', 'error', 'c'), edge('c', 'true', 'r1'), edge('c', 'false', 'end'), edge('r1', 'retry', 'a')],
      });
      expect(messages(viaCondition)).toContain('재요청은 AI 노드의 오류 출구(또는 다른 재요청의 오류 출구) 바로 뒤에만 둘 수 있습니다.');
    });

    it('rejects a 재요청 shared by two AI nodes, and a 다시 보냄 that goes to another AI node', () => {
      const shared = workflowDefinitionSchema.parse({
        nodes: [entry, aiNode('a'), aiNode('b'), retryNode('r1')],
        edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'b'), edge('a', 'error', 'r1'), edge('b', 'error', 'r1'), edge('r1', 'retry', 'a')],
      });
      expect(messages(shared)).toContain('AI 노드 하나의 오류 출구 뒤에만 이을 수 있습니다. 여러 AI 노드가 이 재요청을 함께 쓸 수 없습니다.');
      const elsewhere = workflowDefinitionSchema.parse({ ...shared, edges: [edge('entry', 'out', 'a'), edge('a', 'out', 'b'), edge('a', 'error', 'r1'), edge('r1', 'retry', 'b')] });
      expect(messages(elsewhere).some((message) => message.includes("'다시 보냄'은 오류 출구로 이 재요청에 닿는 AI 노드"))).toBe(true);
    });

    it('checks the model it sends on', () => {
      const withModel = (picked: object | null) => chain({ nodes: chain().nodes.map((node) => (node.id === 'r2' && node.type === 'retry' ? { ...node, config: { ...node.config, model: picked as never } } : node)) });
      expect(messages(withModel({ connectionId: 'c', model: 'm' }))).toEqual([]);
      expect(messages(withModel({ connectionId: '', model: '' }))).toContain("다시 보낼 모델을 고르거나 '같은 모델'로 되돌리세요.");
      expect(messages(withModel({ connectionId: 'gone', model: 'm' }))).toContain('고른 AI 연결이 삭제되었습니다. 다시 고르세요.');
      expect(definitionModels(withModel({ connectionId: 'c', model: 'other' }))).toEqual([{ connectionId: 'c', model: 'm' }, { connectionId: 'c', model: 'other' }]);
    });

    it('warns once, on the AI node, when the chain\'s limits together exceed the node visit limit', () => {
      const long = chain({ settings: { maxVisitsPerNode: 5, maxConsecutiveFailures: 3 } });
      const heavy = workflowDefinitionSchema.parse({ ...long, nodes: long.nodes.map((node) => (node.type === 'retry' ? { ...node, config: { ...node.config, maxTimes: 3 } } : node)) });
      expect(resendsOf(heavy, 'a')).toBe(6);
      const warnings = validateWorkflow(heavy, refs).filter((issue) => issue.level === 'warning' && issue.message.startsWith('다시 보내기가 모두 합쳐 최대 6번이면'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.nodeId).toBe('a');
      expect(validateWorkflow(long, refs).filter((issue) => issue.message.startsWith('다시 보내기가 모두 합쳐'))).toEqual([]);
    });
  });

  it('gives every AI node of every template the one failure pattern: error → 재요청 (절반, 2번) → 재요청 (그대로, 60초, 3번) → its marker', () => {
    const everything = [
      ...WORKFLOW_TEMPLATES.map((template) => ({ name: template.key, definition: template.build(ids) })),
      ...defaultWorkflows(ids).map((workflow) => ({ name: `default ${workflow.name}`, definition: workflow.definition })),
      { name: 'analysis', definition: analysisTemplate(ids) },
    ];
    // The marker per AI node: 번역's three set 검토 필요; every extraction AI puts the AI 실패 tag; 용어 번역 (terms) has none.
    const statusMarkers = new Set(['translate', 'review', 'revise']);
    for (const { name, definition } of everything) {
      for (const node of definition.nodes.filter((candidate) => candidate.type === 'ai')) {
        const resends = definition.edges.filter((edge) => edge.source === node.id && edge.sourceHandle === 'error');
        expect(resends, `${name}/${node.id} has one 재요청`).toHaveLength(1);
        const resend = definition.nodes.find((candidate) => candidate.id === resends[0]!.target)!;
        expect(resend.type, `${name}/${node.id} error → 재요청`).toBe('retry');
        expect(resend.type === 'retry' && resend.config).toMatchObject({ kinds: ['cut-off', 'too-long', 'missing', 'invalid-output', 'timeout'], scale: 0.5, maxTimes: 2, wait: 0, model: null });
        expect(definition.edges.filter((edge) => edge.source === resend.id && edge.sourceHandle === 'retry').map((edge) => edge.target), `${name}/${node.id} 다시 보냄`).toEqual([node.id]);
        const next = definition.edges.filter((edge) => edge.source === resend.id && edge.sourceHandle === 'error');
        expect(next, `${name}/${node.id} first 재요청 오류 → second 재요청`).toHaveLength(1);
        const wait = definition.nodes.find((candidate) => candidate.id === next[0]!.target)!;
        expect(wait.type === 'retry' && wait.config, `${name}/${node.id} second`).toMatchObject({ kinds: ['rate-limit', 'network'], scale: 1, wait: 60, maxTimes: 3, model: null });
        expect(definition.edges.filter((edge) => edge.source === wait.id && edge.sourceHandle === 'retry').map((edge) => edge.target), `${name}/${node.id} 다시 보냄 (second)`).toEqual([node.id]);
        const marker = definition.edges.filter((edge) => edge.source === wait.id && edge.sourceHandle === 'error').map((edge) => definition.nodes.find((candidate) => candidate.id === edge.target)!);
        if (name.endsWith('termTranslate')) { expect(marker, 'terms cannot take the line tag').toEqual([]); continue; }
        if (node.id === 'merge') { expect(marker, 'after the 모으기 no line stands for the failure').toEqual([]); continue; }
        expect(marker, `${name}/${node.id} 재요청 오류 → marker`).toHaveLength(1);
        const isTranslation = (name === 'translation' || name === 'default 번역') && statusMarkers.has(node.id);
        if (isTranslation) expect(marker[0]).toMatchObject({ label: '검토 필요로', config: { fn: 'setStatus', params: { statusId: 's2' } } });
        else expect(marker[0]).toMatchObject({ label: 'AI 실패 태그', config: { fn: 'tagLines', params: { action: 'add', tagIds: ['t0'] } } });
      }
    }
  });

  it('has no 다시 시도? condition and no two nodes at one position, and every template validates', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const definition = workflowDefinitionSchema.parse(template.build(ids));
      expect(validateWorkflow(definition, refs), template.key).toEqual([]);
      expect(definition.nodes.filter((node) => node.type === 'condition' && node.label === '다시 시도?'), template.key).toEqual([]);
      const spots = definition.nodes.map((node) => `${node.position.x},${node.position.y}`);
      expect(new Set(spots).size, `${template.key} positions`).toBe(spots.length);
    }
  });

  it('lays the 번역 template out top to bottom: main path in column 0, 재요청 beside its AI node, markers beside that, the revise loop in its own columns', () => {
    const definition = translationTemplate(ids);
    const place = (id: string) => definition.nodes.find((node) => node.id === id)!.position;
    const main = ['entry', 'translate', 'save', 'check', 'untag-format', 'review', 'untag-review', 'confirm', 'terms', 'save-terms'];
    expect(main.map((id) => place(id).x)).toEqual(main.map(() => 0));
    const ys = main.map((id) => place(id).y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(ys.length);
    for (const ai of ['translate', 'review', 'terms']) {
      expect(place(`${ai}-resend`)).toEqual({ x: place(ai).x + 320, y: place(ai).y });
      expect(place(`${ai}-wait`)).toEqual({ x: place(ai).x + 640, y: place(ai).y });
      expect(place(`${ai}-failed`).y).toBe(place(ai).y);
    }
    expect(place('revise-resend').y).toBe(place('revise').y);
    expect(place('revise-failed').y).toBe(place('revise').y);
    // Edges go down or sideways, except the loops: 재요청 → its AI node, 수정 번역 저장 → 형식 검사.
    const loops = new Set(['translate-resend-retry-translate', 'review-resend-retry-review', 'revise-resend-retry-revise', 'terms-resend-retry-terms', 'translate-wait-retry-translate', 'review-wait-retry-review', 'revise-wait-retry-revise', 'terms-wait-retry-terms', 'save-revision-out-check']);
    for (const edge of definition.edges) if (!loops.has(edge.id)) expect(place(edge.target).y, edge.id).toBeGreaterThanOrEqual(place(edge.source).y);
  });
});

describe('analysis workflow and presets', () => {
  it('keeps the default analysis workflow name', () => {
    expect(ANALYSIS_WORKFLOW).toBe('작품 분석');
  });

  it('builds the work analysis: one AI node, then every list saved in a chain', () => {
    const definition = workflowDefinitionSchema.parse(analysisTemplate(ids));
    expect(definition.nodes.map((node) => (node.type === 'function' ? node.config.fn : node.type))).toEqual(['entry', 'ai', 'retry', 'retry', 'tagLines', 'saveCharacters', 'saveRelationships', 'saveSpeechRules', 'saveEvents', 'saveTerms', 'saveDocument']);
    expect(definition.edges.filter((edge) => edge.source === 'analysis').map((edge) => [edge.sourceHandle, edge.target])).toEqual([['out', 'save-characters'], ['error', 'analysis-resend']]);
    expect(validateWorkflow(definition, { statusIds: new Set(), connections: new Set(['c']), tagIds: new Set(['t0']) } as never).filter((issue) => issue.level === 'error').map((issue) => issue.message)).toEqual([]);
    expect(definition.nodes.find((node) => node.id === 'save-overview')).toMatchObject({ config: { params: { map: { title: 'overviewTitle', body: 'overview' } } } });
  });

  it('fills the analysis AI node from its built-in prompt (not a preset): json, whole script, every rule in the visible instructions', () => {
    const config = presetConfig('analysis', model);
    expect(config.preset).toBeUndefined();
    expect(config).toMatchObject({ output: 'json', scope: 'batch', batch: { mode: 'whole', maxTokens: null }, context: { cast: true } });
    expect(config.fields.map((field) => field.name)).toEqual(['overviewTitle', 'overview', 'characters', 'relationships', 'events', 'speechRules', 'terms']);
    for (const word of ['Do NOT use prior knowledge', 'player character', 'hasoseo', 'loanword']) expect(config.instructions).toContain(word);
    expect(workflowNodeSchema.parse({ id: 'a', type: 'ai', position: { x: 0, y: 0 }, config }).type).toBe('ai');
  });

  it('built-in prompts match their output forms; only reusable ones are presets', () => {
    expect(Object.keys(AI_PRESETS)).toEqual(['translate', 'review', 'terms']);
    // Every node of the 반영 group is placed in its order once.
    expect([...APPLY_PALETTE_ORDER].sort()).toEqual(FUNCTION_NAMES.filter((fn) => functionGroup(fn) === 'apply').sort());
    expect(AI_PROMPTS.listener).toMatchObject({ output: 'json', scope: 'line' });
    expect(AI_PROMPTS.listener.fields.map((field) => field.name)).toEqual(['value', 'confidence']);
    for (const id of ['terms', 'knowledge', 'events'] as const) expect(AI_PROMPTS[id]).toMatchObject({ output: 'json', scope: 'batch' });
    expect(AI_PRESETS.review.output).toBe('verdict');
  });
});

describe('node outputs', () => {
  it('lets every node that returns something declare it, and the next step read it', () => {
    const at = { x: 0, y: 0 };
    const check = { id: 'check', type: 'function', position: at, config: { fn: 'formatCheck', params: {} } } as WorkflowNode;
    const http = { id: 'http', type: 'function', position: at, config: { fn: 'http', params: { fields: [{ name: 'suggestion', type: 'string', description: '' }] }, concurrency: 2 } } as WorkflowNode;
    const status = { id: 'status', type: 'function', position: at, config: { fn: 'setStatus', params: {} } } as WorkflowNode;
    expect(nodeOutputFields(check)?.map((field) => field.name)).toEqual(['text', 'passed', 'issues', 'kind']);
    expect(nodeOutputFields(http)?.map((field) => field.name)).toEqual(['suggestion']);
    expect(nodeOutputFields(status)).toBeNull();
    // translate → check → status: the step before the status change is the check, which returns the text it checked.
    const definition = { nodes: [{ id: 'translate', type: 'ai', position: at, config: {} } as unknown as WorkflowNode, check, status] };
    expect(previousStepId(definition, [{ nodeId: 'translate', port: 'out' }, { nodeId: 'check', port: 'fail' }, { nodeId: 'status', port: 'out' }])).toBe('check');
    expect(fieldsFromSample({ text: '번역', passed: false, issues: ['a'], meta: { x: 1 }, 'bad-name': 1 }).map((field) => [field.name, field.type])).toEqual([['text', 'string'], ['passed', 'boolean'], ['issues', 'strings'], ['meta', 'string']]);
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
    expect(empty).toMatchObject({ model: { connectionId: '', model: '' }, timeoutSeconds: 60, translate: { instructions: AI_PRESETS.translate.instructions } });
    expect(empty.refine.include).toMatchObject({ candidate: true });
    expect(empty.complete).toMatchObject({ enabled: false, model: null, precedingLines: 3, glossary: true, speech: true, timeoutSeconds: 15, dailyCap: 200 });
    // The node a button makes: its preset's output with the shared settings.
    const refine = editorNodeConfig(empty, 'refine');
    expect(refine).toMatchObject({ preset: 'refine', output: 'json', timeoutMinutes: 1 });
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

  it('needs a step with a result before it, and sends no lines only for a json answer of the whole request', () => {
    const model = { connectionId: 'c', model: 'm' };
    const ai = (id: string, config: Record<string, unknown>) => ({ id, type: 'ai', position: { x: 0, y: 0 }, config: { model, instructions: 'x', ...config } });
    const check = (nodes: object[], edges: [string, string][]) =>
      validateWorkflow(workflowDefinitionSchema.parse({ nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, ...nodes], edges: edges.map(([source, target], i) => ({ id: String(i), source, sourceHandle: 'out', target })) }), { statusIds: new Set(), connections: new Set(['c']), tagIds: new Set(['t0']) } as never)
        .filter((issue) => issue.level === 'error')
        .map((issue) => issue.message);
    expect(check([ai('a', {}), ai('b', { input: { previous: true } })], [['entry', 'a'], ['a', 'b']])).toEqual([]);
    expect(check([ai('a', { input: { previous: true } }), ai('b', {})], [['entry', 'a'], ['a', 'b']])).toContainEqual(expect.stringContaining('결과를 내는 노드'));
    expect(check([ai('a', {}), ai('b', { input: { previous: true, lines: false } })], [['entry', 'a'], ['a', 'b']])).toContainEqual(expect.stringContaining('대사 없이'));
  });

  it('finds the previous step back along the edges, past nodes without a result and a result node’s error exit', () => {
    const at = { x: 0, y: 0 };
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: at, config: {} },
        { id: 'who', type: 'ai', position: at, config: { model: { connectionId: 'c', model: 'm' }, instructions: 'x' } },
        { id: 'sure', type: 'condition', position: at, config: { expression: true } },
        { id: 'save', type: 'function', position: at, config: { fn: 'setStatus', params: {} } },
        { id: 'tr', type: 'ai', position: at, config: { model: { connectionId: 'c', model: 'm' }, instructions: 'x' } },
        { id: 'again', type: 'condition', position: at, config: { expression: true } },
      ],
      edges: [['entry', 'out', 'who'], ['who', 'out', 'sure'], ['sure', 'true', 'save'], ['save', 'out', 'tr'], ['tr', 'error', 'again'], ['again', 'true', 'tr']].map(([source, sourceHandle, target], i) => ({ id: String(i), source, sourceHandle, target })),
    });
    expect(previousSteps(definition, 'tr').map((node) => node.id)).toEqual(['who']);
  });
});
