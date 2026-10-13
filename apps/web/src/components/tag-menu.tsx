import { Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PickedLabel } from '@/components/picked-bar';
import { TagChip } from '@/components/status';

export type TagState = 'all' | 'some' | 'none';

/**
 * Attach or detach tags on the picked rows: one check per tag, '일부' when only some carry it.
 * Clicking a tag attaches it to all unless all already have it. Lives in a PickedBar.
 */
export function TagMenu({ tags, state, onToggle, heading }: { tags: { id: string; name: string; color: string }[]; state: (tagId: string) => TagState; onToggle: (tagId: string, add: boolean) => void; heading: string }) {
  if (!tags.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="태그 붙이기·떼기">
          <Tags />
          <PickedLabel>태그</PickedLabel>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{heading}</DropdownMenuLabel>
        {tags.map((tag) => {
          const current = state(tag.id);
          return (
            <DropdownMenuCheckboxItem key={tag.id} checked={current === 'all'} onSelect={(event) => event.preventDefault()} onCheckedChange={() => onToggle(tag.id, current !== 'all')}>
              <TagChip tag={tag} />
              {current === 'some' && <span className="ml-auto text-xs text-muted-foreground">일부</span>}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
