import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { paletteColor } from '@loca/ui';
import { cn } from '@/lib/utils';
import { q } from '@/lib/queries';

/**
 * The colors people gave characters (자료 › 인물 › 색), by name or alias (any case): a name with no
 * colored character has none. One lookup for every place a name is shown, so a person's color is
 * the same everywhere.
 */
export function usePersonColors(projectId: string) {
  const people = useQuery(q.characters(projectId));
  return useMemo(() => {
    const byName = new Map<string, string>();
    for (const character of people.data?.characters ?? []) {
      if (!character.color) continue;
      for (const name of [character.name, ...character.aliases]) byName.set(name.trim().toLowerCase(), character.color);
    }
    return (name: string | null | undefined) => (name?.trim() ? byName.get(name.trim().toLowerCase()) : undefined);
  }, [people.data]);
}

/** A character's name in its color (as a CSS color: the palette's token for the theme). */
export const personStyle = (color: string | undefined) => (color ? { color: paletteColor(color) } : undefined);

/** A name as text, in the person's color when it has one. */
export function PersonName({ projectId, name, className }: { projectId: string; name: string; className?: string }) {
  const colorOf = usePersonColors(projectId);
  return (
    <span className={cn(className)} style={personStyle(colorOf(name))}>
      {name}
    </span>
  );
}
