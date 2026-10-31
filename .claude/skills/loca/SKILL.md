---
name: loca
description: Common rules for working on a loca translation project from the terminal with the `loca` CLI — connecting to the app, how changes are decided (the terminal permission mode), waiting for proposals and runs, undoing, exit codes, output formats and scratch folders. Read it before any other loca-* skill, and whenever asked to translate, check, run a workflow or change anything in loca without the app open.
---

# loca 공통 규칙

`loca`는 loca 앱의 작업 대부분을 터미널에서 합니다. 사람은 앱에서 연결·권한·워크플로를 세팅하고 디버깅할 때 앱을 켭니다. 나머지는 에이전트가 이 CLI로 스스로 판단해 하고, 사용자에게는 채팅으로 결과만 보고합니다.

| 스킬 | 언제 |
|---|---|
| `loca-translate` | 장면·구역·인물·대사 그래프 보기 단위 번역과 다듬기 |
| `loca-review` | 용어·일관성·형식·길이·말투 점검과 일괄 수정 |
| `loca-glossary` | 용어 사용처, 위반 점검, 용어 후보 찾기·제안 |
| `loca-knowledge` | 인물·관계·말투 규칙·사건·노트, 청자, 장면 설명 |
| `loca-workflows` | 워크플로 만들기·고치기·시험, 실행·기다리기·이어 하기·실패 다시 하기 |
| `loca-project` | 프로젝트 만들기, 상태·태그와 순서, 서식 규칙, 원문 구조 |
| `loca-import-format` | 게임 추출 결과를 표준 파일(`loca/v1`)로 바꾸는 변환기 |

## 연결
- loca 앱(서버)이 켜져 있어야 합니다. 화면(브라우저)은 꺼져 있어도 됩니다. 기본 주소는 `http://127.0.0.1:4317`이고, 다르면 `--url` 또는 `LOCA_URL`을 씁니다.
- 프로젝트가 여럿이면 `--project <이름|id>` 또는 `LOCA_PROJECT`를 씁니다. `loca projects`로 목록을 봅니다.
- `loca format …`과 `loca workspace …`만 앱 없이 됩니다.
- 실행 방법:
  - 저장소 루트에서 `pnpm --silent loca …`. `--silent`가 없으면 pnpm이 stdout에 안내 줄을 찍어 `--json`이 깨집니다.
  - 또는 `apps/cli`에서 `npm link`를 한 번 하면 어디서나 `loca`로 씁니다.

## 바꾸는 일과 터미널 권한 모드
- 프로젝트를 바꾸는 명령은 모두 같은 관문을 지납니다: `import`, `call`의 변경 도구, `workflows save`, `runs start/resume/continue`, `terms discover`, `statuses order` 등.
- 관문은 앱의 설정 › 채팅 › **터미널 권한 모드**를 따릅니다. 사람이 정하고, 에이전트는 바꿀 수 없습니다.
  - **수락/거절**: 제안으로 기다립니다. 사람이 앱의 채팅 패널 ‘제안’에서 수락해야 반영됩니다.
  - **자동 검토**: 검사를 통과한 작은 변경(20개 이하, 경고 없음)은 바로 반영합니다. 실행(AI 비용), 삭제, 큰 변경, 경고가 있는 변경은 제안으로 기다립니다.
  - **바로 반영**: 허용된 작업을 바로 반영합니다. 실행도 바로 시작합니다.
- 어느 쪽이 됐는지는 명령 출력이 말합니다.
  - `…: 반영했습니다 (<id>, 터미널 권한 모드)`: 이미 반영됐습니다.
  - `…: 제안으로 올렸습니다 (<id>)`: 사람의 결정을 기다립니다.
  - `--json`이면 `{proposalId, applied, status}`가 나옵니다.
- 지금 모드는 `loca call read_project_settings`의 `agentSettings.terminalPermissionMode`에 있습니다.
- 반영되든 기다리든 모든 변경은 제안 기록에 남고, 사람이 앱에서 보고 되돌릴 수 있습니다.
- 기다리기:
  - 제안은 `loca proposals wait <id>`로 기다립니다(거절·실패면 종료 코드 1).
  - 실행은 `--wait`으로 기다립니다(`loca-workflows`).
  - 둘 다 앱의 변경 알림을 받아 기다리니 직접 반복 조회하지 않습니다. 오래 걸리면 `--timeout <분>`을 씁니다.
