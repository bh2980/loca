import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';

/** A small icon button that puts a value on the clipboard (the CLI and chat take ids and keys as typed text). */
export function CopyButton({ value, label = '복사', tip = '복사' }: { value: string; label?: string; /** The tooltip (a key shows itself in full). */ tip?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tone="muted"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            navigator.clipboard.writeText(value).then(() => toast.success('복사했습니다'), () => toast.error('복사하지 못했습니다.'));
          }}
        >
          <Copy />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
