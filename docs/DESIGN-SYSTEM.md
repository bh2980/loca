# 디자인 시스템 (@loca/ui)

> 상태: 확정 (2026-10-25). 화면은 이 문서의 부품과 토큰만으로 만든다. 바꿀 때는 이 문서를 먼저 고친다.

## 1. 토큰: 원시 → 역할 → 부품 전용

색·크기는 세 단으로 둔다. 아래 단은 위 단만 가리킨다.

| 단 | 무엇 | 누가 쓰나 | 파일 |
|---|---|---|---|
| 원시 | 실제 값. 색은 계열과 밝기, 크기는 px | 토큰 파일만 | `tokens/palette.css` |
| 역할 | 무엇에 쓰는지로, 칠하는 속성마다 지은 이름 (`bg-accent`, `bg-panel`, `text-muted`) | 부품 | `tokens/theme.css` |
| 부품 전용 | 한 업무 부품만 쓰는 값 (`stroke-graph-edge`, `bg-node-header-ai`) | 그 부품만 | `tokens/theme.css` 아래쪽 |

### 1-1. 색

**원시 단계** (`tokens/palette.css`) — 회색은 번호(`slate-1..12`, `night-1..12`), 강조·의미 색은 계열 이름 + 밝기(oklch L × 1000). 이름은 전역이고 테마가 계열을 갖지 않는다. 어느 단계가 어느 역할을 하는지는 theme.css가 정한다.

| 계열 | 단계 | 쓰임 |
|---|---|---|
| `slate` | 1 … 12 | 밝은 테마의 바탕·면·선·글자 (hue 258, 글자 262) |
| `night` | 1 … 12 | 어두운 테마의 바탕·면·선·글자 (hue 265) |
| `cobalt` | 950 910 530 450 370 (+`530-a45`) | 밝은 테마의 강조 하나 (버튼·선택·초점)와 그 옅은 파랑 |
| `teal` | 850 800 340 320 200 (+`800-a50`) | 어두운 테마의 강조 하나 |
| `red` `orange` `amber` `green` `violet` | 둘 다 | 위험 · 경고 · 검토 필요 · 완료 · AI |
| `hue-1..12` `token-1..6` | 테마마다 값이 따로 | 데이터 색: 사용자가 고르는 상태 색, 서식 토큰 칩 짝. 코드가 직접 쓸 수 있는 유일한 원시 값(`var(--hue-${n})`) |

`-aNN`은 같은 색의 투명도(`cobalt-530-a45` = 45%). 회색의 투명도(그림자 `--elevation-color`, 막 `bg-scrim`)는 theme.css가 단계를 `color-mix`로 섞어 만든다. 강조·의미 색 계열은 밝기 이름을 그대로 둔다(`cobalt-530` …): 회색처럼 번호가 뜻을 갖지 않고 단계 수도 계열마다 달라, 번호로 바꿔도 얻는 규칙이 없다.

**역할** (`tokens/theme.css`) — 칠하는 속성마다 Tailwind 이름공간(`--background-color-*` `--text-color-*` `--border-color-*` `--ring-color-*` `--outline-color-*` `--divide-color-*` `--text-decoration-color-*` `--fill-*` `--stroke-*`)으로 이름을 둬서 클래스가 무엇을 칠하는지 말한다(`bg-page` `text-muted` `border-default` `ring-focus`). 밝은 값은 `@theme static` 블록에(Tailwind가 이름을 거기서 읽는다), 어두운 값은 `.dark`에 둔다. 값은 원시 단계, 다른 역할, 또는 그 둘의 섞음뿐이고 숫자 리터럴은 없다. shadcn 이름(`primary`, `muted-foreground`, `destructive` …)과 옛 이름으로 잇는 별칭은 없다. `bg-accent/40`처럼 역할에 투명도를 붙이는 것은 packages/ui 안에서 쓸 수 있다.

