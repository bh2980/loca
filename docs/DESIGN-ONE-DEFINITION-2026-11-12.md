# 정의는 한 곳에: 필터·도구·AI 요청·변경 알림 설계 — 2026-11-12

구현했다(§7). §1은 고치기 전 origin/main `908bb98`의 모습이라, 거기 나오는 이름 가운데 지금은 없는 것이 많다. §3의 코드 조각은 설계할 때의 스케치이고 실제 이름은 §7에 적었다. §6은 모두 권장대로 정했다.

## 1. 문제

같은 개념을 표면(브라우저 라우트, 채팅 도구, CLI, 실행기, 미리보기)마다 다시 적는다. 적힌 곳끼리는 관례로만 맞춰지고, 어긋나면 조용히 틀린다. 지금 어긋나 있는 곳:

| 개념 | 적힌 곳 | 어긋난 결과 |
|---|---|---|
| 대사 필터 → SQL | `routes/source.ts` `unitConditions`, `services/script-query.ts` `findLines`, `engine/run-create.ts` `scopeConditions`, CLI의 이름→id 해석 | `loca runs start --tag 오타`가 전체 대사를 잡는다. 목록과 내보내기가 화자를 다르게 고른다. 실행의 `q`만 원문 `LIKE`다 |
| 도구의 분류·권한·크기 | `agent-tools.ts`, `shared/agent.ts`, `shared/agent-permissions.ts`, `change-gate.ts` `itemCount` | 자동 모드에서 `delete_lines`와 5,000줄 `set_listeners`가 묻지 않고 적용된다 |
| AI 노드가 보내는 요청 | `runner.ts`, `preflight.ts`, `context-preview.ts`, `request-preview.ts`, `editor-assist.ts` | 문맥 미리보기의 배치가 실행의 배치와 다르다 |
| 무엇이 바뀌었나 | DB 트리거(행) + 쓰기 지점의 `events.changed` 100여 곳(토픽) | 토픽을 빠뜨리면 행은 맞고 질문 쿼리는 낡는다. 잡아 주는 장치가 없다 |
| 오류 종류 | `@loca/ai`의 `ModelError.code`, 서버의 메시지 정규식 | CLI 연결의 길이 초과가 `cut-off`가 아니라 `invalid-output`이 된다 |

## 2. 원칙

1. **한 개념은 한 곳에서 정의하고, 나머지는 거기서 파생한다.** 표면은 입력을 그 정의의 모양으로 바꾸는 일만 한다.
2. **파생할 수 없으면 테스트가 대조한다.** "맞춰서 적는다"는 규칙으로 남기지 않는다. 지금 `skills.test.ts`와 `architecture.test.ts`가 하는 방식이다.
3. **미리보기는 실행의 코드를 부른다.** 미리보기가 보여 줄 수 없는 것은 비슷하게 만들지 않고 못 보여 준다고 적는다(라벨은 실제 범위를 말한다).
4. 옛 모양은 마이그레이션으로 옮기고 읽는 쪽 호환 코드는 두지 않는다(AGENTS.md).

## 3. 결정

### 3.1 대사 필터는 `LineFilter` 하나

`@loca/shared`의 `lineFilterSchema`가 이미 가장 넓다. 이것을 유일한 필터 모양으로 삼고, SQL로 가는 길을 하나로 만든다.

```
LineFilter                    이름·id가 섞인, 사람·CLI·URL이 쓰는 모양 (@loca/shared)
  └ resolveLineFilter(db, projectId, filter) → { filter: ResolvedLineFilter, unknown: string[] }
      └ lineConditions(projectId, resolved) → SQL[]        domain/line-filter.ts
```

