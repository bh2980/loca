import { AI_PRESETS } from './presets.ts';
import { contextConfigSchema, type WorkflowDefinition } from './workflow.ts';

export type StatusKind = 'initial' | 'normal' | 'final';

/** `inReview`: lines in this status are listed in the review inbox, however they got there. */
export const DEFAULT_STATUSES: { key: string; name: string; color: string; kind: StatusKind; inReview: boolean }[] = [
  { key: 'untranslated', name: '미번역', color: '#a1a1aa', kind: 'initial', inReview: false },
  { key: 'draft', name: 'AI 초벌', color: '#3b82f6', kind: 'normal', inReview: false },
  { key: 'needs-review', name: '사람 확인 필요', color: '#f59e0b', kind: 'normal', inReview: true },
  { key: 'confirmed', name: '확정', color: '#22c55e', kind: 'final', inReview: false },
];

export const STATUS_COLORS = ['#a1a1aa', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6', '#22c55e'];

/**
 * The default translation flow, expressed as an ordinary user workflow:
 * untranslated → translate → format check → review → confirmed;
 * a failing line is revised while review has run fewer than 3 times, then is set to "needs review",
 * a status shown in the review inbox. People take it from there; the run itself ends.
 */
export function translationTemplate(ids: {
  profileId: string;
  untranslated: string;
  draft: string;
  needsReview: string;
  confirmed: string;
}): WorkflowDefinition {
  const ai = (preset: keyof typeof AI_PRESETS) => ({
    profileId: ids.profileId,
    instructions: AI_PRESETS[preset].instructions,
    output: AI_PRESETS[preset].output,
    fields: [],
    include: AI_PRESETS[preset].include,
    context: contextConfigSchema.parse({}),
    batch: { mode: 'group' as const, size: 60, maxTokens: 6_000 },
  });
  const status = (statusId: string, applyCandidate = false) => ({ fn: 'setStatus', params: { statusId, addTagIds: [], removeTagIds: [], applyCandidate } });
  const at = (column: number, row: number) => ({ x: column * 300, y: row * 180 });
  return {
    settings: { maxVisitsPerNode: 5, concurrency: 2, maxConsecutiveFailures: 3 },
    nodes: [
      { id: 'entry', type: 'entry', position: at(0, 1), config: { statusIds: [ids.untranslated] } },
      { id: 'translate', type: 'ai', position: at(1, 1), label: 'AI 번역', config: ai('translate') },
      { id: 'draft', type: 'function', position: at(2, 1), label: 'AI 초벌로', config: status(ids.draft) },
      { id: 'check', type: 'function', position: at(3, 1), label: '형식 검사', config: { fn: 'formatCheck', params: { placeholders: true, tags: true, newlines: true, emptyText: true } } },
      { id: 'review', type: 'ai', position: at(4, 1), label: 'AI 검수', config: ai('review') },
      { id: 'confirm', type: 'function', position: at(5, 1), label: '확정', config: status(ids.confirmed, true) },
      { id: 'end', type: 'end', position: at(6, 1), config: {} },
      {
        id: 'retry',
        type: 'condition',
        position: at(4, 2),
        label: '검수 3회 미만?',
        config: { expression: { '<': [{ var: 'visits.review' }, 3] }, description: "'AI 검수' 방문이 3회 미만이면 다시 수정합니다." },
      },
      { id: 'revise', type: 'ai', position: at(3, 3), label: 'AI 수정', config: ai('revise') },
      { id: 'escalate', type: 'function', position: at(5, 3), label: '사람 확인 필요로', config: status(ids.needsReview) },
      { id: 'end-review', type: 'end', position: at(6, 3), label: '검토함으로', config: {} },
    ],
    edges: [
      { id: 'e1', source: 'entry', sourceHandle: 'out', target: 'translate' },
      { id: 'e2', source: 'translate', sourceHandle: 'out', target: 'draft' },
      { id: 'e3', source: 'draft', sourceHandle: 'out', target: 'check' },
      { id: 'e4', source: 'check', sourceHandle: 'pass', target: 'review' },
      { id: 'e5', source: 'check', sourceHandle: 'fail', target: 'retry' },
      { id: 'e6', source: 'review', sourceHandle: 'pass', target: 'confirm' },
      { id: 'e7', source: 'review', sourceHandle: 'fail', target: 'retry' },
      { id: 'e8', source: 'confirm', sourceHandle: 'out', target: 'end' },
      { id: 'e9', source: 'retry', sourceHandle: 'true', target: 'revise' },
      { id: 'e10', source: 'retry', sourceHandle: 'false', target: 'escalate' },
      { id: 'e11', source: 'revise', sourceHandle: 'out', target: 'check' },
      { id: 'e12', source: 'escalate', sourceHandle: 'out', target: 'end-review' },
    ],
  };
}

/**
 * Glossary preparation: extract recurring names and terms scene by scene and add them as glossary
 * candidates. Statuses are not touched; candidates reach AI context only after a person accepts them,
 * which is why extraction runs before translation instead of inside it.
 */
export function termExtractionTemplate(ids: { profileId: string }): WorkflowDefinition {
  return {
    settings: { maxVisitsPerNode: 5, concurrency: 2, maxConsecutiveFailures: 3 },
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [] } },
      {
        id: 'terms',
        type: 'ai',
        position: { x: 300, y: 0 },
        label: AI_PRESETS.terms.label,
        config: {
          profileId: ids.profileId,
          instructions: AI_PRESETS.terms.instructions,
          output: 'terms',
          fields: [],
          include: { candidate: false, issues: false },
          // The current glossary is in context so the model skips terms that already exist.
          context: { ...contextConfigSchema.parse({}), relationships: false, precedingLines: 0, previousScenes: 0 },
          batch: { mode: 'group', size: 60, maxTokens: 6_000 },
        },
      },
      { id: 'add', type: 'function', position: { x: 600, y: 0 }, label: '용어 후보 추가', config: { fn: 'addTerms', params: { fromNodeId: 'terms' } } },
      { id: 'end', type: 'end', position: { x: 900, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'entry', sourceHandle: 'out', target: 'terms' },
      { id: 'e2', source: 'terms', sourceHandle: 'out', target: 'add' },
      { id: 'e3', source: 'add', sourceHandle: 'out', target: 'end' },
    ],
  };
}


