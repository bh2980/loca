---
name: loca-workflows
description: Build, change, run and debug loca workflows — the user-defined automation between translation statuses (entry → AI / function / condition / apply nodes → end). Use when asked to create or edit a workflow, add an AI step with JSON output fields, branch on conditions, save AI results into the project, preview or start a run, choose models for a run, or find out why a run failed.
---

# loca 워크플로 만들고 돌리기

공통 규칙(연결, 제안, 권한)은 README를 따릅니다.

## 워크플로가 하는 일
번역 상태 사이에 놓인 자동화입니다. 진입 노드가 고른 상태의 대사를 받아 노드를 따라 흘려보내고, 대사마다 끝에 닿으면 마칩니다. 노드는 특정 게임이나 이름에 묶이지 않은 일반 노드입니다.

| 노드 | 하는 일 | 출구 |
|---|---|---|
| 진입(entry) | 고른 상태의 대사가 들어옴. 워크플로마다 하나 | `out` |
| AI(ai) | 모델·지시문·문맥으로 호출해 결과를 냄. 출력 종류: `text` 글 · `verdict` 판정 · `choice` 선택 · `json` 필드가 있는 JSON | verdict는 `pass`/`fail`/`error`, 나머지는 `out`/`error` |
| 함수(function) | 형식 검사, 용어 검사, 상태 변경, HTTP, 스크립트 | 함수마다 다름 (reference) |
| 반영(apply, 함수의 한 갈래) | AI·스크립트 노드의 결과를 번역 후보·청자·태그·용어·인물·관계·말투 규칙·사건·문서로 프로젝트에 넣음 | `out`/`error` |
| 조건(condition) | 대사의 데이터로 갈래를 나눔 | 조건식에 따라 |
| 종료(end) | 흐름을 마침 | — |

AI 노드는 결과를 **만들기만** 하고, 프로젝트에 넣는 건 반영 노드입니다. AI 노드에 프리셋(번역·검수·수정·말투 맞추기·청자 추정·용어/인물·관계/사건 추출·작품 분석)을 고르면 지시문·출력·문맥이 채워지고, 고쳐 쓸 수 있습니다.

## 먼저 읽기
```
loca workflows list                       # 워크플로, 노드 수, 오류 수, 진입의 대상 상태
loca workflows show <워크플로> --json > "$W/wf.json"   # 정의 전체 {id,name,description,definition}와 검증 결과
loca workflows reference                  # 노드 종류·출구, AI 설정 스키마, 프리셋 요약, 함수·반영 대상, 조건 데이터, 규칙, 연결된 모델, 상태, 태그
loca workflows reference <프리셋 id>       # 그 프리셋의 지시문·출력 필드·문맥 전문 (예: listener)
```
만들거나 고치기 전에 reference를 꼭 읽습니다. 연결·모델·상태·태그 id는 여기 나온 것만 씁니다.

## 만들기·고치기
1. 비슷한 워크플로를 `show --json`으로 받아 고치는 게 가장 안전합니다. 새로 만들면 `id`를 빼고 `name`, `definition`만 씁니다.
2. `definition` = `nodes`(`id`, `type`, `position`, `label?`, `config`) + `edges`(`source`, `sourceHandle`=출구 id, `target`) + `settings`.
3. 규칙 (reference의 `rules`가 기준):
   - 진입은 정확히 하나. `error`를 뺀 모든 출구를 잇습니다(이어지지 않은 `out`은 경고, 대사가 거기서 멈춤).
   - 병렬 갈래는 **한 출구에서 여러 간선**으로. 갈래끼리 다시 만나면 안 되고, 상태를 바꾸는 갈래는 하나까지.
   - 같은 출구에서 같은 노드로 간선 두 개 금지. 되돌아가는 고리에는 출구가 둘 이상인 노드가 있어야 합니다.
