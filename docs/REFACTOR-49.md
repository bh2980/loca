# #49 전반 리팩터링: 감사와 계획

기준: main `9a32cec` (2026-10-18). 원칙은 #22를 따른다. 줄 수만 보고 나누지 않는다. 바꾸는 비용이나 테스트하는 비용이 실제로 줄어드는 경계부터 손댄다. 모든 PR은 동작을 바꾸지 않는다(예외는 따로 적는다). PR마다 `typecheck · ui-rules · test · build`를 통과시키고, 테스트가 얇은 곳에는 테스트를 더한다.

## 1. 순환 import (server, madge)

이슈를 쓸 때는 5개였는데 지금은 7개다. web과 packages에는 순환이 없다.

| # | 순환 | 되돌아오는 import | 해결 |
|---|---|---|---|
| 1 | context → runner → apply-candidate → functions → prompts → analysis → knowledge-tags → tag-scope → **context** | `tag-scope`가 `badRequest`를 `context.ts`에서 가져온다 | HTTP 오류 도우미를 잎 모듈 `http-errors.ts`로 옮긴다. `context.ts`는 다시 내보낸다 |
| 2 | runner → … → analysis → terms → **runner** | `terms`가 `type ModelPort`를 가져온다 | `engine/model-port.ts`로 옮긴다 |
| 3 | runner ↔ preflight | preflight가 `planRun · sceneLinks · selectRunUnits`를 쓰고, runner는 `overheadOf`를 쓴다 | 실행 만들기·계획을 `engine/run-create.ts`로 뺀다(#22) |
| 4 | routes/workflows ↔ services/run-continue | 서비스가 라우트에서 `workflowIssues`를 가져온다 | `services/workflow-issues.ts`로 옮긴다 |
| 5, 6 | layout-worker ↔ chains, section-graph | `type LayoutJob` | `services/layout-types.ts`로 옮긴다 |
| 7 | next-route ↔ route-slice | route-slice가 `effectivePicks`를 가져온다 | `effectivePicks`를 route-slice로 옮기고 next-route는 다시 내보낸다 |

**재발 방지:** `apps/server/src/architecture.test.ts`가 `pnpm test`에서 상대 import 그래프를 직접 훑는다. 순환이 있거나, `services/`·`engine/`이 `routes/`를 import하면 실패한다(테스트 파일은 빼고). madge 같은 새 의존성은 들이지 않는다.

## 2. 서비스가 라우트의 스키마를 가져온다

- `services/agent-tools.ts`는 `routes/knowledge.ts`에서 `characterInput · documentInput · eventInput · relationshipInput · speechRuleInput · termInput`을 가져오고, `routes/projects.ts`에서 `statusInput · tagInput`을 가져온다.
- `services/{agent-tools, analysis-runs, run-continue}.ts`는 `routes/workflows.ts`에서 `workflowIssues`를 가져온다.
- **해결:** 입력 스키마를 `apps/server/src/schemas/{knowledge,projects}.ts`로 옮긴다. 라우트와 서비스가 둘 다 여기서 가져온다. `workflowIssues`는 위의 4번이다. 앞으로는 1절의 아키텍처 테스트가 막는다.

## 3. 큰 파일과 #22

| 파일 | 줄 | 판단 |
|---|---|---|
| `engine/runner.ts` | 1078 | **나눈다.** 실행 만들기와 계획(`selectRunUnits · sceneLinks · planLines · planRun · createRun · createRunInSteps`, 분석 가드)은 상태 전이와 무관하다 → `engine/run-create.ts`. AI 출력 해석(`readAiOutput`)은 순수 함수다 → `engine/ai-output.ts`. 스케줄링·재시도·기록·라우팅은 DB 상태 전이를 한눈에 보도록 Runner에 남긴다(#22 기준) |
| `services/agent-tools.ts` | 693 | 스키마만 옮긴다. 도구 정의는 표처럼 읽히는 목록이라 그대로 둔다 |
| `db/schema.ts` | 690 | 그대로 둔다. 스키마는 한 파일이어야 drizzle 마이그레이션과 맞추기 쉽다 |
| `routes/source.ts` | 593 | 같은 원문 일괄 반영(5절)만 더한다. 쪼개지 않는다 |
| `web/graph/graph-canvas.tsx` | 780 | #22의 '순수 geometry/index' 경계는 이미 `path-window.ts` 등으로 빠져 있다. 남은 것은 그리기와 상호작용이 엉켜 있어서, 쪼개도 변경 비용이 줄지 않는다. **그대로 두고** 이유를 남긴다 |
| `web/translation-editor.tsx` | 534 | 같은 원문 제안(`offerSameSource`)을 `lib/same-source.ts`로 뺀다(5절과 함께). 자동완성·다듬기는 상태를 공유하므로 남긴다 |
| `web/chat/chat-panel.tsx` | 551 | 지금은 그대로 둔다(#48에서 다뤘다) |
| `packages/ui/layout/sidebar.tsx` | 725 | shadcn 원본이라 그대로 둔다 |

#22의 채팅 순환 `tool-part ↔ proposal-card`는 PR #28에서 이미 풀렸다.

## 4. 후보 만들기: 네 군데

`s.candidates`에 직접 insert하는 곳이 넷이다.

- `services/line-save.ts`: 사람의 저장. 같은 글이 있으면 다시 쓴다.
- `services/editor-assist.ts`: 편집기 AI 번역·다듬기.
- `services/agent-tools.ts`의 `propose_translation`.
- `engine/runner.ts`의 `record`: runId·nodeId를 붙이고 `applyRunCandidate`로 이어진다.

`engine/apply-candidate.ts`는 실행이 만든 후보를 줄에 쓴다. 그런데 `filtersByStatus` 하나 때문에 `functions/index.ts` 전체를 import하고, 이 import가 1번 순환의 한 고리다.

**해결:** `services/candidates.ts`에 `addCandidate(tx, { unitId, text, origin, model, note, runId, nodeId, reuseSame })` 하나를 둔다. 네 곳은 모두 이것을 부른다. `reuseSame`은 line-save만 켜서 지금 동작을 그대로 둔다. `filtersByStatus`는 `@tw/shared`의 workflow 쪽(순수 함수)으로 옮긴다. 테스트는 넷의 origin·model·runId와 중복 규칙을 확인한다.

## 5. 같은 원문 적용: 한 줄에 요청 하나

`translation-editor.tsx`의 '모두 이 번역으로'는 `saveLineNow`를 줄마다 차례로 보낸다. N줄이면 N번 요청하고 N번 SSE가 나가며, 중간에 충돌이 나면 앞의 몇 줄만 바뀐 채 멈춘다.

**해결:** `POST /units/:unitId/same-source`(`{ text, lines: [{ unitId, base }] }`)를 만든다. 한 트랜잭션 안에서 줄마다 `saveLine`을 부르므로 규칙은 같다. 그 사이 바뀐 줄은 건너뛰고 수를 돌려준다. 이벤트는 한 번만 낸다. **동작 변경:** 충돌한 줄에서 멈추지 않고 그 줄만 건너뛴 뒤 '건너뜀 n줄'로 알린다.

## 6. 채팅 경로 셋이 스트리밍 코드를 따로 가진다

`chat-run.ts`(API), `pi-chat.ts`, `cli-chat.ts`가 같은 것을 각자 갖고 있다.

- `createUIMessageStream` 뼈대와, 끝날 때 하는 일(markStopped로 기록 저장 → `events.changed` → 오류 문구 → `readToEnd`)
- 글 조각 쓰기(text-start/delta/end)
- 카탈로그 도구 실행: 변경 도구는 `proposeChange`, 거절이면 `refusalText`, 결과는 `fitText`. pi와 CLI에 복사돼 있다
- 다음 턴 프롬프트(`[이어받기, view, 마지막 메시지, 끼어든 메시지]`)

**해결:** `services/chat-stream.ts`에 `chatStream`, `writeText`, `runCatalogTool`, `turnPrompt`를 둔다. 세 백엔드는 자기 고유 루프만 남긴다(API는 streamText 패스, pi는 이벤트 구독, CLI는 도구 라운드). 기존 테스트(chat-steer, cli-chat, pi 관련)를 그대로 통과해야 하고, `runCatalogTool` 단위 테스트를 더한다.

## 7. #48에서 남은 UI

- **워크플로 노드 설정 패널:** 구획 없이 위에서 아래로 나열된다. `SettingsSection` 같은 구획(기본 · 모델 · 문맥 · 출력)을 접을 수 있게 나눈다.
- **인물·관계 도구 막대:** 1280에서 두 줄이 된다. '마지막 분석 …' 요약을 툴바에서 빼고 한 줄 상태로 내리거나 줄임표로 줄인다.
- **라벨과 값이 붙어 보인다**(`워크플로작품 분석 v1`, `성공모델 1개`): 실행 기록과 목록에서 라벨과 값 사이에 간격이나 구분점을 둔다.

## 8. 하지 않는 것

- 메모리에만 있는 채팅 턴과 pi 세션(재시작하면 사라짐): 영속화는 기능 변경이라 #46에서 다룬다.
- 지식 추출 엔진 통합(#47 후속), 번역 반영 경로 전면 일원화(#42): 4절과 5절로 쓰기 경로는 줄인다. 엔진 통합은 동작 변경이라 별도 이슈로 둔다.
- graph-canvas 분할: 3절 참고.

## 계획 (집중 PR)

1. 순환 7개 끊기, `schemas/`, `workflow-issues.ts`, 아키텍처 테스트 (1·2절, 3절의 run-create 분리 포함)
2. 후보 만들기 일원화, `filtersByStatus`를 shared로 (4절)
3. 같은 원문 일괄 반영 (5절)
4. 채팅 스트리밍 공통화 (6절)
5. runner의 AI 출력 해석 분리 (3절 나머지)
6. #48 남은 UI (7절)

## 결과

(PR이 끝나면 채운다)
