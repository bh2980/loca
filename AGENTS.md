# Translation Workbench working rules

## Product and spec

- Product: user-defined translation statuses + workflow nodes between them that automate translation with AI. Story/world documents, characters, relationships and the dialogue/scene graphs exist to give AI nodes context. The code is the spec; the design notes in `docs/` say why it is built that way. Old behaviour may be removed or changed without compatibility shims.
- Labels must describe actual scope and evidence. Scene links are derived from the dialogue graph and must say so. Never invent graph edges or relationships.
- Prefer established libraries over custom infrastructure: ELK for layout (source graph is laid out once on the server, in a worker with a large stack), React Flow for small editable graphs, Canvas + d3-zoom + flatbush for the large source graph, AI SDK / TypeSafe SDK / execa for models, Zod for every boundary. Explain a concrete unmet requirement before writing a custom alternative.
- Source graphs read top-to-bottom; user workflows left-to-right. Do not reintroduce layer-width bounds, chain batching or component stacking that produce "staircase" layouts.

## Verification

- Check the complete journey in the browser (start the API, Vite and `pnpm mock-llm`), including native Back/Forward, retained filters/selection/drafts, and realistic volume (`pnpm samples -- --profile realistic --size 9000` → `samples/realistic-9k.json`; the mock LLM's `MOCK_PROFILE=cli-like|faulty` adds per-call overhead and failures). A successful build is not UX verification.
- Never run real AI jobs or modify user translations as part of verification without authorization; use the mock LLM and an isolated `WORKBENCH_DATA_DIR`.

## Page state

- URL search params are the source of truth for page state (filters, selection, tabs). Viewports and unsaved drafts live in sessionStorage; never push history entries for polling, panning or SSE refreshes.

## Data flow (server → browser)

- Server changes reach the browser over one SSE stream (`apps/server/src/events.ts`); never poll. The topics are `Topic` in `@tw/shared` (`sync.ts`).
- Screens read rows from browser collections (TanStack DB: `apps/web/src/lib/collections.ts`, `terms.ts`, `knowledge.ts`, `units.ts`), one per kind and project (the app's own rows under the scope `app`); never copy those rows into a query cache. A row's type is its reader's (`FeedRow`, from `READERS` in `apps/server/src/feed.ts`); never declare one by hand or keep a route to lend its type.
- The database says what changed, rows and topics alike: SQLite triggers note every changed row (`row_changed`, migrations from 0106; each event carries the rows, lines and the other held collections as ids the browser reads again, `POST sync/:collection`) and say each table's topic (`topic_changed`, from `TABLE_TOPICS` in `db/topics.ts`). A table a reader reads gets triggers in a migration (`feed-readers.test.ts` states which); code calls `events.changed` only for what is not a row, never at a write site. A row does not repeat what a screen can join from another collection by id (a line's scene, a call's connection).
- Writes go through the server API and the change gate, change the collection at once and finish when their `x-seq` comes back (`changeLines`, `decideItems`); no hand-written cache patches.
- Filters a screen and the CLI share live in `@tw/shared`. Lines have one filter, `lineFilterSchema`: the script list (as JSON), the CLI, the chat tools and a run's scope all send it, `services/line-filter.ts` alone resolves its names (`resolveLineFilter`; an unknown name is an error, never a dropped condition) and turns it into SQL (`lineConditions`), and `cli-parity.test.ts` checks every field on every surface.
- A screen's own question, answered anew each time it is asked (a filter's page of ids, a search or suggestions, a preview or preflight, the graph and route views), is a query whose key starts with its topic, refetched when the topic changes; `IMPLIES` covers one that reads another topic's tables. A question answers with ids (and its own numbers) and the rows come from collections (`useLinePage`, `useLinesByKeys`, `useLines`); only an answer computed per line carries line text (the editor's similar translations with their scores; same-source lines read once before a write). Never add a question or a query cache that copies rows. Topics also stay for the CLI's waits.

## Write paths (server)