4. AI 노드:
   - `model`은 `{connectionId, model, effort?}`, `extraModels`는 막혔을 때 넘길 대체 모델(같은 연결의 다른 모델도 됨).
   - `output: "json"`이면 `fields`로 형태를 정합니다: `name`(영문·숫자·_), `type`, `description`, 목록은 `fields`로 하위 필드, `required`(비면 그 줄은 답이 없는 것으로 침), 숫자는 `min`·`max`(예: 확신도 0–1). 모델이 지키지 못하거나 답에서 빠진 줄은 `error` 출구로 나갑니다(`error.kind` = `missing`).
   - `scope: "batch"`는 여러 줄을 한 번에 보냅니다(추출용). batch의 json 결과는 묶음의 첫 줄에만 실려 반영이 한 번만 됩니다.
   - `timeoutMinutes`(기본 10, 작품 분석 프리셋 30): 요청 하나가 이 시간을 넘으면 그 줄들은 `error`(`timeout`)로 나갑니다. 연결에는 제한 시간이 없습니다.
   - 실패는 워크플로가 다룹니다. 엔진은 요청을 나누거나 다시 보내지 않습니다(요청 한도·네트워크 끊김만 잠시 뒤 다시 보내고, 연속 실패가 `settings.maxConsecutiveFailures`회면 실행을 멈춤). 기본 템플릿은 AI 노드마다 `error` → 조건 "다시 시도?"(`visits.<노드> < 2`이고 `error.kind`가 `too-long`·`cut-off`가 아님) → 같은 노드 / 아니면 함수 `fail`("실패로 끝내기")을 둡니다. 요청이 너무 크면(`too-long`·`cut-off`) 더 작은 묶음(장면별·개수별)으로 읽는 노드로 보내세요.
   - 문맥(용어집·말투 규칙·앞 대사·문서·인물 등)은 노드마다 켜고 끕니다. 무엇이 실제로 들어가는지는 `loca context <키> -n <노드 id>`로 봅니다(모델은 부르지 않음).
5. 조건 노드는 JSON Logic입니다. 읽는 값: `visits`(노드별 방문 횟수), `outputs`(앞 노드 출력), `candidate`, `issues`, `unit`(`kind`, `speaker`, `listener`, `statusId`, `tagIds`, `marks`), `error`(마지막으로 `error` 출구로 보낸 실패: `kind` = `missing`·`invalid-output`·`timeout`·`too-long`·`cut-off`·`refused`·`other`, `message`, `nodeId`; 조건을 지나도 남고, 작업 노드가 성공하면 지워짐). 예: `{"in": ["unknownListener", {"var": "unit.marks"}]}`, `{"<": [{"var": "visits.review"}, 3]}`, `{"==": [{"var": "error.kind"}, "missing"]}`. 노드 id와 상태 id는 reference·show에서 확인합니다.
6. 올리기:
   ```
   loca workflows save "$W/wf.json"         # id가 있으면 그 워크플로를 바꾸고, 없으면 새로 만드는 제안
   ```
   실행 중이거나 멈춘 실행이 있는 워크플로는 바꿀 수 없습니다. 수락 뒤 `loca workflows show <워크플로>`로 검증 결과(오류 0)를 확인합니다.

## 돌리기
AI 호출은 비용이 들어 시작도 제안이고, 사용자가 수락해야 시작합니다.
```
loca runs plan <워크플로> -g <장면>        # 읽기만: 대사 수, 묶음·요청 수 추정, 준비 상태
loca runs start <워크플로> -g <장면>       # 시작 제안. 범위와 옵션은 plan과 같음
```
- 범위: `-g` 장면·묶음, `--key` 대사, `--mark` 표시, `--tag` 태그 (모두 만족). `--ignore-status`는 진입이 받지 않는 상태의 대사도 넣습니다.
- `--model "연결:모델"`(모든 AI 단계) 또는 `--model "노드=연결:모델"`(한 단계)로 이번 실행만 다른 모델을 씁니다. 워크플로는 바뀌지 않습니다.
- plan의 **준비 상태**(청자 미상 대사, 확인 안 한 말투 규칙·용어, 규칙 없는 화자 쌍)에 걸린 것은 시작 전에 사용자에게 알립니다. 고치는 법은 `loca-knowledge`, `loca-glossary`.

## 실행 보기와 실패 원인
```
loca runs list --since 24                 # 최근 실행: 상태, 대사 수, 토큰, 실패가 많은 노드
loca runs show <id>                       # 노드별 진행(상태별 대사 수)과 최근 실패
loca proposals list --status pending      # 실행이 올린 제안 중 기다리는 것
```
실패가 한 노드에 몰리면 그 노드의 설정(모델, 출력 필드, 지시문)과 연결 상태를 봅니다. 모델이 출력 형식을 못 지키면 필드 설명을 구체적으로 쓰거나 `required`·`min`·`max`를 점검하고, 연결이 막히면 `extraModels`로 대체 모델을 둡니다.
