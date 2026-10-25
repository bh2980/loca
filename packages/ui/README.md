# @loca/ui

Workbench의 화면 부품과 토큰. 화면은 여기 있는 부품만으로 만듭니다.

## 레이아웃·글자 부품

`Box`, `Stack`, `Inline`, `Grid`, `Text`, `Heading`, `Icon`은 토큰 이름을 prop으로 받습니다. 값은 모두 `src/primitives/style.ts`에 있고, 부품은 그 이름에 해당하는 Tailwind 클래스만 냅니다. 이름을 주지 않으면 클래스를 더하지 않습니다(`<Text tone="muted">`는 색만 바꿉니다).

- `Box`: 패딩·마진·배경·테두리·반경·크기·넘침 같은 레이아웃 옵션만 있는 상자. `as`로 태그를 고르고 `asChild`로 자식(링크 등)에 옵션만 입힙니다.
- `Stack`(세로) / `Inline`(가로, 가로축 가운데 정렬): `gap`, `gapX`, `gapY`, `align`, `justify`, `wrap`, `direction`. 자식이 flex 항목이 아닌 블록이면 `Box`의 `spaceY`.
- `Grid`: `columns`(1~4, 또는 `field` = 5rem 라벨 + 값), `gap`, `align`, `responsive`.
- `Text` / `Heading`: `variant`, `tone`, `weight`, `mono`, `tabular`, `truncate`, `lines`, `preserveLines`, `breakWords`, `nowrap`, `align`, `underline`. 레이아웃 옵션도 받습니다. `Heading`의 variant는 `page`, `page-section`, `section`, `group`.
- `Icon`: lucide 아이콘에 `size`(xs 12px / sm 14px), `tone`, `turn`(펼침 화살표)을 이름으로 줍니다. 래퍼 없이 svg 하나를 그립니다.
- `Button`도 레이아웃 옵션(`marginLeft`, `grow`, `minWidth`…)과 `tone`, `weight`를 받습니다.

### 간격 이름

| 이름 | px | Tailwind |
| --- | --- | --- |
| none | 0 | 0 |
| hair | 2 | 0.5 |
| tight | 4 | 1 |
| condensed | 8 | 2 |
| normal | 12 | 3 |
| comfortable | 16 | 4 |
| spacious | 24 | 6 |
| wide | 32 | 8 |
| section | 48 | 12 |

`padding*`, `margin*`(+`auto`), `gap*`, `spaceY`가 이 이름을 씁니다. 6px은 아이콘과 글자 사이·칩 안쪽이면 `tight`, 그 밖은 `condensed`; 10px은 촘촘한 줄·조작부 안쪽이면 `condensed`, 묶음 사이면 `normal`; 20px은 창 안이면 `comfortable`, 구역 사이면 `spacious`. 부품 안쪽의 Tailwind 간격도 0.5 1 2 3 4 6 8 12만 씁니다.

### 크기 이름

너비·높이는 숫자나 길이 대신 쓰임새 이름만 받습니다. 값은 `tokens/system.css` 한 곳(`--width-*` `--max-width-*` `--height-*` `--max-height-*` `--min-height-*`)에 있고, `pnpm ui-rules`가 `style.ts`에 `w-28`·`w-[200px]` 같은 값이 들어오거나 정의 없는 이름을 쓰는 것을 막습니다. 비율(`1/2` `2/3` `3/4`)과 `full` `auto`는 부모에 대한 몫이라 그대로 씁니다.

| 옵션 | 이름 (값) |
| --- | --- |
| `width` | `icon` (1rem) · 입력칸·이름 열 `field-xs` (4rem) `field-sm` (6) `field` (8) `field-lg` (12) · 메뉴 `menu` (14rem) `menu-lg` (16) · 떠 있는 면·글 카드 `popover` (20rem) `popover-lg` (24) · `rail` (12rem, 옆 목록) |
| `maxWidth` | `full` · `reading` (56rem, 글 열) · `label` (12rem, 줄여 보이는 이름) |
| `height` | `full` `auto` · `bar` (3rem, 창 머리) · `icon` (1rem) · `track` (0.375rem, 진행 막대) · `control-xs` (1.5rem) `control-sm` (1.75) `control` (2) · 불러오는 자리 `placeholder-sm` (4rem) `placeholder-md` (8) `placeholder-lg` (12) `placeholder-page` (24) |
| `maxHeight` | 스크롤 영역 `scroll-sm` (12rem) `scroll` (16) `scroll-lg` (24) · `pane` (부모의 50%) · `dialog` (화면의 70vh) |
| `minHeight` | `0` · `control-sm` (1.75rem) · 글상자 `textarea-sm` (5rem) `textarea` (8) `textarea-lg` (14) |
| `minWidth` | `0` · `field-xs` (4rem) |

### 글자 크기와 색

| variant | 클래스 | 크기 |
| --- | --- | --- |
| micro | text-2xs | 12px |
| caption | text-xs | 12.5px |
| body | text-sm | 13.5px |
| label | text-sm font-medium | 13.5px |
| reading | text-base | 15px |
| title | text-lg | 17px |
| heading | text-xl | 19px |