| 속성 | 이름 | 뜻 |
|---|---|---|
| 배경 `bg-*` | `page` `panel` `chrome` `navigation` | 작업 영역, 오른쪽 창, 사이드바·상태 줄 띠, 왼쪽 목록 |
| | `surface` `overlay` | 올라온 면: 입력칸·노드·카드, 메뉴·팝오버 |
| | `sunken` `quiet` `hover` `selected` | 꺼진 칸, 조용한 채움, 올린 줄, 고른 줄 |
| | `accent` `accent-soft` | 강조 채움, 옅은 강조 |
| | `danger` `warning` `success` `review` `ai` `ai-soft` | 의미 채움 |
| | `line` `neutral` `neutral-subtle` `inverse` `track` `scrim` `focus` | 채움으로 그린 선(구분선·스크롤바·크기 손잡이), 회색 점, 더 옅은 회색 점, 반전 채움(툴팁), 스위치 꺼진 줄, 대화창 뒤 막, 초점색 채움 |
| 글자 `text-*` | `default` `muted` `subtle` | 본문, 라벨·보조, 메타·placeholder (모두 4.5:1 이상) |
| | `inverse` `on-accent` `on-accent-soft` | 진한 채움 위, 강조 채움 위, 옅은 강조 위 |
| | `accent` `danger` `warning` `success` `review` `ai` | 의미 글자 |
| 선 `border-*` | `default` `subtle` `input` | 영역 사이 선, 옅은 선, 입력칸 선 |
| | `strong` `neutral` `surface` `focus` | 글자색 윤곽, 회색 윤곽, 뒤 면 색으로 낸 틈, 초점 |
| | `accent` `danger` `warning` `success` `review` | 의미 선 |
| 고리 `ring-*` | `focus` `line` `strong` `accent` `danger` `warning` | 초점 고리, 고리로 그린 머리카락 선, 고른 견본, 의미 |
| 그 밖 | `outline-focus` `divide-subtle` `decoration-accent` `decoration-danger` | |
| 그림 | `fill-accent` `fill-muted` `fill-page` · `stroke-default` `stroke-muted` `stroke-subtle` `stroke-accent` `stroke-danger` `stroke-warning` | SVG·React Flow가 `var(--fill-…)`로 읽는다 |

옛 이름 → 새 이름 (검토용):

| 옛 | 새 |
|---|---|
| `background` `card` `popover` | `bg-page` `bg-surface` `bg-overlay` |
| `muted` `secondary` `accent` `selection` | `bg-sunken` `bg-quiet` `bg-hover` `bg-selected` |
| `primary` `primary-soft` `primary-foreground` `primary-ink` | `bg-accent` `bg-accent-soft` `text-on-accent` `text-on-accent-soft` (`text-primary` → `text-accent`) |
| `destructive` | `danger` (`bg-` `text-` `border-` `ring-` `decoration-`) |
| `foreground` `muted-foreground` `subtle-foreground` | `text-default` `text-muted` `text-subtle` |
| `card-foreground` `popover-foreground` `accent-foreground` `secondary-foreground` | `text-default` |
| `review-ink` | `text-review` |
| `border` `border-subtle` `input` `ring` | `border-default` `border-subtle` `border-input` `ring-focus` `border-focus` `outline-focus` |
| `bg-border` `ring-border` | `bg-line` `ring-line` |
| `bg-muted-foreground` `border-muted-foreground` `bg-subtle-foreground` | `bg-neutral` `border-neutral` `bg-neutral-subtle` |
| `bg-foreground` `text-background` `border-foreground` `ring-foreground` | `bg-inverse` `text-inverse` `border-strong` `ring-strong` |
| `bg-input` `bg-ring` `border-card` `bg-black/40` | `bg-track` `bg-focus` `border-surface` `bg-scrim` |
| `text-info` (은 정의가 없어 아무것도 칠하지 않았다) | 지움 |

**부품 전용** — 한 업무 부품만 쓰는 값은 역할이나 원시 단계를 가리키고 부품 이름으로 짓는다: 사이드바 `bg-sidebar` `text-sidebar` `bg-sidebar-item` `bg-sidebar-badge`; 그래프 `bg-graph-canvas` `fill-graph-grid` `stroke-graph-edge` `bg-graph-node` `stroke-graph-node` `bg-graph-kind-{choice,condition,wait,event,state}` (canvas-colors.ts가 이름으로 읽는다) `text-graph-choice` `bg-graph-choice` `border-graph-choice`; 노드 카드 `bg-node-header-{neutral,ai,check,flow,status,state}` `text-node-state` `bg-node-state`; `bg-floating-toolbar` `text-floating-toolbar` `bg-floating-toolbar-hover`; `bg-meter-track`; 그림자 색 `--elevation-color`(`shadow-*` 값이 쓴다). 옛 `sidebar-border` `sidebar-ring` `graph-select`는 `border-default` `ring-focus` `accent`와 같은 값이라 없앴다.

