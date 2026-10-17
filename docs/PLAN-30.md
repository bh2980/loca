# #30 Translating along the dialogue graph: no missed branches

## What is already done (DESIGN.md J2c)

- Route slice (길 따라 보기). Route 1 is the route through the most lines.
- 다음 길: the next route goes through the most untranslated lines, found by a local search over the choices.
- 이음새 checks where a new route joins an earlier one (merge points), stored per project.
- AI translation of the route's untranslated lines through RunDialog.
- 이전 길, and per-choice picks.

## What is missing: "no missed branches"

1. **The local search can stop early.** 다음 길 says 0 new lines (`모든 길 번역함`) when no single switch, or switch plus its new choices, gains anything. Untranslated lines that sit behind two nested choices away from the current route are then never offered. `remainingRoutes` stops counting there too.
2. **No list of what is left.** The stubs only show the arms of choices on the current route, and they count all lines, not untranslated ones. There is no project-wide view of which branches still have untranslated lines.
3. **No count of lines no route reaches.** These are lines in graph nodes with no path from a start, which come from data problems in the export. They count in `번역 n/m` but cannot be translated along any route.

## Plan

### Server

- `services/route-coverage.ts`:
  - `reachableAll(g)`: nodes reachable from the starts when every way is taken (every arm of every choice).
  - `remainingBranches(g, weights, picks)`, also called 남은 갈래:
    - Collect the untranslated lines that are reachable but not on the current route.
    - Group them by the choice on the route where they leave it. Go through the route's choices in script order, and each choice's arms in script order. The first arm that reaches a node claims it.
    - Each group carries:
      - the fork;
      - the arm and its label;
      - untranslated and total lines;
      - the first untranslated node in script order (the target for "이 갈래로").
  - `unreachable`: untranslated lines in nodes not reachable from any start.
  - `throughPicks(g, picks, target)`: the picks that make the route pass through `target`. It finds a shortest path (BFS) from the current route to the target and picks each exclusive fork's way along it. Nothing else changes. Forks along the path are off the current route, so the route's own nodes stay reachable.
- `next-route.ts`: a fallback. When the local search gains 0 but 남은 갈래 is not empty, start the search again from `throughPicks` toward the first remaining branch in script order. That way 다음 길 only says 0 when nothing reachable is left untranslated, and `remainingRoutes` counts every branch.
- API:
  - `GET /projects/:id/route/remaining` returns `{ branches, total, unreachable }`.
  - `POST /projects/:id/route/through` takes `{ nodeId, round }`. When the current route has no untranslated lines left, this starts the next round through that node, the way 다음 길 does: the history grows and the seams of that round work. Otherwise it only changes this round's picks, the way an arm pick does.

### Web (path view)

- The status line gains `남은 갈래 n (m줄)`, plus `닿지 않는 줄 k` when k > 0.
- A `남은 갈래` item in 더보기 opens a list panel:
  - each branch shows the choice it leaves, the arm label, its untranslated lines and its first line;
  - `이 갈래로` calls `route/through` and moves the window there.

### Tests

- Unit tests for the coverage service on hand-made graphs: a nested branch that the local search misses, an unreachable node, grouping.
- `throughPicks` reaches the target. The fallback finds the nested branch.
- A route test for `/route/remaining` and `/route/through` (it moves to the next round only when the route is done).
- Relay-station sample: after route 1, the remaining branches match the stubs that have untranslated lines.
- 9k sample: timing of `/route/remaining` and `/route/next`.

### Not in this PR

- Running AI on a single branch from the list: open the branch with 이 갈래로, then use the existing route AI button.
- Per-branch progress beyond the line counts.
