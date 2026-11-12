import { useCallback, useRef, useState } from 'react';
import type { OnPanelResize } from 'react-resizable-panels';
import { readStored, writeStored } from './storage';

/** Keep side panes in pixels across viewport changes and reloads in this browser tab. */
export function usePanelWidth(key: string, fallback: number) {
  const storageKey = `pane-width.${key}`;
  const [defaultSize] = useState(() => {
    const saved = Number(readStored('session', storageKey));
    return `${Number.isFinite(saved) && saved > 0 ? saved : fallback}px`;
  });
  const latestPixelWidth = useRef(Number.parseFloat(defaultSize));
  const onResize = useCallback<NonNullable<OnPanelResize>>((size) => {
    if (size.inPixels <= 0) return;
    latestPixelWidth.current = size.inPixels;
    writeStored('session', storageKey, String(size.inPixels));
  }, [storageKey]);
  const getPixelWidth = useCallback(() => latestPixelWidth.current, []);
  return { defaultSize, onResize, getPixelWidth, groupResizeBehavior: 'preserve-pixel-size' as const };
}
