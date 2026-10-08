import { AI_PRESETS } from './presets.ts';
import type { WorkflowDefinition } from './workflow.ts';

export type StatusKind = 'initial' | 'normal' | 'final';

export const DEFAULT_STATUSES: { key: string; name: string; color: string; kind: StatusKind }[] = [
  { key: 'untranslated', name: '미번역', color: '#a1a1aa', kind: 'initial' },
  { key: 'draft', name: 'AI 초벌', color: '#3b82f6', kind: 'normal' },
  { key: 'needs-review', name: '사람 확인 필요', color: '#f59e0b', kind: 'normal' },
  { key: 'confirmed', name: '확정', color: '#22c55e', kind: 'final' },
];

export const STATUS_COLORS = ['#a1a1aa', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6', '#22c55e'];

/**
 * The default translation flow, expressed as an ordinary user workflow:
 * untranslated → translate → format check → review → confirmed;
 * a failing line is revised while review has run fewer than 3 times, then waits for a person.
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
    context: { glossary: true, documents: true, characters: true, relationships: true, precedingLines: 8, previousScenes: 1 },
    batch: { mode: 'group' as const, size: 30 },
  });
  const status = (statusId: string, applyCandidate = false) => ({ fn: 'setStatus', params: { statusId, addTagIds: [], removeTagIds: [], applyCandidate } });
  const at = (column: number, row: number) => ({ x: column * 300, y: row * 180 });
  return {
    settings: { maxVisitsPerNode: 5, concurrency: 2 },
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
      { id: 'human', type: 'human', position: at(6, 3), config: { instructions: '자동 수정 한도에 도달했습니다. 후보를 고치거나 승인하세요.' } },
      { id: 'reject', type: 'function', position: at(7, 4), label: '미번역으로', config: status(ids.untranslated) },
      { id: 'end-rejected', type: 'end', position: at(8, 4), config: {} },
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
      { id: 'e12', source: 'escalate', sourceHandle: 'out', target: 'human' },
      { id: 'e13', source: 'human', sourceHandle: 'approved', target: 'confirm' },
      { id: 'e14', source: 'human', sourceHandle: 'rejected', target: 'reject' },
      { id: 'e15', source: 'reject', sourceHandle: 'out', target: 'end-rejected' },
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
    settings: { maxVisitsPerNode: 5, concurrency: 2 },
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
          context: { glossary: true, documents: true, characters: true, relationships: false, precedingLines: 0, previousScenes: 0 },
          batch: { mode: 'group', size: 60 },
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
