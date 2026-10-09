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
```
범위는 `lines`와 같은 필터로 좁힙니다(`--section`, `--speaker`, `--group`, `--status`, `--tag`). 많으면 `--jsonl`로 작업 폴더(`W=$(loca workspace new review)`)의 파일에 받아 읽습니다.

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
