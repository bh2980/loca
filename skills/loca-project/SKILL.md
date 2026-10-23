---
name: loca-project
description: Set up and maintain a loca project's own structure and settings — translation statuses, tags and where they apply, format rules (placeholders and custom patterns the format check keeps), AI confirmation and editor AI settings, and the script's groups and source lines (add or fix scenes, document groups, UI groups and lines). Use when asked to add or change a status or tag, change format rules or project settings, or add/edit/move source text in loca.
---

# loca 프로젝트 설정과 원문 구조

공통 규칙(연결, 제안, 권한)은 README를 따릅니다. 아래 도구는 모두 `loca call <도구> <입력>`으로 부르고, 바꾸는 도구는 제안이 됩니다. 입력 형식은 `loca tools <도구>`로 먼저 봅니다.

## 상태
번역 상태는 사용자가 정합니다. 종류는 `initial`(시작) · `normal`(중간) · `final`(최종)이고, 시작과 최종은 하나 이상 남아야 합니다. `inReview`가 켜진 상태의 대사는 검토함에 모입니다.
```
loca statuses                                    # 이름, 종류, 순서, 검토함 표시, id
loca call save_status '{"type":"status","name":"사람 확인","kind":"normal"}'
loca call update_status '{"id":"…","inReview":true}'
loca call delete_status '{"ids":["…","…"],"moveTo":"<남길 상태 id>"}'   # 여러 개를 한 번에. 대사는 moveTo로 옮김
```
- 최종 상태로 바꾸거나 옮길 때 번역이 빈 대사가 있으면 거절됩니다.
- 지운 상태를 쓰던 워크플로 노드는 검증에 실패하니, 지운 뒤 `loca workflows list`의 오류 수를 확인하고 `loca-workflows`로 고칩니다.
- 순서는 앱의 설정 › 상태·태그에서 끌어서 바꿉니다(CLI 없음).

## 태그
태그는 붙는 곳(`scope`)에만 붙습니다: `lines` 대사 · `terms` 용어집 · `people` 인물·관계 · `events` 사건 · `documents` 노트 (`knowledge`는 people·documents·events 셋). 앱 기본 태그(문제 유형, 확인 권장)는 검사가 아니라 워크플로의 태그 붙이기 노드가 붙이고(처음 붙일 때 만들어짐), 번역문이 바뀌면 문제 유형은 떨어집니다. 이 태그는 이름·붙는 곳을 바꾸거나 지울 수 없고 색만 바꿀 수 있습니다.
```
loca tags                                        # 태그와 기본 표시의 붙는 곳, 색, 쓰인 수
loca call save_status '{"type":"tag","name":"지명","scope":["terms"]}'
loca call update_tag '{"id":"…","scope":["terms","documents"]}'   # 이미 붙은 곳은 떼기 전엔 뺄 수 없음
loca call delete_tag '{"ids":["…"]}'               # 붙어 있던 곳에서도 함께 떨어짐
```
- 대사에 붙이고 떼기는 import 파일의 `addTags`·`removeTags`(`loca-translate`), 용어·자료에는 `tag_items`(`loca-glossary`, `loca-knowledge`).
- 순서는 앱에서 끌어서 바꿉니다.

## 저장한 지시
앱 설정 › 채팅에서 사용자가 프로젝트마다 저장해 두는 프롬프트(이름과 내용)입니다. 사용자가 채팅 입력창의 `/` 목록(워크플로 아래 ‘저장한 지시’)에서 골라 입력창에 채우는 용도이고, 이 CLI·스킬에서 실행하거나 바꾸지 않습니다. 읽기만 합니다. 내용에 `{대상}`이 있으면 고를 때 그 자리에서 `@` 첨부 목록이 열려, 사용자가 고른 항목(대사·장면·인물·관계·말투 규칙·사건·노트·용어·태그·상태·워크플로·실행 기록)이 메시지에 칩으로 붙고 그 자리는 항목의 짧은 이름이 됩니다. 앱에 박힌 `/` 명령은 없고, `/워크플로이름`은 그 워크플로를 사용자가 고른 대상으로 실행하는 확인 카드를 띄웁니다(비용이 드는 일이라 사용자가 [실행]을 눌러야 시작).
```
loca prompts                                     # 저장한 지시의 이름과 내용; 채팅 / 목록에서 고르고, {대상} 자리는 @로 고름 (--json: {total, rows})
```
- 사용자가 "저장한 지시"나 `/이름`을 말하면 이 목록에서 내용을 찾아 그 지시대로 합니다. 만들기·고치기는 앱 설정에서 사용자가 합니다.

## 번역 제외
추출된 원문 중 번역 대상이 아닌 줄(빈 원문, 서식만, 숫자·기호뿐…)은 #번역 제외가 붙어 진행률·실행·내보내기·검사에서 빠집니다. 번역은 건드리지 않습니다.
```
loca lines --mark excluded --limit 20               # 지금 빠진 줄
loca call read_project_settings                     # exclusionRules: empty, formatOnly, noLetters, noSourceScript(기본 끔), patterns
```
- 규칙은 `update_project_settings`의 `exclusionRules`로 바꿉니다(통째로). 예: 개발용 키를 빼려면 `patterns`에 `{"label":"키","pattern":"^[A-Z0-9_]+$"}`.
- 한 줄씩은 import 파일 줄에 `"translate":"exclude"`(뺌) · `"include"`(규칙과 상관없이 번역) · `null`(규칙대로)을 넣습니다(`loca-translate`의 import).
- 규칙을 바꾸기 전후로 `loca lines --mark excluded`를 비교해 번역해야 할 줄이 빠지지 않았는지 사용자에게 보여 줍니다.

