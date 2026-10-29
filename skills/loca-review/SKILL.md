---
name: loca-review
description: Review translations in a loca project for glossary violations, inconsistent translations of the same source, broken placeholders/tags, overlong UI strings and speech levels that break the speech rules, see what context an AI node sent for a line, and propose fixes in one batch. Use when asked to check, QA, proofread or find problems in loca translations.
---

# loca로 번역 점검하기

공통 규칙(연결, 제안, 권한, 표시, 작업 폴더, 터미널 권한 모드)은 `loca` 스킬을 따릅니다.

## 한 번에 찾기
찾은 게 있으면 종료 코드 1, 없으면 0이라 끝 단계의 게이트로 씁니다(예: `loca check format -g s1 && loca import …`).
```
loca check terms            # 확정 용어를 안 쓴 번역
loca check consistency      # 같은 원문인데 번역이 다른 곳 (#번역 불일치)
loca check format           # 자리표시자·태그·줄바꿈 (프로젝트 서식 규칙 기준)
loca check length --kind ui --ratio 1.5   # 원문보다 1.5배 넘게 긴 UI 문자열
loca check speech           # 화자→청자 말투 규칙과 번역 끝 어미가 다른 곳 (어미로 추정)
```
범위는 `lines`와 같은 필터로 좁힙니다(`--section`, `--speaker`, `--listener`, `--group`, `--status`, `--tag`). speech 결과는 추정이라 짧은 말·인용은 직접 확인합니다. 많으면 `--jsonl`로 작업 폴더(`W=$(loca workspace new review)`)에 받아 읽습니다.

## 번역이 문맥 탓인지 볼 때
`loca context <키>`는 워크플로의 AI 노드가 그 대사를 번역할 때 보내는 문맥을 보여 줍니다: 앞 대사와 갈래, 넣은 항목과 이유, 상한 때문에 뺀 것. `-n <노드 id>`로 다른 노드, `--prompt`로 프롬프트 전문. 모델은 부르지 않습니다. 빠진 용어·말투 규칙·청자가 원인이면 `loca-glossary`·`loca-knowledge`로 자료부터 고칩니다.

## 고치기
1. 문제 줄의 키를 모아 내보냅니다: `loca export --key <키> <키> ... --context 3 --terms -o "$W/fix.jsonl"` (많으면 `--section` 등으로 내보낸 뒤 해당 줄만 고침)
2. `translation`을 고친 새 파일로 `loca import "$W/fix.out.jsonl" --dry-run` → `loca import "$W/fix.out.jsonl"`.
3. 다시 볼 줄에 태그를 붙이려면 같은 줄에 `"addTags":["<대사 태그>"]`, 상태를 바꾸려면 `"status":"<상태 이름>"`. 이름은 `loca tags`, `loca statuses`에서 확인합니다.

같은 문제가 많으면 직접 고치기보다 검수·수정 노드가 있는 워크플로를 돌리는 편이 낫습니다(`loca-workflows`).

## 진행 상황
```
loca stats sections        # 구역별 미번역
loca runs list --since 24  # 최근 실행과 실패가 많은 노드
loca proposals list --status pending
```
