import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { STYLE } from '../primitives/style';

/** The size names of tokens/system.css (`w-field`, `max-h-scroll`, `h-control-sm` ...): tailwind-merge must know them as sizes to let a later one replace an earlier `w-fit`. */
const SIZE_NAMES = [STYLE.width, STYLE.maxWidth, STYLE.height, STYLE.maxHeight, STYLE.minHeight].flatMap((table) => Object.keys(table));

const merge = extendTailwindMerge({ extend: { theme: { spacing: SIZE_NAMES, container: SIZE_NAMES } } });

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