**Tailwind 기본 색은 끈다** (`--color-*: initial`). `bg-red-500` `bg-black` `text-white`는 CSS가 만들어지지 않는다. 남는 것: `transparent`, `current`, `inherit`, 그리고 위 이름들.

**옛것은 남기지 않는다** — 새 이름으로 바꾸면서 옛 이름·별칭·쓰지 않는 부품·되돌림용 코드는 지운다. 바뀌지 않는 것은 화면에 그려지는 값(색·크기)뿐이다.

#### 회색 단계 (12단계)

회색은 테마마다 12단계이고 번호가 뜻을 가진다(Radix 관례). 역할은 단계 번호로만 가리킨다.

| 단계 | 뜻 | 밝은 `slate-n` (L) | 어두운 `night-n` (L) | 가리키는 역할 |
|---|---|---|---|---|
| 1 | 가장 낮은 바탕 | 1.000 (흰색) | 0.175 | 밝은: surface·overlay·graph-node·on-accent / 어두운: chrome·graph-canvas |
| 2 | 작업 영역 | 0.995 | 0.19 | page·inverse 글자·fill-page / 어두운: navigation |
| 3 | 옆 창 | 0.984 | 0.205 | panel·navigation / 어두운: page·inverse 글자·fill-page |
| 4 | 띠 | 0.968 | 0.235 | chrome·floating-toolbar 글자 / 어두운: panel |
| 5 | 꺼진 칸·올린 줄 | 0.952 | 0.255 | sunken·quiet·hover / 어두운: surface·sunken·border-subtle·divide-subtle·border-surface |
| 6 | 옅은 선·사이드바 올림 | 0.938 | 0.27 | border-subtle·divide-subtle·graph-canvas·sidebar-item / 어두운: overlay |
| 7 | 영역 사이 선 | 0.91 | 0.29 | border·line / 어두운: hover·quiet·border·line·sidebar-item·graph-grid |
| 8 | 진한 선 | 0.83 | 0.32 | graph-grid·graph-node-line / 어두운: graph-node·floating-toolbar |
| 9 | 입력칸 선 | 0.66 | 0.53 | border-input·track / 어두운: border-input·track·graph-node-line |
| 10 | 흐린 글자·중간 채움 | 0.52 | 0.66 | subtle 글자·neutral-subtle·stroke-subtle·graph-edge(밝은) / 어두운: subtle 글자·neutral-subtle·graph-edge |
| 11 | 보조 글자 | 0.43 | 0.76 | muted 글자·neutral·border-neutral·fill-muted / 어두운: 같음 |
| 12 | 본문 글자 | 0.24 | 0.94 | default 글자·inverse 채움·border-strong·sidebar-badge·floating-toolbar 배경 / 어두운: default 글자·inverse 채움·border-strong |

밝은 단계는 hue 258(1–9)·262(10–12), 어두운 단계는 hue 265. 글자 단계(10–12)는 page 위에서 4.5:1 이상, 입력칸 선(9)은 입력칸 면 위에서 3:1 이상. 어두운 9단계는 처음 안(0.50)이 어두운 면 위에서 2.6:1이라 옛 입력칸 선 밝기(0.53, 3.0:1)로 둔다.

### 1-2. 크기

숫자나 길이가 아니라 쓰임새 이름만 쓴다. 값은 `tokens/system.css` 한 곳(Tailwind 테마 변수 `--width-*` `--max-width-*` `--height-*` `--max-height-*` `--min-height-*`)에 있고, `primitives/style.ts`의 `width` `maxWidth` `height` `maxHeight` `minHeight`가 이 이름을 받는다. `pnpm ui-rules`는 `style.ts`에 `w-28` `w-[200px]` 같은 값이 들어오거나 정의 없는 이름을 쓰는 것을 막는다.