- One service function per kind of change, with its rules inside; the app's routes, the agent's tools (through the change gate) and the run engine all call it. A route is parse → call a service → answer: no insert/update, cross-row check or multi-step write in `routes/`.
- Lines: structure (add, delete lines / nodes / scenes) is `services/graph-edit.ts` (`createLine`, `deleteLines`, `deleteNodes`, `deleteGroup`); text and status are `services/line-save.ts` (`saveLine`; `setLineStatus` is the only writer of a line's status, a run's exit actions included; `patchLines` for tags, listener, memo, 번역 제외). Knowledge saves are `services/knowledge-save.ts`, deletes of project items `services/item-delete.ts`.
- A write made from a view of a line carries the line's `rev` (`revOf`: its `updatedAt` in ms) and is refused with `LINE_CHANGED` when the line changed since; a bulk change sends the picked lines' revs and skips, and counts, the ones changed since. No other concurrency convention (no `base` text).
- Structural changes are undone by one persisted record (`services/undo-records.ts`): the change records what it removes (with its dependents), rewrites and makes; ⌘/Ctrl+Z (`POST /projects/:id/undo`) and an accepted proposal's undo (`restore_deleted` via `undoChanges`; a tool's deletes and its edits of the dialogue graph alike) put it back. Never keep undo state in memory.
- A service (and the engine) says no by throwing a `Refusal` (`apps/server/src/refusal.ts`: invalid / missing / conflict / forbidden / limited), never with the web framework or an error class of its own. It gets its HTTP status in one place (`onError`, `context.ts`) and becomes a tool's `{ ok: false, error }` in one place (`catalogOf`, `services/agent-catalog.ts`); a route has no `try/catch` that translates one. A function returns `{ ok: false, error }` only where its callers keep the outcome as data (an item of a batch, the gate's check and verdict, the start or continuation of a run).

## UI

Enforced by `pnpm ui-rules` unless marked "review". Details, token tiers and the type scale are in `packages/ui/README.md` (`pnpm storybook` shows the parts).

- Build screens only from the shared parts: `DataTable`, `FilterBar`, `ActionBar`, `SelectionBar`, `Inspector` from `@loca/ui`, `AiButton` from `apps/web/src/components`. shadcn/ui components underneath.
- Layout and text are said with `Box`/`Stack`/`Inline`/`Grid`/`Text`/`Heading`/`Icon` (props by token name: `gap`, `padding`, `tone`, `variant`…), never with `className`; what they cannot say becomes a component in `packages/ui`. `pnpm ui-rules` refuses `className` anywhere in `apps/web`.
- Colors come from the role names in `packages/ui/src/tokens/theme.css` (light Slate + dark Night themes); never hex, Tailwind palette colours or the raw steps of `tokens/palette.css` outside `tokens/`. One accent, color reserved for meaning, status as shape + colour (`StatusIcon`).
- Text sizes are the `variant` of `Text`/`Heading` (table in `packages/ui/README.md`); no `text-*` classes and no arbitrary `text-[Npx]`.
- Buttons: no raw `<button>`; text buttons take no `size` (`size="sm"` is the default, `"xs"` is refused); icon-only buttons use `icon`/`icon-xs`/`icon-sm`, a button inside a sentence uses `inline`. One primary button per screen/pane (review).
- Collections are tables; details open in a right-hand pane, not modals (AlertDialog only for destructive confirmation; the dialogue graph's translation card is a non-modal card anchored beside its node, not a detail view).
- The project chat is a global right-docked panel and every page reports its selection via `useReportView`.
- The app runs on Windows too: shortcut hints go through `keyLabel` (`lib/keys.ts`), never a hard-coded ⌘/⌥, and handlers accept Ctrl as well as ⌘.
- After `shadcn add`, replace any `from "cn"` import with `@/lib/utils` and remove the `cn` package it adds.

## CLI and agents

- The `loca` CLI (apps/cli) is the main surface for coding agents: what the app can do should be doable from it, and the app is where people set things up and debug. The CLI and the chat tools share the server's agent tools and script service (`services/agent-tools.ts`, `services/script-query.ts`).
- A tool is defined once: its spec in `@tw/shared` (`TOOL_SPECS`: label, the permissions it needs, its batch fields, whether it writes directly) and its server definition of the same name in `services/agent-tools.ts` (description, input, `execute`, `check`, `undo`, `preview`, `permit`). What is particular to a tool is a member of its definition: a proposal's card is drawn from the details its `preview` makes (`ProposalDetail`, a closed set of kinds in `@tw/shared`, rendered by kind in `change-preview.tsx`), and the gate, the undo and the permission check ask the definition (`undo.trim` / `order` / `chain`, `permit`), never a tool's name. The risk class (read / change / run / delete), whether it goes through the gate and its item count are computed from the spec; never write them, a by-name table or a `needsApproval` flag anywhere else. Every surface calls a tool through `callTool` (`services/tool-run.ts`).
- Every change from the terminal goes through the change gate (`proposeChange`) and the project's terminal permission mode (ask / auto / bypass, set by a person in the app); never add a CLI path that writes around it (only saved graph views, pausing or cancelling a run, and making a new project from a file are direct). Undoing an accepted change is a path of the same gate (`undoChanges`).
- The permission modes are a cooperative boundary, not a security boundary: the server does not tell the app from the terminal, so "매번 묻기" holds as long as an agent works through the `loca` CLI. A local process that calls the HTTP API itself (accepting a proposal, changing `agentSettings`) is not stopped; do not describe the modes as protection against one, and do not build features that assume they are.
- The CLI waits on the SSE stream, never by polling.
- Keep `.claude/skills/` (common rules in `.claude/skills/loca`) in step with CLI commands; `apps/cli/src/skills.test.ts` checks them.
