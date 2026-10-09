---
name: loca-characters
description: Read everything a character says or is said about in a loca project and propose character profiles, speech styles and relationships for translators. Use when asked to write or update character profiles, find who talks to whom, or describe how a character speaks in loca.
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
```
파일로 받아 읽고, 인물마다 핵심만 추립니다.

## 프로필 제안
- 기존 인물이 있으면 수정합니다(`loca call list_characters`로 id 확인). 같은 이름으로 새로 만들면 거절됩니다.
- 프로필은 마크다운: 성격, 말투·존댓말 수준, 역할, 번역 시 주의점, 근거가 된 대사 키 몇 개.
```
loca call save_character @"$W/alice.json"     # {"id":"...","name":"Alice","aliases":["CHAR_ALICE"],"profile":"..."}
loca call save_relationship @"$W/rel.json"     # {"from":"Alice","to":"Bob","kind":"동료","description":"…","mutual":true}
```
모든 저장은 제안으로 올라가고, 사용자가 loca 앱에서 수락해야 반영됩니다.
