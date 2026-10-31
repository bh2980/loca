# loca — 게임 번역 작업실

게임에서 뽑아낸 대사·문서·UI 문구를 가져와 번역하는 로컬 프로그램입니다. 인터넷 서비스가 아니라 내 컴퓨터에서 돌아가고, 데이터도 내 컴퓨터에만 저장됩니다.

- **번역 상태를 직접 정합니다.** 예: 미번역 → AI 초안 → 검토 필요 → 완료. 상태는 프로젝트마다 바꿀 수 있습니다.
- **상태 사이를 워크플로가 잇습니다.** "미번역 줄을 AI로 번역하고, 형식·용어를 검사해서 문제가 있으면 검토 필요로" 같은 흐름을 노드로 그려서 돌립니다.
- **AI에게 작품을 알려 줍니다.** 인물 프로필, 인물 사이의 말투(반말·존댓말), 용어집, 세계관 노트, 대사가 이어지는 그래프를 저장해 두면 AI가 번역할 때 그 문맥을 함께 받습니다.
- **사람은 확인하고 고칩니다.** AI가 사람이 번역한 줄을 덮어쓰지 않고, 다른 번역을 내면 "AI 제안"으로 남겨 적용·거절을 맡깁니다.

## 설치와 실행 (처음 한 번)

필요한 것:

