---
name: loca-import-format
description: Write or fix a converter that turns a game's extracted text and script data into loca's standard project file (format "loca/v1"), and check the file with `loca format check`. Use when asked to bring a new game into loca, to convert extractor output, or when an import fails or looks wrong (scenes too big, speakers split, missing graph, wrong placeholders).
---

# 게임 데이터를 loca 표준 파일로 바꾸기

loca는 게임 내부 형식을 모릅니다. 게임마다 **변환기**가 추출 결과를 표준 파일(`loca/v1`, JSON 하나)로 바꾸고, 사용자가 loca 앱에서 그 파일을 가져옵니다. 이 스킬은 변환기를 만들고 결과를 검사하는 절차입니다.
`loca format …`과 `loca workspace …`는 loca 앱이 꺼져 있어도 됩니다.

## 원칙
- **변환기는 게임 전용 코드**입니다. loca가 아니라 그 게임의 작업 폴더나 저장소에 둡니다. 같은 입력이면 항상 같은 파일이 나오게 만듭니다(정렬 고정, 무작위·시간 값 금지).
- **key는 게임의 안정된 ID**를 씁니다(문자열 테이블 키, 대사 ID). 번역 결과는 key로 게임에 돌아가므로, 배열 순번이나 실행할 때마다 바뀌는 값은 쓰지 않습니다.
- **없는 것을 지어내지 않습니다.** 원본에 없는 그래프 간선, 짐작한 인물 관계, 추측한 화자를 넣지 않습니다. 모르면 비워 둡니다. 원본의 근거(파일 경로, 원래 ID, 조건식 원문)는 `meta`에 남깁니다.
- 중간 파일과 시험 출력은 작업 폴더에 둡니다: `W=$(loca workspace new <게임>-convert)`. 이 폴더는 git에 올라가지 않습니다.

## 순서
1. 작업 폴더를 만들고, 추출 결과에서 **대사 단위·장면 단위·화자·분기 정보가 어디 있는지** 먼저 확인합니다. 작은 장 하나를 골라 둡니다.
2. 규격을 봅니다: `loca format schema` (JSON Schema). 칸의 뜻은 아래 표를 봅니다.
3. 작은 범위부터 변환해 `"$W/sample.json"`에 쓰고 검사합니다.
   ```
   loca format check "$W/sample.json"
   ```
   형식 오류는 경로와 함께 나옵니다(예: `units.12.group: 없는 group`). 형식 오류를 고치면 참조 오류(없는 group·node·인물)가 이어서 나올 수 있으니, 오류가 0개가 될 때까지 반복합니다.
4. **경고를 읽습니다.** 오류는 아니지만 의도와 다를 가능성이 큽니다.
   - 그래프 노드에 들어가지 않은 대사 → 그 대사의 앞 대사 문맥을 장면 순서로만 찾습니다.
   - 인물 목록에 없는 화자 → 프로필·관계가 문맥에 붙지 않습니다. 표기 차이(`ALICE`/`Alice`)면 별칭으로 묶습니다.
   - 원문이 빈 대사.
5. 전체를 변환하고 다시 검사합니다. 요약의 묶음·대사·노드 수가 원본 수와 맞는지 확인합니다.
6. 사용자에게 파일 경로와 요약을 알립니다. **가져오기는 사용자가 loca 앱에서 합니다**(시작 화면 ‘표준 파일 가져오기’). 가져오기 전에 같은 검사와 경고가 다시 보입니다.