- `resolveLineFilter`가 이름을 id로 바꾸는 유일한 곳이다(상태·태그·장면·화자 별칭·보기). 못 찾은 이름은 `unknown`으로 돌려주고, **모든 표면이 오류로 답한다.** 빈 목록을 "조건 없음"으로 읽는 일이 생기지 않도록 `ResolvedLineFilter`의 목록 필드는 비어 있을 수 없다(없거나, 하나 이상).
- `findLines`, 목록의 `/units/ids`·`/units/matches`, 실행 범위(`selectRunUnits`), 결과 내보내기, 보기가 모두 `lineConditions`를 쓴다. `unitConditions`와 `scopeConditions`는 없앤다.
- 브라우저는 필터를 `LineFilter` JSON으로 보낸다. `listQuery`(쉼표·JSON 문자열)와 웹의 직렬화 둘(`lineQueryParams`, `lineFilterOf`)이 하나가 된다. 검토함(`review`)을 `LineFilter`에 넣는다.
- 실행 범위는 `{ filter: ResolvedLineFilter, termIds? }`로 저장한다. `runScopeSchema`와 `db/schema.ts`의 손으로 쓴 `RunScope`를 대체하고, 기존 `runs.scope`는 마이그레이션으로 옮긴다. 그러면 "목록에 보이는 것"과 "실행·내보내기 대상"이 같은 필터가 되고, CLI의 `withFilters` 플래그가 `runs plan/start`에도 그대로 붙는다.
- `start_run`은 `plan_run`과 같은 입력(이름)을 받는다. CLI가 태그·키를 직접 id로 바꾸는 코드(`main.ts` `runs start`)를 지운다.
- 통일하면서 정해지는 의미: `q`는 어디서나 `lineTextFilter`(FTS, 원문·번역·화자·키). 화자는 §6-2.

지켜 주는 장치: `cli-parity.test.ts`를 필터 필드 전부로 넓힌다(필드마다 목록·`findLines`·실행 범위가 같은 줄을 고르는지). `lineFilterSchema`에 필드를 더하면 이 테스트의 표에 없어서 실패한다.

### 3.2 도구는 `ToolSpec` 하나에서 파생

분류·권한·크기를 도구 이름 옆 한 줄에 둔다. `shared/agent.ts`의 `AGENT_TOOLS`와 `agent-permissions.ts`의 `fixed`·이름별 분기를 대체한다(웹이 라벨과 권한표를 읽으므로 `@loca/shared`에 둔다).

```ts
export const TOOL_SPECS = {
  find_lines:     { label: '대사 찾기',     needs: read('script') },
  delete_lines:   { label: '대사 지우기',   needs: [p('script', 'delete')], batch: ['keys'] },
  set_listeners:  { label: '청자 저장',     needs: [p('script', 'update')], batch: ['lines'] },
  save_knowledge: { label: '자료 일괄 저장', needs: (input) => …, options: […], batch: KNOWLEDGE_KEYS },
  start_run:      { label: '워크플로 실행', needs: [p('workflows', 'run')] },
} satisfies Record<string, ToolSpec>;
```

- **위험 분류는 적지 않고 권한에서 계산한다**: 필요한 권한에 `delete`가 있으면 삭제, `run`이 있으면 실행, 전부 `read`면 읽기, 아니면 변경. `delete_lines`가 한쪽에선 `change`, 다른 쪽에선 `delete`인 일이 구조상 없어진다. `target`은 쓰는 곳이 없어 지운다.
- 게이트 여부(`needsApproval`)도 분류에서 나온다(읽기가 아니면 게이트). 게이트를 거치지 않는 예외(AGENTS.md가 적은 것)는 spec에 표시한다.
- `itemCount`는 `batch`가 가리키는 필드 길이의 합이다.
- 서버 카탈로그(`agent-tools.ts`)는 `Record<keyof typeof TOOL_SPECS, …>`로 타입을 건다. 한쪽에만 있는 도구는 컴파일되지 않는다.
- 겹치는 도구는 하나로 줄인다: `delete_units`/`delete_lines`, `save_group_summary`/`update_group`, 줄 생성 둘(§3.6과 같이).
- 제안 검사·되돌리기의 도구별 분기(`proposal-check.ts`, `proposal-undo.ts`)는 서버의 도구 정의 옆으로 옮긴다(`check`, `undo` 멤버). 2단계로 해도 된다.

지켜 주는 장치: 변경 도구의 Zod 입력을 훑어 최상위 배열 필드가 `batch`에 빠져 있으면 실패하는 테스트. `skills.test.ts`는 `AGENT_TOOLS` 대신 실제 카탈로그와 대조하고, skill 문서의 JSON 예시를 도구 스키마로 파싱한다.

### 3.3 AI 요청은 실행기의 코드로만 만든다

```ts
// engine/request.ts: 한 노드가 이 대상들로 보내는 요청 하나
buildRequest(db, projectId, node /* 예산 확정 */, subjects) → { system, prompt, schema, context, lineIds }

// engine/run-create.ts: 이 줄이 실행에서 속할 배치 (planRun의 계획 + 그 노드의 packGroups)
batchOf(db, definition, node, unitId) → unitId[]
```

