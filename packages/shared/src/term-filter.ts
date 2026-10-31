import { sourceOf, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus, type StatusBy } from './knowledge.ts';
import { decidedBy, isUnreviewed, matchesMarks, termMarksOf, type AutoMark, type DecidedBy } from './marks.ts';

/**
 * What the glossary can be narrowed by: the glossary page's filters (its URL) and list_terms /
 * `loca terms`, so both list the same terms. Every given part must hold.
 */
export interface TermFilter {
  /** Text in the source, the Korean form or the memo, case aside. */
  text?: string;
  /** 출처: who wrote it. */
  source?: KnowledgeSource;
  /** 상태 (several mean either); rejected terms are never listed. */
  status?: readonly ('candidate' | 'confirmed')[];
  /** 정한 쪽. */
  decidedBy?: DecidedBy;
  /** 번역 비어 있음 (true) or 있음 (false). */
  emptyTarget?: boolean;
  /** Automatic tags the term must all carry, and 숨기기: any of these leaves it out. */
  marks?: readonly AutoMark[];
  hideMarks?: readonly AutoMark[];
  /** Tag ids the term must all carry, and 숨기기: any of these leaves it out. */
  tags?: readonly string[];
  hideTags?: readonly string[];
  /** No person has decided it yet: a candidate, or decided by AI. */
  unreviewed?: boolean;
  /** Only these terms (a run's scope). */
  ids?: readonly string[];
}

export interface FilterableTerm {
  id: string;
  source: string;
  target: string;
  note: string;
  status: KnowledgeStatus;
  statusBy: StatusBy;
  origin: KnowledgeOrigin;
  lines: number | null;
  tags?: readonly { id: string }[];
}

/** Whether the term passes the filter. `duplicate`: another source shares its Korean form (#번역어 중복, duplicateTargets over the whole glossary). */
export function termMatches(term: FilterableTerm, filter: TermFilter, duplicate = false) {
  if (term.status === 'rejected') return false;
  const marks = termMarksOf({ lines: term.lines, duplicateTarget: duplicate });
  const tagIds = (term.tags ?? []).map((tag) => tag.id);
  const needle = filter.text?.trim().toLowerCase();
  return (
    (!filter.ids || filter.ids.includes(term.id)) &&
    (!needle || [term.source, term.target, term.note].some((text) => text.toLowerCase().includes(needle))) &&
    (!filter.source || sourceOf(term) === filter.source) &&
    (!filter.status?.length || filter.status.includes(term.status as 'candidate' | 'confirmed')) &&
    (!filter.decidedBy || decidedBy(term, filter.decidedBy)) &&
    (filter.emptyTarget === undefined || !term.target.trim() === filter.emptyTarget) &&
    (!filter.unreviewed || isUnreviewed(term)) &&
    matchesMarks(marks, filter.marks) &&
    (filter.tags ?? []).every((id) => tagIds.includes(id)) &&
    !marks.some((mark) => filter.hideMarks?.includes(mark)) &&
    !tagIds.some((id) => filter.hideTags?.includes(id))
  );
}