## 칸
| 칸 | 뜻 | 주의 |
|---|---|---|
| `format` | `"loca/v1"` | 다른 값은 거부됩니다 |
| `project` | `name`, `description`, `sourceLanguage`(기본 `en`), `targetLanguage`(기본 `ko`), `formatRules` | 아래 ‘자리표시자·태그’ |
| `groups[]` | 묶음: `key`, `kind`(`scene`/`document`/`ui`), `title`, `description`, `section`, `order`, `meta` | 아래 ‘묶음 나누기’ |
| `units[]` | 대사·문구: `key`, `group`, `order`, `kind`(`dialogue`/`document`/`ui`), `speaker`, `listener`, `source`, `translation`, `tags`, `meta` | `translation`이 있으면 현재 번역이 되고 상태는 기본 상태 세트의 ‘AI 초벌’로 들어갑니다. 공식·기존 번역일 때만 넣습니다. `listener`(누구에게 하는 말인지, 인물 이름)는 게임 데이터가 확실히 알 때만. `tags`는 게임 데이터의 분류(예: `["UI", "음성", "20자 제한"]`)로, 같은 이름은 프로젝트 태그 하나가 되어 필터·실행 범위·워크플로 조건에 쓰입니다 |
| `graph.nodeTypes` | 게임의 노드 클래스 이름 → `{ kind, label, description }` | `kind`: `script`(대사 있음)·`choice`(플레이어가 고르는 선택지, 문구가 대사로 들어감)·`condition`·`wait`·`event`·`state`·`connector`·`unknown` |
| `graph.nodes[]` | `key`, `type`, `kind`, `label`, `units`(이 노드가 보여 주는 대사 key, 순서대로), `group`, `meta` | 대사가 없는 컨테이너 노드는 `group`으로 장면을 알려 줍니다 |
| `graph.edges[]` | `from`, `to`, `kind`, `label` | 선택지 문구나 조건은 `label`에 |
| `characters[]` | `name`, `aliases`, `profile`, `speech`, `player` | 화자 표기가 여럿이면 하나를 `name`, 나머지를 `aliases`로. 말 없는 주인공처럼 대사를 듣기만 하는 플레이어 캐릭터도 넣고 `player: true` |
| `relationships[]` | `from`, `to`(인물 이름·별칭), `kind`, `description`, `mutual`, `changes[]`(`at` 대사 키, `change`, `cause`) | 원본이나 공식 자료에 있는 것만 |
| `events[]` | `title`, `summary`, `cause`, `outcome`, `participants`, `evidence`(대사 키) | 공식 자료에 있는 것만. 보통은 앱의 작품 분석이 초안을 만듭니다 |
| `speechRules[]` | `from`, `to`, `level`(`hasipsio` 하십시오체/`hao` 하오체/`hage` 하게체/`haera` 해라체/`haeyo` 해요체/`hae` 해체·반말/`other`), `address`, `note`, `start`(대사 키, 이 줄부터) | 기존 공식 번역에서 확인된 말투만 |
| `documents[]` | `title`, `kind`(`story`/`world`/`style`/`note`), `body`(마크다운), `alwaysInclude` | `alwaysInclude`(앱의 ‘번역 문맥에 넣기’)를 켜면 ‘작품 문서’ 문맥을 켠 AI 노드의 호출마다 통째로 들어가므로 짧은 핵심 설정만 |
| `terms[]` | `source`, `target`, `note` | 확정된 공식 번역어만. 모르면 `target`을 비웁니다 |

## 묶음 나누기
- 묶음은 **AI가 한 번에 번역하는 단위이자 ‘장면 문맥’**입니다. 대화 하나, 컷신 하나, 문서 하나 정도가 알맞습니다. 장(chapter) 전체를 한 묶음으로 만들지 않습니다. 장은 `section`에 씁니다.
- 대화는 `scene`, 게임 속 읽을거리(편지, 웹페이지, 기록)는 `document`, 메뉴·버튼·안내 문구는 `ui`입니다.
- `order`는 묶음 안(대사) 또는 전체(묶음)의 표시 순서입니다. 실제 진행 순서를 모르면 추출 순서를 쓰고, 그렇다고 `project.description`에 적습니다.

