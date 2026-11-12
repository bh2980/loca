import { matchedKey, type KeyPress } from '@/lib/keys';
import { SHORTCUTS } from '@/lib/shortcuts';

/**
 * The keys the source graph's canvas takes while it has the focus: arrows pan, + and − zoom, F fits, Enter opens the
 * selected node, Esc lets the selection go. They are plain keys: with ⌘, Ctrl or Alt held the key is the browser's or
 * another shortcut's (find, page zoom, the translation card's Alt+↓), and the canvas leaves it alone.
 */
type CanvasKeyAction = { pan: [dx: number, dy: number] } | 'zoom-in' | 'zoom-out' | 'fit' | 'open' | 'deselect';

/** How far an arrow key pans, in screen pixels. */
const STEP = 80;
const PAN: Record<string, [number, number]> = { Up: [0, STEP], Down: [0, -STEP], Left: [STEP, 0], Right: [-STEP, 0] };

export function canvasKeyAction(event: KeyPress): CanvasKeyAction | undefined {
  const pan = matchedKey(event, SHORTCUTS.canvasPan.keys);
  if (pan) return { pan: PAN[pan]! };
  const zoom = matchedKey(event, SHORTCUTS.canvasZoom.keys);
  if (zoom) return zoom === 'Plus' ? 'zoom-in' : 'zoom-out';
  if (matchedKey(event, SHORTCUTS.canvasFit.keys)) return 'fit';
  if (matchedKey(event, SHORTCUTS.canvasOpen.keys)) return 'open';
  if (matchedKey(event, SHORTCUTS.canvasDeselect.keys)) return 'deselect';
  return undefined;
}
