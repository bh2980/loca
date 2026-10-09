---
name: loca-glossary
description: Build and maintain the glossary of a loca project — find where terms are used, catch translations that ignore confirmed terms, collect proper nouns that are missing, and propose terms. Use when asked about terminology, glossary, names of places/organizations, or consistent naming in loca.
---

# loca 용어집 다루기

- 용어 목록: `loca call list_terms` (또는 `'{"q":"Guild"}'`로 좁히기)
- 용어가 쓰인 대사: `loca lines --q "Guild" --all --jsonl`
- 확정 용어를 어긴 번역: `loca check terms`

## 새 용어 제안
1. 후보를 찾습니다. 원문에서 반복되는 고유명사(조직·장소·제품·별칭)를 `loca lines --q <단어>`로 용례와 함께 확인합니다.
2. 용어는 **후보 상태**로 제안합니다. 확정은 사람이 앱에서 합니다.
   ```
   loca call save_terms @"$W/terms.json"      # W=$(loca workspace new glossary)
   ```
   `terms.json`: `{"terms":[{"source":"Guild","target":"길드","note":"…","status":"candidate"}]}`
3. 확정 용어가 바뀌면 그 용어가 쓰인 줄을 `loca-review` 순서로 고칩니다.
