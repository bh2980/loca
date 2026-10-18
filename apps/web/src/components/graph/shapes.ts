import type { CanvasColors } from './canvas-colors';
/**
 * Node shapes by meaning, so kind is readable without color:
 * line/scene = rounded rectangle, condition = diamond, wait = hourglass, event = circle,
 * state change = hexagon, connector/join = dot, unknown = dashed rectangle, folded run = stacked box,
 * a player's choice = a pill (fully rounded ends) on blue.
 */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const fillFor = (kind: string, colors: CanvasColors) => ({ script: colors.graphNode, scene: colors.graphNode, chain: colors.graphNode, choice: colors.choice, condition: colors.condition, wait: colors.wait, event: colors.event, state: colors.state, connector: colors.mutedForeground, unknown: colors.muted }[kind] ?? colors.muted);

export const KIND_LABEL: Record<string, string> = {
  script: '대사',
  scene: '장면',
  chain: '이어진 노드',
  choice: '선택지',
  condition: '조건·분기',
  wait: '대기',
  event: '이벤트',
  state: '상태 변경',
  connector: '합류',
  unknown: '미분류',
};

export function drawShape(context: CanvasRenderingContext2D, kind: string, box: Box, options: { selected: boolean; selectColor: string; detailed: boolean; k: number; colors: CanvasColors }) {
  const { x, y, width: w, height: h } = box;
  const cx = x + w / 2, cy = y + h / 2;
  context.beginPath();
  switch (kind) {
    case 'condition':
      context.moveTo(cx, y);
      context.lineTo(x + w, cy);
      context.lineTo(cx, y + h);
      context.lineTo(x, cy);
      context.closePath();
      break;
    case 'wait':
      context.moveTo(x + w * 0.2, y);
      context.lineTo(x + w * 0.8, y);
      context.lineTo(cx, cy);
      context.lineTo(x + w * 0.8, y + h);
      context.lineTo(x + w * 0.2, y + h);
      context.lineTo(cx, cy);
      context.closePath();
      break;
    case 'event':
      context.ellipse(cx, cy, Math.min(w, h) / 2, Math.min(w, h) / 2, 0, 0, Math.PI * 2);
      break;
    case 'state': {
      const inset = Math.min(w * 0.22, h * 0.5);
      context.moveTo(x + inset, y);
      context.lineTo(x + w - inset, y);
      context.lineTo(x + w, cy);
      context.lineTo(x + w - inset, y + h);
      context.lineTo(x + inset, y + h);
      context.lineTo(x, cy);
      context.closePath();
      break;
    }
    case 'connector':
      context.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2);
      break;
    case 'chain':
      // A folded run: a box with a second edge behind it, like a small stack.
      context.roundRect(x + 5, y + 5, w, h, Math.min(10, h / 4));
      context.fillStyle = options.detailed ? options.colors.muted : options.colors.graphNodeLine;
      context.fill();
      if (options.detailed) {
        context.strokeStyle = options.colors.graphNodeLine;
        context.lineWidth = 1;
        context.stroke();
      }
      context.beginPath();
      context.roundRect(x, y, w, h, Math.min(10, h / 4));
      break;
    case 'choice':
      context.roundRect(x, y, w, h, h / 2);
      break;
    default:
      context.roundRect(x, y, w, h, Math.min(10, h / 4));
  }
  // Zoomed out there is no outline, so white boxes need a visible fill.
  context.fillStyle = !options.detailed && (kind === 'script' || kind === 'scene' || kind === 'chain') ? options.colors.graphNode : !options.detailed && kind === 'choice' ? options.colors.primary : fillFor(kind, options.colors);
  context.fill();
  if (!options.detailed && !options.selected) return;
  context.lineWidth = options.selected ? Math.max(2.5, 2.5 / options.k) : 1;
  context.strokeStyle = options.selected ? options.selectColor : kind === 'choice' ? options.colors.primary : options.colors.graphNodeLine;
  if (kind === 'unknown' && !options.selected) context.setLineDash([4, 3]);
  context.stroke();
  context.setLineDash([]);
}