## 서식 규칙과 프로젝트 설정
```
loca call read_project_settings                  # 이름, 설명, formatRules, aiAutoConfirm, editorAi, markColors
loca call update_project_settings @"$W/settings.json"
```
- 보낸 항목은 **통째로 바뀝니다.** 먼저 읽고, 바꿀 객체(예: `formatRules`) 전체를 고쳐서 보냅니다.
- `formatRules`: 형식 검사가 지키는 자리표시자 프리셋(중괄호 변수, printf, 마크업 태그 등)과 직접 만든 패턴. 바꾼 뒤 `loca check format`으로 결과가 기대대로인지 봅니다.
- `aiAutoConfirm`(앱: 설정 › 프로젝트 › AI 문맥): AI가 만든 용어·자료를 바로 확정할지(true, 기본) 후보로 둘지(false). 문맥에는 확정된 용어·자료만 들어갑니다. 대사의 상태는 바꾸지 않습니다(대사 상태는 사람이나 워크플로의 상태 변경 노드만 바꿈). 사용자가 정하는 설정이니 묻고 바꿉니다.
- `editorAi`: 편집기 AI. AI 번역·다듬기 버튼은 `model`(CLI 연결도 됨), `context`(함께 보낼 것)를 같이 쓰고, `translate`·`refine`에는 각자의 `instructions`·`include`만 있습니다(빈 값은 AI 번역·AI 다듬기 프리셋으로 채움, 워크플로 노드와 따로). `complete`는 자동완성(`enabled`, API 연결 `model`, `instructions`, `precedingLines`, `glossary`, `speech`, `timeoutSeconds`, `delayMs`(대사를 열고 기다린 뒤 자동 요청, 기본 500), `dailyCap`). `timeoutSeconds`(기본 60)는 AI 번역·다듬기·자연어로 정규식 만들기의 제한 시간.
- 채팅 설정(권한 모드, 도구 권한, 새 대화 모델)은 에이전트가 바꿀 수 없습니다.

## 원문 구조: 장면·묶음·원문
묶음은 종류가 셋입니다: 장면(`scene`, 대사) · 문서 묶음(`document`, 안의 항목이 문서) · UI 묶음(`ui`, 안의 항목이 UI 문자열).
```
loca scenes list                                 # 묶음 목록과 대사 수
loca call create_group '{"kind":"document","title":"편지","key":"letters"}'
loca call update_group '{"groupId":"…","title":"…"}'   # 종류는 못 바꿈
loca call create_unit '{"groupId":"…","key":"letter_01","source":"…","speaker":null}'
loca call update_unit '{"unitId":"…","source":"…"}'   # 원문을 바꾸면 그 줄 상태가 처음으로 돌아감. groupId로 같은 종류의 다른 묶음으로 옮김
```

대사 그래프도 프로젝트 데이터라 고칠 수 있습니다(가져온 파일이 원본이 아님). 대사·노드는 키로 부르고, 바꾼 것은 제안으로 올라가 사람이 앱에서 수락합니다. 직접 그은 선과 넣은 대사는 "AI가 만듦"으로 남습니다.
```
loca call link_lines '{"from":"<키>","to":"<키>","action":"link"}'      # 선 잇기(label로 선택지 이름), "unlink"면 지우기
loca call add_line_after '{"after":"<키>","source":"…","speaker":"Mira"}' # 그 대사 바로 뒤: 다음 대사가 하나면 사이에, 갈래면 새 갈래로
loca call delete_lines '{"keys":["<키>"]}'                              # 지우면서 앞뒤를 이어 줌(bridge:false면 끊음)
```
- `graph` 없이 가져온 파일(영화 대본 같은)은 장면의 대사마다 이어지지 않은 노드가 하나씩 생깁니다(문서·UI 묶음의 항목은 노드가 없음). 연결은 이렇게 만듭니다.
- 장면 연결은 저장되지 않고 대사 그래프에서 계산됩니다. 장면 잇기 = A의 마지막 대사 노드 → B의 첫 대사 노드 간선 하나입니다(`link_scenes`). 선택지·조건을 거쳐 이어진 연결은 `link_scenes`의 `unlink`로 끊을 수 없고, `link_lines`로 해당 선을 지웁니다.
- 대본 순서로 잇기(`link_in_order`)는 장면 안에서 노드를 대본 순서대로 잇되, 이미 나가는 길이나 들어오는 길이 있는 노드는 건드리지 않아 기존 갈래가 그대로 남습니다. 먼저 `loca scenes list`·`loca scenes show`로 장면을 확인합니다.
```
loca graph link <from키> <to키> [--label 선택지]   # link_lines
loca graph unlink <from키> <to키>
loca graph link-scenes <from장면> <to장면> [--unlink]   # 장면 A의 마지막 대사 → B의 첫 대사
loca graph order --scene <장면...> --line <키...>   # 대본 순서로 잇기(둘 중 하나 이상)
```
- 파일에 없는 원문만 넣습니다. 흐름이 틀렸는지는 `loca call line_context`·`show_graph`로 먼저 확인합니다.
- 게임 데이터가 가진 분기(선택지·조건)는 지어내지 않습니다. 게임 데이터에서 다시 가져와야 하면 `loca-import-format`.
- 장면 설명(AI 번역 노드가 장면 문맥으로 받음)은 `loca-knowledge`의 `save_group_summary`.
