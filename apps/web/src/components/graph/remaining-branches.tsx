import { Box, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Empty, EmptyHeader, EmptyTitle, Inline, Text } from '@loca/ui';
import type { PathNodeText } from '@/components/graph/path-graph';

export interface RemainingBranchItem {
  fork: string;
  arm: string;
  label: string | null;
  untranslated: number;
  lines: number;
  firstNode: string;
}

/**
 * 남은 갈래 (docs/PLAN-30.md): the branches the current route does not pass that still have
 * untranslated lines, by the choice they leave it at. 이 갈래로 takes the route through the branch's
 * first untranslated line (the next round when this route is translated).
 */
export function RemainingBranches({ open, onOpenChange, branches, unreachable, texts, busy, onGo }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: RemainingBranchItem[];
  unreachable: number;
  texts: Map<string, PathNodeText>;
  busy: boolean;
  onGo: (branch: RemainingBranchItem) => void;
}) {
  const line = (id: string) => {
    const text = texts.get(id);
    return text?.text ? `${text.speaker ? `${text.speaker}: ` : ''}${text.text}` : null;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Box asChild maxWidthFromSm="xl">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>남은 갈래 {branches.length.toLocaleString()}</DialogTitle>
          <DialogDescription>
            이번 길이 지나지 않는, 번역 안 한 줄이 있는 갈래
            {unreachable > 0 && ` · 어떤 길로도 닿지 않는 ${unreachable.toLocaleString()}줄 제외`}
          </DialogDescription>
        </DialogHeader>
        {branches.length ? (
          <Box as="ul" marginX="-condensed" maxHeight="60vh" overflow="y" data-testid="remaining-branches">
            {branches.map((branch) => (
              <Inline as="li" key={`${branch.fork}:${branch.arm}`} gap="normal" paddingX="condensed" paddingY="condensed">
                <Box minWidth={0} grow>
                  <Text as="p" truncate variant="body">{branch.label ?? line(branch.arm) ?? '이름 없는 갈래'}</Text>
                  <Text as="p" truncate variant="caption" tone="muted" title={line(branch.firstNode) ?? undefined}>
                    <Text tabular>미번역 {branch.untranslated.toLocaleString()} / {branch.lines.toLocaleString()}줄</Text>
                    {line(branch.firstNode) && ` · ${line(branch.firstNode)}`}
                  </Text>
                </Box>
                <Button variant="outline" disabled={busy} onClick={() => onGo(branch)}>
                  이 갈래로
                </Button>
              </Inline>
            ))}
          </Box>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>남은 갈래가 없습니다</EmptyTitle>
              
            </EmptyHeader>
          </Empty>
        )}
      </DialogContent>
      </Box>
    </Dialog>
  );
}
