import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 이/가 for a noun (by its last syllable's final consonant); non-Hangul endings read as vowels. */
function subject(noun: string) {
  const code = noun.trim().charCodeAt(noun.trim().length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '이' : '가';
}

/**
 * What a list says when it has no rows. Filtered: nothing matches the filters ("조건에 맞는 …가
 * 없습니다"); otherwise there is simply nothing yet ("아직 …가 없습니다") with an optional hint
 * and the action that fills it.
 */
export function EmptyState({ noun, filtered, hint, action, className }: { noun: string; filtered?: boolean; hint?: ReactNode; action?: ReactNode; className?: string }) {
  const particle = subject(noun);
  return (
    <div className={cn('px-4 py-12 text-center text-sm text-muted-foreground', className)}>
      <p className={cn(!filtered && hint ? 'font-medium text-foreground' : undefined)}>{filtered ? `조건에 맞는 ${noun}${particle} 없습니다.` : `아직 ${noun}${particle} 없습니다.`}</p>
      {!filtered && hint && <p className="mt-1">{hint}</p>}
      {!filtered && action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