- 되돌리기: `loca proposals undo <id...>`. 터미널 권한 모드가 반영한 것만 되돌리고, 사람이 수락한 제안은 앱에서 되돌립니다. 모드가 수락/거절이면 되돌리기도 사람이 앱에서 합니다.
- 목록: `loca proposals list --status pending`으로 기다리는 제안을, `loca proposals show <id>`로 결과를 봅니다.
- 예외: `loca views create/update/delete`는 번역 데이터가 아니라 그래프에 보일 노드만 저장하므로 바로 저장되고, `loca projects import`는 있던 프로젝트를 건드리지 않고 새로 만들므로 바로 됩니다.
- 실행 일시정지·취소(`loca runs pause/cancel`)는 비용이 들지 않아 모드와 상관없이 바로 됩니다.

## 권한
- `loca tools`·`loca call`은 앱의 설정 › 채팅 › 도구 권한을 따릅니다(대상별 생성·조회·변경·삭제·실행).
- **삭제는 기본으로 꺼져 있어** 삭제 도구가 `loca tools` 목록에 아예 없을 수 있습니다. 목록에 없거나 거절된 작업은 다른 도구로 우회하지 말고, 필요한 대상과 행위를 사용자에게 말해 켜 달라고 합니다.
- 도구의 입력 형식은 `loca tools <이름>`으로 봅니다. `save_*` 도구는 `id`가 있으면 그 항목의 보낸 필드만 바꾸고, 없으면 새로 만듭니다.

## 사람만 하는 것
- 연결 추가와 API 키·로그인. `loca connections`는 목록과 시험만 합니다.
- 채팅·도구 권한과 터미널 권한 모드
- 홈 기본값 고치기, 저장한 지시 고치기
- 프로젝트 삭제
- 자료·용어를 "사람이 확인함"으로 표시하기
- "수락/거절" 모드에서 제안 결정

이런 일이 필요하면 무엇을 왜 해야 하는지 사용자에게 말합니다.

## 자동 태그(#), 필터, 상태
읽기 명령은 앱 화면과 같은 규칙을 씁니다. 앱이 스스로 붙이는 자동 태그는 줄이나 항목의 다른 칸에 보이지 않는 사실만입니다(`--mark`).

| 어디 | 자동 태그 |
|---|---|
| 대사 | `diverged` #번역 불일치 · `aiSuggestion` #AI 제안 대기 |
| 자료 | `review` #확인 권장 · `noEvidence` #근거 부재 |
| 용어 | `unused` #대본 미등장 · `duplicateTarget` #번역어 중복 |

줄이나 항목에 이미 보이는 사실은 그 칸의 필터로 겁니다.

| 무엇 | 대사 (`lines`·`export`·`check`·`runs`) | 용어 (`terms`·`runs`) | 자료 (`knowledge`) |
|---|---|---|---|
| 상태가 최종 아님 (남은 일) / 최종 | `--unfinished` / `--finished` | | |
| 정한 쪽: AI가 정하고 사람이 아직 안 봄(✦) / 사람 | `--by ai` / `--by human` | `--by ai` / `--by human` | `--by ai` / `--by human` |
| 청자 모름 (청자를 모르거나 AI 추정이 불확실) | `--listener -` | | |
| 메모 있음 / 없음 | `--noted` / `--without-note` | | |
| 번역 제외 뺌 / 그것만 | `--excluded hide` / `--excluded only` | | |
| 번역어 비어 있음 / 있음 | | `--empty-target` / `--has-target` | |

- **번역 제외**는 번역 대상이 아닌 줄입니다: 빈 원문, 서식만 있는 줄, 글자 없는 줄, 프로젝트의 제외 규칙에 걸린 줄, 사람이 직접 뺀 줄. 진행률·최종 아님·실행·`export --untranslated`/`--translated`·`check`에서 빠지고, 번역은 건드리지 않습니다. `loca lines`는 상태 옆에 `· 번역 제외`, AI가 정한 상태에 `✦`를 붙여 보여 줍니다.
- **#AI 제안 대기**는 AI가 낸 번역이 사람의 적용·거절을 기다리는 줄입니다: 사람이 번역한 줄에 실행이 낸 번역(그 줄의 번역은 바뀌지 않음), `propose_translation`으로 올린 제안. 사람이 줄 상세의 "AI 제안"에서 적용하거나 거절하고, 에이전트는 사용자가 시킬 때만 `loca call decide_suggestion`(`{unitId, candidateId, decision: apply|decline}`, 제안의 id는 `loca call read_line`의 `suggestions`)으로 정합니다. 줄이 전에 가졌던 번역은 `history`에 있습니다.
- 자동 태그를 걸 때는 `--mark`를 씁니다. 반대로 빼려면 `--hide-mark`·`--hide-tag`·`--hide-status`·`--hide-speaker`를 씁니다(하나라도 해당하면 뺌).
- 앱의 대사 목록은 번역 제외를 기본으로 숨깁니다(필터 바의 숨김 칩). CLI의 `lines`는 숨기지 않으니 필요하면 `--excluded hide`를 붙입니다.
- 자동 태그를 여러 개 주면 모두 만족해야 합니다. 모든 필터는 함께 주면 모두 만족해야 합니다.
- `--unreviewed`는 사람이 아직 안 본 것(후보 또는 AI가 정한 것)입니다.
- 자료·용어의 상태:
  - `status`: confirmed(번역 문맥에 쓰임) · candidate(아직 안 쓰임)
  - `statusBy`: ai(AI가 정했고 사람이 안 봄) · human
