# 홈 설정 (새 프로젝트 기본값) 설계 — 2026-10-27

## 1. 문제

모든 설정이 프로젝트 안에 있다. 새 프로젝트를 만들 때마다 에디터 AI 모델, 채팅 권한, 저장한 지시, 상태를 다시 맞춰야 한다.
"연결"(API 키·CLI 계정)은 반대로 앱 전체가 같이 쓴다(`connections` 테이블에 projectId 없음). 그래서 프로젝트마다 다른 API를 쓸 수 없는데, 화면은 `/p/$projectId/settings/connections`에 있어 프로젝트 설정처럼 보인다.

## 2. 결정

- **홈 설정 = 새 프로젝트 기본값.** 프로젝트를 만들 때 한 번 복사한다. 그 뒤로는 프로젝트가 자기 값을 가지고, 홈을 바꿔도 기존 프로젝트는 그대로다. 실시간 상속·"전역 따름" 표시는 없다.
- 한꺼번에 맞추고 싶을 때는 사람이 누르는 버튼 두 개로 한다.
  - 프로젝트 설정의 **"홈 기본값 가져오기"**: 홈 값으로 이 프로젝트의 섹션을 덮어쓴다.
  - 프로젝트 설정의 **"홈 기본값으로 저장"**: 이 프로젝트의 섹션을 홈 기본값으로 올린다. 이미 잘 맞춰 둔 프로젝트에서 홈을 채우는 길이다.
- **연결도 복사한다.** 프로젝트마다 필요한 API가 다를 수 있기 때문이다. 예외는 없다.

## 3. 무엇이 어디로 가나

| 섹션 | 홈 설정 | 프로젝트 생성 시 | 가져오기 / 올리기 |
|---|---|---|---|
| 연결 (키, 주소, 실행 파일, 모델 한도) | 기본 목록 | 복사 (새 id, API 키도 키체인에 새 항목으로) | 가져오기: 없는 이름은 추가, **같은 이름은 키·주소·실행 파일·모델 한도를 홈 것으로 갱신**(id는 그대로라 워크플로·대화가 계속 가리킴). 지우지는 않음 |
| 에디터 AI (`editorAi`) | 기본값 | 복사 | 섹션 통째로 덮어씀 |
| 채팅: 권한·새 대화 모델·권한 모드 (`agentSettings`) | 기본값 | 복사 | 덮어씀 |
| 저장한 지시 (`agentSettings.prompts`) | 기본값 | 복사 | 가져오기는 **없는 이름만 추가**, 같은 이름은 그대로 둠 |
| AI 결과 바로 확정 (`aiAutoConfirm`) | 기본값 (워크플로 화면 안) | 복사 | 덮어씀 |
| 상태 | 기본 목록 | 복사 (새 id) | 가져오기는 **없는 이름만 추가**. 기존 상태는 대사가 가리키므로 바꾸거나 지우지 않음 |
| 태그 (사람이 만든 것) | 기본 목록 | 복사 | 없는 이름만 추가 |
| 워크플로 | 기본 목록 (§5) | 복사 | 가져오기는 **새 워크플로로 추가**, 기존 것은 건드리지 않음 |
| 이름·설명·언어·그래프 상태(`routePicks` 등)·내보내기·삭제 | — | — | 프로젝트 전용 |
| 서식 규칙 (`formatRules`) | — | 지금처럼: 파일에 적힌 규칙 > 원문 자동 감지 > Zod 기본값 | 프로젝트 전용 |
| 번역 제외 (`exclusionRules`) | — | Zod 기본값 (지금과 같음) | 프로젝트 전용 |
| 자동 표시 색 (`markColors`) | — | 앱 기본 색 (지금과 같음) | 프로젝트 전용 |
| 테마 | "화면" 탭. 프로젝트 사이드바 메뉴도 그대로 둠 (둘 다 같은 브라우저 localStorage) | — | — |

**홈에 둘지 점검한 결과** (기준: 새 프로젝트마다 대개 같은 값으로 다시 맞추는가, 그리고 홈 워크플로가 이것을 필요로 하는가)

