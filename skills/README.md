# loca skills

에이전트(Claude Code, Codex, pi 등)가 `loca` CLI로 번역 작업을 할 때 읽는 절차서입니다. 아래 **공통 규칙**은 모든 스킬에 적용되고, 각 스킬은 자기 일의 순서만 적습니다.

| 스킬 | 언제 |
|---|---|
| `loca-translate` | 장면·구역·인물 단위 번역과 다듬기 (내보내기 → 파일 번역 → 검사 → 제안) |
| `loca-review` | 용어·일관성·형식·길이·말투 점검과 일괄 수정, 번역이 문맥 탓인지 보기 |
| `loca-glossary` | 용어 사용처, 위반 점검, 용어 후보 제안 |
| `loca-knowledge` | 인물·관계·말투 규칙·사건·문서 읽기와 제안, 대사의 청자 정하기, 장면 설명 |
| `loca-workflows` | 워크플로 만들기·고치기(노드, AI 출력·필드, 조건, 반영), 실행 미리보기·시작, 실패 원인 보기 |
| `loca-project` | 프로젝트 설정: 상태·태그, 서식 규칙, 장면·원문 추가와 수정 |
| `loca-import-format` | 게임 추출 결과를 표준 파일(`loca/v1`)로 바꾸는 변환기 만들기와 `loca format check` |

## 공통 규칙

### 연결
loca 앱이 켜져 있어야 합니다(기본 `http://127.0.0.1:4317`, 다르면 `--url` 또는 `LOCA_URL`). 프로젝트가 여럿이면 `--project <이름>` 또는 `LOCA_PROJECT`. `loca format …`과 `loca workspace …`만 앱 없이 됩니다.

### 바꾸는 일은 모두 제안
프로젝트를 바꾸는 명령(`import`, `call`의 변경 도구, `workflows save`, `runs start`)은 바로 반영되지 않고 **제안**이 됩니다. 사용자가 앱의 채팅 패널 ‘CLI 제안’에서 수락해야 반영됩니다. 제안을 올린 뒤에는 제안 ID와 요약을 알리고, 결과는 `loca proposals show <id>`, 기다리는 제안은 `loca proposals list --status pending`으로 봅니다. 예외는 `loca views create` 하나입니다(번역 데이터는 바꾸지 않고 그래프에 보일 노드만 저장).

### 권한
`loca tools`·`loca call`은 앱의 설정 › 채팅 › 도구 권한을 따릅니다(대상별 생성·조회·변경·삭제·실행). **삭제는 기본으로 꺼져 있어** 삭제 도구가 `loca tools` 목록에 아예 없을 수 있습니다. 목록에 없거나 거절된 작업을 다른 도구로 우회하지 말고, 필요한 대상과 행위를 사용자에게 말해 켜 달라고 합니다. 도구의 입력 형식은 `loca tools <이름>`으로 봅니다. `save_*` 도구는 `id`가 있으면 그 항목의 보낸 필드만 바꾸고, 없으면 새로 만듭니다.

### 표시(#)와 상태
읽기 명령은 앱 화면과 같은 규칙을 씁니다. 앱이 자동으로 붙이는 표시는 이렇습니다.

| 어디 | 표시 |
|---|---|
| 대사 | `remaining` #남은 줄 · `ai` #AI 초안 · `unknownListener` #청자 미상 · `diverged` #번역 불일치 · `noted` #메모 · `excluded` #번역 제외 |
| 자료 | `candidate` 후보 · `ai` #AI 초안 · `noEvidence` #근거 부재 |
| 용어 | `candidate` 후보 · `ai` #AI 초안 · `emptyTarget` #번역 누락 · `unused` #대본 미등장 |

#번역 제외는 번역 대상이 아닌 줄(빈 원문, 서식만, 글자 없음, 프로젝트의 제외 규칙, 사람이 직접 뺀 줄)입니다. 진행률·#남은 줄·실행·`export --untranslated`/`--translated`·`check`에서 빠지고 번역은 건드리지 않습니다. `--mark`로 같은 조건을 겁니다. 반대로 빼려면 `--hide-mark`·`--hide-tag`·`--hide-status`·`--hide-speaker`(하나라도 해당하면 뺌)를 씁니다. 앱의 대사 목록은 #번역 제외를 기본으로 숨기고(필터 바의 숨김 칩), CLI의 `lines`는 숨기지 않으니 필요하면 `--hide-mark excluded`를 붙입니다. 여러 표시는 모두 만족이지만 `candidate`와 `ai`를 함께 주면 둘 중 하나입니다. `--unreviewed`는 사람이 아직 안 본 것(후보 또는 AI 초안)입니다. 자료·용어의 `status`는 confirmed(번역 문맥에 쓰임)·candidate(아직 안 쓰임), `statusBy`는 ai(AI가 정했고 사람이 안 봄)·human입니다. 대사 상태와 태그는 프로젝트마다 다르니 `loca statuses`, `loca tags`로 확인합니다. 태그는 붙는 곳(대사·자료·용어집)에만 붙습니다.

### 출력과 파일
- `--json`은 목록을 항상 `{ total, rows }`로 냅니다. 많으면 `--jsonl`이나 `--all`로 파일에 받아 읽습니다.
- `loca check <종류>`는 찾은 게 있으면 종료 코드 1이라 끝 단계의 게이트로 씁니다.
- 임시 파일은 `W=$(loca workspace new <작업>)`이 만드는 `.loca/<작업>/`에 두고(git에 올라가지 않음), 끝나면 `loca workspace clean <작업>`으로 지웁니다.
- 번역문이나 긴 결과를 채팅 답변에 다시 쓰지 않습니다. 결과는 파일과 제안에 있고, 사용자에게는 몇 개를 했는지와 걸린 것만 알립니다.

### 이름을 지어 부르지 않기
워크플로·상태·태그·연결 이름은 프로젝트마다 사용자가 정합니다. 문서의 예시 이름을 그대로 쓰지 말고 `loca workflows list`, `loca statuses`, `loca tags`, `loca workflows reference`(연결된 모델)로 실제 이름을 확인한 뒤 씁니다.

## 설치
각 폴더를 에이전트의 스킬 폴더에 복사하거나 링크합니다.
- Claude Code: `~/.claude/skills/` (또는 프로젝트의 `.claude/skills/`)
- pi: `~/.pi/agent/skills/`
- Codex: `~/.codex/skills/`

`loca` 명령은 저장소 루트에서 `pnpm loca …`로 쓰거나, `apps/cli`에서 `npm link`로 어디서나 `loca`를 쓰게 할 수 있습니다. 스킬은 README의 공통 규칙을 전제로 하니 README도 함께 둡니다.
