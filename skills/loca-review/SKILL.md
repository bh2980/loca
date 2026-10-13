---
name: loca-review
description: Review translations in a loca project for glossary violations, inconsistent translations of the same source, broken placeholders/tags and overlong UI strings, and propose fixes in one batch. Use when asked to check, QA, proofread or find problems in loca translations.
---

# loca로 번역 점검하기

## 한 번에 찾기
```
loca check terms            # 확정 용어를 안 쓴 번역
loca check consistency      # 같은 원문인데 번역이 다른 곳
loca check format           # 자리표시자·태그·줄바꿈 (프로젝트 형식 규칙 기준)
loca check length --kind ui --ratio 1.5   # 원문보다 1.5배 넘게 긴 UI 문자열
loca check speech           # 화자→청자의 확정 말투 규칙과 번역 끝 어미가 다른 곳 (어미로 추정)
```
범위는 `lines`와 같은 필터로 좁힙니다(`--section`, `--speaker`, `--listener`, `--group`, `--status`, `--tag` — 태그를 여럿 주면 모두 붙은 대사). speech 결과는 어미로 추정한 것이라 짧은 말·인용은 직접 확인합니다. 많으면 `--jsonl`로 작업 폴더(`W=$(loca workspace new review)`)의 파일에 받아 읽습니다.

## 실행 전 준비 상태
```
loca plan "기본 번역" -g "<장면>"            # 읽기만. 범위: -g 장면, --key 대사, --mark 표시, --tag 태그 (모두 만족)
```
앱 실행 창과 같은 계산입니다: 대사 수, 묶음·AI 요청 수 추정, **준비 상태**(청자 미상 대사 수, 확인 안 한 말투 규칙·용어 이름, 5줄 이상 말하는데 규칙 없는 화자 쌍). 걸린 항목은 고치기 전에 사용자에게 알립니다: `loca lines --mark unknownListener`, `loca terms --unreviewed`, `loca knowledge speech-rules --unreviewed`. 시작은 `start_run` 제안으로만 합니다.

## 줄의 표시
`loca lines`·`line`·`export`(와 `find_lines`)는 줄마다 `marks`를 보입니다: `remaining` 남은 줄 · `ai` AI가 정함 · `unknownListener` 청자 미상 · `noted` 메모 · `diverged` 같은 원문 다른 번역. `--mark`로 같은 조건을 걸 수 있습니다(예: `loca lines --mark diverged ai`는 둘 다 가진 줄).

## 번역이 문맥 탓인지 볼 때
`loca context <키>`는 워크플로의 AI 노드가 그 대사를 번역할 때 보내는 문맥을 보여 줍니다(앞 대사·갈래, 넣은 항목과 이유, 상한 때문에 뺀 것). `-n <노드 id>`로 다른 노드, `--prompt`로 프롬프트 전문. 모델은 부르지 않습니다.

## 고치기
1. 문제 줄의 키를 모아 내보냅니다: `loca export --key <키> <키> ... --context 3 --terms -o "$W/fix.jsonl"`
   (키가 많으면 `--section` 등 필터로 내보낸 뒤 해당 줄만 고칩니다.)
2. `translation`을 고친 새 파일을 만들고 `loca import "$W/fix.out.jsonl" --dry-run` → `loca import "$W/fix.out.jsonl"`.
3. 다시 확인할 줄에 태그를 붙이고 싶으면 같은 파일에 `"addTags":["재검토"]`를 넣습니다. 상태를 바꾸려면 `"status":"사람 확인 필요"`처럼 상태 이름을 씁니다.

## 진행 상황
```
loca stats sections        # 구역별 미번역
loca stats runs --since 24 # 최근 실행: 토큰·실패 호출·실패가 잦은 노드
```
