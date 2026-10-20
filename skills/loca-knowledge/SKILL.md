---
name: loca-knowledge
description: Read and maintain a loca project's knowledge that AI translation uses as context — characters (profile, gender, age band, how they speak), relationships, Korean speech rules per speaker → listener, story events, reference documents, scene descriptions, and who each line is addressed to. Use when asked to write or update character profiles, find who talks to whom, decide or fix speech levels (반말/존댓말, 해요체·하십시오체…), set listeners of lines, record story events, write world/style documents or scene summaries in loca.
---

# loca 작품 자료 다루기

공통 규칙(연결, 제안, 권한, 표시)은 README를 따릅니다. 자료는 번역 문맥으로 쓰입니다: **확정(confirmed)** 된 자료만 AI 노드에 들어가고, 후보는 들어가지 않습니다. AI가 확정한 자료(#AI 초안)도 이미 쓰이고 있으니, 틀린 것을 보면 고쳐서 제안합니다(사람이 수락하면 정한 쪽이 사람이 됩니다).

## 읽기
파일은 작업 폴더에 받습니다: `W=$(loca workspace new knowledge)`
```
loca speakers                                   # 화자 키와 저장된 인물 이름, 대사 수
loca speakers first Bob                         # 처음 등장하는 장면
loca lines --speaker Alice --all --jsonl > "$W/alice.jsonl"         # 본인이 한 말 (이름·별칭·화자 키)
loca lines --mentions Alice --all --jsonl > "$W/about-alice.jsonl"  # 남이 Alice를 언급한 말
loca lines --speaker Alice --listener Bob --all --jsonl > "$W/alice-bob.jsonl"  # Alice가 Bob에게 한 말
loca scenes with Alice Bob                      # 둘이 함께 나오는 장면 (대사 그래프에서 파생)
loca scenes show "<장면>"                       # 한 장면을 대본 순서로
loca line <키> --around 6                        # 대사 앞뒤와 분기
loca knowledge characters                        # 인물 (relationships, speech-rules, events, documents도 같은 방식)
loca knowledge speech-rules --unreviewed         # 사람이 아직 안 본 것. --mark, --tag로도 거름
loca call list_speech_rules '{"speaker":"Alice"}'
```
대사 그래프(누가 어디서 이어지는지)는 통째로 읽기엔 크니 일부만 봅니다.
```
loca views create --label "미라와 요나스" -s MIRA JONAS   # 고른 노드만 남긴 보기를 저장하고 앱 링크 출력 (제안 없이 저장)
loca views list
```
고르는 조건은 `-g <장면>`, `-s <화자>`, `--line <키>`, `-q <글자>`, `--between <시작> <끝>`, `--around <n>`, `--mode view|mark`입니다. 두 대사 사이의 실제 경로는 `loca call find_reading_route`로 찾습니다(시작·끝 키는 `find_lines`·`line_context`로 먼저 확인, 반환된 링크로 앱에서 엶).

항목의 `source`는 내용을 만든 쪽입니다: workflow(워크플로·채팅) · script(대본에서 찾음) · import(가져오기) · human(사람).

## 인물과 관계
- 기존 인물은 `id`로 고칩니다(`loca call list_characters`). 같은 이름으로 새로 만들면 거절됩니다.
- `profile`은 마크다운: 성격, 역할, 번역 시 주의점, 근거 대사 키 몇 개. `speech`는 원문에서 어떻게 말하는지. `player`는 플레이어 캐릭터(말이 없어도 청자가 됨).
- `gender`(`male`/`female`/`other`/`unknown`)와 `ageBand`(`child`/`teen`/`young`/`middle`/`old`/`unknown`)는 대사에 근거(대명사, 호칭, 나이 언급)가 있을 때만 채웁니다. 번역의 호칭·말투 문맥에 들어갑니다.
```
loca call save_character @"$W/alice.json"       # {"id":"…","name":"Alice","aliases":["CHAR_ALICE"],"profile":"…","speech":"…","player":false,"gender":"female","ageBand":"middle"}
loca call save_relationship @"$W/rel.json"       # {"from":"Alice","to":"Bob","kind":"동료","description":"…","mutual":true}
```

## 말투 규칙
한국어 말투는 프로필이 아니라 **화자 → 청자 방향마다 규칙 하나**로 냅니다. 말투가 바뀌는 지점(다툼·화해·승진)이 있으면 그 대사 키를 `startKey`로 한 규칙을 더 둡니다. 비꼬는 한두 줄은 구간이 아닙니다.
`level`: `hasoseo`(하소서체) `hasipsio`(하십시오체) `hao`(하오체) `hage`(하게체) `haera`(해라체) `haeyo`(해요체) `hae`(해체·반말) `other`.
```
loca call save_speech_rule @"$W/rule.json"       # {"fromName":"Alice","toName":"Bob","level":"haeyo","address":"밥 씨","note":"직장 선배","startKey":null}
loca check speech --speaker Alice --listener Bob # 규칙과 번역 어미가 다른 곳 (어미로 추정)
```
규칙을 고친 뒤 기존 번역을 맞추려면, 그 쌍의 대사를 말투만 고치는 워크플로(기본 "말투만 고치기")로 다시 돌리도록 제안합니다. 프로젝트에 그런 워크플로가 있는지는 `loca workflows list`로 확인하고, 없으면 `loca-workflows`로 만듭니다.

## 대사의 청자
청자는 말투를 정하는 열쇠입니다. 화자가 있는 대사 중 청자를 모르는 줄에 #청자 미상(`unknownListener`)이 붙습니다(화자 없는 지문·서식만 있는 줄은 빠짐).
```
loca lines --mark unknownListener -g "<장면>"
```
- 사람이 확정한 청자: import 파일 줄에 `{"key":"<키>","rev":<rev>,"listener":"Bob"}`(모르면 `null`).
- 근거로 추정한 AI의 추측: `loca call set_listeners`로 확신도(0–1)와 함께 제안합니다. 줄마다(`lines`) 주고, 사람이 정했거나 가져오기로 들어온 청자는 바꾸지 않습니다. 이런 줄은 #AI 초안으로 남아 사람이 확인합니다. 형식은 `loca tools set_listeners`.
- 특별한 청자: 여럿(`group`) · 불특정 다수(`public`) · 혼잣말(`self`) · 그 밖의 사람(`others`).

## 사건·문서·장면 설명
```
loca call save_event @"$W/event.json"            # {"title":"…","summary":"…","outcome":"…","participants":["Alice"],"evidence":["<키>"]}
loca call save_document @"$W/doc.json"           # {"title":"세계관","kind":"world","body":"…","alwaysInclude":false}
loca call save_group_summary '{"groupId":"…","description":"…"}'   # 장면을 끝까지 읽은 뒤, 2–5문장 사실만
```
- 문서 `kind`: `story` 스토리 · `world` 세계관 · `style` 문체 · `note` 메모. `alwaysInclude`(번역 문맥에 넣기)는 작품 문서 문맥을 켠 AI 노드에 전문이 들어가니 짧고 꼭 필요한 것만 켭니다.
- 장면 설명은 AI 번역 노드가 장면 문맥으로 받습니다: 누가 있는지, 무슨 일이 있는지, 분위기.
- 사건의 `evidence`는 그 사건을 보여 주는 대사 키입니다. 근거가 없으면 #근거 부재가 붙습니다.
- 사건 흐름의 선: `loca knowledge events --json`의 `next`가 사건이 이어지는 사건입니다(`source` `graph` = 대사 그래프에서 계산, `added` = 직접 이음). 대사 그래프로는 안 보이는 인과(나란히 열리는 장면)만 `loca call link_events '{"fromId":"…","toId":"…","action":"link"}'`로 잇고, 틀린 선은 `"action":"unlink"`로 뺍니다(계산된 선은 다시 계산해도 빠진 채). 사건이 엉뚱한 곳에 있어서 선이 틀렸다면 잇지 말고 `save_event`로 `evidence`를 고칩니다.

## 여러 개를 한 번에
같은 종류든 섞였든 많으면 `save_knowledge`로 한 제안에 묶습니다(최대 200개, 인물이 먼저 저장되어 새 관계가 새 인물을 이름으로 부를 수 있음). 하나라도 실패하면 아무것도 저장되지 않으니 고쳐서 전체를 다시 보냅니다. 태그는 `loca call tag_items '{"kind":"speechRules","ids":["…"],"add":["확인 필요"],"remove":[]}'`로 붙이고, 붙는 곳은 `loca tags`로 먼저 확인합니다.
