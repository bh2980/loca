import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AI_CONFIRM_KINDS, DEFAULT_AI_CONFIRM, type AiConfirm, type AiConfirmKind } from '@tw/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';

const AI_CONFIRM_LABELS = { auto: '자동 확정', candidate: '후보로만' } as const;

/**
 * Where an AI step that writes knowledge or terms says how its results land: the project's
 * AI 결과 반영 (there is no switch of its own), with a link there.
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
      <Link to="/p/$projectId/settings/agent" params={{ projectId }} className="underline underline-offset-2 hover:text-foreground">
        에이전트 설정
      </Link>
    </p>
  );
}

/**
 * One choice per kind of knowledge for what AI results become: used right away (✦ until a person
 * looks) or candidates a person confirms. Every AI step that writes these follows it.
 */
export function AiConfirmList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const project = useQuery(q.project(projectId));
  const policy: AiConfirm = project.data?.aiConfirm ?? DEFAULT_AI_CONFIRM;
  const save = useMutation({
    mutationFn: (next: AiConfirm) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { aiConfirm: next } })),
    onMutate: async (next) => ({ undo: await optimistic(queryClient, [{ key: q.project(projectId).queryKey, update: (data: object) => ({ ...data, aiConfirm: next }) }]) }),
    onSuccess: () => toast.success('저장했습니다. 다음 분석·실행부터 적용됩니다.'),
    onError: (error, _next, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });
  return (
    <ul className="rounded-lg border">
      {(Object.keys(AI_CONFIRM_KINDS) as AiConfirmKind[]).map((kind) => (
        <li key={kind} className="flex items-center gap-3 px-4 py-2">
          <span className="min-w-0 flex-1 text-sm font-medium">{AI_CONFIRM_KINDS[kind]}</span>
          <Select value={policy[kind]} disabled={!project.data || save.isPending} onValueChange={(value) => save.mutate({ ...policy, [kind]: value as 'auto' | 'candidate' })}>
            <SelectTrigger size="sm" className="w-32" aria-label={`${AI_CONFIRM_KINDS[kind]} AI 결과`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['auto', 'candidate'] as const).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {AI_CONFIRM_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </li>
      ))}
    </ul>
  );
}

