# 공통 화면 부품

이 문서는 현재 `@loca/ui`가 export하고 실제 화면이 사용하는 공통 부품을 기록한다. 새 화면은 같은 표현을 다시 만들지 말고 이 목록을 먼저 확인한다.

## 등록 순서

공통 부품을 먼저 `packages/ui/src/`에 구현하고 `packages/ui/src/index.ts`에서 export한다. 그 다음 앱 화면에서 `@loca/ui`로 import해 사용한다. 같은 역할을 화면 안에 복사하거나 `className`으로 공통 부품을 우회하지 않는다. 새 API와 사용 화면을 이 문서에도 반영한다.

색·면·테두리·상태 표현은 `packages/ui/src/tokens/theme.css`의 semantic token을 사용한다. A Slate와 C Night는 같은 역할 토큰의 테마 값으로 표현한다. 앱에서 hex나 Tailwind 팔레트 색을 직접 고르지 않는다.

## 현재 부품과 사용 화면

| 부품 | API와 책임 | 사용하는 화면 |
|---|---|---|
| `PageHeader`, `PageHeading` | `PageHeader({ title, leading?, tools? })`가 한 줄 페이지 머리와 제목/도구 슬롯을 제공한다. `PageHeading`은 제목 위치에 추가 콘텐츠를 보낸다. | 프로젝트 홈: `apps/web/src/routes/p.$projectId.tsx` |
| `DockProvider`, `DockContent`, `DockLevel`, `DockInspector`, `DockHeader`, `WorkspaceShell` | 라우트 문맥을 보존한 채 inspector를 단일 오른쪽 도크에 portal로 표시한다. `DockLevel`은 가장 구체적인 inspector를 선택하고 `WorkspaceShell`은 접고 펼치는 패널을 유지한다. | 프로젝트 셸: `apps/web/src/routes/p.$projectId.tsx` |
| `usePanelWidth` | `usePanelWidth(key, fallback)`는 폭을 픽셀 단위로 `sessionStorage`에 저장하고 `{ defaultSize, onResize, groupResizeBehavior: 'preserve-pixel-size' }`를 돌려준다. 뷰포트가 바뀌어도 도크 폭을 픽셀 기준으로 보존한다. | 오른쪽 도크와 대사 장면 목록 |
| `NavigationPane`, `NavigationItem` | `NavigationPane({ search?, children, footer? })`는 고정 검색·스크롤 목록·아래쪽 보기 영역을 제공한다. `NavigationItem`은 현재 항목을 표현하며 `asChild`로 링크를 감쌀 수 있다. | 대사 장면 탐색: `apps/web/src/components/script/group-list.tsx` |
| `SpeakerIdentity` | `SpeakerIdentity({ speaker, listener? })`는 이름의 이니셜, 안정적인 화자 색, 선택적인 청자 표기를 보여준다. A에서는 중립 표기, C에서는 화자별 semantic hue를 쓴다. | 대사 행: `apps/web/src/components/script/line-row.tsx` |
| `TranslationRow` | `checkbox`, `speaker`, `status`, `source`, `translation`, `meta`, `actions` 슬롯을 정렬한다. `layout`은 `grid`·`focus`·`review`, `compact`는 UI 문자열 밀도, `selected`는 활성 편집 행을 나타낸다. | 대사 행: `apps/web/src/components/script/line-row.tsx` |
| `SceneSectionHeader` | `title`, 실제 데이터가 있을 때만 `count`, 선택적인 `trailing` 동작을 갖는 장면 머리다. | 대사 목록의 장면 구분: `apps/web/src/components/script/line-row.tsx` |
| `TranslationColumnHeader` | `TranslationRow`와 같은 체크박스 여백과 두 열을 사용한다. 일반 모드에서는 원문/번역 라벨을, 선택 모드에서는 전체 너비 `selection` 슬롯을 보여준다. | 대사 열 머리와 선택 동작: `apps/web/src/components/script/line-bulk.tsx` |
| `EditorToolbarProvider`, `EditorToolbarSlot`, `EditorToolbar` | provider가 도구 슬롯의 portal 대상을 만든다. `EditorToolbarSlot`은 페이지 머리에서 공간을 예약하고, `EditorToolbar({ children })`는 그 슬롯에 필터나 도구를 보낸다. provider 밖에서는 자식이 현재 위치에 표시된다. | 대사 페이지 도구 배치: `apps/web/src/routes/p.$projectId.script.tsx`, `apps/web/src/components/script/line-list.tsx` |
| `InlineEditorActions` | `primary`, `ai`, `overflow` 슬롯을 한 줄에 배치한다. 각 동작의 버튼과 동작은 편집 화면이 제공한다. | 번역 편집기: `apps/web/src/components/translation-editor.tsx` |
| `CandidateCard` | `text`, 선택적 `meta`와 `action`, `current`를 받는다. 후보 문구와 출처·적용 동작을 담고 현재 후보만 semantic primary 테두리로 구분한다. | 번역 후보: `apps/web/src/components/line-detail.tsx` |
| `ContextLine` | `speaker`, `source`, 선택적 `translation`, `current` 슬롯을 받는다. 화자 72px 열과 최대 두 줄의 문맥 텍스트를 정렬한다. | 인접 대사 문맥: `apps/web/src/components/line-detail.tsx` |
| `SegmentedControl` | `value`, `onChange`, `{ value, label }[]` 항목으로 공통 ToggleGroup의 방향키 포커스와 단일 라디오 선택을 제공한다. 선택 면은 두 테마의 semantic surface를 사용한다. | 대사 보기 전환: `apps/web/src/routes/p.$projectId.script.tsx` |
| `NodeCard` | 종류, 제목, 요약, 포트, 오류·경고, 실행 상태를 슬롯과 데이터로 표현한다. 연결선과 배치는 그래프 엔진에 남긴다. | 워크플로 노드 렌더러: `apps/web/src/components/workflow/node-view.tsx` |
| `NodeLibrary` | 검색 가능한 노드 종류 목록을 제공하고 선택 또는 드래그를 전달한다. | 워크플로 편집기: `apps/web/src/routes/p.$projectId.workflows.$workflowId.tsx` |
| `CanvasLegend` | AI·검사·흐름·상태의 캔버스 범례를 공통 의미 색으로 표시한다. | 워크플로 편집기 캔버스 |
| `CanvasToolbar` | 확대·축소·맞춤·정렬·미니맵 조작을 콜백으로 제공한다. | 워크플로 편집기 캔버스: `apps/web/src/routes/p.$projectId.workflows.$workflowId.tsx` |
| `SelectionToolbox` | 현재 캔버스 선택에 대한 액션 목록을 표시한다. 각 액션은 화면이 제공한다. | 워크플로 노드/연결 선택: `apps/web/src/routes/p.$projectId.workflows.$workflowId.tsx` |

## 경계

공통 부품은 배치와 표현을 맡고, 데이터 조회·URL·저장·라우팅은 화면이 맡는다. 각 슬롯의 내용이나 숫자는 실제 데이터에서 전달한다. 그래프 연결선·레이아웃 계산은 React Flow, Canvas, ELK에 남기며 이 부품 목록에 자체 그래프 엔진을 추가하지 않는다.

현재 표는 export와 호출부를 기준으로 작성했다. A/C 전체 화면의 시각 비교, 다른 뷰포트, 키보드, Back/Forward 검증 완료를 뜻하지 않는다.
