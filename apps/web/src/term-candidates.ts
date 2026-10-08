import { legacyTermCandidateId, type Term, type TermCandidate } from '@workbench/contracts';

export function termCandidates(term: Term): TermCandidate[] {
  return term.candidates ?? [{ id: legacyTermCandidateId(term.id), target: term.target, guidance: term.description, isDefault: true, enabled: true, version: term.version, status: term.status }];
}