- **둔다**
  - 연결: 사람이 쓰는 계정은 프로젝트가 바뀌어도 거의 같다. 홈 워크플로의 AI 노드도 연결 이름으로 이어진다.
  - 에디터 AI: 모델·시간 제한·지시는 번역하는 사람의 작업 습관이다.
  - 채팅 권한·모드·새 대화 모델: 사람의 안전 기준이라 프로젝트마다 달라질 이유가 적다.
  - 저장한 지시: 사람이 모아 두는 프롬프트라 여러 프로젝트에서 다시 쓴다.
  - 상태·태그·워크플로: 이 앱의 핵심이 "사람이 정한 상태 + 그 사이의 워크플로"다. 워크플로는 상태·태그를 이름으로 가리키므로 셋을 같이 둔다.
  - AI 결과 바로 확정: 사람이 AI를 얼마나 믿는지의 기준이다. 다만 스위치 하나라 메뉴를 따로 만들지 않고, 워크플로 화면 안에 섹션으로 둔다.
- **뺀다**
  - 서식 규칙, 번역 제외: 게임 엔진·파일 형식·개발자 키 모양처럼 그 작품의 원문에 따라 정해진다. 기본 켜기/끄기는 지금 기본값으로 충분하다.
  - 자동 표시 색: 바꾸는 일이 드물고 보기만 다르다. 나중에 필요하면 더한다.

홈 기본값을 한 번도 손대지 않았다면, 지금 코드의 상수(`DEFAULT_STATUSES`, `defaultWorkflows`, Zod 기본값)와 결과가 똑같다. 그래서 기존 사용자에게는 아무것도 바뀌지 않는다.

## 4. 데이터

**`@tw/shared`: `appDefaultsSchema`** (Zod, 모든 칸에 지금 기본값)

```ts
appDefaultsSchema = z.object({
  editorAi: editorAiSchema.prefault({}),
  agentSettings: agentSettingsSchema.prefault({}),
  aiAutoConfirm: z.boolean().default(true),
  statuses: z.array(templateStatusSchema).default(DEFAULT_STATUSES),   // key, name, color, kind, inReview
  tags: z.array(templateTagSchema).default([]),                        // name, color, scope (앱 태그 'AI 실패'는 늘 따로 만듦)
  workflows: z.object({
    templates: z.array(z.enum(TEMPLATE_KEYS)).default(['translation', 'listener', 'people', 'events']), // 지금의 앞 넷
    saved: z.array(savedWorkflowSchema).default([]),                   // §5
  }).prefault({}),
})
```

상태 목록 검증은 프로젝트와 같다: 처음 상태 하나 이상, 완료 상태 하나 이상.

**DB: `app_settings` 테이블** (행 하나)

| 칸 | 내용 |
|---|---|
| `id` | `'app'` 고정 |
| `defaults` | `appDefaultsSchema` JSON (읽을 때 parse해서 빈 칸은 기본값으로) |
| `updated_at` | |

행이 없으면 `appDefaultsSchema.parse({})`로 읽는다.

**DB: `connections.project_id`** (nullable, 프로젝트 삭제 시 cascade)

- `null` = 홈 기본 연결, 값 있음 = 그 프로젝트의 연결.
- 연결을 id로 찾는 곳(서버 12개 파일: `routes.ts`의 `liveChoice`, `preflight`, `budgets`, `run-plan`, `chat-run` 등)은 id가 겹치지 않으므로 그대로 동작한다. 대신 **다른 프로젝트의 연결을 쓰지 못하게** `liveChoice`와 모델 선택 목록에서 `project_id`를 확인한다.
- 실행 기록(`runs`)의 모델 스냅샷은 이미 연결 정보를 얼려 두므로 손대지 않는다.

**기존 데이터 옮기기** (키체인을 다뤄야 해서 SQL 마이그레이션이 아니라 서버 시작 시 한 번 도는 JS 단계, 끝나면 `app_settings`에 표시):