| 종류 | 이름 (값) | 쓰는 곳 |
|---|---|---|
| 간격 | none 0 · hair 2 · tight 4 · condensed 8 · normal 12 · comfortable 16 · spacious 24 · wide 32 · section 48 (px) | `padding*` `margin*` `gap*` `spaceY`, 부품 안쪽도 이 단계만 |
| 너비 `icon` | 1rem | 접기 화살표 자리 |
| 너비 `field-*` | xs 4rem · sm 6 · (없음) 8 · lg 12 | 숫자·선택 입력칸, 행의 이름 열 (`minWidth` `field-xs`: 4rem 밑으로 줄지 않는 이름 열) |
| 너비 `menu*` | (없음) 14rem · lg 16 | 드롭다운 메뉴와 그 방아쇠 |
| 너비 `popover*` | (없음) 20rem · lg 24 | 떠 있는 면, 캔버스 위 패널, 글 카드 |
| 너비 `rail` | 12rem | 화면 옆 목록(워크플로 노드 목록) |
| 최대 너비 | `reading` 56rem · `label` 12rem | 글 열 · 줄여 보이는 이름 |
| 높이 | `bar` 3rem · `icon` 1rem · `track` 0.375rem · `control-xs` 1.5rem · `control-sm` 1.75 · `control` 2 | 창 머리 · 구분선 · 진행 막대 · 입력 높이 |
| 높이 `placeholder*` | sm 4rem · md 8 · lg 12 · page 24 | 불러오는 자리 |
| 최대 높이 `scroll*` | sm 12rem · (없음) 16 · lg 24 | 스크롤 영역이 커지다 멈추는 높이 |
| 최대 높이 | `pane` 50% · `dialog` 70vh | 부모 대비 · 화면 대비. 대화창이 하나를 크게 보일 때는 `DialogContent tall`(70vh 높이의 열) |
| 최소 높이 | `control-sm` 1.75rem · `textarea-sm` 5rem · `textarea` 8 · `textarea-lg` 14 | 글상자 |

단계를 줄일 때 옛 값은 가장 가까운 단계로 옮긴다(같은 거리면 입력칸·메뉴·스크롤 영역은 큰 쪽, 불러오는 자리는 작은 쪽). 간격 6px은 아이콘과 글자 사이·칩 안쪽이면 4, 그 밖은 8. 10px은 촘촘한 줄·작은 조작부 안쪽이면 8, 묶음 사이면 12. 20px은 창 안이면 16, 화면 구역 사이면 24. 부품 안쪽의 Tailwind 간격도 같은 단계만 쓴다(0.5 1 2 3 4 6 8 12): 1.5 → 1 또는 2, 2.5 → 2 또는 3, 3.5 → 3, 5 → 4, 7 → 8. 아이콘·상자 크기(`size-3.5`)는 간격이 아니라 그대로 둔다.

#### 값 정리 (2026-10-26)

체계는 그대로 두고 값만 규칙적으로 맞췄다. 화면이 조금 달라지는 것은 승인된 변경이다. 합치거나 없앤 단계:

- 회색: 밝은 18단계 → `slate-1..12`, 어두운 17단계 → `night-1..12`. 회색의 투명도 단계(`slate-240-a08`, `night-0-a35`, `night-0-a40`)는 없애고 `color-mix`로 대신한다.
- 간격: `snug`(6) `cozy`(10) `roomy`(20) 삭제. `snug` → `tight` 또는 `condensed`, `cozy` → `condensed` 또는 `normal`, `roomy` → `comfortable`.
- 너비: `field-3xs` `field-2xs` → `field-xs`; `field-xs` → `field-sm`; `field-md` `field-lg` → `field`; `field-xl` `field-2xl` → `field-lg`; `menu-2xs` `-xs` `-sm` `-md` → `menu`; `menu-xl` → `menu-lg`; `popover-sm` → `popover`; `card` → `popover-lg`; `list` → `rail`(12rem).
- 최대 너비: `label-sm` `label-lg` → `label`; `form` `column` → `reading`.
- 높이: `placeholder`(6rem) `-block` → `placeholder-sm`; `placeholder-lg` `-xl` → `placeholder-md`(8rem); `height` `dialog` `dialog-lg`(75vh 85vh) → `DialogContent tall`.
- 최대 높이: `scroll-xs` `-md` → `scroll-sm`; `scroll-list` `-lg` `-xl` → `scroll`; `scroll-2xl` `-3xl` → `scroll-lg`; `pane` 45% → 50%; `popover` `popover-tall` `window` → `dialog`(70vh); `overlay` → `pane`.
- 최소 높이: `textarea-xs` `-md` → `textarea-sm`; `textarea-lg` → `textarea`(8rem); `textarea-xl` → `textarea-lg`.

