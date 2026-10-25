import type { ComponentProps } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, Icon } from '@loca/ui';
import { askAgent } from '@/lib/agent';

/**
 * A shortcut to the project agent. `send` posts the request right away; otherwise the
 * chat input is pre-filled and the user finishes the sentence. Results come back as
 * accept/reject cards in the chat, never as silent changes. Without a `prompt` it is only the
 * button's look (✦ outline) for a trigger that does its own thing, e.g. the run dialog's.
 */
export function AiButton({ prompt, send = true, children, onClick, ...props }: { prompt?: string; send?: boolean } & ComponentProps<typeof Button>) {
  return (
    <Button variant="outline" {...props} onClick={prompt ? () => askAgent(prompt, { send }) : onClick}>
      <Icon icon={Sparkles} size="sm" tone="accent" /> {children}
    </Button>
  );
}
