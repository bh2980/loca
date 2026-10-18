import type { InferResponseType } from 'hono/client';
import { ChevronRight } from 'lucide-react';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@loca/ui';
import type { client } from '@/lib/api';

type List = InferResponseType<(typeof client.runs)[':id']['plan']['$get'], 200>;

const JOINED = { link: '그래프로 이어짐', speaker: '화자 겹침', fill: '덜 찬 묶음 채움' } as const;

/** The plan batch by batch: which scenes travel in one request, and why each joined the one before. */
export function BatchList({ list, defaultOpen = false }: { list: List; defaultOpen?: boolean }) {
  if (!list.total) return null;
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="group -ml-2">
          <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
          묶음 구성 보기 ({list.total.toLocaleString()}개)
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 rounded-md border">
          {list.batches.map((batch, index) => (
            <li key={index} className="space-y-1 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground tabular-nums">
                #{index + 1} · {batch.lines.toLocaleString()}줄 · 원문 토큰 {batch.tokens.toLocaleString()}
              </p>
              <ul className="space-y-0.5">
                {batch.scenes.map((scene) => (
                  <li key={scene.groupId}>
                    {scene.title} <span className="tabular-nums text-muted-foreground">({scene.lines})</span>
                    {scene.joined && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ← {JOINED[scene.joined.why]}
                        {scene.joined.why === 'speaker' && `: ${scene.joined.speakers.join(', ')}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {list.total > list.batches.length && <p className="mt-1 text-xs text-muted-foreground">앞 {list.batches.length.toLocaleString()}개만 보여 줍니다.</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}
