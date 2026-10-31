import { useMemo } from 'react';
import { paletteColor, Text, type TextProps } from '@loca/ui';
import { useCharacters } from './knowledge';

/**
 * The colors people gave characters (자료 › 인물 › 색), by name or alias (any case): a name with no
 * colored character has none. One lookup for every place a name is shown, so a person's color is
 * the same everywhere.
 */
export function usePersonColors(projectId: string) {
  const people = useCharacters(projectId);
  // Each colored name once: the lookup stays the same function until a color or a colored name changes,
  // so what reads it (table rows, script lines) is not drawn again for an edit to someone's profile.
  const colored = (people.data ?? []).flatMap((character) => (character.color ? [character.name, ...character.aliases].map((name) => `${name.trim().toLowerCase()}\t${character.color}`) : [])).join('\n');
  return useMemo(() => {
    const byName = new Map(colored ? colored.split('\n').map((line) => line.split('\t') as [string, string]) : []);
    return (name: string | null | undefined) => (name?.trim() ? byName.get(name.trim().toLowerCase()) : undefined);
  }, [colored]);
}

/** A character's name in its color (as a CSS color: the palette's token for the theme). */
export const personStyle = (color: string | undefined) => (color ? { color: paletteColor(color) } : undefined);

/** A name as text, in the person's color when it has one. */
export function PersonName({ projectId, name, ...text }: { projectId: string; name: string } & Omit<TextProps, 'children' | 'style'>) {
  const colorOf = usePersonColors(projectId);
  return (
    <Text {...text} style={personStyle(colorOf(name))}>
      {name}
    </Text>
  );
}
