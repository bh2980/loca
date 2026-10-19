---
name: loca-translate
description: Translate game script lines in a loca project from the terminal in batches (export JSONL → translate in a file → check → import as one proposal). Use when asked to translate a scene, chapter, character's lines or any set of lines in loca, or to rewrite/polish existing translations in bulk.
---

# loca로 대사 번역하기

loca 앱이 켜져 있어야 합니다(기본 `http://127.0.0.1:4317`, 다르면 `LOCA_URL`). 프로젝트가 여럿이면 `--project <이름>` 또는 `LOCA_PROJECT`.

## 원칙
- **대사를 하나씩 조회·저장하지 않습니다.** 범위를 한 번에 내보내고, 파일에서 번역하고, 한 번에 돌려보냅니다.
- **번역문을 채팅 답변에 다시 쓰지 않습니다.** 결과는 파일에만 씁니다. 사용자에게는 몇 줄을 했는지, 무엇이 걸렸는지만 알립니다.
- 파일은 작업 폴더에 둡니다: `W=$(loca workspace new ch1-translate)`. git에 올라가지 않고, 끝나면 `loca workspace clean ch1-translate`로 지웁니다.
- 돌려보낸 변경은 **제안 1건**이 되고, 사용자가 loca 앱에서 수락해야 반영됩니다. 수락 전까지 아무것도 바뀌지 않습니다.
- 대량 번역을 loca의 워크플로로 돌리는 편이 나으면(워크플로의 AI 노드에 연결과 모델이 정해져 있는 경우. `loca workflows list`로 고르고 `loca workflows reference`로 확인) 그렇게 제안하세요: `loca runs start <워크플로> -g <장면>`. 이것도 제안이라 사용자가 앱의 채팅 패널 ‘CLI 제안’에서 수락해야 시작합니다.

## 순서
1. 범위 확인
   ```
   loca stats sections            # 구역(장)별 미번역 수 (장면 목록은 loca scenes list, 한 장면 읽기는 loca scenes show <장면>)
   loca lines --section "Chapter 1" --untranslated --limit 5
   ```
2. 내보내기 — 앞 대사 문맥과 확정 용어를 붙입니다.
   ```
   loca export --section "Chapter 1" --untranslated --context 4 --terms -o "$W/ch1.jsonl"
   ```
   한 줄 = 한 대사: `key`, `rev`, `group`, `speaker`, `listener`(누구에게 하는 말인지, 알 때만), `speechRule`(그 화자→청자의 확정 말투 규칙, 있을 때만), `source`, `translation`, `marks`(#남은 줄·#AI 초안·#청자 미상·#메모·#번역 불일치), `before`(앞 대사), `terms`(지켜야 할 용어).
   `unknownListener`(#청자 미상)가 붙은 줄은 청자(말투)를 모르는 줄이니 추측하지 말고 사용자에게 알립니다. `diverged`(#번역 불일치)는 같은 원문이 다르게 번역된 줄이니 맞춰 줍니다.
   번역 전에 `loca runs plan <워크플로> -g <장면>`으로 준비 상태(확인 안 한 용어·말투 규칙)를 봅니다.
3. 인물 말투가 필요하면 함께 읽습니다: `loca call list_characters`
4. 번역해서 **새 파일**(`$W/ch1.out.jsonl`)에 씁니다. 줄마다 `key`와 `rev`를 그대로 두고 `translation`만 채웁니다. 다른 필드는 남겨도 무시됩니다.
   - `{PLAYER_NAME}` 같은 자리표시자와 `<b>` 같은 태그는 원문과 같은 개수로 유지합니다.
   - `terms`의 `target`을 반드시 씁니다.
   - `speechRule`이 있으면 그 말투(하십시오체·해요체·해체(반말)·해라체 등)와 호칭을 따릅니다. 인용이거나 다른 사람에게 하는 말이 분명할 때만 예외입니다.
   - 같은 장면 안에서 말투를 일정하게 유지합니다.
5. 검사 → 제안
   ```
   loca import "$W/ch1.out.jsonl" --dry-run      # 오류·충돌·경고만 확인
   loca import "$W/ch1.out.jsonl" --model <모델 이름>
   ```
   경고(자리표시자, 용어)가 있으면 고쳐서 다시 `--dry-run`. 충돌은 그사이 사람이 고친 줄이라 건너뜁니다(덮어쓰지 않음).
6. 사용자에게 제안 ID와 요약을 알리고, 수락 여부는 `loca proposals show <id>`로 확인합니다(대기 중인 제안은 `loca proposals list --status pending`). 사용자는 앱의 채팅 패널 ‘CLI 제안’에서 수락합니다.

## 다듬기(이미 번역된 줄)
`--translated`로 내보내고 `translation`을 고친 뒤 같은 방식으로 import합니다. 바뀌지 않은 줄은 자동으로 빠집니다.

앱의 다듬기 버튼과 같은 기준으로 고칩니다. 기존 번역은 번역가의 것이므로 말과 문체는 그대로 두고, 이유가 있는 곳만 이 순서로 고칩니다: ① 의미(빠지거나 더해지거나 틀린 뜻) ② 규칙(확정 용어, 화자→청자 말투·호칭, 원문 서식, 변수 뒤 조사) ③ 표현(번역투, 어색한 조사·어순, 띄어쓰기·맞춤법). 맞는 줄은 건드리지 않습니다(바뀌지 않은 줄은 import에서 빠집니다). 사용자에게 알릴 때 줄마다 무엇을 왜 고쳤는지 짧게 적습니다.
