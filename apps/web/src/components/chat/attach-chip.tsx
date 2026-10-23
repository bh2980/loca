import { useRouter } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { shortLabel, type ChatChip } from '@tw/shared';
import { Button } from '@loca/ui';
import { chipHref } from '@/lib/chat-links';

/**
 * What a message points at: the kind and a short name. Clicking it opens that item's page (a new history
 * entry, like a link); with `onRemove` it can be taken out (the box, before sending).
 */
export function AttachChip({ projectId, chip, onRemove, link = true }: { projectId: string; chip: ChatChip; onRemove?: () => void; /** False for what the page itself reports: it is already open. */ link?: boolean }) {
  const router = useRouter();
  const href = link ? chipHref(projectId, chip) : undefined;
  const label = shortLabel(chip.label, 40);
  const body = (
    <>
      <span className="text-muted-foreground">{chip.kind}</span>
      <span className="truncate">{label}</span>
    </>
  );
  return (
    <span className="inline-flex max-w-full items-center rounded-md bg-muted text-xs">
      {href ? (
        <Button type="button" variant="ghost" size="inline" className="min-w-0 hover:bg-transparent" title={chip.label} aria-label={`${chip.kind} ${label} 열기`} onClick={() => router.history.push(href)}>
          {body}
        </Button>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1 px-1 py-0.5" title={chip.label}>{body}</span>
      )}
      {onRemove && (
        <Button type="button" variant="ghost" size="inline" aria-label={`${label} 첨부 빼기`} className="p-0.5 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={onRemove}>
          <X />
        </Button>
      )}
    </span>
  );
}
