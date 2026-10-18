import { useParams } from '@tanstack/react-router';
import { AUTO_MARKS, markColor, type AutoMark } from '@tw/shared';
import { chipStyle } from '@loca/ui';
import { useMarkColors } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * An automatic mark as a tag: the same chip as TagChip (@loca/ui), in the project's color for it (설정 › 상태·태그).
 * The project comes from the route unless given (the chat panel sits outside it on some pages).
 * Statuses, tags and the AI mark themselves are drawn by @loca/ui (tokens/status.tsx).
 */
export function MarkChip({ mark, projectId, className }: { mark: AutoMark; projectId?: string; className?: string }) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const colors = useMarkColors(projectId ?? params.projectId);
  const color = markColor(mark, colors);
  return (
    <span className={cn('inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', className)} style={chipStyle(color)} title={AUTO_MARKS[mark].description}>
      #{AUTO_MARKS[mark].name}
    </span>
  );
}
