---
name: loca-translate
description: Translate game script lines in a loca project from the terminal in batches (export JSONL → translate in a file → check → import as one proposal). Use when asked to translate a scene, chapter, character's lines or any set of lines in loca, or to rewrite/polish existing translations in bulk.
---

# loca로 대사 번역하기

공통 규칙(연결, 제안, 권한, 표시, 작업 폴더, 터미널 권한 모드)은 `loca` 스킬을 따릅니다.

## 원칙
- **대사를 하나씩 조회·저장하지 않습니다.** 범위를 한 번에 내보내고, 파일에서 번역하고, 한 번에 돌려보냅니다. 돌려보낸 변경은 제안 1건이 됩니다.
- 대량 초벌은 프로젝트의 워크플로로 돌립니다(AI 노드에 연결과 모델이 정해져 있을 때). 순서는 `loca` 스킬의 "혼자 끝까지"와 `loca-workflows`입니다. 직접 번역은 소량(실패·걸린 줄, 어려운 장면, 다듬기)에 씁니다.

## 순서
1. 작업 폴더와 범위
   ```
   W=$(loca workspace new ch1-translate)
   loca stats sections            # 구역(장)별 미번역 수. 장면 목록은 loca scenes list
   loca lines --section "Chapter 1" --untranslated --limit 5
   ```
2. 내보내기 — 앞 대사 문맥과 확정 용어를 붙입니다.
   ```
   loca export --section "Chapter 1" --untranslated --context 4 --terms -o "$W/ch1.jsonl"
   ```
   한 줄 = 한 대사입니다. 필드:
   - `key`, `rev`, `group`, `speaker`, `source`, `translation`, `marks`
   - `listener`: 알 때만
   - `speechRule`: 그 화자→청자의 확정 말투 규칙, 있을 때만
   - `before`: 앞 대사. AI 노드처럼 대사 그래프를 거슬러 갑니다.
   - `beforeBranches`: 갈래가 합쳐지는 곳이면 `[{label: 선택지, lines}]`. 플레이어는 이 중 한 갈래를 거쳐 오니, 어느 갈래에서 와도 자연스럽게 번역합니다.
   - `terms`: 지켜야 할 용어
   - #청자 미상(`unknownListener`) 줄은 말투를 모르는 줄이니 추측하지 말고 사용자에게 알립니다(고치는 법은 `loca-knowledge`).
   - #번역 불일치(`diverged`)는 같은 원문이 다르게 번역된 줄이니 맞춰 줍니다.
3. 인물 말투가 더 필요하면 `loca call list_characters`, `loca knowledge speech-rules`로 읽습니다.
4. 번역해서 **새 파일**(`$W/ch1.out.jsonl`)에 씁니다. 줄마다 `key`와 `rev`를 그대로 두고 `translation`만 채웁니다(다른 필드는 무시됨).
   - 자리표시자(`{PLAYER_NAME}`)와 태그(`<b>`)는 원문과 같은 개수로 유지합니다.
   - `terms`의 `target`을 반드시 씁니다.
   - `speechRule`이 있으면 그 말투와 호칭을 따릅니다. 인용이거나 다른 사람에게 하는 말이 분명할 때만 예외입니다.
   - 같은 장면 안에서 말투를 일정하게 유지합니다.
5. 검사 → 제안
   ```
   loca import "$W/ch1.out.jsonl" --dry-run      # 오류·충돌·경고만 확인
   loca import "$W/ch1.out.jsonl" --model <번역한 모델 이름>
   ```
   경고(자리표시자, 용어)가 있으면 고쳐서 다시 `--dry-run`. 충돌은 그사이 사람이 고친 줄이라 건너뜁니다(덮어쓰지 않음).
6. 반영됐는지 제안으로 기다리는지(터미널 권한 모드), 몇 줄인지 알립니다. 오류·충돌 줄이 있으면 `import`는 종료 코드 1입니다(나머지 줄은 들어감). 끝나면 `loca workspace clean ch1-translate`.

import 파일의 줄에는 번역 말고도 `status`(상태 이름), `addTags`·`removeTags`(대사에 붙는 태그만), `listener`(사람이 확정한 청자), `translate`(`exclude` 번역에서 뺌 · `include` 번역함 · `null` 규칙대로)를 넣을 수 있습니다. #번역 제외 줄은 내보내기에 나오지 않으니 번역할 필요가 없습니다.

## 대사 그래프의 한 흐름 따라 번역하기
사람이 앱에서 떼어 둔 보기(또는 `loca views create --between <시작키> <끝키>`로 만든 보기)를 범위로 씁니다.
```
loca views show "<보기>"                                    # 흐름 순서, 갈림(⤷)과 합쳐짐(⤶), 선택지 이름
loca export --view "<보기>" --untranslated -c 4 -t -o "$W/flow.jsonl"   # 흐름 순서로, 갈래별 앞 대사와 함께
```
번역·검사·import는 위와 같습니다. 워크플로로 돌릴 때는 `loca runs start <워크플로> --view "<보기>" --wait`.

## 다듬기(이미 번역된 줄)
`--translated`로 내보내고 `translation`을 고친 뒤 같은 방식으로 import합니다. 바뀌지 않은 줄은 자동으로 빠집니다.

앱의 다듬기 버튼과 같은 기준입니다. 기존 번역은 번역가의 것이므로 말과 문체는 그대로 두고, 이유가 있는 곳만 이 순서로 고칩니다: ① 의미(빠지거나 더해지거나 틀린 뜻) ② 규칙(확정 용어, 화자→청자 말투·호칭, 원문 서식, 변수 뒤 조사) ③ 표현(번역투, 어색한 조사·어순, 띄어쓰기·맞춤법). 맞는 줄은 건드리지 않습니다. 사용자에게 알릴 때 줄마다 무엇을 왜 고쳤는지 짧게 적습니다.
