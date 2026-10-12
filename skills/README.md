# loca skills

에이전트(Claude Code, Codex, pi 등)가 `loca` CLI로 번역 작업을 할 때 읽는 절차서입니다.

| 스킬 | 언제 |
|---|---|
| `loca-translate` | 장면·구역·인물 단위 번역과 다듬기 (내보내기 → 파일 번역 → 검사 → 제안) |
| `loca-review` | 용어·일관성·형식·길이·말투 규칙 점검과 일괄 수정 |
| `loca-glossary` | 용어 사용처, 위반 점검, 용어 후보 제안 |
| `loca-characters` | 인물 대사 읽기, 프로필·관계·말투 규칙·사건 제안, 대사의 청자 고치기 |
| `loca-import-format` | 게임 추출 결과를 표준 파일(`loca/v1`)로 바꾸는 변환기 만들기와 `loca format check` |

임시 파일은 `loca workspace new <작업>`이 만드는 `.loca/<작업>/`에 둡니다(git에 올라가지 않음).

## 설치
각 폴더를 에이전트의 스킬 폴더에 복사하거나 링크합니다.
- Claude Code: `~/.claude/skills/` (또는 프로젝트의 `.claude/skills/`)
- pi: `~/.pi/agent/skills/`
- Codex: `~/.codex/skills/`

`loca` 명령은 저장소 루트에서 `pnpm loca …`로 쓰거나, `apps/cli`에서 `npm link`로 어디서나 `loca`를 쓰게 할 수 있습니다.