한 부품만 쓰는 크기·위치(React Flow 연결점, 덮는 자리, 목록 줄의 여백 제거)는 `style.ts`가 아니라 그 부품의 prop이다: `FlowHandle` `Overlay` `CanvasFloat` `VirtualItem` `Bleed` `ListItem` `AlertRow`, `Button`의 `flush` `align` `reveal` `group`, `DialogContent`의 `size`. 옵션 전체 목록은 `packages/ui/README.md`.

## 2. 부품 5단

의존은 아래로만: ⑤ → ④ → ③ → ② → ①.

| 단 | 폴더 | 무엇 | 규칙 |
|---|---|---|---|
| ① 토큰 | `tokens/` | 위 1장 | |
| ② 기초 | `primitives/` | `Box` `Stack` `Inline` `Grid` `Text` `Heading` `Icon` | 토큰 이름만 받는다. 한 화면만 쓰는 옵션을 두지 않는다 |
| ③ 조작 | `controls/` | `Button` `Input` `Textarea` `Select` `Combobox` `Checkbox` `Switch` `RadioGroup` `Toggle` `Tabs` `DropdownMenu` `ContextMenu` `Popover` `Dialog` `AlertDialog` `Sheet` `Tooltip` … (shadcn 기반) | 너비·고정폭 글꼴·크기는 속성으로 받는다 (`<Select width="field">`, `<Input mono>`). 화면별 사본을 만들지 않는다 |
| ④ 패턴 | `patterns/` | 여러 화면이 같은 모양으로 쓰는 것: `Field`·`FieldRow` `Section` `PaneHeader` `SplitPane` `DataTable` `ListRow` `Chip` `Badge` `Count` `StatusIcon` `Meter` `Progress` `EmptyState` `Skeleton` `Notice` `Toolbar` `ActionBar` `SelectionBar` `Inspector` `KeyValue` `Markdown` `MenuLabel` … | 이름은 역할로 짓고 화면 이름(Script·Knowledge…)을 붙이지 않는다 |
| ⑤ 업무 | `domains/<업무>/` | 업무 뜻이 있는 것: `chat` `graph` `workflow` `script`(대사 목록·번역 편집) `knowledge` `app`(셸·사이드바·상태 표시줄) | ②~④를 조합한다. 패턴과 같은 모양을 새로 만들지 않는다. 이름은 업무 이름으로 시작해도 된다 |

**없는 것**: 한 곳에서만 쓰면서 클래스만 입히는 껍데기. 그런 모양은 속성이 되거나, 화면에서 ②~④로 짠다.

### 2-1. 부품 목록 (확정)

한 모양에 부품 하나다. 화면별 사본(`ScriptSelectTrigger`, `RulesInput`, `KnowledgeSplitPane` …)은 모두 아래 부품의 속성으로 합쳐 없앴다. 한 곳에서 클래스만 입히던 껍데기(`ScriptPage`, `NavigationPane`, `HeaderTabs`, `RowChevron` …)는 화면이 ②~④로 직접 짠다. `src/index.ts`는 층별로 파일 하나에 한 줄이다.

**② 기초 `primitives/` (9 파일)** `Box` `Stack` `Inline` `Grid` `Text` `Heading` `Icon` · `ListItem` `Overlay`(`VirtualItem`, `Bleed`) · `style.ts` `tags.ts`(속성 표)

**③ 조작 `controls/` (34 파일, shadcn 기반)**