1. 지금 연결은 모두 홈 기본 연결(`project_id = null`)로 남는다.
2. 프로젝트마다 지금 연결 전부를 복사한다(새 id, 키도 복사). 그 프로젝트가 안 쓰는 연결도 복사한다. 지금 모든 프로젝트에서 보이던 것이 그대로 보여야 하기 때문이다.
3. 그 프로젝트 안에서 연결 id를 새 id로 바꾼다: 워크플로 AI·재요청 노드의 `model.connectionId`, `chat_sessions.connection_id`, `editorAi.model`·`editorAi.complete.model`, `agentSettings.chatModel`.
4. 한 트랜잭션으로 하고, 시작 전에 DB를 백업한다(`backupBeforeMigration`과 같은 방식). 키 복사가 실패하면 그 연결은 키 없이 복사하고 연결 화면에 "키 없음"으로 보인다(지금도 있는 표시).

## 5. 워크플로 기본값

홈에는 워크플로 편집기를 두지 않는다. 편집기는 프로젝트의 상태·태그·연결 검증에 묶여 있기 때문이다.

- **기본 템플릿 고르기**: 7개 템플릿(`WORKFLOW_TEMPLATES`) 중 새 프로젝트가 처음부터 가질 것을 체크한다. 지금은 앞의 넷이 기본이다.
- **프로젝트에서 올린 워크플로**: 프로젝트 워크플로 화면에서 "홈 기본값으로 저장"을 누르면 정의를 복사해 둔다. 홈에서는 목록 보기·이름 바꾸기·지우기만 한다. 고치려면 프로젝트에서 고친 뒤 다시 올린다.
- **상태·태그 참조 옮기기**: 올릴 때 정의 안의 상태 id·태그 id를 **이름**으로 바꿔 저장한다(`savedWorkflowSchema`에 이름 참조). 프로젝트로 복사할 때는 그 프로젝트에서 같은 이름을 찾는다. 이름이 없으면 지금 템플릿과 같은 규칙(종류·검토함 여부, `templateDefinition` in `routes/workflows.ts`)으로 찾고, 그래도 없으면 비워 둔다. 빈 칸은 기존 워크플로 검증이 "상태를 고르세요"로 알려 준다. 몰래 다른 상태로 연결하지 않는다.
- AI 노드의 모델도 같은 방식으로 옮긴다. 올릴 때 연결 id를 **연결 이름**으로 바꾸고, 복사할 때 그 프로젝트에서 같은 이름의 연결을 찾는다. 없으면 비워 두고, 검증이 "모델을 고르세요"로 알려 준다.
- 홈 기본값 안의 모델 선택(에디터 AI, 새 대화 모델)은 홈 기본 연결을 가리킨다. 프로젝트를 만들 때 연결을 먼저 복사하고, 그때 만든 id 대응표로 바꿔 넣는다.

## 6. 서버

- `services/app-defaults.ts`
  - `readAppDefaults(db)` / `updateAppDefaults(db, patch)`: 섹션 단위 패치, 패치한 섹션은 통째로 바꿈
  - `pullDefaults(db, projectId, sections)`: §3의 "가져오기" 규칙
  - `pushDefaults(db, projectId, sections)`: 프로젝트 → 홈 (워크플로는 `workflowIds`를 받음)
- `services/importer.ts`: 상수 대신 `readAppDefaults`를 읽는다. 상태·태그·워크플로도 여기서 만든다. 번역이 이미 있는 대사의 상태는 지금 템플릿 규칙으로 정한다: 검토함이 아닌 첫 중간 상태, 없으면 처음 상태.
- 라우트
  - `GET /api/app/defaults`, `PATCH /api/app/defaults`
  - `POST /api/projects/:id/defaults/pull { sections }`
  - `POST /api/projects/:id/defaults/push { sections, workflowIds? }`
  - 연결 API는 두 곳으로 나눈다: `/api/app/connections`(홈)와 `/api/projects/:id/connections`(프로젝트). 핸들러는 지금 `connectionRoutes`를 범위(`projectId | null`)만 받게 바꿔 함께 쓴다. "쓰는 곳이 있어 못 지움" 검사(`usesOf`)는 그 범위 안에서만 본다.
  - 모델 시험은 연결이 있는 곳 어디서나 그대로 쓴다.