- [Node.js](https://nodejs.org) 22.12 이상
- pnpm 10: Node.js를 설치한 뒤 터미널에서 `corepack enable` 한 번

이 저장소를 받은 폴더에서 차례로 실행합니다. Windows PowerShell에서도 같습니다.

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm start
```

브라우저로 **http://127.0.0.1:4317** 을 엽니다. 끄려면 터미널에서 Ctrl+C.

- 다음부터는 `pnpm start`만 하면 됩니다. 저장소를 새로 받았을 때(`git pull`)는 `pnpm install`과 `pnpm build`를 다시 합니다. 빌드가 소스보다 오래되면 서버가 터미널에 그렇게 알려 줍니다.
- 데이터는 저장소 안의 `.workbench/workbench.sqlite` 한 파일입니다. 처음부터 다시 하려면 프로그램을 끄고 `.workbench` 폴더를 지우면 됩니다.
- AI 서비스의 API 키는 파일이 아니라 Windows 자격 증명 관리자(macOS는 키체인)에 저장됩니다.

## 처음 써 보기

### 1. 예시 프로젝트 가져오기

첫 화면(홈)의 **표준 파일 가져오기**에서 다음 중 하나를 고릅니다.

| 파일 | 내용 |
|---|---|
| `samples/showcase.loca.json` | **추천.** 이 저장소를 위해 직접 쓴 항구 마을 실종 미스터리 『The Quiet Lamp of Harrowmere』(영어 → 한국어). 장면 39개, 648줄, 선택지가 갈라지고 합쳐지는 대사 그래프가 있습니다. 원문만 있고 인물·용어·번역은 비어 있습니다. |
| `samples/relay-station.json` | 16줄짜리 아주 작은 예시. 인물 2명, 용어 2개가 들어 있습니다. |

### 2. AI 연결하기

화면 왼쪽 아래 **설정 › 연결 › 연결 추가**에서 쓸 AI를 등록합니다. 연결은 "어디에 어떻게 접속하는지"만 담고, 어떤 모델을 쓸지는 워크플로의 AI 노드와 채팅에서 고릅니다.

- **API 키가 있을 때:** OpenAI 호환 API (OpenAI, OpenRouter 등)
- **이미 쓰는 AI 프로그램이 있을 때:** Codex · Claude · Grok · Antigravity · opencode 명령줄 프로그램. 그 프로그램에 로그인돼 있으면 키 없이 씁니다. opencode로는 무료 모델(`opencode/…`)도 쓸 수 있습니다.
- **AI 없이 화면만 둘러볼 때:** 터미널을 하나 더 열어 가짜 AI 서버를 띄웁니다. 비용이 들지 않고, 번역 결과는 `[ko] …` 같은 가짜 문장입니다.

  ```bash
  pnpm mock-llm
  ```

  연결 추가에서 종류는 **OpenAI 호환 API**, 주소는 `http://127.0.0.1:4398/v1`, 키는 아무 글자나 넣고, 모델은 `mock`을 고릅니다.

### 3. 화면 둘러보기

왼쪽 메뉴의 화면들입니다.

| 메뉴 | 하는 일 |
|---|---|
| **번역 › 대사** | 장면별 대사 목록. 줄을 고르면 바로 번역을 입력하고, 오른쪽 패널에서 그 줄의 상세(AI 제안, 비슷한 번역, 말투와 인물, 검증, 이력)를 봅니다. 상태·화자·태그·표시(#)로 거릅니다. |
| **번역 › 그래프** | 대사가 이어지는 흐름. 노드를 고르면 원문·번역 카드가 옆에 뜨고, 필요한 노드만 남긴 "보기"를 저장할 수 있습니다. |
| **번역 › 용어집** | 고유명사·UI 낱말의 정해진 번역. 어느 대사에 나오는지, 번역이 지켰는지 봅니다. |
| **자료 › 인물·관계 · 사건 · 노트** | AI가 번역할 때 받는 문맥: 인물 프로필, 화자→청자 말투 규칙, 관계, 사건, 세계관·문체 노트. |
| **자동화 › 워크플로** | 상태 사이의 자동화를 노드로 그립니다. 새 프로젝트에는 번역, 검수, 청자 추정, 인물·관계 추출, 사건 추출 워크플로가 들어 있습니다. AI 노드에 연결과 모델을 정하고 실행합니다. |
| **자동화 › 실행 기록** | 실행의 진행, 줄마다 거친 단계, AI 호출과 비용, 실패한 줄 다시 하기. |
| **설정** | 프로젝트, 상태·태그, 에디터(편집기의 AI 버튼), 채팅(권한), 연결, 화면 테마. |

화면 오른쪽 **에이전트** 패널(Windows Ctrl+I, macOS ⌘I)에 "대본을 읽고 인물 프로필을 만들어 줘"처럼 말로 부탁할 수도 있습니다. 프로젝트를 바꾸는 일은 제안 카드로 올라오고, 수락해야 반영됩니다.

### 4. 한 바퀴 해 보기

1. 쇼케이스를 가져오고 연결을 하나 만듭니다.
2. **워크플로**에서 "인물·관계 추출"을 열고, AI 노드에 연결·모델을 고른 뒤 실행합니다. 끝나면 **인물·관계**에 인물과 말투 규칙이 생깁니다.
3. **워크플로 › 번역**으로 장면 하나를 번역합니다. 실행할 때 범위를 장면으로 좁힐 수 있습니다.
4. **대사**에서 번역된 줄을 고르고, 오른쪽 패널의 검증·말투를 보며 고친 뒤 다음 상태로 옮깁니다.
5. **실행 기록**에서 방금 실행이 각 줄을 어떻게 지나갔는지 봅니다.

## 문제가 생기면

- **화면이 예전 모습 그대로일 때:** `pnpm build`를 다시 하고 `pnpm start`. 서버를 켠 터미널에 "웹 빌드가 소스보다 오래됐습니다"가 보이면 이 경우입니다.
- **브라우저가 열리지 않을 때:** `pnpm start`를 켠 터미널에 오류가 있는지 봅니다. 4317 포트를 다른 프로그램이 쓰고 있으면 `WORKBENCH_PORT`로 바꿀 수 있습니다(아래 표).
- **AI 실행이 실패할 때:** **실행 기록**에서 실패한 줄과 AI 호출을 열면 모델이 돌려준 오류가 그대로 보입니다. 설정 › 연결에서 연결 시험도 할 수 있습니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `WORKBENCH_PORT` | 4317 | 프로그램 주소의 포트 |
| `WORKBENCH_DATA_DIR` | `./.workbench` | 데이터(DB)를 두는 폴더 |
| `WORKBENCH_SECRETS` | (운영체제 보관함) | `memory`면 API 키를 메모리에만 둡니다(테스트용) |

---

아래는 개발과 자동화를 위한 내용입니다.

## 개발 모드

```bash
pnpm dev
```

API(4317)와 화면 개발 서버(Vite, 4318)가 함께 뜨고, 소스를 저장하면 다시 읽습니다. 화면은 Vite가 알려 주는 **http://127.0.0.1:4318** 로 엽니다. `localhost:4318`은 쓰지 마세요: 개발 서버는 IPv4(127.0.0.1)에서만 듣는데 Windows의 `localhost`는 IPv6(::1)를 먼저 시도해 요청마다 약 0.3초가 늦어집니다. `pnpm dev` 중의 4317은 API만이라 화면이 예전 빌드일 수 있습니다.

API가 준비되기를 최대 30초 기다리며, 실패하면 API 주소와 서버 로그 확인 안내를 출력합니다. 파일 감시는 Node의 `--watch`를 쓰고, Windows·macOS에서는 `--watch-path`로 서버 소스와 공유 패키지만 감시합니다.

## loca CLI

앱이 켜져 있을 때 터미널에서 대본을 찾고, 점검하고, 파일로 번역을 주고받습니다.

```bash
pnpm loca projects
pnpm loca lines --speaker "Alice" --all
pnpm loca lines --speaker "Alice" --listener "Bob"   # Alice가 Bob에게 한 말 (--listener - 는 청자 미상)
pnpm loca check terms
pnpm loca context tower.1                # AI 노드가 이 대사에 보낼 문맥 (모델 호출 없음)
pnpm loca terms --unreviewed             # 용어집: 나온 줄·표시(#)·태그. usage <용어>는 쓰인 대사
pnpm loca knowledge speech-rules --unreviewed   # 작품 자료(documents|characters|relationships|events|speech-rules)
pnpm loca tags                           # 태그와 기본 표시의 붙는 곳·쓰인 수
pnpm loca plan "기본 번역" -g "<장면>"      # 실행 미리보기: 대사·요청 수·준비 상태 (읽기만)
W=$(pnpm --silent loca workspace new ch1)     # .loca/ch1 작업 폴더 (git에 안 올라감)
pnpm loca export --section "Chapter 1" --untranslated --context 4 --terms -o "$W/ch1.jsonl"
pnpm loca import "$W/ch1.out.jsonl" --dry-run
pnpm loca import "$W/ch1.out.jsonl"     # 제안 1건 → 앱에서 수락하면 반영
```

앱 없이 되는 명령: `loca format schema`(표준 파일 JSON Schema), `loca format check <파일>`(형식 오류·요약·경고),
`loca workspace new|list|clean`(에이전트 임시 파일을 두는 `.loca/`. 가장 가까운 `.loca`, 없으면 git 저장소 루트, 없으면 현재 폴더에 만들고 스스로 git에서 빠집니다. `LOCA_WORKSPACE`로 바꿀 수 있음).

어디서나 `loca`로 쓰려면 `apps/cli`에서 `npm link`. 앱 주소는 `LOCA_URL`, 프로젝트는 `--project` 또는 `LOCA_PROJECT`. 에이전트용 사용법은 [`.claude/skills/`](.claude/skills/README.md).

## 표준 포맷 (`loca/v1`)

게임별 추출기/변환기가 만드는 JSON입니다. 작업실은 게임 내부 구조를 몰라도 됩니다. 스키마의 기준은
[packages/shared/src/import-format.ts](packages/shared/src/import-format.ts)이고, 가져오기 화면과 `loca format check`가 위반 위치를 경로로 알려 줍니다.
변환기를 만드는 절차는 [`.claude/skills/loca-import-format`](.claude/skills/loca-import-format/SKILL.md).

```jsonc
{
  "format": "loca/v1",
  "project": { "name": "…", "sourceLanguage": "en", "targetLanguage": "ko" },
  "groups": [{ "key": "scene-1", "kind": "scene", "title": "…" }],          // scene | document | ui
  "units":  [{ "key": "scene-1.3", "group": "scene-1", "speaker": "MIRA", "source": "…" }],
  "graph": {
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
apps/web        React 19, TanStack Router · DB(브라우저 데이터, 서버의 바뀐 행 피드로 갱신) · Query, shadcn/ui, React Flow(워크플로·인물), Canvas+d3-zoom(원문 그래프)
packages/shared 표준 포맷·워크플로 정의·검증(Zod, graphology), 형식 검사
packages/ai     AI SDK(OpenAI 호환), TypeSafe SDK(System One), CLI 실행(execa). 호출은 한 경로로 한 번(다시 보내기는 워크플로의 재요청 노드가 한다)
scripts         샘플 생성(pnpm samples), 모의 LLM(pnpm mock-llm)
```

검사:

```bash
pnpm typecheck && pnpm test
```

Windows에서도 전체 검사는 `pnpm verify`로 실행합니다. 격리된 데이터와 mock LLM으로 재현하는 방법과 확인 결과는 [Windows 검증 기록](docs/WINDOWS-VALIDATION.md)에 있습니다.