| 부품 | 속성 | 합쳐서 없어진 것 |
|---|---|---|
| `Button` | `variant` `size` `tone` `weight` `flush` `align` `reveal` `group` 레이아웃 옵션 | RowRevealButton, RulesAddButton, DisclosureButton |
| `Select` (`SelectTrigger`) | `width` `size` `bare` `fixed` | ScriptSelectTrigger, DetailSelectTrigger, KnowledgeSelectTrigger, FullSelectTrigger, RulesKindSelectTrigger, CompactSelect |
| `Input` · `NumberInput` | `size` `mono` `width` `align` `variant` `onSunken` (간격은 `Box asChild`) | ScriptInput, RulesInput, MonoInput, KnowledgeCodeInput, NumberFieldInput, PromptNameInput |
| `Textarea` | `mono` `variant` `autoSize` `resize` `rows` | KnowledgeTextarea, PromptTextarea, MonoTextarea, RulesSampleTextarea |
| `SearchField` · `MenuSearchField` | `size` `onCanvas` `end` | SearchInput, ScriptSearchField, ConversationSearchField |
| `Combobox` | 옵션 목록 | SearchableSelect |
| `TagInput` | `value` `onChange` `suggestions` `placeholder` (쉼표·Enter로 태그가 되고, 칸을 떠나면 입력한 글이 태그로 남는다) | ChipField, ChipTextInput, ChipSuggestionList, ChipSuggestionItem, ChipInput |
| `Collapsible` (`CollapsibleContent`) | `paddingTop` `paddingBottom` `paddingLeft` `marginTop` (접혀 있어도 빈 숨은 요소로 남는다) | InstructionsBody, KnowledgeFold |
| `Dialog` (`DialogContent`) | `size` (`sm` 32rem · `md` 36rem · `lg` 48rem) `tall` | LargeDialog, ImportDialogContent |
| `PopoverContent` · `DropdownMenuContent` · `DropdownMenuSubContent` · `ContextMenuContent` | `width` `padding` `maxHeight` (메뉴는 `trigger` `fit`도) | StatusPopoverContent, FilterPopoverContent, KnowledgePairPopoverContent, ShortcutPopoverContent, ScriptLineMenuContent, ScriptLineSubmenuContent, ScriptFilterMenuContent, ScriptFilterSubmenuContent, ScriptGroupMenuContent, EditorMenuContent, ProjectMenuContent, SettingsMenuContent, ConversationMenuContent |
| `Spinner` | `size` `tone` `fixed` | AccentSpinner |
| `TextLink` | `tone` `quiet` `underline` `variant` `weight` `block` `asChild` | RulesQuietLink, LinkStyle, PopoverActionLink |
| `SegmentedControl` | `fill` `fixed` | FilterSegmentedBar |
| `Tabs` · `TabsList` | `stretch` · `variant` `fill` | HeaderTabs, HeaderTabsList |
| 그 밖 | `AlertDialog` `Sheet` `Tooltip` (`HelpTip`) `HoverCard` `Command` `Checkbox` `Switch` `RadioGroup` `Toggle` `ToggleGroup` `Collapsible` `ScrollArea` `Separator` `Resizable*` `Kbd` `Label` `InputGroup` `Toaster` | |

**④ 패턴 `patterns/` (38 파일)**