- SSE: 새 토픽 `app`(projectId 없이 emit). 쿼리 키는 `['app', 'defaults']`. pull은 바뀐 프로젝트 토픽(`projects`·`statuses`·`workflows`)을 emit한다. `app`을 읽는 다른 토픽 쿼리는 없으므로 `IMPLIES`는 추가하지 않는다.
- 지금 프로젝트 설정 쪽 코드(`project-settings.ts`, `line-marks.ts`의 SQL 하위 질의 등)는 **그대로 둔다**. 복사 방식이라 읽는 길이 바뀌지 않는다.

## 7. 화면

**홈** (`/`): 헤더의 가져오기(주 버튼) 옆에 "설정" 링크를 둔다(보조, ghost).

**홈 설정** (`/settings/...`): 프로젝트 사이드바 대신 홈용 틀을 쓴다. `@loca/ui`에 `AppSettingsFrame`을 새로 만든다(왼쪽 목록 + 본문, `ProjectListFrame`과 같은 계열).

| 경로 | 내용 |
|---|---|
| `/settings/defaults/connections` | 기본 연결 (지금 연결 화면과 같은 부품, `?conn=` 그대로) |
| `/settings/defaults/statuses` | 기본 상태·태그 (표 + 오른쪽 상세 pane, 프로젝트 화면과 같은 부품) |
| `/settings/defaults/editor` | 에디터 AI (탭 없음) |
| `/settings/defaults/chat` | 권한·새 대화 모델·권한 모드·저장한 지시 |
| `/settings/defaults/workflows` | 기본 템플릿 체크 + 올린 워크플로 목록 + AI 결과 바로 확정 |
| `/settings/appearance` | 테마 |

왼쪽 목록은 "새 프로젝트 기본값"(연결, 상태·태그, 에디터 AI, 채팅, 워크플로) / "화면"으로 묶는다. "새 프로젝트 기본값" 제목 아래에 "새로 만드는 프로젝트에만 쓰입니다. 기존 프로젝트는 각 프로젝트 설정의 '홈 기본값 가져오기'로 맞춥니다."를 한 줄로 적는다.

**부품 재사용**: 지금 섹션 부품(연결 화면, `ModelPicker`, `EditorAiSection`, `AgentTab`, `SavedPromptsSection`, `AiAutoConfirmSetting`, 상태·태그 pane)은 `projectId`를 받아 `q.project`를 읽고 `PATCH /projects/:id`로 저장한다. 이를 `target: { kind: 'project'; projectId } | { kind: 'app' }`를 받는 형태로 바꾸고, 읽기·저장은 `useSettingsTarget(target)` 훅 하나에 모은다. 프로젝트에만 있는 정보(대사 수, 미리보기)는 `app`일 때 숨긴다.

**프로젝트 설정**: 섹션마다 버튼을 흩어 두지 않고, 설정 › 프로젝트에 "홈 기본값" 섹션 하나를 둔다. 섹션 체크(연결, 에디터 AI, 채팅, 저장한 지시, AI 결과 바로 확정, 상태, 태그, 워크플로)와 버튼 둘("홈 기본값 가져오기", "홈 기본값으로 저장")이 있다. 워크플로를 체크하고 올릴 때는 올릴 워크플로를 고른다. 덮어쓰는 동작이라 실행 전에 섹션마다 무엇이 바뀌는지 적은 AlertDialog로 확인받고, 끝나면 섹션별 결과(예: "상태 1개 추가")를 보여 준다.

