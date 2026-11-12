import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Box, Button, Heading, Kbd, Popover, PopoverTrigger, ShortcutSection, Stack, PopoverContent } from '@loca/ui';
import { shortcutSections, useShortcuts } from '@/lib/shortcuts';

const OPEN_EVENT = 'loca:shortcut-help';
/** Opens the shortcut list from elsewhere (the command palette). */
export const openShortcutHelp = () => window.dispatchEvent(new Event(OPEN_EVENT));

/**
 * The shortcut list, from the header's keyboard button or `?` anywhere outside a text field: the table of
 * `lib/shortcuts.ts`, which the handlers read too. A popover, not a page: it is glanced at and closed. `listen` is off for a copy that is mounted but
 * hidden (the closed dock's header), so one key opens one list.
 */
export function ShortcutHelp({ listen = true }: { listen?: boolean }) {
  const [open, setOpen] = useState(false);
  useShortcuts({ help: () => setOpen((value) => !value) }, { enabled: listen });
  useEffect(() => {
    if (!listen) return;
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [listen]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="단축키 (?)" title="단축키 (?)">
          <Keyboard />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" width="popover-lg" padding="none" maxHeight="dialog">
        {shortcutSections().map((section) => (
          <ShortcutSection key={section.title}>
            <Heading as="h3" variant="section" minWidth={0} marginBottom="condensed">{section.title}</Heading>
            <Box as="dl" spaceY="condensed" variant="body">
              {section.rows.map((row) => (
                <Stack key={row.id} direction="row" align="start" justify="between" gap="normal">
                  <Box as="dt" minWidth={0}>{row.label}</Box>
                  <Stack as="dd" direction="row" shrink={false} gap="tight">
                    {row.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Box>
          </ShortcutSection>
        ))}
      </PopoverContent>
    </Popover>
  );
}
