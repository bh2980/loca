/**
 * A laid-out line when the nodes at its ends move (a node or a frame dragged): it keeps the shape the layout gave it.
 * Both ends moved by the same amount: the whole line moves with them. One end moved: its first run (out of or into the
 * port) moves with it and meets the rest of the line by a short step at the middle of the run after it, so the line stays
 * square and keeps its mark where it was (or moves it with the end it sat by).
 */
import type { WorkflowEdge } from '@tw/shared';

type Point = { x: number; y: number };
type Layout = NonNullable<WorkflowEdge['layout']>;
type Delta = { dx: number; dy: number };

const shift = (point: Point, by: Delta) => ({ x: point.x + by.dx, y: point.y + by.dy });
const still = (by: Delta) => by.dx === 0 && by.dy === 0;

/** The line's points with its first run moved by `by`, joined to the rest square. Needs at least 3 points. */
function moveStart(points: Point[], by: Delta): Point[] {
  const [first, second, third, ...rest] = points as [Point, Point, Point, ...Point[]];
  const a = shift(first, by);
  const b = shift(second, by);
  // The run after the first one is joined by a step at its middle, across the way the end moved.
  const flat = Math.abs(second.y - third.y) < 0.5;
  const joint = flat
    ? [{ x: (b.x + third.x) / 2, y: b.y }, { x: (b.x + third.x) / 2, y: third.y }]
    : [{ x: b.x, y: (b.y + third.y) / 2 }, { x: third.x, y: (b.y + third.y) / 2 }];
  return [a, b, ...joint, third, ...rest];
}

/** Drops points that add no bend (on a straight run between their neighbours, or the same as the one before). */
function tidy(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = out.at(-2);
    const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
    if (before && last && ((same(before.x, last.x) && same(last.x, point.x)) || (same(before.y, last.y) && same(last.y, point.y)))) out.pop();
    out.push(point);
  }
  return out;
}

/** `layout` with its source end moved by `source` and its target end by `target`; undefined without a route. */
export function shiftRoute(layout: Layout | undefined, source: Delta, target: Delta): Layout | undefined {
  if (!layout) return undefined;
  if (still(source) && still(target)) return layout;
  if (source.dx === target.dx && source.dy === target.dy) {
    return { points: layout.points.map((point) => shift(point, source)), ...(layout.labelPosition && { labelPosition: shift(layout.labelPosition, source) }) };
  }
  if (layout.points.length < 2) return undefined;
  if (layout.points.length === 2) {
    // A straight line between two nodes: its ends move, and it steps across at its middle.
    const a = shift(layout.points[0]!, source);
    const b = shift(layout.points[1]!, target);
    const down = Math.abs(layout.points[0]!.x - layout.points[1]!.x) < 0.5;
    const points = down
      ? [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b]
      : [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b];
    const next = tidy(points);
    return { points: next, ...(layout.labelPosition && { labelPosition: nearest(next, layout.labelPosition) }) };
  }
  let points = layout.points;
  if (!still(source)) points = moveStart(points, source);
  if (!still(target)) points = moveStart([...points].reverse(), target).reverse();
  // The mark stays where it was unless it sat on a run that moved: then it moves with that end.
  const mark = layout.labelPosition;
  const onRun = (from: Point, to: Point, at: Point) => (Math.abs(from.x - to.x) < 0.5 ? Math.abs(at.x - from.x) < 0.5 && at.y >= Math.min(from.y, to.y) && at.y <= Math.max(from.y, to.y) : Math.abs(at.y - from.y) < 0.5 && at.x >= Math.min(from.x, to.x) && at.x <= Math.max(from.x, to.x));
  const [p0, p1] = layout.points as [Point, Point];
  const [q0, q1] = [...layout.points].reverse() as [Point, Point];
  const moved = mark && (!still(source) && onRun(p0, p1, mark) ? shift(mark, source) : !still(target) && onRun(q0, q1, mark) ? shift(mark, target) : mark);
  const next = tidy(points);
  // A mark left off the line by the step (its run got shorter) goes to the nearest point of the line.
  const labelPosition = moved && (next.slice(1).some((point, index) => onRun(next[index]!, point, moved)) ? moved : nearest(next, moved));
  return { points: next, ...(labelPosition && { labelPosition }) };
}

/** The point of a square line nearest to `at`. */
function nearest(points: Point[], at: Point): Point {
  let best = points[0]!;
  let distance = Infinity;
  for (const [index, to] of points.slice(1).entries()) {
    const from = points[index]!;
    const point = { x: Math.min(Math.max(at.x, Math.min(from.x, to.x)), Math.max(from.x, to.x)), y: Math.min(Math.max(at.y, Math.min(from.y, to.y)), Math.max(from.y, to.y)) };
    const d = Math.abs(point.x - at.x) + Math.abs(point.y - at.y);
    if (d < distance) [best, distance] = [point, d];
  }
  return best;
}
