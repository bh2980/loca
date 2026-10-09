# loca — 게임 번역 작업실

게임에서 추출한 원문을 가져와, 사용자가 정의한 **번역 상태**와 그 사이의 **워크플로 노드**로
AI 번역·검수·수정·사람 확인을 자동화하는 Windows 로컬 작업실입니다.
스토리·세계관 문서, 인물 프로필·관계, 대사/장면 그래프를 저장해 AI 프롬프트의 문맥으로 씁니다.

설계와 사용자 여정: [docs/DESIGN.md](docs/DESIGN.md)

## 실행

Node.js 22.12+ 와 pnpm 10이 필요합니다(`corepack enable`).

```bash
pnpm install
```

```bash
pnpm build && pnpm start
```

`http://127.0.0.1:4317` 을 엽니다. 데이터는 `.workbench/workbench.sqlite`에 저장되고 API 키는 Windows 자격 증명 관리자(macOS는 키체인)에 저장됩니다.

개발 모드(API 4317 + Vite 4318, 저장 시 자동 재시작):

```bash
pnpm dev
```

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `WORKBENCH_PORT` | 4317 | API 포트 (Vite 프록시도 이 값을 따름) |
| `WORKBENCH_DATA_DIR` | `./.workbench` | DB 위치 |
| `WORKBENCH_SECRETS` | (keyring) | `memory`면 키를 메모리에만 보관 (테스트용) |

## 시작하기

1. 첫 화면에서 **표준 파일 가져오기** → `samples/relay-station.json` (작은 예시)
2. 설정 › AI 연결·프로필 → 연결 추가(OpenAI 호환 API, System One, Codex/Claude/Grok/Antigravity/opencode CLI) → 프로필 만들기. opencode CLI로는 opencode의 무료 모델(`opencode/…`)과 opencode Go 모델을 쓸 수 있습니다
3. 워크플로 → 기본 번역 → AI 노드에 프로필 지정 → 저장 → 실행
4. 실행 기록에서 진행을 보고, 검토함에서 ‘사람 확인 필요’ 같은 검토 상태의 대사를 고치고 다음 상태로 옮김
5. 우측 **에이전트**(⌘I)에게 "대본을 읽고 인물 프로필을 만들어줘"처럼 요청 → 제안 카드 수락

실제 모델 없이 흐름을 확인하려면 모의 서버를 띄우고 연결 주소를 `http://127.0.0.1:4398/v1`(모델 `mock`)로 지정합니다.

```bash
pnpm mock-llm
```

## loca CLI

앱이 켜져 있을 때 터미널에서 대본을 찾고, 점검하고, 파일로 번역을 주고받습니다.

```bash
pnpm loca projects
pnpm loca lines --speaker "Alice" --all
pnpm loca check terms
pnpm loca context tower.1                # AI 노드가 이 대사에 보낼 문맥 (모델 호출 없음)
W=$(pnpm --silent loca workspace new ch1)     # .loca/ch1 작업 폴더 (git에 안 올라감)
pnpm loca export --section "Chapter 1" --untranslated --context 4 --terms -o "$W/ch1.jsonl"
pnpm loca import "$W/ch1.out.jsonl" --dry-run
pnpm loca import "$W/ch1.out.jsonl"     # 제안 1건 → 앱에서 수락하면 반영
```

앱 없이 되는 명령: `loca format schema`(표준 파일 JSON Schema), `loca format check <파일>`(형식 오류·요약·경고),
`loca workspace new|list|clean`(에이전트 임시 파일을 두는 `.loca/`. 가장 가까운 `.loca`, 없으면 git 저장소 루트, 없으면 현재 폴더에 만들고 스스로 git에서 빠집니다. `LOCA_WORKSPACE`로 바꿀 수 있음).

어디서나 `loca`로 쓰려면 `apps/cli`에서 `npm link`. 앱 주소는 `LOCA_URL`, 프로젝트는 `--project` 또는 `LOCA_PROJECT`. 에이전트용 사용법은 [`skills/`](skills/README.md).

## 표준 포맷 (`loca/v1`)

게임별 추출기/변환기가 만드는 JSON입니다. 작업실은 게임 내부 구조를 몰라도 됩니다. 스키마의 기준은
[packages/shared/src/import-format.ts](packages/shared/src/import-format.ts)이고, 가져오기 화면과 `loca format check`가 위반 위치를 경로로 알려 줍니다.
변환기를 만드는 절차는 [`skills/loca-import-format`](skills/loca-import-format/SKILL.md).

```jsonc
{
  "format": "loca/v1",
  "project": { "name": "…", "sourceLanguage": "en", "targetLanguage": "ko" },
  "groups": [{ "key": "scene-1", "kind": "scene", "title": "…" }],          // scene | document | ui
  "units":  [{ "key": "scene-1.3", "group": "scene-1", "speaker": "MIRA", "source": "…" }],
  "graph": {
    "flow": "partial",   // complete: 분기·조건·장면 이동이 그래프에 빠짐없이 있음 / partial(기본): 그 밖
    // 원본 노드 클래스마다 표시 범주(kind)와 의미를 한 번 선언합니다.
    "nodeTypes": { "IfElseState": { "kind": "condition", "label": "조건 분기", "description": "…" } },
    "nodes": [{ "key": "n1", "type": "ChatMessageState", "units": ["scene-1.3"] }, { "key": "n2", "type": "IfElseState" }],
    "edges": [{ "from": "n1", "to": "n2", "label": "pin 0" }]
  },
  "characters": [{ "name": "MIRA", "aliases": ["Mira"], "profile": "…" }],
  "relationships": [{ "from": "MIRA", "to": "JONAS", "kind": "동료", "mutual": true }],
  "documents": [{ "title": "세계관", "kind": "world", "body": "…", "alwaysInclude": true }],
  "terms": [{ "source": "Directorate", "target": "총국" }]
}
```

`kind`는 콘텐츠 노드(`script`)와 이벤트·제어 노드(`condition`, `wait`, `event`, `state`, `connector`, `unknown`)로 나뉩니다.
모양과 번역량 집계는 `kind`를 따르고, 원본 `type`과 설명은 그래프 범례와 노드 상세에 그대로 보입니다.

## 구조

```
apps/server     Hono API, Drizzle + SQLite(FTS5), 워크플로 실행기, ELK 그래프 배치(worker), 채팅 에이전트
apps/web        React 19, TanStack Router/Query, shadcn/ui, React Flow(워크플로·인물), Canvas+d3-zoom(원문 그래프)
packages/shared 표준 포맷·워크플로 정의·검증(Zod, graphology), 형식 검사
packages/ai     AI SDK(OpenAI 호환), TypeSafe SDK(System One), CLI 실행(execa), 재시도·대체 경로(p-retry)
scripts         샘플 생성(pnpm samples), 모의 LLM(pnpm mock-llm)
```

검사:

```bash
pnpm typecheck && pnpm test
```