- 대사 상태와 태그는 프로젝트마다 다르니 `loca statuses`, `loca tags`로 확인합니다. 태그는 붙는 곳(대사·자료·용어집)에만 붙습니다.

## 범위: 대사 그래프 보기
- 사람이 앱에서 떼어 둔 대사 그래프의 일부(저장된 보기)는 `--view <이름|id>`로 범위가 됩니다: `lines`, `export`, `check`, `runs plan/start`.
- 에이전트가 직접 만들 수도 있습니다: `loca views create --label … --between <시작키> <끝키>`(두 대사 사이의 모든 경로), `-g` 장면, `-s` 인물.
- `loca views show <보기>`는 보기를 흐름 순서로 보여 줍니다. 갈림과 합쳐짐, 선택지 이름이 함께 나옵니다.

## 출력과 종료 코드
- `--json`은 목록을 항상 `{ total, rows }`로 냅니다. 많으면 `--jsonl`이나 `--all`로 파일에 받아 읽습니다. 안내문은 stderr로 나가니 stdout만 파싱합니다.
- 종료 코드 1인 경우:
  - `loca check <종류>`: 찾은 것이 있을 때. 끝 단계의 게이트로 씁니다.
  - `loca import`: 오류·충돌 줄이 있을 때(나머지 줄은 들어감)
  - `loca runs wait/show`: 실행이 깨끗하게 끝나지 않았을 때(실패, 오류 출구로 빠진 줄, 일시정지, 취소)
  - `loca proposals wait`: 거절·실패일 때
- 임시 파일은 `W=$(loca workspace new <작업>)`이 만드는 `.loca/<작업>/`에 둡니다(git에 올라가지 않음). 끝나면 `loca workspace clean <작업>`으로 지웁니다.
- 번역문이나 긴 결과를 채팅 답변에 다시 쓰지 않습니다. 결과는 파일과 프로젝트에 있으니, 사용자에게는 몇 개를 했는지, 걸린 것, 사람이 결정할 것만 알립니다.

## 이름을 지어 부르지 않기
워크플로·상태·태그·연결 이름은 프로젝트마다 사용자가 정합니다. 문서의 예시 이름을 그대로 쓰지 말고 `loca workflows list`, `loca statuses`, `loca tags`, `loca connections`로 실제 이름을 확인한 뒤 씁니다.

## 혼자 끝까지: "○○ 초벌 해 줘"
1. `loca workflows list`로 워크플로를 고르고, `loca runs plan <워크플로> <범위>`로 미리 봅니다. 범위 예: `--section "Chapter 2"`, `-g <장면>`, `--view <보기>`.
   - 준비 상태(청자 미상, 후보 말투 규칙·용어)에 걸린 것은 고칠 수 있으면 고칩니다(`loca-knowledge`, `loca-glossary`). 못 고치면 보고에 넣습니다.
2. `loca runs start <워크플로> <범위> --wait`으로 실행합니다. 모드가 "수락/거절"이면 수락을 기다린다고 사용자에게 한 줄 알립니다.
3. 요약이 실패나 "오류로 빠진 줄"을 말하면 다시 합니다.
   - 실패한 줄: `loca runs continue <id> --retry-failed --wait`
   - 오류로 빠진 줄: `loca runs start <워크플로> --rerun-errors <id> --wait`. 같은 원인(연결 끊김 등)이 되풀이되면 `--model`로 다른 모델을 쓰거나 사용자에게 알립니다.
4. 점검합니다: `loca check terms|format|consistency <범위>`. 걸린 줄은 `loca-review`로 고칩니다.
5. 보고: 몇 줄이 초벌됐는지, 남은 문제(실패·검토 필요·점검 결과)와 사람이 결정할 것을 짧게 알립니다.

## 설치
- Claude Code: 스킬이 이 저장소의 `.claude/skills/`에 있어 저장소를 열면 바로 보입니다(Windows 포함). 다른 곳에서 쓰려면 각 폴더를 `~/.claude/skills/`에 복사하거나 링크합니다.
- Codex 등: 각 폴더를 그 에이전트의 스킬 폴더(예: `~/.codex/skills/`)에 복사하거나 링크합니다.
