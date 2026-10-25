import type { InferResponseType } from 'hono/client';
import { ChevronRight } from 'lucide-react';
import { Box, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, Text } from '@loca/ui';
import type { client } from '@/lib/api';

type List = InferResponseType<(typeof client.runs)[':id']['plan']['$get'], 200>;

const JOINED = { link: '그래프로 이어짐', speaker: '화자 겹침', fill: '덜 찬 묶음 채움' } as const;

/** The plan batch by batch: which scenes travel in one request, and why each joined the one before. */
export function BatchList({ list, defaultOpen = false }: { list: List; defaultOpen?: boolean }) {
  if (!list.total) return null;
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" group flush="start">
          <Icon icon={ChevronRight} turn="group" />
          묶음 {list.total.toLocaleString()}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Box as="ul" marginTop="condensed" radius="md" border="all">
          {list.batches.map((batch, index) => (
            <Box as="li" key={index} spaceY="tight" paddingX="normal" paddingY="condensed" variant="body">
              <Text as="p" variant="caption" tone="muted" tabular>
                #{index + 1} · {batch.lines.toLocaleString()}줄 · 원문 토큰 {batch.tokens.toLocaleString()}
              </Text>
              <Box as="ul" spaceY="hair">
                {batch.scenes.map((scene) => (
                  <li key={scene.groupId}>
                    {scene.title} <Text tabular tone="muted">({scene.lines})</Text>
                    {scene.joined && (
                      <Text marginLeft="tight" variant="caption" tone="muted">
                        ← {JOINED[scene.joined.why]}
                        {scene.joined.why === 'speaker' && `: ${scene.joined.speakers.join(', ')}`}
                      </Text>
                    )}
                  </li>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
        {list.total > list.batches.length && <Text as="p" marginTop="tight" variant="caption" tone="muted">앞 {list.batches.length.toLocaleString()}개만 보여 줍니다.</Text>}
      </CollapsibleContent>
    </Collapsible>
  );
}