/**
 * Listener estimation: reads each scene with the whole cast and records who every line is
 * addressed to, with a confidence. Speech rules apply to a line only when its listener is known.
 * Translations and statuses are untouched, so it can run on any lines, any number of times.
 */
export function listenerTemplate(ids: { profileId: string }): WorkflowDefinition {
  return {
    settings: { maxVisitsPerNode: 5, concurrency: 2, maxConsecutiveFailures: 3 },
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [] } },
      {
        id: 'listener',
        type: 'ai',
        position: { x: 300, y: 0 },
        label: AI_PRESETS.listener.label,
        config: {
          profileId: ids.profileId,
          instructions: AI_PRESETS.listener.instructions,
          output: 'listener',
          fields: [],
          include: AI_PRESETS.listener.include,
          context: { ...contextConfigSchema.parse({}), glossary: false, cast: true, precedingLines: 8, previousScenes: 1 },
          batch: { mode: 'group', size: 80, maxTokens: 6_000 },
        },
      },
      { id: 'record', type: 'function', position: { x: 600, y: 0 }, label: '청자 기록', config: { fn: 'setListener', params: { fromNodeId: 'listener' } } },
      { id: 'end', type: 'end', position: { x: 900, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'entry', sourceHandle: 'out', target: 'listener' },
      { id: 'e2', source: 'listener', sourceHandle: 'out', target: 'record' },
      { id: 'e3', source: 'record', sourceHandle: 'out', target: 'end' },
    ],
  };
}

/**
 * After a speech rule or a listener is corrected: re-fit only the speech level and forms of address
 * of the current translations, so the rest of the wording does not drift as a full re-translation would.
 * The fitted text becomes the representative translation; the status stays as it was.
 */
export function speechFixTemplate(ids: { profileId: string }): WorkflowDefinition {
  return {
    settings: { maxVisitsPerNode: 5, concurrency: 2, maxConsecutiveFailures: 3 },
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [] } },
      {
        id: 'fit',
        type: 'ai',
        position: { x: 300, y: 0 },
        label: AI_PRESETS.speechFix.label,
        config: {
          profileId: ids.profileId,
          instructions: AI_PRESETS.speechFix.instructions,
          output: 'candidate',
          fields: [],
          include: AI_PRESETS.speechFix.include,
          context: { ...contextConfigSchema.parse({}), speech: true, documents: false, characters: false, relationships: false, glossary: false, precedingLines: 4, previousScenes: 0 },
          batch: { mode: 'group', size: 40, maxTokens: 6_000 },
        },
      },
      { id: 'apply', type: 'function', position: { x: 600, y: 0 }, label: '번역에 적용', config: { fn: 'setStatus', params: { applyCandidate: true } } },
      { id: 'end', type: 'end', position: { x: 900, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'entry', sourceHandle: 'out', target: 'fit' },
      { id: 'e2', source: 'fit', sourceHandle: 'out', target: 'apply' },
      { id: 'e3', source: 'apply', sourceHandle: 'out', target: 'end' },
    ],
  };
}

/** The workflow that a speech rule's "re-run affected lines" picks first. */
export const SPEECH_FIX_WORKFLOW = '말투만 고치기';

/**
 * Keeps 자료 growing with the script: each scene is read against what is already known and new
 * people, relationship changes, events and speech-level changes are added as AI items. Official
 * knowledge is never changed; disagreements become AI candidates. Translations are untouched.
 */
export function knowledgeTemplate(ids: { profileId: string }): WorkflowDefinition {
  return {
    settings: { maxVisitsPerNode: 5, concurrency: 2, maxConsecutiveFailures: 3 },
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [] } },
      {
        id: 'find',
        type: 'ai',
        position: { x: 300, y: 0 },
        label: AI_PRESETS.knowledge.label,
        config: {
          profileId: ids.profileId,
          instructions: AI_PRESETS.knowledge.instructions,
          output: 'knowledge',
          fields: [],
          include: AI_PRESETS.knowledge.include,
          context: { ...contextConfigSchema.parse({}), glossary: false, cast: true, speech: true, precedingLines: 8, previousScenes: 1 },
          batch: { mode: 'group', size: 120, maxTokens: 6_000 },
        },
      },
      { id: 'apply', type: 'function', position: { x: 600, y: 0 }, label: '자료 반영', config: { fn: 'applyKnowledge', params: { fromNodeId: 'find', autoConfirm: true } } },
      { id: 'end', type: 'end', position: { x: 900, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'entry', sourceHandle: 'out', target: 'find' },
      { id: 'e2', source: 'find', sourceHandle: 'out', target: 'apply' },
      { id: 'e3', source: 'apply', sourceHandle: 'out', target: 'end' },
    ],
  };
}
