/** Resolve the theme's colour tokens to concrete CSS colours for CanvasRenderingContext2D (the names are the tokens in packages/ui tokens/theme.css). */
export function getCanvasColors(style: CSSStyleDeclaration = getComputedStyle(document.documentElement)) {
  const read = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return {
    graphEdge: read('stroke-graph-edge'), graphNode: read('background-color-graph-node'), graphNodeLine: read('stroke-graph-node'),
    text: read('text-color-default'), textMuted: read('text-color-muted'),
    accent: read('background-color-accent'), accentSoft: read('background-color-accent-soft'), onAccentSoft: read('text-color-on-accent-soft'),
    surface: read('background-color-surface'), sunken: read('background-color-sunken'), line: read('border-color-default'),
    choice: read('background-color-graph-kind-choice'), condition: read('background-color-graph-kind-condition'),
    wait: read('background-color-graph-kind-wait'), event: read('background-color-graph-kind-event'), state: read('background-color-graph-kind-state'),
    hues: Array.from({ length: 12 }, (_, index) => read(`hue-${index + 1}`)),
  };
}
export type CanvasColors = ReturnType<typeof getCanvasColors>;
