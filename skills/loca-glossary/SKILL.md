---
name: loca-glossary
description: Build and maintain the glossary of a loca project — find where terms are used, catch translations that ignore confirmed terms, collect proper nouns that are missing, and propose terms. Use when asked about terminology, glossary, names of places/organizations, or consistent naming in loca.
---

# loca 용어집 다루기

- 용어 목록: `loca terms` (`-q Guild`, `--mark …`, `--tag …`, `--limit`, `--jsonl`). 줄마다 원문 → 번역어, 상태(후보/확정), **나온 줄**(대본에서 그 용어가 쓰인 대사 수), 표시(#), 태그, id. 앱 용어집 화면의 필터와 같은 규칙이다.
  - 표시: `candidate`(후보, 아직 번역 문맥에 안 쓰임) · `ai`(#AI 초안: AI가 정했고 사람이 안 봄) · `emptyTarget`(번역어 없음) · `unused`(대본에 안 나옴). `--mark candidate ai`는 **둘 중 하나**, 다른 표시끼리는 모두 만족.
  - **확인 안 한 용어**: `loca terms --unreviewed` (= 후보 또는 AI 초안). 번역하기 전에 사람이 볼 목록이다.
- 용어가 쓰인 대사: `loca terms usage <원문|id> [--limit n] [--jsonl]` (앱 용어 창의 사용처와 같은 낱말 단위 매칭). 임의 글자 검색은 `loca lines --q "Guild" --all --jsonl`
- 확정 용어를 어긴 번역: `loca check terms`
- 읽기 도구로 직접: `loca call list_terms '{"marks":["unused"],"limit":50}'`. 결과가 길면 `truncated`가 붙으니 `offset`·`limit`으로 넘긴다

## 새 용어 제안
1. 후보를 찾습니다. 원문에서 반복되는 고유명사(조직·장소·제품·별칭)를 `loca lines --q <단어>`로 용례와 함께 확인합니다.
2. 용어는 **후보 상태**로 제안합니다. 확정은 사람이 앱에서 합니다.
   ```
   loca call save_terms @"$W/terms.json"      # W=$(loca workspace new glossary)
   ```
   `terms.json`: `{"terms":[{"source":"Guild","target":"길드","note":"…","status":"candidate"}]}`
   이미 있는 원문(대소문자 무시)이나 한 파일 안 중복은 제안에서 빠지고 `뺌  Guild: 이미 있는 용어입니다: …`로 이유가 출력됩니다. 먼저 `loca terms -q Guild`로 확인하세요.
3. 이미 있는 용어를 고칠 때는 `{"terms":[{"id":"…","target":"새 번역"}]}`처럼 **바꿀 필드만** 넣습니다. 넣지 않은 필드(상태·메모 등)는 그대로입니다.
4. 용어에 태그를 붙이거나 뗄 때는 `loca call tag_items '{"kind":"terms","ids":["…"],"add":["지명"],"remove":[]}'`. 용어집에 붙을 수 있는 태그만 붙습니다(`loca tags`로 붙는 곳 확인). 새 태그는 `loca call save_status '{"type":"tag","name":"지명","scope":["terms"]}'`.
5. 확정 용어가 바뀌면 그 용어가 쓰인 줄을 `loca-review` 순서로 고칩니다.
