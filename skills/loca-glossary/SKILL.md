---
name: loca-glossary
description: Build and maintain the glossary of a loca project — find where terms are used, catch translations that ignore confirmed terms, collect proper nouns that are missing, and propose terms. Use when asked about terminology, glossary, names of places/organizations, or consistent naming in loca.
---

# loca 용어집 다루기

공통 규칙(연결, 제안, 권한, 표시, 작업 폴더)은 README를 따릅니다. 확정 용어만 번역 문맥에 들어가고, 후보는 들어가지 않습니다.

## 읽기
```
loca terms                         # 원문 → 번역어, 상태, 나온 줄(대본에서 쓰인 대사 수), 표시(#), 태그, id. -q, --mark, --tag, --limit, --jsonl
loca terms --unreviewed            # 확인 안 한 용어(후보 또는 AI 초안): 번역 전에 사람이 볼 목록
loca terms usage <원문|id>          # 그 용어가 쓰인 대사 (앱 용어 창과 같은 낱말 단위 매칭)
loca lines --q "Guild" --all --jsonl   # 임의 글자 검색
loca check terms                   # 확정 용어를 어긴 번역
```
읽기 도구를 직접 쓰면 결과가 길 때 `truncated`가 붙으니 `offset`·`limit`으로 넘깁니다: `loca call list_terms '{"marks":["unused"],"limit":50}'`

## 새 용어 제안
1. 원문에서 반복되는 고유명사(조직·장소·제품·별칭)를 용례와 함께 확인합니다.
2. **후보 상태**로 제안합니다. 확정은 사람이 앱에서 합니다.
   ```
   W=$(loca workspace new glossary)
   loca call save_terms @"$W/terms.json"      # {"terms":[{"source":"Guild","target":"길드","note":"…","status":"candidate"}]}
   ```
   이미 있는 원문(대소문자 무시)이나 한 파일 안 중복은 제안에서 빠지고 이유가 출력됩니다. 먼저 `loca terms -q Guild`로 확인합니다.
3. 이미 있는 용어는 `{"terms":[{"id":"…","target":"새 번역"}]}`처럼 **바꿀 필드만** 넣습니다.
4. 태그: `loca call tag_items '{"kind":"terms","ids":["…"],"add":["<용어 태그>"],"remove":[]}'`. 용어집에 붙는 태그만 붙습니다(`loca tags`). 새 태그 만들기는 `loca-project`.
5. 확정 용어가 바뀌면 그 용어가 쓰인 줄(`loca terms usage`)을 `loca-review` 순서로 고칩니다.

## 비어 있는 번역어 채우기
번역어가 없는 용어(`loca terms --mark emptyTarget`)를 한꺼번에 채우는 일은 용어 입력 워크플로(진입 `input: "terms"`, 기본 "용어 번역")가 합니다. 진입의 용어 조건 기본값은 후보이면서 번역어가 없는 용어입니다. AI 노드(json: `target`, `note`, `kind`, `meaning`; 문맥 `examples`로 용어가 나온 대사를 함께 보냄) → `용어 표기 저장`(`saveTermEntry`, 사람이 채운 칸은 건드리지 않음)으로 잇고, 용어가 아니라고 본 것은 `용어 상태 변경`(`setTermStatus`, rejected)으로 보냅니다. 만드는 법은 `loca-workflows`.
```
loca runs plan 용어 번역                      # 대상 용어 수와 요청 수 (모델은 부르지 않음)
loca runs plan 용어 번역 --term Guild         # 특정 용어만
loca runs start 용어 번역                     # 시작 제안 (앱에서 수락)
```
반영은 제안으로 올라가고(`propose` 기본), 수락한 뒤 `loca terms --unreviewed`로 AI가 채운 것을 사람이 확인합니다.
