# loca skills

에이전트(Claude Code, Codex, pi 등)가 `loca` CLI로 번역 작업을 할 때 읽는 절차서입니다.

| 스킬 | 언제 |
|---|---|
| `loca-translate` | 장면·구역·인물 단위 번역과 다듬기 (내보내기 → 파일 번역 → 검사 → 제안) |
| `loca-review` | 용어·일관성·형식·길이·말투 규칙 점검과 일괄 수정 |
| `loca-glossary` | 용어 사용처, 위반 점검, 용어 후보 제안 |
| `loca-characters` | 인물 대사 읽기, 프로필·관계·말투 규칙·사건 제안, 대사의 청자 고치기 |
| `loca-import-format` | 게임 추출 결과를 표준 파일(`loca/v1`)로 바꾸는 변환기 만들기와 `loca format check` |

읽기 명령은 앱 화면과 같은 규칙을 씁니다: 줄의 `marks`(#표시), `loca terms`·`knowledge`·`tags`·`statuses`. 줄의 표시는 앱 이름으로 #남은 줄(`remaining`) · #AI 초안(`ai`) · #청자 미상(`unknownListener`) · #번역 불일치(`diverged`) · #메모(`noted`)입니다. `--mark candidate ai`처럼 후보와 AI 초안을 함께 주면 둘 중 하나, `--unreviewed`는 사람이 아직 안 본 항목입니다.

`--json`은 목록을 항상 `{ total, rows }`로 냅니다(lines, terms, knowledge, check, scenes list, statuses, workflows list, runs list, proposals list, views list). `loca check <종류>`는 찾은 게 있으면 종료 코드 1, 없으면 0이라 번역 끝 단계의 게이트로 쓸 수 있습니다.

임시 파일은 `loca workspace new <작업>`이 만드는 `.loca/<작업>/`에 둡니다(git에 올라가지 않음).

## 설치
각 폴더를 에이전트의 스킬 폴더에 복사하거나 링크합니다.
- Claude Code: `~/.claude/skills/` (또는 프로젝트의 `.claude/skills/`)
- pi: `~/.pi/agent/skills/`
- Codex: `~/.codex/skills/`

`loca` 명령은 저장소 루트에서 `pnpm loca …`로 쓰거나, `apps/cli`에서 `npm link`로 어디서나 `loca`를 쓰게 할 수 있습니다.

## 워크플로·실행·보기
앱의 번역 자동화는 상태 사이에 놓인 워크플로 노드입니다. 노드는 특정 게임이나 이름에 묶이지 않은 일반 노드입니다: AI 노드는 출력 종류를 고릅니다(`text` 글 · `verdict` 판정 · `choice` 선택 · `json` 필드가 있는 JSON), 반영 노드는 결과를 번역·청자·자료 등의 **제안**으로 올리고, 조건 노드는 줄의 데이터(상태, 표시, 청자, 태그, 앞 노드의 출력)를 읽어 갈래를 나눕니다. 노드 종류·출구·조건이 읽는 값·연결된 모델은 `loca workflows reference`에서 확인하고, 만들거나 고치기 전에 읽으세요.
```
loca workflows list                      # 워크플로, 노드 수, 오류 수, 시작의 대상 상태
loca workflows show <워크플로>            # 노드·연결·검증 결과. --json은 {id,name,description,definition,issues}
loca workflows save <파일>               # show --json 파일을 고쳐 제안으로 올림 (id가 있으면 변경)
loca runs plan <워크플로> -g <장면>        # 실행 전 미리보기 (읽기만)
loca runs start <워크플로> -g <장면>       # 시작을 제안으로 올림. 범위: -g · --key · --mark · --tag · --ignore-status · --model
loca runs list · loca runs show <id>     # 최근 실행과 노드별 진행·실패
loca proposals list --status pending     # 수락을 기다리는 제안
loca proposals show <id>                 # 한 제안의 결정 상태
loca views list                          # 대사 그래프의 저장된 보기
loca views create --label "미라와 요나스" -s MIRA JONAS   # 링크 출력
```
`workflows save`와 `runs start`를 포함해 프로젝트를 바꾸는 명령은 모두 제안이 되고, 사용자가 앱의 채팅 패널 ‘CLI 제안’에서 수락해야 반영됩니다. 예외로 `views create`는 제안 없이 바로 저장합니다(번역 데이터는 바꾸지 않고 그래프에 보일 것만 정하며, 앱에서 열 링크를 출력). 옵션은 `-g <장면>`, `-s <화자>`, `--line <키>`, `-q <글자>`, `--between <시작> <끝>`, `--around <n>`, `--mode view|mark`입니다. 도구의 입력 스키마는 `loca tools <이름>`으로 봅니다.

## 에이전트 도구 권한

`loca tools`와 `loca call`은 채팅과 같은 대상별 생성·조회·변경·삭제·실행 권한을 따릅니다. `save_*`에서 `id`가 있으면 변경, 없으면 생성입니다. 대사 권한에서 **생성**은 새 원문 항목(`create_unit`)을 만들고, 번역 후보 추가(`propose_translation`)는 기존 대사의 **변경** 권한을 씁니다. 장면 권한은 장면·문서·UI 묶음의 생성·조회·변경·삭제를, 상태와 태그 권한은 각각 `save_status`·`update_status`·`delete_status` 및 `update_tag`·`delete_tag`를 제어합니다. 워크플로도 생성·조회·변경·삭제·실행 권한이 따로 있습니다.

`find_reading_route`는 대사와 장면 **조회** 권한이 필요합니다. 먼저 `find_lines` 또는 `line_context`로 시작·끝 키를 확인한 다음 `start`와 `end`에 전달하세요. 경로는 키가 속한 대사 노드 전체를 포함하며, 여러 줄 노드의 시작은 첫 줄부터, 끝은 마지막 줄까지입니다. 반환된 앱 링크로 전체 경로를 엽니다.

모든 변경 도구는 `loca call`에서도 먼저 제안으로 기록되며, 대화의 권한 모드에 따라 사용자 결정 또는 자동 반영 절차를 거칩니다. `save_knowledge` 같은 일괄 호출은 항목마다 같은 권한을 요구하고, 금지된 작업이 하나라도 포함되면 반영하지 않습니다. 제안 수락 직전에도 권한을 다시 확인합니다. 목록에서 사라졌거나 거절된 작업을 다른 도구로 우회하지 말고 사용자에게 필요한 대상과 행위를 설명하세요. `list_statuses`와 `list_relationships`로 상태·관계를 각각 조회할 수 있습니다.
