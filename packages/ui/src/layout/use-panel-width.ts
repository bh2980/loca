import { useCallback, useRef, useState } from 'react';
import type { OnPanelResize } from 'react-resizable-panels';

/** Keep side panes in pixels across viewport changes and reloads in this browser tab. */
export function usePanelWidth(key: string, fallback: number) {
  const storageKey = `loca.pane-width.${key}`;
  const [defaultSize] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem(storageKey));
      return `${Number.isFinite(saved) && saved > 0 ? saved : fallback}px`;
    } catch { return `${fallback}px`; }
  });
  const latestPixelWidth = useRef(Number.parseFloat(defaultSize));
  const onResize = useCallback<NonNullable<OnPanelResize>>((size) => {
    if (size.inPixels <= 0) return;
    latestPixelWidth.current = size.inPixels;
    try { sessionStorage.setItem(storageKey, String(size.inPixels)); } catch { /* private mode */ }
  }, [storageKey]);
  const getPixelWidth = useCallback(() => latestPixelWidth.current, []);
  return { defaultSize, onResize, getPixelWidth, groupResizeBehavior: 'preserve-pixel-size' as const };
}