| 부품 | 속성 | 합쳐서 없어진 것 |
|---|---|---|
| `Field` (`Field.Label` `.Description` `.Error` `.Content` `.Group` `.Set`) | `label` `description` `help` `error` `action` `width` · `orientation` | SettingsFieldGroup, InspectorField, FieldNote, NormalLabel, FixedLabel, NodeFieldset, ClearableFieldRow |
| `KeyValue` (`KeyValueRow`) | `align` `framed` | PropertyGrid, FieldRows, ImportSummaryRows, ScriptSpeakerFact |
| `Section` · `SectionHeading` · `Group` | `variant` (`pane` `page`) `title` `description` `actions` `footer` `tone` · `level` `ruled` | InspectorSection, InspectorBlock, SettingsSection, GroupHeading, PopoverSectionTitle, FlushGroupHeading |
| `MenuLabel` | `tone` (`muted` `strong` `quiet`) | MutedMenuLabel, MenuHeadingLabel, ScriptFilterGroupLabel, ConversationMenuHeading |
| `ListRow` | `as` (`li` `link` `button` `menuitem`) `variant` `density` `selected` `active` `flagged` `stacked` | PopoverRowLink, KnowledgeListItem, ScriptListItem, TodoRowLink, RunRowLink, ConversationItem, SearchResultButton, KnowledgeRowButton, ScriptSectionNavLink, ScriptGroupNavLink, NavigationItem |
| `Chip` (`Chip.Dot`) | `as` `variant` `tone` `size` `soft` `faint` `removable` `color` | Badge, CanvasChip(+Label, Note), ChipDot, WayChip, ChipTag, ScriptTermChip, ScriptHintChip, ScriptChipButton, TagPreviewChip, KnowledgeNameBadge, KnowledgeReviewBadge, EditorSuggestionOrigin |
| `Count` | `tone` | CountBadge, RulesCountBadge, ScriptMarkCount |
| `Notice` (`NoticeRow` `NoticeDescription`) | `tone` `variant` (`inline` `banner` `floating`) `placement` `actions` `icon` `title` | NoticeBox, RulesWarningBanner, ErrorNotice, CanvasToast, ServerNotice, Alert |
| `Progress` · `Meter` | `size` `tone` `grow` `indeterminate` · `size` `width` | JobProgressBar, RunProgressBar · StatusMeter, ScriptStatusMeter, StatusBar |
| `Skeleton` | `shape` (`line` `row` `card` `page`) `count` `height` `width` | RowSkeleton, ProjectCardSkeleton, ScriptRowSkeleton, SettingsPageSkeleton, KnowledgeLoadingBlock |
| `EmptyState` (`Empty*`) | `size` (`inline` `pane` `page`) `variant` `overlay` | OutlinedEmpty, FullPageEmpty, ScriptEmptyState, Empty |
| `SplitPane` | `fill` `minSize` | KnowledgeSplitPane, FullHeightSplitPane, ScriptLineSplit |
| `Swatch` · `SwatchPicker` | `color` | SwatchButton, SwatchDot, PickerSwatch, PickerSwatchInput |
| `DataTable` | `compact` `rowState` 열 `tone` `variant` `weight` `tabular` `mono` `dense` | CompactDataTable, TablePanel, CellInline, 열의 className |
| `StatusIcon` · `TagChip` · `AiMark` | `small` | SmallStatusIcon |
| 그 밖 | `Toolbar`류 `FilterBar` `Pager` `FilterChips` · `ActionBar` · `SelectionBar` (`grow`) · `Inspector` `InspectorHeader` `InspectorTabs` `InspectorList` `InspectorResult` `InspectorActionRow` `InspectorToggle` `DirtyBar` · `Disclosure` · `PaneHeader` · `Page` `PageBody` `PageHeader` `HeaderActions` `HeaderViews` `PageHeading` · `RightDock` 부품(`DockProvider` `DockInspector` `DockHeader` `DockHeaderSlot` `WorkspaceShell`) · `Card` · `Markdown` · `TagMenu` `TagListEditor` · `HistoryList` `HistoryItem`(접힌 이력 한 줄, 열면 전문·바뀐 곳, 되돌리기는 hover·열림 때 날짜 자리에) · `FilePickButton`(파일 선택 창을 여는 버튼) · `PermissionMatrix` · `ViewSwitch` · `FilterHeaderButton` `FilterCheck` | |

**⑤ 업무 `domains/` (55 파일)** 업무 뜻이 있거나 클래스를 ②로 말할 수 없는 부품만 남는다. 모두 ②~④로 짜고 `className`을 받지 않는다.

