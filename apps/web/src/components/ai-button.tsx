import type { ComponentProps } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { askAgent } from '@/lib/agent';

/**
 * A shortcut to the project agent. `send` posts the request right away; otherwise the
 * chat input is pre-filled and the user finishes the sentence. Results come back as
 * accept/reject cards in the chat, never as silent changes.
 */
export function AiButton({ prompt, send = true, children, ...props }: { prompt: string; send?: boolean } & Omit<ComponentProps<typeof Button>, 'onClick'>) {
  return (
    <Button variant="outline" {...props} onClick={() => askAgent(prompt, { send })}>
      <Sparkles /> {children}
    </Button>
  );
}
