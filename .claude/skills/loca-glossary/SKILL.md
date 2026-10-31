---
name: loca-glossary
description: Build and maintain the glossary of a loca project — find where terms are used, catch translations that ignore confirmed terms, collect proper nouns that are missing, and propose terms. Use when asked about terminology, glossary, names of places/organizations, or consistent naming in loca.
---

# loca 용어집 다루기

공통 규칙(연결, 제안, 권한, 표시, 작업 폴더, 터미널 권한 모드)은 `loca` 스킬을 따릅니다. 확정 용어만 번역 문맥에 들어가고, 후보는 들어가지 않습니다. AI가 만든 용어가 바로 확정될지는 프로젝트 설정 `aiAutoConfirm` 하나가 정합니다(`loca-project`).

## 읽기
```
loca terms                         # 원문 → 번역어(다른 번역어 후보, 적용 범위), 상태, 나온 줄(대본에서 쓰인 대사 수), 자동 태그(#), 태그, id. -q, --status, --by, --empty-target, --mark, --tag, --unreviewed, --limit, --jsonl
loca terms --unreviewed            # 확인 안 한 용어(후보 또는 AI가 정한 것): 번역 전에 사람이 볼 목록
loca terms usage <원문|id>          # 그 용어가 쓰인 대사 (앱 용어 창과 같은 낱말 단위 매칭)
loca lines --q "Guild" --all --jsonl   # 임의 글자 검색
loca check terms                   # 확정 용어를 어긴 번역
```
읽기 도구를 직접 쓰면 결과가 길 때 `truncated`가 붙으니 `offset`·`limit`으로 넘깁니다: `loca call list_terms '{"marks":["unused"],"limit":50}'`

## 대본에서 후보 찾기
```
loca terms discover                # 앱의 "대본에서 찾기": 괄호 속 말, 가타카나, 대문자 구, 반복되는 말, 인물 이름을 코드로 찾아 새 것은 후보로 더함 (모델 안 부름)
loca terms --status 후보 --limit 50  # 찾은 후보 보기
```
번역어 채우기는 용어 입력 워크플로(`termTranslate` 프리셋)를 `loca runs start <워크플로> --empty-target --wait`으로 돌리거나, 소량은 아래처럼 직접 제안합니다.

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
번역어가 없는 용어(`loca terms --empty-target`)를 한꺼번에 채우는 일은 용어 입력 워크플로(진입 `input: "terms"`, 기본 "용어 번역")를 `--status 후보 --empty-target` 범위로 실행해서 합니다. AI 노드(json: `target`, `note`; 문맥 `examples`로 용어가 나온 대사를 함께 보냄) → `용어 표기 저장`(`saveTermEntry`, 사람이 채운 칸은 건드리지 않음) 두 단계입니다. 용어가 아닌 후보는 용어집에서 사람이 버립니다. 만드는 법은 `loca-workflows`.
```
loca runs plan 용어 번역 --status 후보 --empty-target    # 대상 용어 수와 요청 수 (모델은 부르지 않음)
loca runs plan 용어 번역 --term Guild                        # 특정 용어만
loca runs start 용어 번역 --status 후보 --empty-target   # 시작 제안 (앱에서 수락)
```
표기를 얻은 후보는 프로젝트 설정 `aiAutoConfirm`에 따라 바로 확정되거나 후보로 남습니다. AI가 채운 것은 `loca terms --unreviewed`로 사람이 확인합니다.

## 번역어 후보와 적용 범위
- 용어의 `target`이 메인 번역어이고, 번역 문맥과 용어 검사에는 메인만 쓰입니다. 다른 번역어는 `targetCandidates`에 남습니다(이전 메인, AI가 낸 다른 표기).
- 메인을 바꾸려면 `save_terms`로 그 후보를 `target`으로 보냅니다. 이전 메인은 후보로 내려갑니다.
- AI 용어 추출이 다른 번역어를 내면: "AI 결과 바로 확정"이 켜져 있고 사람이 정한 메인이 아니면 메인이 되고, 아니면 후보로 들어갑니다.
- 버튼 이름 같은 UI 낱말은 `"scope":["ui"],"matchCase":true`로 두면 대사 속 같은 낱말("help me")에 걸리지 않습니다. 서로 다른 원문이 같은 번역어면 `#번역어 중복`이 붙습니다(알림만).