- `runner.callLines`, `preflight`의 `requestPrompt`·표본 추정, `previewContext`, `previewRequest`, `editor-assist`가 `buildRequest`를 부른다. `PromptLine`을 손으로 만드는 곳(지금 다섯)은 `buildRequest` 안 하나가 된다. 전체 대본 모드, 용어 대상, 선택지, 앞 노드 결과(`input.previous`)의 갈래도 그 안에만 있다.
- 미리보기의 배치는 `batchOf`로 고른다. 실행과 같은 대상(번역 제외 빼고), 같은 첫 AI 노드 설정, 같은 `sceneLinks`.
- 미리보기가 만들 수 없는 것(앞 노드 결과를 읽는 병합 노드)은 줄만으로 흉내 내지 않고 "앞 노드 결과가 있어야 해서 실행 기록에서만 볼 수 있음"으로 답한다.
- 용어 대상의 `termPrompt`에 가짜 run item을 `as never`로 넘기는 일을 없앤다(`subjects`가 줄/용어를 구분해 받는다).
- 토큰 추정 SQL(`(length(cast(source as blob)) + 3) / 4`, 다섯 번 복사)을 한 헬퍼로 둔다.

지켜 주는 장치: 같은 프로젝트·노드·줄에 대해 미리보기의 `prompt`와 mock 모델이 실행에서 받은 `prompt`가 글자 그대로 같은지 보는 테스트(노드 종류별: 줄 단위, 묶음, 전체 대본, 용어).

### 3.4 변경 알림: 토픽도 DB가 말한다 (§6-1)

지금 트리거는 행(컬렉션)만 적고 토픽은 쓰기 지점이 적는다. 스키마의 거의 모든 테이블에 이미 피드 트리거가 있으므로, 토픽도 같은 곳에서 나오게 한다.

- `Topic`과 `IMPLIES`를 `@loca/shared`(`sync.ts`)로 옮긴다. 서버·웹·CLI가 같은 타입을 쓴다.
- 테이블 → 토픽 표를 코드에 하나 둔다(`TABLE_TOPICS`). 이 표에서 `AFTER INSERT/UPDATE/DELETE` 트리거를 만들어 `topic_changed(topic, project_id)`를 부른다(마이그레이션 하나로 생성). 행 트리거(`row_changed`)는 그대로 둔다. 컬럼 목록과 파생 규칙이 거기에 있다.
- `Events`는 `topic_changed`를 받아 지금의 `changed()`와 똑같이 처리한다(`IMPLIES`, 요청의 `x-changed`, 묶어 보내기).
- 손으로 부르는 `events.changed`는 **DB에 없는 변화**만 남긴다: 레이아웃 진행, 채팅 스트림 상태 같은 것. 남는 호출부는 목록으로 고정한다.
- 쓰기 지점의 토픽 나열(`'graph', 'units'` 일곱 번, `APPLY_TOPICS`, `FUNCTION_TOPICS`)은 지운다.

`IMPLIES`는 남는다("이 질문은 다른 토픽의 테이블도 읽는다"는 쿼리 쪽 사실이라 트리거가 알 수 없다). 다만 주석과 실제가 어긋난 줄을 고치고, 웹의 `ALSO`(`live.ts`)를 여기로 합친다.

지켜 주는 장치: (a) 스키마의 모든 테이블이 `TABLE_TOPICS`에 있는지, (b) 표에서 만든 트리거 SQL이 DB의 것과 같은지, (c) `events.changed(` 호출부가 허용 목록 안에만 있는지 보는 테스트.

### 3.5 행 타입과 쿼리 키

