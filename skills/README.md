# loca skills

에이전트(Claude Code, Codex, pi 등)가 `loca` CLI로 번역 작업을 할 때 읽는 절차서입니다.

| 스킬 | 언제 |
|---|---|
| `loca-translate` | 장면·구역·인물 단위 번역과 다듬기 (내보내기 → 파일 번역 → 검사 → 제안) |
| `loca-review` | 용어·일관성·형식·길이·말투 규칙 점검과 일괄 수정 |
| `loca-glossary` | 용어 사용처, 위반 점검, 용어 후보 제안 |
| `loca-characters` | 인물 대사 읽기, 프로필·관계·말투 규칙·사건 제안, 대사의 청자 고치기 |
| `loca-import-format` | 게임 추출 결과를 표준 파일(`loca/v1`)로 바꾸는 변환기 만들기와 `loca format check` |

읽기 명령은 앱 화면과 같은 규칙을 씁니다: 줄의 `marks`(#표시), `loca terms`·`knowledge`·`tags`·`plan`. `--mark candidate ai`처럼 후보와 AI가 정함을 함께 주면 둘 중 하나, `--unreviewed`는 사람이 아직 안 본 항목입니다.

임시 파일은 `loca workspace new <작업>`이 만드는 `.loca/<작업>/`에 둡니다(git에 올라가지 않음).

## 설치
각 폴더를 에이전트의 스킬 폴더에 복사하거나 링크합니다.
- Claude Code: `~/.claude/skills/` (또는 프로젝트의 `.claude/skills/`)
- pi: `~/.pi/agent/skills/`
- Codex: `~/.codex/skills/`

`loca` 명령은 저장소 루트에서 `pnpm loca …`로 쓰거나, `apps/cli`에서 `npm link`로 어디서나 `loca`를 쓰게 할 수 있습니다.

## 에이전트 도구 권한

`loca tools`와 `loca call`은 채팅과 같은 대상별 생성·조회·변경·삭제·실행 권한을 따릅니다. `save_*`에서 `id`가 있으면 변경, 없으면 생성입니다. 대사 권한에서 **생성**은 새 원문 항목(`create_unit`)을 만들고, 번역 후보 추가(`propose_translation`)는 기존 대사의 **변경** 권한을 씁니다. 장면 권한은 장면·문서·UI 묶음의 생성·조회·변경·삭제를, 상태와 태그 권한은 각각 `save_status`·`update_status`·`delete_status` 및 `update_tag`·`delete_tag`를 제어합니다. 워크플로도 생성·조회·변경·삭제·실행 권한이 따로 있습니다.

`find_reading_route`는 대사와 장면 **조회** 권한이 필요합니다. 먼저 `find_lines` 또는 `line_context`로 시작·끝 키를 확인한 다음 `start`와 `end`에 전달하세요. 경로는 키가 속한 대사 노드 전체를 포함하며, 여러 줄 노드의 시작은 첫 줄부터, 끝은 마지막 줄까지입니다. 반환된 앱 링크로 전체 경로를 엽니다.

모든 변경 도구는 `loca call`에서도 먼저 제안으로 기록되며, 대화의 권한 모드에 따라 사용자 결정 또는 자동 반영 절차를 거칩니다. `save_knowledge` 같은 일괄 호출은 항목마다 같은 권한을 요구하고, 금지된 작업이 하나라도 포함되면 반영하지 않습니다. 제안 수락 직전에도 권한을 다시 확인합니다. 목록에서 사라졌거나 거절된 작업을 다른 도구로 우회하지 말고 사용자에게 필요한 대상과 행위를 설명하세요. `list_statuses`와 `list_relationships`로 상태·관계를 각각 조회할 수 있습니다.