**프로젝트 연결 화면**: `/p/$projectId/settings/connections`에 그대로 두고, 이제 정말 그 프로젝트의 연결만 보여 준다. 화면 설명에 "이 프로젝트에서만 쓰는 연결입니다"를 적는다. 연결 화면을 가리키는 링크(`getting-started.tsx`, `model-picker.tsx`, `chat/chat-panel.tsx`)는 바꾸지 않아도 된다. 옛 주소 `/p/$projectId/ai/connections`는 지운다(레거시 호환 없음).

**CLI 연결의 로그인**: Claude·Codex 같은 CLI 연결은 복사해도 로그인은 컴퓨터에 하나다. 한 프로젝트 연결 화면에서 로그인·로그아웃하면 같은 CLI를 쓰는 모든 프로젝트에 적용된다. CLI 연결 상세에 이 사실을 한 줄로 적는다.

**채팅 패널**: 대화는 프로젝트에 묶여 있으므로 홈 설정 화면에는 채팅 패널이 없다.

## 8. CLI · 채팅 · skills

- 읽기: 채팅 도구 `read_app_defaults`, CLI `loca defaults [섹션]`. `loca prompts`는 지금처럼 프로젝트 것을 보여 준다.
- 가져오기(pull): 프로젝트를 바꾸는 일이므로 채팅·CLI에서는 **제안**으로 만든다. 사람이 앱에서 수락하고, `proposal-undo`로 되돌릴 수 있다. CLI는 `loca defaults pull <섹션...>`.
- 올리기(push)·홈 편집: **앱에서 사람만** 한다. 제안은 프로젝트 단위라 홈을 담을 수 없다. 또 채팅 권한 기본값을 에이전트가 넓히면 안 된다(#45와 같은 이유).
- `skills/loca-project`에 위 명령과 "홈 기본값은 새 프로젝트에만 쓰인다"를 적는다.

## 9. 정해야 할 것

없음. 결정 과정:
- 실시간 상속 대신 한 번 복사
- 연결도 복사
- 서식 규칙·번역 제외·자동 표시 색은 홈에서 뺌
- 테마는 홈 "화면"과 프로젝트 사이드바 메뉴 두 곳에 둠

## 10. 순서 (한 브랜치, 마지막에 PR 하나)

1. `appDefaultsSchema` + `app_settings` 마이그레이션 + `app-defaults.ts` + importer가 기본값을 읽게. 테스트: 기본값을 안 건드리면 지금과 같은 프로젝트가 만들어진다, 바꾸면 바뀐 값으로 만들어진다, 홈을 바꿔도 기존 프로젝트는 그대로다.
2. 연결을 프로젝트별로: `connections.project_id`, 기존 데이터 옮기기(백업 포함), 연결 API 두 갈래, 다른 프로젝트 연결 차단. 테스트: 옮긴 뒤 모든 워크플로·대화·에디터 AI가 같은 연결 이름·모델을 가리킨다, 키가 복사됐다, 한 프로젝트에서 연결을 지워도 다른 프로젝트는 그대로다.
3. `AppSettingsFrame` + 홈 헤더 "설정" + 홈 기본 연결 화면.
4. 섹션 부품 `target` 전환 + 홈의 에디터 AI·채팅·상태·태그 화면, 홈 "화면" 탭(테마).
5. 워크플로 기본값: 템플릿 체크, 프로젝트에서 올리기, 이름으로 참조 옮기기.
6. 프로젝트 설정의 가져오기·올리기 + 채팅 도구·CLI·제안·skills.
7. `IMPROVEMENT-PLAN-2026-10-19.md`에 이 내용을 요약해 넣는다(계획서가 기준 문서).
8. 브라우저 확인: API·Vite·`pnpm mock-llm`, 따로 둔 `WORKBENCH_DATA_DIR`. 순서는 홈 기본값 바꾸기 → `samples/realistic-9k.json` 가져오기 → 복사됐는지 확인 → 홈 다시 바꾸기 → 기존 프로젝트 그대로인지 확인 → 가져오기 버튼 → 바뀌었는지 확인. 설정 탭·선택이 URL에 남는지, 뒤로/앞으로 가기도 본다.
