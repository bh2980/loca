import { useRouter } from '@tanstack/react-router';
import { shortLabel, type ChatChip } from '@tw/shared';
import { AttachmentChip } from '@loca/ui';
import { chipHref } from '@/lib/chat-links';

/**
 * What a message points at: the kind and a short name. Clicking it opens that item's page (a new history
 * entry, like a link); with `onRemove` it can be taken out (the box, before sending).
 */
export function AttachChip({ projectId, chip, onRemove, link = true }: { projectId: string; chip: ChatChip; onRemove?: () => void; /** False for what the page itself reports: it is already open. */ link?: boolean }) {
  const router = useRouter();
  const href = link ? chipHref(projectId, chip) : undefined;
  const label = shortLabel(chip.label, 40);
  return (
    <AttachmentChip
      kind={chip.kind}
      label={label}
      title={chip.label}
      onOpen={href ? () => router.history.push(href) : undefined}
      openLabel={`${chip.kind} ${label} 열기`}
      onRemove={onRemove}
      removeLabel={`${label} 첨부 빼기`}
    />
  );
}
