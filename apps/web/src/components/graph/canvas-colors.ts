/** Resolve semantic theme tokens to concrete CSS colors for CanvasRenderingContext2D. */
export function getCanvasColors(style: CSSStyleDeclaration = getComputedStyle(document.documentElement)) {
  const read = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return {
    graphCanvas: read('graph-canvas'), graphGrid: read('graph-grid'), graphEdge: read('graph-edge'), graphNode: read('graph-node'),
    graphNodeLine: read('graph-node-line'), graphSelect: read('graph-select'), foreground: read('foreground'),
    mutedForeground: read('muted-foreground'), subtleForeground: read('subtle-foreground'), primary: read('primary'), primaryInk: read('primary-ink'),
    primarySoft: read('primary-soft'), card: read('card'), muted: read('muted'), border: read('border'), review: read('review'),
    aiSoft: read('ai-soft'), selection: read('selection'), choice: read('graph-kind-choice'), condition: read('graph-kind-condition'),
    wait: read('graph-kind-wait'), event: read('graph-kind-event'), state: read('graph-kind-state'),
    hues: Array.from({ length: 12 }, (_, index) => read(`hue-${index + 1}`)),
  };
}
export type CanvasColors = ReturnType<typeof getCanvasColors>;
