/**
 * The keys the source graph's canvas takes while it has the focus: arrows pan, + and − zoom, F fits, Enter opens the
 * selected node, Esc lets the selection go. They are plain keys: with ⌘, Ctrl or Alt held the key is the browser's or
 * another shortcut's (find, page zoom, the translation card's Alt+↓), and the canvas leaves it alone.
 */
type CanvasKeyAction = { pan: [dx: number, dy: number] } | 'zoom-in' | 'zoom-out' | 'fit' | 'open' | 'deselect';

/** How far an arrow key pans, in screen pixels. */
const STEP = 80;
const PAN: Record<string, [number, number]> = { ArrowUp: [0, STEP], ArrowDown: [0, -STEP], ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0] };

export function canvasKeyAction(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): CanvasKeyAction | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  if (PAN[event.key]) return { pan: PAN[event.key]! };
  if (event.key === '+' || event.key === '=') return 'zoom-in';
  if (event.key === '-') return 'zoom-out';
  if (event.key === 'f') return 'fit';
  if (event.key === 'Enter') return 'open';
  if (event.key === 'Escape') return 'deselect';
  return undefined;
}
