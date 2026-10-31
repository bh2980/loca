import { useParams } from '@tanstack/react-router';
import { AUTO_MARKS, markColor, markName, type AutoMark } from '@tw/shared';
import { TagChip, Text } from '@loca/ui';
import { useMarkStyles } from '@/lib/queries';

/**
 * An automatic tag: the same chip as TagChip (@loca/ui), in the project's name and colour for it, with its meaning on hover.
 * The project comes from the route unless given (the chat panel sits outside it on some pages).
 * Statuses, tags and the AI mark themselves are drawn by @loca/ui (tokens/status.tsx).
 */
export function MarkChip({ mark, projectId }: { mark: AutoMark; projectId?: string }) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const styles = useMarkStyles(projectId ?? params.projectId);
  return (
    <Text as="span" title={AUTO_MARKS[mark].description}>
      <TagChip tag={{ name: markName(mark, styles), color: markColor(mark, styles) }} />
    </Text>
  );
}