- 컬렉션의 행 타입은 **피드의 리더에서** 나온다. `feed.ts`의 `READERS`를 컬렉션별로 타입을 살려 두고 `FeedRow['terms']`를 내보낸다. 웹의 `projectCollection(name)`이 그 타입을 받는다. 부분 보유 컬렉션(줄, 실행 항목, 제안, AI 기록)은 각자의 by-ids 리더에서 받는다.
- 타입만 빌려 주던 목록 GET 라우트(`/characters`, `/statuses`, `/terms` …, 브라우저·CLI 호출 없음)와 웹의 `Omit<…>` 보정, 손으로 쓴 행 인터페이스를 지운다.
- 쿼리 키는 팩토리 하나로 만든다: `key(topic: Topic, …)`. 키 리터럴(`queryKey: [`)은 팩토리 밖에서 금지한다(`ui-rules`에 규칙 추가). `['line-context']`, `['run-start']`처럼 토픽으로 시작하지 않는 키가 없어지고, 화면 쪽 `invalidateQueries` 호출도 필요 없어진다.
- 줄 행을 컬렉션 밖에 복사해 둔 곳(`q.graphNode`, `line-bulk.tsx`의 `known`, `sample-search`)은 id로 답하고 행은 `useLines`로 읽는다.
- 토픽 밖에 키를 두는 질문은 `lib/query-keys.ts`의 `OWN_FAMILIES`에만 있다(`line-surroundings`, `run-start`). 각자 따르는 토픽을 `meta.follows`로 밝히고, 토픽 대신 무엇이 다시 묻게 하는지 그 표에 적는다.

### 3.6 쓰기 경로

서버:

- **지식**: 라우트의 직접 insert/update를 없애고 `knowledge-save.ts`의 저장 함수를 `PERSON`으로 부른다. "확정 관계는 양끝 인물도 확정"과 프로젝트 안의 id인지 확인하는 일이 저장 함수 안에 있게 된다.
- **줄 구조**: 줄 만들기·지우기를 서비스 하나로 모은다(`source-mutations.ts`와 `graph-edit.ts`가 각자 하는 키 유일성, 초기 상태, 그래프 노드, 근거 정리). 되돌리기는 줄에 딸린 것(후보, 이력, 실행 항목)까지 스냅숏한다.
- **줄 불변식**: "완료 상태에는 번역이 있어야 한다"를 `setLineStatus` 하나에 두고 사람의 저장·일괄 변경·실행의 종료 동작이 모두 거친다. 청자 쓰기는 `Saver`를 받아서, 자동·바로 반영 모드가 적용한 것이 `human`으로 남지 않게 한다.
- **실행 시작·이어 하기**: `startWorkflowRun`과 `resolveStartRun`의 검사, 라우트의 continue와 `continue_run` 도구를 서비스 하나씩으로 합친다.

웹: 행을 바꾸는 쓰기는 `lib/`의 엔터티별 함수만 한다. 그 함수는 항상 `sent`(x-seq 대기)를 거치고, 낙관적 변경이 필요한 것만 `createOptimisticAction`을 쓴다. 라우트·컴포넌트는 `client.*.$post/$put/$patch/$delete`를 직접 부르지 않는다(`ui-rules` 규칙).

### 3.7 실행기: 끝나지 않는 상태를 없앤다

- `dispatch`가 띄운 작업은 어떻게 끝나든 기록된다: 던지면 `failBatch`(그 줄들의 실패) 또는 `halt`(실행 멈춤과 안내). 지금은 `try` 밖에서 던지면 줄이 `running`으로 남는다.
- 오류 종류는 코드로만 정한다. `ModelErrorCode`에 `cut-off`와 `refused`를 넣고 멈춤 사유를 아는 곳(`@loca/ai`)에서 붙인다. `ItemErrorKind`는 코드에서 전사 함수로 얻는다. 서버의 메시지 정규식(`outputCutOff`, `/거절|refus/`)을 지운다.
- "넣는 중"은 `notice` 문자열 비교가 아니라 실행 상태값으로 둔다. 서버를 켤 때 그 상태로 남은 실행은 실패로 닫는다.
- 재시도로 되돌린 스텝 표시(`retriedSteps`)를 `run_steps`에 저장한다. 재시작 뒤 연속 실패 수가 달라지지 않는다.

### 3.8 그래프 화면: 한 가지 일은 한 가지 방법으로

그래프가 넷이다(대사·장면 그래프는 Canvas, 관계 그래프·사건 흐름·워크플로 편집기는 React Flow). 그리는 라이브러리는 그대로 두고, 그 위의 상호작용을 하나씩으로 줄인다.

