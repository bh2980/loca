import { useParams } from '@tanstack/react-router';
import { AUTO_MARKS, markColor, type AutoMark } from '@tw/shared';
import { TagChip } from '@loca/ui';
import { useMarkColors } from '@/lib/queries';

/**
 * An automatic mark as a tag: the same chip as TagChip (@loca/ui), in the project's color for it (설정 › 상태·태그).
 * The project comes from the route unless given (the chat panel sits outside it on some pages).
 * Statuses, tags and the AI mark themselves are drawn by @loca/ui (tokens/status.tsx).
 */
export function MarkChip({ mark, projectId }: { mark: AutoMark; projectId?: string }) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const colors = useMarkColors(projectId ?? params.projectId);
  return <TagChip tag={{ name: AUTO_MARKS[mark].name, color: markColor(mark, colors) }} />;
}
