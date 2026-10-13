---
name: loca-characters
description: Read everything a character says or is said about in a loca project and propose character profiles, relationships, Korean speech rules per speaker → listener, listeners of lines, and story events for translators. Use when asked to write or update character profiles, find who talks to whom, decide or fix speech levels (반말/존댓말, 해요체·하십시오체…), set who a line is addressed to, or describe how a character speaks in loca.
---

# loca로 인물 프로필 만들기

## 읽기
파일은 작업 폴더에 받습니다: `W=$(loca workspace new characters)`
```
loca speakers                                   # 화자 키와 저장된 인물 이름
loca lines --speaker "Alice" --all --jsonl > "$W/alice.jsonl"         # 본인이 한 말 (이름·별칭·화자 키 모두 됨)
loca lines --mentions Alice --all --jsonl > "$W/about-alice.jsonl"    # 남이 Alice를 언급한 말 (별칭 자리표시자 포함)
loca scenes --with Alice Bob                    # 둘이 함께 나오는 장면
loca first Bob                                  # 처음 등장하는 장면
loca line <키> --around 6                        # 특정 대사 앞뒤와 분기
loca lines --speaker Alice --listener Bob --all --jsonl > "$W/alice-bob.jsonl"  # Alice가 Bob에게 한 말
loca lines --listener - --group "<장면>"          # 청자를 아직 모르는 대사
loca call list_characters                        # 인물(말투 특징·플레이어 여부)과 관계(변화 지점), 상태·출처
loca call list_speech_rules '{"speaker":"Alice"}'  # 화자→청자 말투 규칙과 구간
loca call list_events                            # 사건
```
각 항목에는 `status`(confirmed = 번역 문맥에 쓰임, candidate = 아직 안 쓰임), `statusBy`(ai = AI가 그 상태로 정했고 아직 사람이 보지 않음, human = 사람이 정함), `source`(내용을 만든 쪽: analysis 작품 분석 / workflow 워크플로·채팅 / script 대본에서 찾음 / import 가져오기 / human 사람)가 있습니다. AI가 확정한 항목도 이미 번역에 쓰이고 있으니, 틀린 것을 발견하면 고쳐서 제안합니다(사람이 수락하면 정한 쪽이 사람이 되고, 내용을 고쳤으면 출처도 사람이 됩니다).
파일로 받아 읽고, 인물마다 핵심만 추립니다.

## 프로필 제안
- 기존 인물이 있으면 수정합니다(`loca call list_characters`로 id 확인). 같은 이름으로 새로 만들면 거절됩니다.
- 프로필은 마크다운: 성격, 역할, 번역 시 주의점, 근거가 된 대사 키 몇 개. `speech`는 원문에서 어떻게 말하는지, `player`는 플레이어 캐릭터(말이 없어도 청자가 됨).
- **한국어 말투는 프로필이 아니라 말투 규칙**으로 냅니다. 화자→청자 방향마다 하나, 말투가 바뀌는 지점(다툼·화해·승진)이 있으면 그 대사 키를 `startKey`로 한 규칙을 더 둡니다. 비꼬는 한두 줄은 구간이 아닙니다.
  `level`: `hasoseo`(하소서체) `hasipsio`(하십시오체) `hao`(하오체) `hage`(하게체) `haera`(해라체) `haeyo`(해요체) `hae`(해체·반말) `other`.
```
loca call save_character @"$W/alice.json"       # {"id":"...","name":"Alice","aliases":["CHAR_ALICE"],"profile":"...","speech":"...","player":false}
loca call save_relationship @"$W/rel.json"       # {"from":"Alice","to":"Bob","kind":"동료","description":"…","mutual":true}
loca call save_speech_rule @"$W/rule.json"       # {"fromName":"Alice","toName":"Bob","level":"haeyo","address":"밥 씨","note":"직장 선배","startKey":null}
loca call save_event @"$W/event.json"            # {"title":"…","summary":"…","outcome":"…","participants":["Alice"],"evidence":["<키>"]}
```
- 대사의 청자를 고칠 때는 import 파일 줄에 `"listener":"Bob"`(모르면 `null`)을 넣습니다: `{"key":"<키>","rev":<rev>,"listener":"Bob"}`.
- 말투 규칙을 고친 뒤에는 그 쌍의 대사를 앱의 "말투만 고치기" 워크플로로 다시 돌리면 어미·호칭만 새 규칙에 맞춰집니다(`loca check speech --speaker Alice --listener Bob`으로 먼저 확인).
모든 저장은 제안으로 올라가고, 사용자가 loca 앱에서 수락해야 반영됩니다.