`tone`: `default`(text-default), `muted`, `subtle`, `accent`, `danger`, `warning`, `success`, `choice`, `inherit`. 색은 `tokens/theme.css`의 역할뿐입니다.

### `style.ts` 옵션 전체

간격·크기: `padding` `paddingX` `paddingY` `paddingTop` `paddingBottom` `paddingLeft` `paddingRight` · `marginTop` `marginBottom` `marginLeft` `marginRight` · `spaceY` · `width` `maxWidth` `minWidth` `height` `maxHeight` `minHeight` (Stack·Inline·Grid는 `gap` `gapX` `gapY`).
면: `background` `border` `borderColor` `divide` `radius` `shadow` `ring`.
배치: `grow` `shrink` `overflow` `position`(`relative`) `display`(`block` `flex`) `alignSelf` `justifyContent` `fieldSizing` `resize` `cursor` `opacity` `userSelect`.
글자: `variant` `tone` `weight` `mono` `tabular` `truncate` `lines` `leading` `lineThrough` `underline`(`true` `offset` `hover`) `preserveLines` `breakWords`(`true` `all`) `nowrap` `textAlign` `srOnly`.

한 부품이나 한 라이브러리만 쓰는 옵션은 여기 없고 그 부품의 prop입니다: React Flow 연결점의 모양은 `FlowHandle look`, 위에 덮는 자리는 `Overlay` · `CanvasFloat` · `VirtualItem`, 부모 안쪽 여백을 넘는 상자는 `Bleed by`, 목록 첫·마지막 줄의 여백 제거와 줄 호버 묶음은 `ListItem trim` · `group`, 버튼의 정렬·호버 표시·접힘 화살표 묶음은 `Button flush` · `align` · `reveal` · `group`, 대화창 너비·높이는 `DialogContent size` · `tall`, 경고 안 줄은 `AlertRow`.

## 색 토큰

세 단입니다. 원시(`tokens/palette.css`: 회색은 `slate-1..12` · `night-1..12`, 강조·의미는 `cobalt-530` …) → 역할(`tokens/theme.css`: 칠하는 속성마다 `bg-page`, `text-muted`, `border-default`, `ring-focus` …) → 부품 전용(`bg-sidebar`, `stroke-graph-edge`, `bg-node-header-ai` …). 부품과 화면은 역할만 쓰고 원시 단계 이름은 `tokens/` 밖에 쓰지 않습니다. Tailwind의 기본 색은 꺼져 있어(`bg-red-500`, `text-white`는 CSS가 생기지 않습니다) 클래스의 색은 모두 theme.css에 정의된 이름이어야 하며 `pnpm ui-rules`가 확인합니다. 이름 목록과 옛 이름 대응은 `docs/DESIGN-SYSTEM.md` 1-1입니다. `Box`의 `background`(`page` `sunken` `panel` `sidebar` `surface` `overlay` …), `borderColor`(`default` `subtle` `accent`), `ring`(`line` `focus`)도 같은 역할 이름입니다.

## 폴더

`src/tokens`(css) < `primitives`(Box Stack Inline Grid Text Heading Icon, ListItem Overlay) < `controls`(shadcn 기반 조작) < `patterns`(여러 화면이 같은 모양으로 쓰는 것) < `domains/{app,chat,graph,knowledge,script,workflow}`. 의존은 아래로만이고 `pnpm ui-rules`(`scripts/ui-tiers.ts`)가 가져오기 방향, 기초·조작·패턴 이름의 업무 단어, 공개 속성의 `className`을 막습니다. 부품 목록과 속성은 `docs/DESIGN-SYSTEM.md` 2-1입니다. 같은 역할의 사본을 새로 만들지 말고 속성을 더합니다.

## 규칙

화면에는 className을 쓰지 않는다; 표현할 수 없으면 @loca/ui에 부품을 만든다.

- 화면(`apps/web`)은 위 부품과 `controls/` `patterns/` `domains/<업무>/`의 부품으로 짭니다. 데이터·상태·동작은 화면에, 마크업은 부품에 둡니다.
- `className`은 부품 안(`packages/ui`)에서만 씁니다. `pnpm ui-rules`가 `apps/web` 전체에서 `className`을 막습니다.
- 새 옵션이 필요하면 `style.ts`의 표에 이름과 클래스를 한 줄 더합니다. 클래스는 Tailwind가 찾을 수 있게 통째로 적고, 크기는 `tokens/system.css`에 새 이름을 먼저 둡니다. 한 화면·한 라이브러리에만 필요한 옵션은 표에 넣지 않고 그 부품의 prop으로 둡니다.

## Storybook

```sh
pnpm storybook         # http://localhost:6006
pnpm build-storybook   # packages/ui/storybook-static
```

제목은 층을 따릅니다: Foundations(토큰) → Primitives → Controls → Patterns → Domains/<업무>. 조작·패턴은 모든 상태(기본·선택·비활성·오류·빈 값·긴 글, 톤·크기·너비)를, 업무 부품은 주요 상태를 보여 줍니다. 툴바에서 밝은/어두운 테마를 바꿉니다(앱처럼 `html`의 `.dark` 클래스).