| 업무 | 남은 부품 (화면 수) |
|---|---|
| `app` | 셸 `Sidebar*` · `DockPane` · `StatusBarButton` · `AppStatusBar` · `StatusBarItem` · `ShortcutSection` · 프로젝트 `ProjectListFrame` `ProjectCard` `ProjectCardLink` `BrandMark` `FileDropZone` `StatusChipLink` `TodoIcon` `StepMarker` · 규칙 `RulesPresetCard` `RulesPresetExample` · `SaveStatusLine` |
| `chat` | `UserMessage` `AssistantMessage` `SteerBubble` `SentImage` `ImageChip` `AttachmentChip` `MessageActionBar` · `ToolCard` `ToolCardHeader` `ToolCallRow` `SourceExcerpt` `ToolErrorCard` `CompactionNotice` · `ComposerInput` `ComposerMenu` `ComposerRow` `ComposerGroup` `ModeSelect` `ContextMeterView` `MenuRowAction` `MenuRowMeta` |
| `graph` | 캔버스 `CanvasSurface`(`grow` `fill`) `CanvasOverlay` `CanvasFloat` `CanvasToolbar` `CanvasDirectionControl` `FloatingZoomBar` `GraphMinimap` `SelectionToolbox` `SelectionRect` `GraphCanvasElement` `FoundNodeList` · 노드 `NodeCard` `NodeKindIcon` `NodeLibrary` `FoldChip` `FlowHandle` `FlowRow` `ColumnResizeHandle` `FloatingCard` · 경로 `PathNodeCard` `PathNodeButton` `ForkNodeFrame` `ForkOptionItem` `PathEdgeLabel` `SeamStateChip` `ArmChip` · 관계 `PersonNodeFrame` `RelationLabelFrame` |
| `knowledge` | `EventFlowCard` |
| `script` | `ScriptTranslationRow` `ScriptReadingRow` `SceneSectionHeader` `TranslationColumnHeader` `SpeakerIdentity` `CandidateCard` `ScriptWorkspace` `GraphScriptSplit` `GraphEndpointBar` · 편집기 `Editor*`(입력 상자, 토큰·용어 표시, 비교 낱말, 제안 목록, 도구 줄, `EditorAiSuggestion` AI 제안 적용·거절) · `Script*`(장면 줄, 검토 이슈, 메모, 원문 모양) · `DetailIssue` |
| `workflow` | `SelectField` `FieldReadRow` `FieldChildren` `TagToggle` `RequestDetails` `RequestPart` · `ScopeRow` `ReadinessDot` `RunStatusBadge` · `EdgeLabelRow` `EdgeLabelPill` |

### 속성 이름 규칙
- 값은 역할 이름: `tone="danger"`, `width="field"`, `variant="caption"`. `color="red"`, `width={192}`는 쓰지 않는다.
- 같은 뜻은 같은 이름: `tone`(색 의미), `variant`(모양 종류), `size`(크기 단계), `width`(너비), `mono`(고정폭).
- `className`은 부품 안에서만. 부품은 `className`을 밖으로 받지 않는다(받으면 화면이 클래스를 쓰는 길이 열린다).

## 3. 검사 (`pnpm ui-rules`)
- `apps/web`: `className=` 금지, 날 `<button>` 금지, 임의 글자 크기 금지.
- 원시 색 단계(`slate-3`, `night-3`, `var(--cobalt-530)` …)는 `tokens/` 밖에서 쓰지 않는다. (`hue-n` `token-n`은 데이터 색이라 예외)
- 쓰는 색 클래스(`bg-*` `text-*` `border-*` `ring-*` `outline-*` `divide-*` `fill-*` `stroke-*` `decoration-*`)는 모두 `theme.css`에 정의된 이름이어야 한다(오타나 `text-info`처럼 정의 없는 이름이 조용히 아무것도 칠하지 않는 일을 막는다). 색 코드 리터럴 금지.
- `patterns/` `controls/` `primitives/`의 부품 이름과 파일에 업무 이름(Script, Knowledge, Workflow, Graph, Chat, Rules …)이 없다.
- 의존 방향: `primitives`는 `controls`·`patterns`·`domains`를, `controls`는 `patterns`·`domains`를, `patterns`는 `domains`를 가져오지 않는다.
- `packages/ui` 부품의 공개 속성에 `className`이 없다. 예외는 `scripts/ui-tiers.ts`의 목록(Radix·shadcn 슬롯을 그대로 넘기는 조작 부품, 부모 `Box asChild`가 클래스를 넘기는 `Count`·`Collapsible`, 레이아웃 기초)이고 이유가 파일마다 적혀 있다.
- 검사는 `scripts/ui-rules.ts`(화면·토큰)와 `scripts/ui-tiers.ts`(층·이름·className)다.

## 4. Storybook
순서: Foundations(토큰) → Primitives → Controls → Patterns → Domains.
조작·패턴은 모든 상태(기본·hover 대신 선택·비활성·오류·빈 값·긴 글)를, 업무 부품은 주요 상태를 둔다. 밝은/어두운 테마를 툴바에서 바꾼다.

## 5. 검증
바꿀 때마다 화면 34개 상태와 채팅 상태의 모든 요소의 계산된 스타일·위치를 밝은·어두운 테마에서 바꾸기 전과 비교한다. 기준: 바뀐 요소 0개. 일부러 바꾸는 경우(단계 합치기 등)는 따로 승인받는다.