## 그래프
- 게임에 대화 그래프(분기, 조건, 대기, 이벤트)가 있으면 그대로 옮깁니다. loca는 이 그래프로 **앞 대사 문맥**과 **장면 연결**을 계산합니다.
- 노드의 `units`는 그 노드가 보여 주는 대사입니다. 선택지 노드에서 갈라지는 간선마다 선택지 문구를 `label`에 둡니다. 조건 분기는 조건식 원문을 `label`이나 노드 `meta`에 둡니다.
- 그래프가 없으면 `graph`를 생략합니다. 파일 순서로 간선을 지어내지 않습니다.

## 자리표시자·태그
번역에서 지켜야 할 토큰을 `project.formatRules`로 알려 줍니다. loca의 형식 검사와 AI 검수가 같은 규칙을 씁니다.
```json
"formatRules": {
  "presets": ["brace", "angleTag"],
  "custom": [{ "label": "아이콘", "kind": "placeholder", "pattern": "@icon:[a-z_]+" }]
}
```
프리셋: `brace` `{name}` · `doubleBrace` `{{name}}` · `printf` `%s %d` · `dollar` `$name$ ${name}` · `square` `[PLAYER]` · `rpgmaker` `\N[1]` · `escapes` `\n` · `angleTag` `<b>` · `bbcode` `[b]`.
`[NAME]` 변수와 `[b]` BBCode는 모양이 같으니 게임에 실제로 있는 쪽만 켭니다.

## 최소 예시
```json
{
  "format": "loca/v1",
  "project": { "name": "Example Game", "sourceLanguage": "en", "targetLanguage": "ko", "formatRules": { "presets": ["brace"] } },
  "groups": [
    { "key": "ch1.harbor", "kind": "scene", "title": "Harbor at night", "section": "Chapter 1", "order": 0 },
    { "key": "menu", "kind": "ui", "title": "Main menu", "order": 1 }
  ],
  "units": [
    { "key": "HARBOR_001", "group": "ch1.harbor", "speaker": "Alice", "source": "You're late, {PLAYER_NAME}." },
    { "key": "HARBOR_002", "group": "ch1.harbor", "speaker": "Bob", "source": "The ferry left without us." },
    { "key": "HARBOR_003", "group": "ch1.harbor", "speaker": "Alice", "source": "Then we swim." },
    { "key": "HARBOR_004", "group": "ch1.harbor", "speaker": "Alice", "source": "Fine, we wait." },
    { "key": "MENU_CONTINUE", "group": "menu", "kind": "ui", "source": "Continue" }
  ],
  "graph": {
    "nodeTypes": { "Line": { "kind": "script", "label": "대사" }, "Choice": { "kind": "condition", "label": "선택지" } },
    "nodes": [
      { "key": "n1", "type": "Line", "units": ["HARBOR_001", "HARBOR_002"] },
      { "key": "c1", "type": "Choice", "group": "ch1.harbor" },
      { "key": "n2", "type": "Line", "units": ["HARBOR_003"] },
      { "key": "n3", "type": "Line", "units": ["HARBOR_004"] }
    ],
    "edges": [
      { "from": "n1", "to": "c1" },
      { "from": "c1", "to": "n2", "label": "Swim" },
      { "from": "c1", "to": "n3", "label": "Wait" }
    ]
  },
  "characters": [{ "name": "Alice", "aliases": ["ALICE"], "profile": "" }, { "name": "Bob" }]
}
```
이 예시는 장 사이 이동이 그래프에 없으므로 `partial`입니다.

## 흔한 실수
- 배열 순번을 key로 써서 다시 추출하면 key가 바뀜.
- 장 전체를 한 묶음으로 만들어 AI 묶음 번역과 장면 문맥이 너무 커짐.
- 같은 인물이 `Alice`/`ALICE`/`alice`로 나뉨 → `characters`의 `aliases`로 묶기.
- 파일 순서대로 간선을 만들어 분기가 없는 것처럼 보이게 함.
- 그래프가 일부인데 `complete`로 선언.
- 기계 번역이나 다른 언어 문구를 `translation`에 넣어 ‘AI 초벌’ 상태로 들어감.
