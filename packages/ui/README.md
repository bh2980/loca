# @loca/ui

Workbench의 화면 부품과 토큰. 화면은 여기 있는 부품만으로 만듭니다.

## 레이아웃·글자 부품

`Box`, `Stack`, `Inline`, `Grid`, `Text`, `Heading`, `Icon`은 토큰 이름을 prop으로 받습니다. 값은 모두 `src/layout/style.ts`에 있고, 부품은 그 이름에 해당하는 Tailwind 클래스만 냅니다. 이름을 주지 않으면 클래스를 더하지 않습니다(`<Text tone="muted">`는 색만 바꿉니다).

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
| snug | 6 | 1.5 |
| condensed | 8 | 2 |
| cozy | 10 | 2.5 |
| normal | 12 | 3 |
| comfortable | 16 | 4 |
| roomy | 20 | 5 |
| spacious | 24 | 6 |
| wide | 32 | 8 |
| section | 48 | 12 |

`padding*`, `margin*`(+`auto`), `gap*`, `spaceY`가 이 이름을 씁니다.

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

`tone`: `default`(text-foreground), `muted`, `subtle`, `primary`, `danger`(text-destructive), `warning`, `success`, `inherit`. 색은 `theme.css`의 의미 토큰뿐입니다.

## 규칙

화면에는 className을 쓰지 않는다; 표현할 수 없으면 @loca/ui에 부품을 만든다.

- 화면(`apps/web`)은 위 부품과 `packages/ui/src/chat` 같은 표현 부품으로 짭니다. 데이터·상태·동작은 화면에, 마크업은 부품에 둡니다.
- `className`은 부품 안(`packages/ui`)에서만 씁니다. `pnpm ui-rules`가 `apps/web` 전체에서 `className`을 막습니다.
- 새 옵션이 필요하면 `style.ts`의 표에 이름과 클래스를 한 줄 더합니다. 클래스는 Tailwind가 찾을 수 있게 통째로 적습니다.

## Storybook

```sh
pnpm storybook         # http://localhost:6006
pnpm build-storybook   # packages/ui/storybook-static
```

이름은 Foundations(간격·글자·색), Layout(Box·Stack·Grid·Text), Chat(대화 부품) 순으로 정렬됩니다. 툴바에서 밝은/어두운 테마를 바꿉니다(앱처럼 `html`의 `.dark` 클래스).