- **고른 묶음**은 `lib/graph-selection.ts`. 규칙(상자·⌘/Ctrl+클릭은 고르고, 그냥 클릭은 URL의 선택이다. 키와 메뉴는 고른 묶음에, 없으면 열린 항목에 듣는다)은 순수 함수이고 `useGraphSelection`이 묶음을 든다.
- **복사·붙여넣기**는 `lib/graph-clipboard.ts`(종류별로 탭이 든다), **키**는 `lib/graph-shortcuts.ts`, **되돌리기**는 `lib/undo-history.ts`. 서버가 되돌리는 화면은 토큰 스텝을, 워크플로 편집기처럼 저장 전 편집을 스스로 드는 화면은 `snapshotHistory`를 쓴다(스텝·순서·한도는 같은 `undoHistory`).
- **뷰포트**는 `lib/viewport.ts`의 `useStoredViewport(projectId, graph, scope)` 하나, 저장소 키도 `viewport` 하나다. scope는 그 그래프가 보여 주던 것(구역·방향, 워크플로, 실행, 사람·사건 묶음의 짧은 이름)이라 같은 것을 다시 열면 보던 자리에서 열린다.
- **메뉴**는 `ContextMenu` 하나. 캔버스가 우클릭한 자리와 대상을 알려 주는 화면은 `PointMenu`(같은 메뉴, 자리를 화면이 든다)를 쓴다. 고른 묶음의 막대는 `SelectionBar floating`.
- 관계 그래프와 사건 흐름은 편집 방식이 같다: `EditableFlow`가 고르기·끌기·키·메뉴·복사·뷰포트를 맡고, 각 파일에는 노드와 선의 모양, 배치, 쓰기 함수만 남는다. 두 화면의 동작(`remove`·`connect`·`add`·`duplicate`·`undo`·`redo`)도 `EditableFlowActions` 한 모양이다.
- 화면 컴포넌트는 조립만 한다. 대사 그래프는 URL(`graph-search.ts`: 읽기와 모든 변경), 순회(`flow-model.ts`), 카드 글(`node-cards.ts`)을 React 없는 모듈로 빼고 테스트한다. 워크플로 편집기는 초안·저장, 선택, 그린 모양, 편집, 배치, React Flow 연결을 훅 하나씩으로 나누고, 정의를 바꾸는 일은 순수 함수(`definition-edits.ts`)다. 편집기와 실행 그래프가 함께 그리는 것(카드의 글, 출구 표식이 붙는 선, 이름, 측정한 크기, 자동 정렬)은 `flow-graph.ts`·`flow-canvas.ts`에 한 번만 있다.

## 4. 이번에 하지 않는 것

각각 따로 설계한다. 위 결정과 얽히지 않는다.

- `packages/ui/domains` 재배치와 일회용 부품 정리
- `services/`와 `engine/`의 계층, "route" 이름 정리, `@tw/*`·`@loca/ui`·저장소 키 접두사 통일
- `@loca/ai`의 연결 종류별 provider 객체

## 5. 순서

앞의 것이 뒤의 것을 쉽게 한다. 각 단계는 따로 병합할 수 있다.

1. **지우기**: 호출자 없는 그래프 파일 7개와 테스트, 안 쓰는 쿼리·`lib/optimistic.ts`, 옛 채팅 프로토콜·승인 흐름 잔재. 미사용 export 검사를 `pnpm verify`에 넣는다. (§6-4, §6-5가 정해지면 `end` 노드와 옛 길 서버도.)
2. **§3.2 도구 spec**: 가장 작고, 자동 모드의 삭제 문제를 바로 고친다.
3. **§3.1 필터**: `--tag` 문제와 목록·내보내기 차이를 고친다. `runs.scope` 마이그레이션이 있다.
4. **§3.3 요청**과 **§3.7 실행기**: 같은 파일(`runner.ts`)을 만지므로 이어서 한다.
5. **§3.4 토픽**: 호출부가 가장 많다. 표와 테스트를 먼저 넣고(이때는 손 emit과 겹쳐도 해가 없다) 그다음에 손 emit을 지운다.
6. **§3.5, §3.6**: 화면과 라우트를 넓게 만진다. 5 뒤에 하면 화면 쪽 무효화 코드를 같이 지울 수 있다.

## 6. 정해야 할 것

