import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AI_CONFIRM_KINDS, DEFAULT_AI_CONFIRM, type AiConfirm, type AiConfirmKind } from '@tw/shared';
import { q } from '@/lib/queries';

export const AI_CONFIRM_LABELS = { auto: '자동 확정', candidate: '후보로만' } as const;

/**
 * Where an AI step that writes knowledge or terms says how its results land: the project's
 * 설정 › AI 확정 (there is no switch of its own), with a link there.
 */
export function AiConfirmNote({ projectId, kinds }: { projectId: string; kinds: AiConfirmKind[] }) {
  const project = useQuery(q.project(projectId));
  const policy: AiConfirm = project.data?.aiConfirm ?? DEFAULT_AI_CONFIRM;
  const group = (mode: 'auto' | 'candidate') => kinds.filter((kind) => policy[kind] === mode).map((kind) => AI_CONFIRM_KINDS[kind]);
  const auto = group('auto');
  const candidate = group('candidate');
  // One line: the usual case (all auto) says just that; only the exceptions are named.
  const summary = !candidate.length ? '자동 확정' : !auto.length ? '후보로만' : `자동 확정 (후보로만: ${candidate.join('·')})`;
  return (
    <p className="text-xs text-muted-foreground">
      결과: {summary} ·{' '}
      <Link to="/p/$projectId/settings/ai-confirm" params={{ projectId }} className="underline underline-offset-2 hover:text-foreground">
        AI 확정 설정
      </Link>
    </p>
  );
}
