# loca skills

에이전트(Claude Code, Codex 등)가 `loca` CLI로 번역 작업을 할 때 읽는 절차서입니다. 공통 규칙(연결, 터미널 권한 모드, 기다리기·되돌리기, 종료 코드, 작업 폴더)은 **`loca` 스킬**에 있고, 각 `loca-*` 스킬은 자기 일의 순서만 적습니다.

| 스킬 | 언제 |
|---|---|
| `loca` | 공통 규칙, 혼자 끝까지 하는 순서("○○ 초벌 해 줘") |
| `loca-translate` | 장면·구역·인물·대사 그래프 보기 단위 번역과 다듬기 |
| `loca-review` | 용어·일관성·형식·길이·말투 점검과 일괄 수정 |
| `loca-glossary` | 용어 사용처, 위반 점검, 용어 후보 찾기·제안 |
| `loca-knowledge` | 인물·관계·말투 규칙·사건·노트, 청자, 장면 설명 |
| `loca-workflows` | 워크플로 만들기·고치기·시험, 실행·기다리기·이어 하기·실패 다시 하기 |
| `loca-project` | 프로젝트 만들기, 상태·태그와 순서, 서식 규칙, 원문 구조 |
| `loca-import-format` | 게임 추출 결과를 표준 파일(`loca/v1`)로 바꾸는 변환기 |

## 설치
- Claude Code: 스킬이 저장소의 `.claude/skills/`에 있어 저장소를 열면 바로 보입니다(Windows 포함). 다른 프로젝트에서 쓰려면 각 폴더를 `~/.claude/skills/`에 복사하거나 링크합니다.
- Codex 등: 각 폴더를 그 에이전트의 스킬 폴더(예: `~/.codex/skills/`)에 복사하거나 링크합니다. `loca` 스킬도 함께 둡니다.
- `loca` 명령: 저장소 루트에서 `pnpm --silent loca …`로 쓰거나, `apps/cli`에서 `npm link`를 한 번 해서 어디서나 `loca`로 씁니다. `--silent`가 없으면 pnpm이 stdout에 안내 줄을 찍어 `--json` 출력이 깨집니다.