1. **토픽을 DB에서 낼 것인가(§3.4).** 권장: 낸다. AGENTS.md의 "쓰기 지점에서 emit하지 않는다"가 토픽에도 참이 된다. 대안은 지금 구조를 두고 AGENTS.md를 "행은 트리거, 토픽은 쓰기 지점"으로 고친 뒤 테스트로 빠진 토픽을 잡는 것인데, 무엇이 빠졌는지 테스트가 알 방법이 마땅치 않다.
2. **화자 필터의 의미.** 목록은 문자열 그대로, `findLines`는 인물의 별칭까지 펼친다. 권장: 별칭까지 펼치는 쪽으로 통일("별칭이 화자를 정한다"). 목록 화면에서 화자 하나를 고르면 그 인물의 다른 표기 줄도 보이게 된다.
3. **앱과 터미널의 구분을 서버가 강제할 것인가.** 지금은 어떤 로컬 프로세스든 `POST /proposals/:id/accept`나 `agentSettings` 변경을 부를 수 있어서, "매번 묻기"는 에이전트가 `loca` CLI만 쓴다는 전제 위에 있다. 권장: 강제하지 않고 그 전제를 AGENTS.md와 skill에 적는다. 브라우저에 심는 토큰은 같은 컴퓨터의 프로세스가 읽을 수 있어 실수는 막아도 경계가 되지는 않는다.
4. **`end` 노드.** 편집기가 편집할 때마다 지우고 템플릿도 만들지 않는데 스키마·실행기·CLI·skill에는 남아 있다. 권장: 마이그레이션으로 지우고 종류에서 뺀다.
5. **옛 "길 따라" 서버.** `/route`, `/route/next`, `/route/remaining`, `/seam-checks`와 라운드·이음새 점검은 브라우저와 CLI에서 부르는 곳을 찾지 못했다(`route-slice.ts`는 경로 대본이 아직 쓴다). 경로로 만든 보기가 이것을 대신한 것이 맞으면 같이 지운다.

## 7. 구현 결과

§6은 다섯 가지 모두 권장대로 정했다. §4에 "이번에 하지 않는 것"으로 적었던 것도 사용자가 없는 지금 같이 했다. 호환 코드와 값을 옮기는 마이그레이션은 두지 않았다.

| 결정 | 지금의 한 곳 | 어긋나면 잡는 것 |
|---|---|---|
| §3.1 필터 | `lineFilterSchema`(`@loca/shared`), `domain/line-filter.ts`의 `resolveLineFilter` → `lineConditions`. 실행 범위는 `{ filter?, terms?, changeHuman? }` | `services/cli-parity.test.ts` |
| §3.2 도구 | `TOOL_SPECS`(`@loca/shared`) + `services/agent-tools.ts`의 같은 이름 정의(`check`·`undo`·`preview`·`permit`), 호출은 `callTool` | `services/tool-specs.test.ts`, `routes/tool-routes.test.ts` |
| §3.3 요청 | `engine/request.ts` `buildRequest`, `engine/run-create.ts` `batchOf` | `engine/request-parity.test.ts` |
| §3.4 토픽 | `db/topics.ts` `TABLE_TOPICS` → 트리거(`topic_changed`). 손으로 부르는 `changed`는 행이 아닌 것만 | `db/topics.test.ts`, `events.test.ts`, `feed-readers.test.ts` |
| §3.5 행 타입·키 | 서버 `feed.ts` `READERS` → `FeedRow`, 웹 `lib/query-keys.ts` `key(topic, …)` | `pnpm ui-rules`(손으로 쓴 `queryKey`, 화면의 API 쓰기, 저장소 직접 접근을 막는다) |
| §3.6 쓰기 | `domain/line-save.ts`(`setLineStatus`, `rev`), `services/graph-edit.ts`(대사 만들기·지우기), `domain/knowledge-save.ts`, 되돌리기는 `undo_records` 하나. 거절은 `refusal.ts`의 `Refusal` 하나 | `routes/one-write-path.test.ts`, `architecture.test.ts` |
| §3.7 실행기 | 상태 `preparing`, `run_steps.retried`, 오류 종류는 `MODEL_ERROR_KINDS` | `engine/run-limbo.test.ts`, `engine/run-parts.test.ts` |
| §3.8 그래프 화면 | `lib/graph-selection.ts`·`graph-clipboard.ts`·`viewport.ts`·`undo-history.ts`, `EditableFlow` | 각 모듈의 단위 테스트 |
| 계층 | `routes → services → engine → domain → db` | `architecture.test.ts` |
| 죽은 코드 | — | `pnpm unused`(knip), `noUnusedLocals`·`noUnusedParameters` |

남긴 것: `WORKBENCH_*` 환경 변수와 `.workbench/` 폴더 이름(지금 쓰는 로컬 설정이 깨진다), 마이그레이션 130여 개를 하나로 합치기(로컬 DB가 열리지 않게 된다). 둘 다 정하면 바로 할 수 있다.
