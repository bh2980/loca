# Translation Workbench (Loca) 추가 개선 및 고도화 상세 개발 명세서 (AI 구현 블루프린트)

작성일: 2026-10-19 · 개정: 2026-10-19 (과제 2·3·6 재설계, 1장 상태 표 참고)

> **문서 목적**: 본 문서는 사전 맥락이 없는 다른 AI 에이전트나 개발자가 이 문서 하나만 읽고도 설계자의 의도와 100% 동일한 코드·동작·UI를 즉시 구현할 수 있도록, **수정 대상 파일 경로, 줄 번호, 정확한 Zod 스키마/타입 정의, 핵심 알고리즘, 그리고 변경 전/후 코드 블록**까지 모두 포함한 코드 레벨 명세서입니다.

---

## 0. 필수 준수 아키텍처 및 코딩 규칙 (`AGENTS.md` 요약)

구현 시 아래 규칙을 **예외 없이** 준수해야 합니다:

1. **디자인 토큰 및 컴포넌트 규칙 (`@loca/ui`)**:
   - 색상은 반드시 `packages/ui/src/tokens/theme.css`의 시맨틱 토큰(`bg-panel`, `bg-sunken/20`, `text-default`, `text-muted`, `text-subtle`, `border-subtle`, `text-accent`, `text-success`, `text-warning`, `text-danger` 등)만 사용합니다. **임의의 Hex 색상이나 Tailwind 팔레트 색상(`bg-blue-500`, `text-emerald-600` 등) 사용 금지**.
   - 텍스트 크기는 `text-base`, `text-sm`, `text-xs`만 사용합니다 (`text-[11px]` 등 임의 픽셀 클래스 금지, 기존 `@loca/ui` 유틸리티인 `text-2xs`만 예외 허용).
   - 네이티브 `<button>` 태그를 직접 쓰지 않고 반드시 `@loca/ui`의 `<Button size="sm" ...>`을 사용합니다.
   - 단축키 표시는 하드코딩(`⌘`, `⌥`)하지 않고 반드시 `apps/web/src/lib/keys.ts`의 `keyLabel()`을 사용합니다.
2. **상태 관리 원칙**:
   - 페이지 상태(필터, 선택 항목, 탭, 단순화 토글 등)는 **URL Search Params**가 단일 진실 공급원(Source of Truth)입니다.
   - 뷰포트(Pan/Zoom 좌표), 미저장 초안(Draft), 임시 숨김 노드 집합(`hiddenIds`)은 `sessionStorage`에 보관하며, 패닝이나 폴링으로 브라우저 히스토리를 푸시하지 않습니다.
   - 서버 변경은 SSE 스트림 하나(`apps/server/src/events.ts`)로 오고, 폴링을 추가하지 않습니다. 화면은 행을 브라우저 컬렉션(TanStack DB, 종류·프로젝트마다 하나)에서 읽고 질의 캐시에 사본을 두지 않습니다. 컬렉션은 행 피드가 맞춥니다: SQLite 트리거가 바뀐 행을 적고(`row_changed`), 이벤트가 그 행을 싣습니다(대사는 id만). 화면에 보이는 표에는 쓰는 곳마다 신호를 덧붙이지 않고 마이그레이션으로 트리거를 둡니다. 쓰기는 서버 API(와 변경 관문)를 거쳐 컬렉션을 먼저 바꾸고, `x-seq`가 돌아오면 끝납니다(`changeLines`, `decideItems`). 화면과 CLI가 함께 쓰는 필터는 `@tw/shared`에 둡니다. 주제 질의와 `IMPLIES`는 옛 설계의 남은 부분이라 컬렉션으로 옮기고 새로 만들지 않습니다(과제 10).
3. **CLI 연결을 부르는 방법** (연결은 프로젝트마다 따로지만 CLI 로그인은 컴퓨터에 하나, 쓰임에 따라 부르는 방법이 다름):
   - 프로젝트 채팅은 **ACP**(`packages/ai/src/acp.ts`): CLI마다 상주 프로세스 하나가 대화 세션을 이어 가고, 작업실 도구는 MCP 서버(`mcp-host.ts`)로 넘긴다. 변경 도구는 지금처럼 제안이 된다. Claude·Codex는 공식 어댑터, Grok `grok agent stdio`, OpenCode `opencode acp`, Antigravity는 Google ACP 서버의 래퍼(Zed로 이름을 대어 CLI와 같은 모델 목록)를 쓴다.
   - 워크플로·분석 요청은 **one-shot 실행**(`cli.ts`): 도구를 끄고 JSON 스키마로 한 번에 받는다. 2026-10-20 실측(2줄 번역 1회)에서 ACP는 Claude는 비슷, Grok은 입력 2배, Antigravity는 모델 호출 3번에 사용량 보고도 없어 대량 작업에 쓰지 않는다.

---

## 1. 개선 과제 요약

> **2026-10-19 개정:** 과제 2·3·6은 사용자 검토 후 다시 설계했다. 첫 구현(`classifyTarget`, AI 노드의 자동 반영, 규칙 기반 `단순화 보기`, 세션 숨김 노드)은 이 개정과 맞지 않으므로 지운다. 과제 1·4·5와 6.1·6.2는 구현과 브라우저 검증을 마쳤다(9b4c746까지).

| 번호 | 과제명 | 핵심 목표 | 상태 |
| :--- | :--- | :--- | :--- |
| **과제 1** | 에디터 인라인 문맥 & `LineDetail` 자동 열림 방지 | 대사 클릭은 상세창을 열지 않는다. 원문 아래 용어·말투·관계, 번역 아래 후보·TM 상위 3개. 상세는 탭 없는 한 화면. | 완료 |
| **과제 2** | **AI 노드: 목적과 무관한 범용 출력** | AI 노드는 프롬프트를 실행하고 정해진 형태의 결과를 낼 뿐이다. 출력 형태는 문장·판정·선택·JSON 네 가지와 출력 단위(대사마다 / 묶음 전체)뿐. 용어·자료·작품 분석은 출력 종류가 아니라 프리셋. 숨은 프롬프트와 자동 반영을 없앤다. | 재작업 |
| **과제 3** | **반영 노드 & 숨김 없는 기본 워크플로** | 결과를 프로젝트에 넣는 일은 반영 노드가 맡는다(CLI·채팅 쓰기 도구와 같은 서비스). 필드 매핑이 보이고, 바로 쓴다(용어·자료의 확정 여부는 프로젝트 설정 하나). 기본 워크플로는 실제 노드로 그린다. 스크립트 노드 JSON 필드는 유지. | 재작업 |
| **과제 4** | 형식 검사 비정규식 규칙 & `[AI로 규칙 만들기]` | 글자·바이트·줄·비율·금칙어, 자연어 → 정규식. | 완료 |
| **과제 5** | 관계 표·그래프에서 관계·말투 추가 | `+ 관계·말투` 팝오버. | 완료 |
| **과제 6** | **그래프 조작 & 저장되는 보기(view)** | 박스 선택·휠 이동(완료). 오른쪽 클릭이 선택·상세를 바꾸지 않게 고친다. 보기 = 남길 노드의 정의를 저장하고 연결은 원본에서 계산하는 DB view. AI(채팅)나 사람이 만든다. | 일부 재작업 |
| **과제 7** | **홈 설정 (새 프로젝트 기본값)** | 홈 › 설정의 기본값을 새 프로젝트가 만들어질 때 한 번 복사한다. 실시간 상속은 없고, 연결도 프로젝트마다 따로다. | 완료 |

---

## 2. 과제별 코드 레벨 상세 구현 명세

---

### 과제 1: 에디터 인라인 문맥 완결화 & 대사 상세(`LineDetail`) 자동 열림 방지 및 단일 화면 개편

#### 1.1 대사 선택 시 우측 상세창(`LineDetail`) 자동 열림 방지
- **문제 원인**:
  - [`apps/web/src/components/script/line-list.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/script/line-list.tsx#L236-L256)에서 `<SplitPane>`의 `pane` 속성이 `search.line && <LineDetail ... />`로 되어 있음.
  - [`apps/web/src/routes/p.$projectId.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/routes/p.$projectId.tsx#L42-L45)의 `propertiesOpen` 상태는 워크스페이스 전역 상태이므로, 사용자가 이전에 용어집·자료·그래프 등에서 항목을 클릭해 `propertiesOpen === true`가 된 상태에서 대본 에디터(`/script`)로 오면, 대사를 클릭(`search.line` 설정)하자마자 `hasInspector`가 `true`가 되면서 우측 상세창이 강제로 열림.
- **수정 파일**: [`apps/web/src/components/script/line-list.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/script/line-list.tsx) (Lines 232–256)
- **정확한 변경 코드**:
  ```tsx
  // 변경 전 (line-list.tsx:232-256)
  return (
    <SplitPane
      storageKey="tw.pane.script"
      open={Boolean(dockEditor || search.line)}
      selectionKey={dockSelectionKey ?? search.line}
      autoActivate={Boolean(dockEditor || search.detail)}
      pane={
        dockEditor ?? (
          search.line && (
            <LineDetail
              projectId={projectId}
              unitId={search.line}
              tab={search.tab}
              onTab={(tab) => patch({ tab }, true)}
              onClose={() => patch({ line: undefined, edit: undefined, detail: undefined }, true)}
              onSelectLine={(id) => patch({ line: id, edit: undefined }, false)}
              onApply={(text) => {
                drafts.set(projectId, search.line!, text);
                patch({ edit: '1' }, true);
              }}
            />
          )
        )
      }
    >

  // 변경 후
  const showDetailPane = Boolean(search.line && search.detail);
  return (
    <SplitPane
      storageKey="tw.pane.script"
      open={Boolean(dockEditor || showDetailPane)}
      selectionKey={dockSelectionKey ?? (showDetailPane ? search.line : undefined)}
      autoActivate={Boolean(dockEditor || showDetailPane)}
      pane={
        dockEditor ?? (
          showDetailPane && search.line ? (
            <LineDetail
              projectId={projectId}
              unitId={search.line}
              onClose={() => patch({ detail: undefined }, true)}
              onSelectLine={(id) => patch({ line: id, edit: undefined, detail: '1' }, false)}
              onApply={(text) => {
                drafts.set(projectId, search.line!, text);
                patch({ edit: '1' }, true);
              }}
            />
          ) : null
        )
      }
    >
  ```
  - 또한 `LineList` 내부에서 `[상세]` 버튼을 눌렀을 때(`line-list.tsx:332`)와 우클릭 메뉴에서 `상세 속성 열기`를 눌렀을 때(`line-list.tsx:351`)만 `patch({ line: line.id, detail: '1' }, true); revealDock?.();`가 호출되므로, 평소에 대사를 클릭하거나 `↑`/`↓`로 이동할 때는 우측 상세창이 절대 자동으로 뜨지 않으며, 상세창의 닫기(`×`)를 누르면 선택된 대사(`search.line`)는 유지한 채 `detail`만 닫힘.

---

#### 1.2 비선택 줄 원문 용어 밑줄 표시 & 선택 줄 원문 하단 인라인 힌트(`LineHints`) 표시

1. **원문 용어 밑줄 상시 표시 (`apps/web/src/components/editor/source-text.tsx`)**
   - **현재 상태**: `TokenText`(Lines 20–53)에서 `piece.kind === 'term'`일 때 `selected`가 `true`이면 클릭 가능한 `<Button>`으로 렌더링하고, `selected`가 `false`이면 아무 스타일 없는 일반 문자열(`piece.raw`)로 렌더링하여 비선택 줄에서는 어떤 단어가 용어집에 등록된 단어인지 전혀 알 수 없음.
   - **수정 코드 (`apps/web/src/components/editor/source-text.tsx` Lines 45–50)**:
     ```tsx
     // 변경 전
     if (piece.kind === 'term' && !selected) return <span key={i}>{piece.raw}</span>;

     // 변경 후: 비선택 행에서도 원문 내 용어집 단어에 점선 밑줄과 뜻(target) 툴팁을 표시
     if (piece.kind === 'term' && !selected) {
       return (
         <span
           key={i}
           title={`${piece.raw} → ${piece.insert}`}
           className="underline decoration-primary/45 decoration-dotted underline-offset-4"
         >
           {piece.raw}
         </span>
       );
     }
     ```

2. **선택된 줄의 좌측(원문 칸) 하단에 `LineHints` 인라인 표시 (`apps/web/src/components/script/line-row.tsx` & `apps/web/src/components/graph/route-list.tsx`)**
   - **현재 상태**: [`line-row.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/script/line-row.tsx#L59-L131)에 `LineHints` 컴포넌트가 이미 구현되어 있으나, 정작 `LineRow`의 `source` prop(Lines 188–195)에서는 호출되지 않고 있었음.
   - **수정 코드 (`apps/web/src/components/script/line-row.tsx` Lines 59–131 및 188–198)**:
     - `LineHints`에서 용어집 칩을 클릭했을 때 `insertIntoLine(line.id, term.target)`이 호출되도록 클릭 핸들러를 연결합니다:
     ```tsx
     // line-row.tsx 내 LineHints의 part !== 'context' 영역 개선
     {part !== 'context' && usedTerms.length > 0 && (
       <div className="flex flex-wrap items-center gap-1 pt-1">
         {usedTerms.map((term) => {
           const ok = !checked || mentions(checked, term.target);
           return (
             <Button
               key={term.source}
               type="button"
               variant="ghost"
               size="sm"
               title={`클릭하여 '${term.target}' 삽입`}
               onClick={(e) => {
                 e.stopPropagation();
                 insertIntoLine(lineId, term.target);
               }}
               className={cn(
                 'h-5 gap-1 rounded px-1.5 py-0 text-xs font-normal border',
                 ok
                   ? 'border-border-subtle bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground'
                   : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20',
               )}
             >
               <span>{term.source}</span>
               <span className="text-subtle-foreground">→</span>
               <span className="font-medium text-foreground">{term.target}</span>
               {checked ? (
                 ok ? <Check className="size-3 text-success" /> : <AlertTriangle className="size-3 text-warning" />
               ) : null}
             </Button>
           );
         })}
       </div>
     )}
     ```
     - 그리고 `LineRow`의 `source` prop(Lines 188–195)에서 `selected`일 때 `<LineSourceText>` 바로 아래에 `<LineHints>`를 렌더링합니다:
     ```tsx
     source={
       <div className="space-y-1.5">
         <LineSourceText
           projectId={projectId}
           unitId={line.id}
           source={line.source}
           selected={selected}
           className="leading-relaxed text-foreground [overflow-wrap:anywhere]"
         />
         {selected && (
           <LineHints
             projectId={projectId}
             lineId={line.id}
             source={line.source}
             translation={draft ?? line.translation}
             speaker={line.speaker}
             listener={line.listener}
             speech={line.speech}
           />
         )}
       </div>
     }
     ```
   - **경로 번역 뷰 (`apps/web/src/components/graph/route-list.tsx` Lines 133–142)**에서도 동일하게 `selected`일 때 `<LineSourceText>` 아래에 `<LineHints>`를 렌더링하여 경로 따라 번역할 때도 용어·말투·관계가 원문 바로 아래에 보이게 합니다.

---

#### 1.3 에디터 우측(번역 칸) 하단: 번역 후보 & 유사 번역(TM) 인라인 상시 노출
- **현재 상태**:
  - [`apps/web/src/components/translation-editor.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/translation-editor.tsx#L282-L324)에서 `useSuggestions(projectId, unit.id, open)`가 이미 **이 줄의 번역 후보(`unit.data?.candidates`)**와 **유사 대사 TM(`q.lineMatches(unitId)`)**을 합쳐 최대 9개까지 가져오고 있으나, `<AdvancedDisclosure label="유사 번역 및 후보 · N">` 안에 접혀 있어서 클릭하기 전에는 볼 수 없음.
- **수정 파일**: [`apps/web/src/components/translation-editor.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/translation-editor.tsx) (Lines 282–324)
- **정확한 변경 코드**:
  - `<AdvancedDisclosure>`를 제거하고, `suggestions.length > 0`이면 **상위 3개(`visibleSuggestions = showAllSuggestions ? suggestions : suggestions.slice(0, 3)`)를 항상 펼쳐진 컴팩트 리스트**로 보여줍니다:
  ```tsx
  {suggestions.length > 0 && (
    <div className="mt-1.5 space-y-1 rounded-md border border-border-subtle bg-muted/15 p-1.5">
      { (showAllSuggestions ? suggestions : suggestions.slice(0, 3)).map((item, i) => (
        <Button
          key={item.key}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => pickSuggestion(item.text)}
          className="h-auto w-full flex-col items-stretch gap-0.5 rounded px-2 py-1 text-left font-normal hover:bg-accent/60"
        >
          <div className="flex w-full items-center gap-1.5 text-xs">
            {i < 3 && (
              <kbd className="shrink-0 rounded border border-border-subtle bg-background px-1 font-mono text-2xs text-subtle-foreground">
                {keyLabel(`Alt+Shift+${i + 1}`)}
              </kbd>
            )}
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-2xs font-normal text-muted-foreground">
              {item.badge}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{item.text}</span>
          </div>
          {item.diff && (
            <div className="truncate pl-1 text-2xs text-muted-foreground">
              <span className="mr-1 text-subtle-foreground">원문 차이:</span>
              {item.diff.map((part, j) => (
                <span
                  key={j}
                  className={cn(
                    part.kind === 'same' && 'text-muted-foreground',
                    part.kind === 'removed' && 'bg-destructive/15 text-destructive line-through px-0.5 rounded-xs',
                    part.kind === 'added' && 'bg-primary/15 text-primary font-medium px-0.5 rounded-xs',
                  )}
                >
                  {part.text}
                </span>
              ))}
            </div>
          )}
        </Button>
      ))}
      {suggestions.length > 3 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowAllSuggestions((prev) => !prev)}
          className="h-5 w-full justify-center text-2xs text-muted-foreground"
        >
          {showAllSuggestions ? '접기' : `+${suggestions.length - 3}개 후보·유사 번역 더보기`}
        </Button>
      )}
    </div>
  )}
  ```

---

#### 1.4 우측 대사 상세(`LineDetail`)에서 `번역 도우미` 탭 제거 및 단일 스크롤 화면 개편
- **배경**: 원문·번역·화자·청자·말투·관계·태그·메모·앞뒤 대사·용어집·후보·TM이 모두 에디터 인라인에서 즉시 보이므로, 우측 `LineDetail`에 `번역 도우미 | 검사·이력` 탭을 둘 이유가 없음.
- **수정 파일**: [`apps/web/src/components/line-detail.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/line-detail.tsx)
- **세부 변경 명세**:
  1. `InspectorTabs` import 및 렌더링 제거 (`tab`, `onTab` prop은 하위 호환을 위해 optional로 두거나 제거).
  2. 단일 스크롤 영역 안에 다음 5개 `<InspectorSection>`을 순서대로 배치:
     - **섹션 1 — `기본 정보 · 청자 · 태그` (`defaultOpen`)**:
       - `<PropertyGrid>`:
         - `대사 키`: `<code className="font-mono text-xs break-all text-muted-foreground">{line.key}</code>`
         - `소속 장면`: 장면 링크 버튼 (`{line.group.title}`) + `대사 그래프에서 열기` 버튼
         - `화자`: `{speakerTitle}` (인물 상세 바로가기 포함)
         - `청자`: `<ListenerPicker>` (수동 청자 변경 및 AI 추정 근거 표시)
         - `태그`: `<TagListEditor>` (태그 추가/삭제/인라인 생성)
     - **섹션 2 — `번역 후보 및 유사 대사 (TM)` (`defaultOpen`)**:
       - `<CandidateSection>` (AI/이전 후보 전체 목록 및 채택 버튼)
       - `q.lineMatches(projectId, unitId)`를 호출하여 **대본 내 동일/유사 원문 대사(`Same` / `Similar`) 전체 목록**과 원문 단어 차이(`diff`), 채택(`[이 번역 쓰기]`) 버튼 표시
     - **섹션 3 — `변경 이력` (`defaultOpen={line.history.length > 0}`)**:
       - `<HistorySection>` (이전 번역본 시각, 작성자 `사람`/`AI`, 되돌리기 버튼)
     - **섹션 4 — `형식·규칙 검사 상세` (`defaultOpen`)**:
       - 최근 워크플로 실행 이슈(`lastRun?.data.issues`) 및 `<LineChecks>`
     - **섹션 5 — `AI 프롬프트 문맥 미리보기` (`defaultOpen={false}`)**:
       - `<AiContextPanel projectId={projectId} unitId={unitId} />`

---

### 과제 2: AI 노드 — 목적과 무관한 범용 출력

#### 2.0 원칙
- AI 노드의 관심사는 **프롬프트를 만들어 모델을 부르고, 정해진 형태의 답을 받아 다음 노드로 넘기는 것**까지다. 결과를 어디에 넣을지는 AI 노드가 알지 못한다(과제 3의 반영 노드가 맡는다).
- 출력 형태는 **용도를 모르는 형식**만 둔다. "용어 후보", "자료 변경", "작품 분석", "청자"처럼 목적이 박힌 출력 종류는 없앤다.
- 모델에게 가는 문장은 **모두 노드에서 보이고 고칠 수 있어야** 한다. 서버가 붙이는 것은 출력 형식 강제(스키마대로 답하라)와 입력 형식 설명뿐이며, 이것도 노드의 `프롬프트 미리보기`에서 읽기 전용으로 보인다.
- `말투 규칙 검사`(`speechCheck`)는 삭제된 상태를 유지한다(f01d2d2).

#### 2.1 출력 형태 (`aiNodeConfigSchema.output`)
| 형태 | 모델이 내는 것 | 출구 | 다음 노드가 읽는 값 |
| :--- | :--- | :--- | :--- |
| `text` 문장 | 대사마다 텍스트 하나 | `out` | `outputs.<노드>.text` (번역문·수정문 등. 대사의 번역 후보로 남길지는 반영 노드가 정한다) |
| `verdict` 판정 | 통과 여부, 이유, 분류 | `pass` / `fail` | `outputs.<노드>.passed`, `.issues` |
| `choice` 선택 | 사용자가 정한 선택지 중 하나(또는 없음), 확신도 0–1, 이유 | `out` | `outputs.<노드>.value`, `.confidence`, `.reason` |
| `json` JSON | 사용자가 정의한 필드 | `out` | `outputs.<노드>.<필드>` |

- `choice`의 선택지는 노드에 직접 적거나 **프로젝트 값 목록**에서 가져온다: 등장인물 이름 + 특수 청자, 대사 태그 이름, 상태 이름. 목록 출처는 프롬프트에 그대로 펼쳐 보인다.
- `json` 필드 타입: 문자열·숫자·참거짓에 더해 **목록(하위 필드 포함)**과 **대사 근거**(대사 id 목록)를 지원한다. 작품 분석처럼 한 번에 여러 항목을 뽑는 프리셋에 필요하다. `jsonFieldSchema`를 재귀 구조로 넓히고, 편집기는 하위 필드를 접고 펼 수 있게 한다. 고급 사용자를 위해 JSON 스키마 텍스트 편집도 둔다.
- 없앨 것: `terms`·`knowledge`·`analysis`·`listener` 출력, `sections`, `autoApply`, `asCandidate`, `classifyTarget`, `CONTRACT`의 목적별 문장, `analysisRequest`의 숨은 `SECTION_RULES`, runner의 `AUTO_APPLY_FUNCTIONS`·`shouldAutoApply`·`attachClassifiedTag`.

#### 2.2 출력 단위 (`aiNodeConfigSchema.scope`)
- `line` **대사마다**: 지금처럼 대사 id마다 답 하나.
- `batch` **묶음 전체**: 요청(묶음) 하나에 답 하나. 용어·인물 목록처럼 대사 하나에 속하지 않는 결과.
  - 결과는 실행 단위로 한 번 저장하고(`run_batches` 또는 기존 실행 단계 기록에 묶음 id로), 그 묶음의 **모든 대사가 같은 묶음 결과를 참조**해서 들고 간다(`outputs.<노드>` = 묶음 결과).
  - 반영 노드는 같은 묶음 결과를 **한 번만** 처리한다(묶음 id로 중복 제거). 대사마다 반복 저장하지 않는다.
- 묶음 구성(`batch.mode`: 장면 묶음·고정 개수·대사 하나·대본 전체)은 그대로 쓴다. 대본 전체를 한 번에 읽는 작품 분석이 나눠 읽는 것보다 약 5배 싸다는 실험 결과 때문에 `whole`은 유지한다.
- **실패는 워크플로가 다룬다.** 엔진은 요청을 스스로 나누거나 기다렸다 다시 보내거나 다른 연결로 넘기지 않는다(2026-10-22 "실패를 눈에 보이게": 연결의 `maxAttempts`·`fallback`과 러너의 요청 한도·연결 끊김 재대기를 없앴다. AI 호출은 한 경로로 한 번이고, 편집기 보조·정규식 보조·모델 시험·채팅도 한 번 하고 오류를 보여 준다). 실패한 요청이 `settings.maxConsecutiveFailures`번 연달아면 실행을 멈춘다(출력 잘림·요청 한도·연결 끊김도 센다). 답에서 빠진 줄·형식 오류·시간 초과·너무 큰 요청은 노드의 `error` 출구로 나가고 조건 노드가 `error.kind`(`missing`·`invalid-output`·`timeout`·`too-long`·`cut-off`·`rate-limit`(사용량 한도)·`network`(연결 끊김)·`refused`·`other`)로 갈래를 나눈다. 이어지지 않은 출구는 항목을 이유와 함께 실패로 끝낸다(따로 "실패로 끝내기" 노드는 없다, 2026-10-20). 실패한 줄의 다시 보내기는 그래프에 보이는 **재요청 노드**가 다룬다: 노드 `error` → 재요청(`kinds`, `scale` 0.1–1(1 = 그대로), `wait`(초, 0 = 바로), `model`(없음 = AI 노드의 모델, 또는 이 줄들만 보낼 다른 모델), `maxTimes` 1–5) → `다시 보냄` → 같은 AI 노드. 다시 보낸 줄은 `wait`초 동안 쉬었다가(실행은 멈추지 않는다. 줄에 "이 시각 전에는 보내지 않음"을 적어 두고 스케줄러가 건너뛰며, 가장 이른 때에 타이머로 깨어난다. 일시정지·취소·이어하기도 그대로) AI 노드가 요청 크기에 `scale`을 거듭 곱해, 모델이 같은 줄끼리 따로 묶어 보낸다. 횟수를 넘거나 `kinds`가 아니면 원래 오류 그대로 `오류` 출구로 나가고, 거기에 또 재요청을 이어 **사슬**로 쓸 수 있다(노드마다 횟수를 따로 센다. 재요청은 AI 노드의 `오류`나 다른 재요청의 `오류` 바로 뒤에만 두고, 사슬의 모든 노드는 같은 AI 노드로 되돌린다). 기본 템플릿의 모든 AI 노드에 재요청 둘이 이어져 있다: A(`cut-off`·`too-long`·`missing`·`invalid-output`·`timeout`, 절반 크기, 최대 2번) → B(`rate-limit`·`network`, 같은 크기, 60초 뒤, 최대 3번. 템플릿의 노드 방문 상한은 그만큼 8). B의 `오류`는 실패 표시로 간다: 번역·검수·수정은 상태 변경 `검토 필요로`, 용어 추출·인물·관계 추출·사건 추출·청자 추정은 태그 붙이기 `AI 실패 태그`(용어 번역은 `AI 실패`가 대사 전용 태그라 `오류`를 잇지 않는다). "다시 시도?" 조건 노드는 없다(2026-10-21). 사슬의 어느 노드든 받아 가는 실패는 연속 실패에 세지 않는다(횟수를 다 쓴 뒤의 실패는 센다). 실행 화면은 다시 보내는 줄에 `다시 보냄 2/3 · 사용량 한도 · 1분 뒤 · 모델`을 보여 준다. 요청 크기는 연결·모델의 한도로만 정하고 지난 요청에서 배우지 않는다. 그 밖의 다시 시도는 필요한 사람이 재요청의 종류·횟수나 조건 노드(방문 횟수·실패 종류)로 그리고, 사람이 볼 항목은 상태 변경·태그로 남긴다. 실행 이어하기의 "실패 다시 보내기"는 실패한 줄을 실패시킨 노드로 돌려보낸다.
- **호출 제한 시간은 AI 노드에 둔다**(`timeoutMinutes`, 기본 10분, 작품 분석 프리셋 30분). 연결에는 제한 시간이 없다. 워크플로 밖의 호출은 정해진 값(편집기 AI·정규식 만들기는 설정 › 에디터의 에디터 AI 제한 시간 60초, 연결 확인 2분)을 쓰고, 채팅은 전체 제한 없이 모델이 2분 동안 아무것도 보내지 않으면 멈춘다.
- **문맥에 들어가는 것은 확정된 용어·자료뿐이다. 확정은 사람이 하거나, 프로젝트 설정 하나(설정 › 프로젝트 › AI 문맥, `aiAutoConfirm`, 기본 켬)가 켜져 있으면 AI가 한다.** 결과 반영 노드는 늘 바로 쓰고, 쓴 용어·자료의 상태는 이 설정이 정한다(노드마다 제안/후보/확정을 따로 정하지 않는다). 사람이 먼저 보고 싶으면 이 설정을 끈다. AI 노드에도 "확정된 것만" 같은 두 번째 축은 없다. ✦는 누가 정했는지만 알리고 문맥에는 영향이 없다. 대사는 이 설정과 상관없다: 대사의 상태는 사람이나 워크플로의 상태 변경 노드만 바꾸고, 앞 대사는 상태와 상관없이 읽기만 한다. 화면의 안내 문구는 최소로 둔다(설정 칸 한 줄, 목록·노드에는 "AI 결과: 바로 확정 · 설정" 한 줄). 대사의 기본 최종 상태 이름은 용어의 "확정"과 헷갈리지 않게 "완료"다. 실행 창의 준비 상태는 문맥에 들어가지 않는 후보(말투 규칙·용어)만 알린다.
- **동시 처리는 노드 안에서 일어나고, 그 수는 노드에 있다.** 그래프의 화살표는 대사가 거치는 단계 순서이고, AI 노드는 자기 `동시 처리 수`(기본 1, 노드 카드에 `×n`)만큼, HTTP·스크립트 노드는 자기 `concurrency`(기본 2, 1–8)만큼 요청을 동시에 보낸다. 워크플로 설정(`연속 실패`, `노드 방문 상한`)은 아무 노드도 고르지 않았을 때 오른쪽 창에 보인다. 연결에는 동시 한도가 없다: 실행마다 그 수만큼 따로 돌고(실행 두 개면 더한 만큼), 채팅은 세지 않는다. 실행 창과 `loca runs plan`은 다른 실행이 AI 요청을 동시에 최대 몇 개 보내는지와 이 실행을 더하면 몇 개가 되는지 알리기만 하고 막지 않는다.
- **실행 상황은 실행 기록에서 본다.** 실행 상세에 표와 함께 그래프 보기가 있고, 노드마다 `요청 n/한도 · 처리 · 대기 · 실패`(실행 중)와 지나간 줄·실패한 줄을 보인다. 노드를 누르면 그 노드에 있는 대사 표로 간다. 워크플로 편집기는 편집만 하고, 실행 중이면 실행 기록으로 가는 안내만 띄운다.
- **편집기 AI도 AI 노드 설정이다.** 설정 › 에디터에서 AI 번역·다듬기는 모델 하나와 함께 보낼 것(체크박스: 용어집·청자·말투·앞 대사 n줄과 그 번역·이전 장면·인물·문서; 자료는 확정 여부와 상관없이 보냄)을 같이 쓰고, 버튼마다 지시문만 따로 둔다(처음엔 `AI 번역`·`AI 다듬기` 프리셋 값, 한 줄로 "프리셋 사용 중 · 편집", 워크플로 노드와 따로). 자동완성은 입력 중에 답해야 해서 API 모델을 따로 고르고, 함께 보낼 것(용어집·청자·말투·앞 대사 n줄)과 지시문, 오늘 사용량/하루 최대 호출을 보인다. 에디터 AI 제한 시간(60초, AI 번역·다듬기·자연어로 정규식 만들기 공통)·자동완성 제한 시간·자동완성 대기 시간(대사를 열고 0.5초 머물러야 자동 요청, ↑↓로 지나가는 대사는 요청 안 함)·하루 최대 호출은 "고급"을 펼쳐야 보인다(다른 도구들처럼 기본값으로 바로 쓰고 세부는 숨긴다). `AI 다듬기` 프리셋은 `json`·대사마다(`text` + `changes`)라 워크플로에서도 쓴다(번역 저장이 `text`를 받음). 코드에 숨은 프롬프트는 없다.
- **AI 노드는 앞 단계의 결과를 입력으로 받을 수 있다**(`input.previous`, `input.fields`: 남길 경로). 앞 단계는 선을 따라 그 대사가 지나온 길에서 마지막으로 결과를 낸 노드이고, 조건·저장·상태 변경 노드는 건너뛴다. **결과를 내는 노드 = 결과 칸을 선언한 노드**(`nodeOutputFields`, 2026-10-20): AI(출력 종류에 따라), 형식 검사·용어 검사(`text`·`passed`·`issues` 고정), 스크립트·HTTP(사용자가 `fields`로 선언, HTTP는 `paths`로 응답 위치, 시험 실행 결과로 칸 채우기), 모으기. 함수는 모두 같은 입력(항목, 지금 번역 `candidate`, 앞 단계 결과 `previous`)을 받고, 결과의 `text`는 대사의 지금 번역이 된다. 그래서 "앞 단계 지적"이라는 별도 통로는 없다: 검사 뒤의 AI는 검사 결과를 `previous`로 받고 고칠 번역문은 문맥 › 지금 번역으로 받는다. 저장 노드와 조건 노드도 같은 선언으로 칸을 고른다. 노드를 골라 먼 결과를 가져오지 않는다: 그래프에 이어진 앞 단계가 곧 입력이다(중간에 AI 노드를 끼우면 그 결과를 받는 것이 정상). 노드 설정에는 `넣기 · ← 앞 단계 이름` 체크 하나와 남길 필드가 있다. 대사마다 `previous`로 들어가고, 묶음 전체 결과는 묶음 첫 줄에만 있다. `input.lines: false`면 대사 없이 앞 단계 결과 목록만 보낸다(출력 json · 묶음 전체, 모으기 바로 뒤의 합치기 노드).
- **워크플로는 입력 타입을 선언하고, 노드는 코어 + 그 입력의 확장이다.** 진입 노드의 `input`(대사/용어)이 무엇이 들어오는지 정하고, 입력마다 다른 것(묶음 방식, AI 문맥 칸, 조건 행, 그 입력에만 있는 노드·프리셋, 실행 창 범위 칸)은 `INPUT_TYPES` 표 하나에만 있다. 편집기는 그 입력의 칸·노드만 보이고, 다른 입력의 노드나 없는 묶음 방식은 검증 오류다. 진입 노드는 입력만 정하고, 어떤 항목을 넣을지는 실행 범위만 정한다. 실행 창은 하나의 틀(대상 목록 + 필터 + 예상 + 모델)이고 내용만 입력에 따라 바뀐다: 대상은 장면 트리 또는 평평한 용어 목록, 필터는 목록 페이지와 같은 규칙이다. 대사는 상태(프로젝트 상태)와 태그(자동 태그·대사 태그), 용어는 상태 줄(후보·확정, 용어집의 상태 열과 같은 값)과 태그 줄(`#AI 초안`·`#번역 누락`·`#대본 미등장`·용어 태그)이다. 용어·자료의 상태는 어디서나 상태로 보이고 거르며 태그가 아니다(자동 표시 `#후보`는 없다). 한 정보는 한 곳에서만 고른다. 필터는 워크플로마다 마지막에 쓴 값을 이 브라우저에 기억한다. 목록은 입력별로 묶여 모든 워크플로를 보이고, 연 화면의 장면·대사·용어는 같은 입력이면 시작값이다. 용어 입력: AI 노드는 용어마다 `T1…` 항목(원문, 현재 표기·메모, 쓰인 줄 수, 나온 대사 `context.examples`줄). 확정 용어는 용어 자체와 나온 대사의 원문에서 찾는다(번역하는 용어 자신은 빼고), 조건은 `term`(용어 상태·표기 유무·쓰인 대사 수 행). 실행 항목은 `run_items.subject_id`로 대사나 용어를 가리킨다(외래 키 없음, 지우면 함께 지움). 설계: `docs/DESIGN-INPUT-TYPES-2026-10-20.md`.
- **용어 번역은 워크플로다.** 예전 "용어 AI 채우기"(숨은 프롬프트, 별도 작업 기록 `term_jobs`)는 없앴다. 기본 워크플로 `용어 번역`: 진입(용어) → `AI 용어 번역`(json·용어마다 `target`·`note`, 100개씩, 나온 대사 2줄) → `용어 표기 저장`(비어 있을 때만). 이름이 말하는 일만 한다(용어인지 가려 버리는 판정은 넣지 않는다). 예전 "일반어로 보임" 후보는 AI가 거절한 용어로 옮겼다(마이그레이션 0076).
- **모으기 노드**(`gather`, 설정 `fields`): 앞쪽 노드에 실행의 열린 항목이 하나도 남지 않을 때 닫히고, 선으로 이어진 앞 단계(AI·스크립트 노드)의 답(묶음 답은 한 번)을 `outputs.<모으기> = { parts, count, failed }`로 묶어 항목 하나만 다음으로 넘긴다(나머지는 거기서 끝남). 모으기 뒤에는 항목을 바꾸는 노드를 둘 수 없고, 바로 뒤의 AI 노드는 `input { previous: true, lines: false }`로 읽는다. 고리 안에 둘 수 없다. 실행 이어하기로 늦게 도착한 항목은 두 번째 모음을 만든다.
- **워크플로 호출 노드**(`call`, 설정 `{workflowId}`, 출구 `완료`·`오류`; 2026-10-21): 같은 입력 타입의 다른 저장된 워크플로를 그 자리에서 돌린다. 실행을 시작할 때 서버가 호출을 부른 워크플로의 노드로 펼친다(`expandCalls`): 안쪽 노드의 id는 `호출id/노드id`(겹치면 `c1/c2/n`), 모두 호출 노드의 자리에 놓이고, 실행의 저장된 정의에 `calls`(접두사 → 이름·워크플로 id)가 남는다. 그러므로 **그 시작 시점의 내용**으로 돌고 이어서 실행해도 같은 내용이다. 부른 워크플로의 진입 노드와 `settings`는 쓰이지 않고 부르는 쪽 설정(연속 실패·노드 방문 상한)이 적용된다. 끝 노드에 닿거나 이어지지 않은 출구로 끝나는 줄은 호출의 `완료`로, 이어지지 않은 `error` 출구로 실패로 끝나게 되는 줄은 `오류`로 나간다(오류 종류·메시지 그대로). 순환(자기 자신 또는 여러 단계 뒤 되돌아옴)은 저장할 때(편집기 검사)와 실행을 시작할 때 모두 거부한다. 다른 워크플로가 부르는 워크플로는 지울 수 없다(`이 워크플로를 부르는 곳이 있습니다: …`); 편집기 머리에 `워크플로 N개가 이 워크플로를 부릅니다`와 그 목록이 나온다. 대사는 워크플로를 따라 흐르므로 "앞 단계 결과"는 그 대사가 실제로 거쳐 온 노드의 결과다: 호출 안의 첫 노드는 호출 앞 노드의 결과를, 호출 뒤의 노드는 그 대사가 호출 안에서 마지막으로 거친 노드의 결과를 받는다. 실행 기록은 안쪽 노드를 `호출 이름 › 노드 이름`으로 부르고(위치 열, 단계, AI 호출 목록, 실행 창의 요청 나눔), 실행 그래프는 호출마다 카드 하나(안쪽 대기·실행·실패를 합친 수)로 접어 보이며 카드를 누르면 안쪽 노드 목록과 노드별 대사 수가 열린다. CLI는 `loca workflows show`에서 `호출: 이름`으로 보여 준다.

#### 2.3 지시문과 프리셋
- 노드의 지시문 칸이 프롬프트 본문이다. 프리셋을 고르면 지시문·출력 형태·필드·문맥 설정이 **노드에 채워질 뿐**이고, 이후에는 평범한 AI 노드다.
- 프리셋: 번역(`text`), 검수(`verdict`), 수정(`text`; 대사의 현재 번역과 앞 단계(형식 검사·검수)의 지적을 읽고 지적된 곳만 고침), 청자 추정(`json`·대사마다: `value` 필수 = 등장인물·엑스트라·특수 청자 또는 `unknown`, `confidence` 0~1 — 목록 밖 엑스트라를 버리지 않도록 `choice`가 아님), 용어 추출(`json`·묶음, 대사의 현재 번역을 보고 원문 용어와 번역에 쓰인 표기를 짝지음 — 표기를 새로 정하지 않음), 인물·관계 추출(`json`·묶음), 사건 추출(`json`·묶음), 작품 분석(`json`·대본 전체).
- 예전 `SECTION_RULES`·`CONTRACT` 문장은 해당 프리셋의 지시문으로 옮긴다(한국어로 다듬어도 된다). 이미 확정된 등장인물 이름을 넣던 부분은 문맥 옵션 `등장인물 목록`(`context.cast`)으로 드러낸다.
- `프롬프트 미리보기`: 실제로 보내는 시스템·사용자 메시지 전체를 샘플 대사로 보여준다(기존 `AiContextPanel` 재사용).

#### 2.4 조건 분기
- 앞 노드의 `choice`(값·확신도), `verdict`(통과), `json`·스크립트 필드로 조건식을 만드는 빠른 빌더는 유지한다(de952ba). 필드 경로만 새 출력 이름에 맞춘다.

---

### 과제 3: 반영 노드 & 숨김 없는 기본 워크플로

#### 3.1 반영 노드 (`function` 노드의 새 묶음, 팔레트 이름 `반영`)
- CLI·채팅이 쓰는 쓰기 도구와 **같은 서비스**를 노드로 낸다. 도구와 노드가 같은 검증·같은 저장 경로를 탄다.

| 반영 노드 | 대응 도구/서비스 | 입력(매핑할 필드) |
| :--- | :--- | :--- |
| 번역 저장 | 후보 저장(`applyRunCandidate`) | 문장 |
| 청자 저장 | 청자 저장 | 값, 확신도 |
| 태그 붙이기/떼기 | `tag_items` | 동작, 고른 태그·문제 유형, 앞 단계 결과의 태그 이름 필드(선택) |
| 상태 변경 | 기존 `setStatus` | (설정값) |
| 용어 저장 | `save_terms` | 목록: 원문, 번역, 메모, 근거 |
| 인물 저장 | `save_character` | 목록: 이름, 별칭, 새 사실(`newFacts`), 새 말버릇(`newSpeech`), 근거 |
| 관계 저장 | `save_relationship` | 목록: 쌍마다 방향별 관계(`views`: 인물, 상대, 종류, 설명, 근거, 변화) |
| 말투 규칙 저장 | `save_speech_rule` | 목록: 화자, 청자, 등급, 호칭, 시작 줄 |
| 사건 저장 | `save_event` | 목록: 제목, 설명, 인물, 근거 |
| 문서 저장 | `save_document` | 제목, 본문 |

- **필드 매핑:** 반영 노드는 노드를 고르지 않고 선으로 이어진 앞 단계(AI·스크립트 노드, 조건·다른 저장 노드는 건너뜀)의 결과를 반영한다. 노드 설정에는 "반영할 결과 ← 앞 단계"와 입력 필드별 선택이 보인다. 프리셋으로 만든 AI 노드 뒤에 이으면 이름이 같은 필드가 자동으로 채워진다. 매핑이 비면 노드에 경고가 뜨고 실행 전 검사(`preflight`)에서 막는다.
- **반영 방식:** 반영 노드는 늘 바로 쓴다(노드마다 제안/후보를 고르지 않는다, 2026-10-20). 용어·자료가 확정으로 들어갈지는 프로젝트 설정 `aiAutoConfirm` 하나가 정한다. 사람이 정한 항목은 바꾸지 않는다는 기존 규칙(`HUMAN_OWNED_NOTE`)은 그대로.
- **CLI·skills:** 반영 노드와 같은 도구 목록을 쓰므로 CLI 쪽 새 명령은 없다. 개발이 끝난 뒤 skills 문서를 한 번에 맞춘다.

#### 3.2 숨김 없는 기본 워크플로
- 기본 워크플로와 템플릿을 **실제 노드로** 그린다. 예전 "대본 읽기"처럼 이름만 다른 AI 노드 안에 프롬프트와 저장을 숨기지 않는다.
- **템플릿은 이름이 말하는 일만 한다(2026-10-20).** AI 노드 → 저장 노드가 기본이고, 숨은 판정(용어인가?·확신도 기준), 대상 거르기 조건(대상은 실행 창이 고른다), 검사·검수 반복, 합치기 같은 단계는 넣지 않는다. 필요하면 사용자가 노드를 더한다. 실패는 모든 AI 노드가 같은 모양(재요청 → 실패 표시)으로 다루고, 조건 노드로 그린 다시 시도는 없다.
- **AI 문맥 칸은 실제로 보내는 것으로 이름 붙이고 칸마다 "?" 툴팁으로 짧게 설명한다(`CONTEXT_FIELDS` 한 곳).** "용어집"이 아니라 "확정 용어"(보내는 원문에 나오는 확정 용어만), "용례"가 아니라 "나온 대사".
- **그래프 단축키는 어디서나 같다(`lib/graph-shortcuts.ts`, 2026-10-21):** ⌘/Ctrl+Z 되돌리기, ⌘/Ctrl+Shift+Z·Ctrl+Y 다시 하기, ⌘/Ctrl+C·X·V 복사·잘라내기·붙여넣기, Delete·Backspace 삭제. 그래프는 할 수 있는 것만 연결한다: 워크플로 편집기는 전부(되돌리기는 편집 기록, 끌기·입력은 멈출 때까지 한 단계), 인물 관계 그래프도 전부(삭제는 바로 되고, 서버가 지운 행을 1시간 보관해 `knowledge-restore`로 되돌린다). 보기 전용 그래프는 없음. 노드가 선택된 채 선을 그냥 클릭하면 선만 선택된다(⌘/Ctrl은 더하기).
- **대사 그래프도 편집한다(2026-10-21):** 프로젝트가 원본이라 대사 그래프도 고치는 데이터다(가져오기는 들어오는 길 하나). 카드마다 점 둘(위·왼쪽 = 들어옴, 아래·오른쪽 = 나감), 끌어서 다른 노드에 놓으면 선. 선을 클릭하면 오른쪽에 출처(가져온 파일 / 사람이 이음 / AI가 이음)와 앞·뒤 대사, 삭제. 노드 오른쪽 클릭: 이 대사 뒤에 대사 추가(다음 대사가 하나면 사이에, 갈래면 새 갈래로; 연결점(hub)으로 가는 선은 세지 않음)·복제·복사·삭제(앞뒤를 이어 줌). 선택지 선을 지우면 그 선택지가 빠진다. 카드 하나를 고르면 위에 복제·삭제 도구가 뜬다(다른 그래프와 같다). Delete·⌘Z/⌘⇧Z·⌘C/⌘X/⌘V는 다른 그래프와 같고, 되돌리기는 서버의 토큰(1시간). 편집하면 서버가 배치를 다시 계산하는 동안(9천 줄에 약 4초) 이전 배치를 그대로 보여 준다. 저장된 보기(view)는 선이 계산된 것이라 읽기만. CLI·채팅: `link_lines`·`add_line_after`·`delete_lines`(제안). 한 줄짜리 카드의 오른쪽 클릭에는 대사 목록과 같은 대사 메뉴(상태·태그·번역 대상·복사·원문 편집)가 같이 나온다. 대사 목록의 ⋯와 오른쪽 클릭도 같은 메뉴다.
- **대사 그래프가 원본, 장면 연결은 계산 결과(2026-10-23, 2026-10-31 개정):** 장면 그래프는 대사 그래프에서 읽은 연결을 보여 주기만 한다. 장면끼리 잇기·끊기(앱의 끌어 잇기·연결 끊기, 도구 `link_scenes`, CLI `loca graph link-scenes`)는 없앴다: "A의 마지막 대사 → B의 첫 대사"로 앱이 연결 지점을 추측해 선을 만들었기 때문. 연결은 대사 그래프에서 줄끼리(`link_lines`) 잇는다. `graph` 없이 가져온 파일도 장면의 대사마다 이어지지 않은 노드가 하나씩 생기고(문서·UI 묶음은 제외), "대본 순서로 잇기"(`linkInOrder`, 장면 그래프의 장면 메뉴·채팅 `link_in_order`·CLI `loca graph order`)가 장면 안에서 순서대로 잇되 이미 나가는/들어오는 길이 있는 노드는 건드리지 않는다. ⌘/Ctrl+Z로 되돌린다. 그래프 화면은 대사 그래프로 열린다(`대사 | 장면`).
- **대사 화면에 숨은 "…" 메뉴는 없다(2026-10-21):** 동작은 그 대상 옆에 둔다. 장면(UI 묶음·문서 묶음) 추가는 장면 목록 검색 옆 +. 장면 오른쪽 클릭에는 편집·대사 추가·그래프에서 보기·AI로 장면 요약. 대사 오른쪽 클릭에는 원문 편집·이 장면에 대사 추가(장면 끝에)·그래프에서 보기. 제목 줄에는 장면 목록 접기·펴기 아이콘과, 장면을 열었을 때 ‹ ›(이전·다음 장면). 특정 대사 뒤에 넣기는 대사 그래프 편집과 함께 한다.
- **설명은 두 가지(2026-10-21):** 칸 아래에 보이는 설명(`description`/`hint`)은 입력하는 법만 쓴다(형식, 비우면 어떻게 되는지, 왜 잠겼는지). 그 설정이 무엇이고 바꾸면 어떻게 되는지는 이름 옆 ? 툴팁(`help`)에 쓴다. 한 칸에 둘 다 있을 수 있지만 섞지 않는다. 설정 묶음(SettingsSection)의 설명은 묶음 소개라 그대로 둔다.
- **인물을 지우면 손대지 않은 이름 후보도(2026-10-21):** 인물을 저장할 때 생긴 용어 후보(이름·별칭, 메모 "인물 이름"/"X의 별칭") 가운데 아직 후보이고 번역이 없고 메모 그대로이며, 남은 다른 인물이 같은 이름을 쓰지 않는 것은 인물과 함께 지워지고 ⌘Z로 함께 돌아온다. 사람이 손댄 용어는 남는다.
- **문제 유형 태그는 보이는 노드로만 바뀐다(2026-10-21).** 형식 검사·용어 검사·AI 검수는 통과/실패와 결과 칸(`issues`, `kind`, `categories`)만 내고 태그를 붙이거나 떼지 않는다. 태그는 `태그 붙이기` 반영 노드(동작 붙이기/떼기; 고른 태그·문제 유형 또는 앞 단계 결과 필드가 이름 붙인 태그, 모든 문제 유형 떼기)가 바꾸고, 문제 유형 태그는 처음 붙일 때 프로젝트에 만든다. 기본 번역 흐름은 실패 → 붙이기, 통과 → 떼기(그 검사의 종류만; 검수 통과는 모든 문제 유형)로 배선한다. 암묵 규칙은 하나: 번역문이 실제로 바뀌면(번역 저장·사람 저장) 그 대사의 문제 유형 태그를 모두 뗀다.
- **인물 색(2026-10-21):** 인물마다 색을 고를 수 있다(인물 › 색, 태그와 같은 팔레트, 기본은 없음). 정한 색은 그 인물의 이름·별칭이 보이는 모든 곳에 같다: 대사 목록·상세, 대사 그래프 카드·노드 상세·번역 카드, 경로 보기, 인물 관계 그래프, 관계 표, 인물 표, 사건 카드, 근거 대사, 화자 필터, 검색. 이름 철자로 색을 정하던 자동 색은 없앴다(색은 뜻이 있을 때만). 가져오기 파일의 `characters[].color`.
- **자료는 인물·관계 → 사건 → 노트(2026-10-21):** 사람·AI가 써 두는 참고 글(스토리·세계관·문체·메모)은 "노트"다. 번역 › 대사의 "문서"(게임 속 문서 텍스트)와 이름이 겹치지 않게 했다. 대본에서 뽑아 그래프로 보는 인물·관계와 사건을 붙이고, 자유 글인 노트를 마지막에 둔다. 자료의 기본 탭은 인물·관계. 저장 이름(`documents`, `save_document`)은 그대로.
- **사건 흐름도 같은 그래프 동작(2026-10-21):** 단축키·오른쪽 클릭 메뉴(사건: 상세·복제·복사·삭제 / 선: 상세·삭제 / 빈 곳: 사건 추가·붙여넣기·자동 정렬)·복제·삭제 도구·도구 막대(가로·세로 포함, 머리글에서 뺌)가 인물 관계 그래프와 같다. 카드마다 점이 둘이다: 위(왼쪽)는 앞 사건에서 들어오는 선, 아래(오른쪽)는 다음 사건으로 나가는 선. 끌어서 다른 카드 어디에 놓아도 이어진다. 선은 대사 그래프에서 계산되지만 사람이 고칠 수 있다: 직접 이은 선은 `event_links`(added)에, 지운 계산 선은 hidden으로 남아 다시 계산해도 살아나지 않는다. 선을 클릭하면 오른쪽에 출처(대사 그래프: 두 대사 키 / 직접 이음: 사람·AI)와 삭제. 사건 추가 버튼은 표 보기에만. CLI·채팅은 `link_events`(link/unlink, 제안)로 고치고 `list_events`의 `next`로 본다. 번역 › 그래프(장면·대사, 경로 보기, 끝점 고르기)의 캔버스도 같은 도구 막대(확대·맞춤·가로·세로·미니맵)를 쓰고, 가로·세로는 머리글에서 뺐다.
- **머리글: 보기 탭은 제목 옆, 동작은 오른쪽(2026-10-21):** 무엇을 보는지 고르는 탭(인물·관계의 그래프·인물·관계, 사건의 흐름·표, 번역 › 그래프의 장면·대사)은 늘 그 자리에 있으므로 제목 바로 옆(`HeaderViews`)에, 선택에 따라 나타났다 사라지는 동작·추가 버튼은 오른쪽(`HeaderActions`)에 둔다. 캔버스 도구 막대는 묶음(확대·맞춤·자동 정렬·방향·미니맵) 사이에 구분선을 둔다.
- **인물 관계 그래프는 캔버스에서 편집한다(2026-10-21):** 인물의 점을 다른 인물로 끌면 관계("관계")가 생기고 그 쌍이 열린다(관계 칸이 펼쳐진 채). 선을 클릭하면 쌍을 열어 관계·말투를 입력·수정한다. 오른쪽 클릭은 인물(상세·복제·복사·삭제)/선(상세·삭제)/빈 곳(인물 추가·붙여넣기·자동 정렬). 인물 하나를 고르면 위에 복제·삭제 도구가 뜬다. 붙여넣기·복제는 "이름 (복사)"와 그들 사이 관계를 만든다. 아래 도구 막대는 워크플로 편집기와 같고 '자동 정렬'이 위치를 다시 계산한다. 위치는 이 브라우저에만 남고, 편집하면 모두 제자리에 고정된다(화면도 다시 맞추지 않는다). 그래프 보기에는 머리글의 인물 추가·관계·말투 추가 버튼이 없다.
- **노드 목록은 네 묶음, 색도 묶음을 따른다(2026-10-20).** AI(보라, 결과를 만든다) · 반영(파랑, 프로젝트에 쓴다: 저장 노드, 상태 변경, 용어 상태 변경) · 함수(초록, 읽고 판단·계산: 형식 검사, 용어 검사, 스크립트, HTTP) · 흐름(노랑: 조건, 모으기). 묶음은 `functionGroup` 한 곳이 정한다.
- **프리셋은 여러 워크플로에서 다시 쓰는 것만(2026-10-20):** 번역, 검수(그리고 자유 형식). 한 곳에서만 쓰는 지시문(청자 추정, 용어 추출·번역, 인물·관계·사건 추출, 작품 분석, 편집기의 다듬기)은 그 워크플로의 AI 노드나 편집기 설정 안에 있다(코드에서는 `AI_PROMPTS`).
  - 관계의 형식(2026-10-23): AI는 쌍마다 `{between: [두 사람], views: [{from, to, kind, description, evidence, changes: [{at, kind, cause}]}, …]}`를 낸다. `views`는 하나 또는 둘로 `between`의 방향(from→to 또는 to→from)이며 같은 방향을 두 번 쓰지 않고(대본이 `from`이 `to`를 어떻게 보는지 보여 줄 때만 그 방향을 내고, 동료·연인·형제자매·친구처럼 양쪽이 같으면 두 방향 모두), `kind`는 `to`가 `from`에게 누구인지 짧은 명사 하나다(양쪽 역할을 함께 쓰거나("두목-부하") 여럿을 잇거나("동료 / 파트너") 변화를 넣지("협력에서 적대로") 않는다.). 시간에 따른 변화는 그 시각의 `changes`에 대사 id(`at`)와 새 관계(`kind`)와 이유(`cause`)로 적는다. 방향이 없거나 셋 이상이거나 겹치거나 쌍의 방향이 아니면 요청이 `invalid-output`으로 실패해 재요청 노드가 다시 보낸다. 저장은 시각마다 방향이 있는 행(종류·설명·근거·변화)이고, 두 시각의 종류와 변화(같은 대사의 같은 새 관계, 또는 없음)가 같으면 쌍방(`mutual`) 행 하나, 변화는 `{at, kind, cause}`(바뀐 뒤의 관계)로 저장한다. 번역 문맥의 관계는 묶음의 첫 줄 기준(그 줄까지 지난 변화를 반영한 종류)이고, 첫 줄 뒤에 묶음 안에서 바뀌는 변화만 `changes`로 따로 준다. 관계 그래프 선의 이름은 `종류 ▸ 바뀐 종류 ▸ …`, 한 방향 선에도 화살표(→/←, 쌍방은 ↔)가 붙는다.
  - 작품 분석: `진입 → AI "작품 분석"(json·대본 전체) → 인물 저장 → 관계 저장 → 말투 규칙 저장 → 사건 저장 → 용어 저장 → 문서(개요) 저장`. 장면별 청자는 만들지 않는다(청자는 청자 추정 워크플로가 대사별로). 인물을 먼저 저장해 뒤의 관계·말투 규칙이 이름을 찾는다. 대본이 여러 요청으로 나뉘면 조각마다 저장된다(같은 이름의 인물은 합쳐지고 개요는 갱신). 조각을 합치는 AI 단계(모으기 → 결과 합치기)는 기본에 없고 필요하면 사용자가 더한다. 필요 없는 항목은 필드와 반영 노드를 지우면 된다(예전 섹션 선택 대신).
  - 용어 추출: `진입 → AI "용어 추출"(json·장면 묶음) → 용어 저장 → 종료`.
  - 사건 추출: 같은 방식.
  - 인물·관계 추출: `진입 → AI "인물·관계 추출" → 모으기(인물·관계·말투 규칙, 대사 id 포함) → AI "인물·관계 합치기"(`peopleMerge`: 인물은 사람마다, 관계는 쌍마다 방향별 시각 둘(변화는 대본 순서), 말투 규칙은 화자→청자 구간마다 하나) → 인물 저장 → 관계 저장 → 말투 규칙 저장`. 장면을 읽는 동안에는 저장하지 않고 각 목록을 합친 뒤 한 번만 저장한다(2026-10-22). 대사 없이 조각만 받는 합치기 요청은 조각이 가진 대사 id만 답에 남긴다. AI는 새 인물뿐 아니라 이미 있는 인물에 대해 이 장면이 보여 주는 역할·성별·나이대·별칭·프로필도 낸다. (2026-10-23) 저장된 글은 AI가 고쳐 쓰지 않고 새로 알게 된 것만 더한다. 인물의 프로필·말버릇은 전체 글 대신 `newFacts`·`newSpeech`(각각 `{text, evidence}` 목록, 저장된 글이 아직 말하지 않은 사실만, 없으면 빈 목록)로 받는다. 인물 저장은 새 별칭을 더하고(다른 저장된 인물의 이름은 더하지 않음) 모르던 역할·성별·나이대만 채우며, 새 사실을 프로필·말버릇 끝에 한 줄씩 덧붙인다(출처와 상관없이 기존 글은 그대로, 이미 적힌 사실은 건너뜀, 아직 저장되지 않은 인물은 새 사실이 곧 프로필). `profiles` 설정과 `save_character` 제안 올리기는 없다. 관계 저장은 저장된 관계의 종류·설명을 두고 새 변화만 변화 목록 끝에 덧붙이고(같은 대사의 변화는 건너뜀), 말투 규칙 저장은 저장된 규칙을 두고 새 구간·새 쌍의 규칙만 넣는다(같은 쌍·구간에서 다른 규칙은 넣지 않고 후보도 만들지 않음). ‘AI 결과: 바로 확정’은 새 항목이 확정/후보로 들어가는지만 정한다. 합치기는 이름이 나온 인물의 저장된 프로필·말버릇·역할·성별·나이대·별칭과 저장된 관계·말투 규칙을 문맥으로 받는다. (2026-10-26) AI 문맥 `대화 쌍`(`context.pairs`, `pairMinTurns` 기본 3): 보내는 대사에서 청자(없으면 바로 이어 말한 사람)로 센 대화 쌍과 횟수를 `talkingPairs`로 보낸다(합치기 노드는 실행이 읽은 모든 대사). 장면 AI는 쌍마다 관계를 쓰거나 `pairsWithoutRelationship`에 이유를 적고, 합치기는 쌍마다 최종 관계를 내거나 `unresolvedPairs`에 이유를 적는다. 관계 저장(`params.unresolved`)은 못 정한 쌍 중 두 사람이 저장된 인물인 쌍을 관계 `관계 미확인` 후보(확인 권장)로 넣고, 인물이 아닌 사람이 낀 쌍은 넣지 않고 결과에 센다. 같은 쌍의 진짜 관계가 나중에 저장되면 후보는 그 관계로 바뀐다. (2026-10-26) 실험에서 사람이 아닌 화자 이름(OBJECTIVE·Telephone·La Grenouille)이 인물로 저장되고 한 사람이 두 이름(Voltaire / Inspector Voltaire)으로 갈라졌다. 장면 노드와 합치기는 사람이 아닌 이름을 `notPeople: [{name, reason}]`에 적고(인물이 아님, 합치기는 `characters`에 내지 않음), 관계 없는 쌍은 필수 `kind`(`notPerson`·`noEvidence`·`undecided`)를 갖는다. 인물 저장 `params.notPeople`: 만들지 않고, 같은 이름의 저장된 인물은 두고 확인 권장 `인물이 아닐 수 있음: 이유`만 붙인다. 관계 저장 `params.unresolved`: `notPerson` 쌍은 버리고 수만 센다. 합치기는 같은 사람의 이름을 가장 온전한 이름 하나+별칭으로 내고, 인물 저장은 저장된 인물에 쓰던 별칭 규칙(한 단어 이름 ⊂ 다른 이름, 별칭끼리는 잇지 않음)을 같은 저장 안의 새 인물끼리에도 적용한다.
  - 청자 추정: `진입 → AI "청자 추정"(json: 값·확신도) → 청자 저장`. 어떤 줄을 할지는 실행 창(`#청자 미상`). 확신도가 낮은 추정도 적고 `#청자 미상`으로 표시된다.
  - 번역 (2026-10-21, 이름 "번역 (검수 포함)"에서 바뀜): `진입 → AI 번역 → 번역 저장 → 형식 검사 → AI 검수 → 완료로 → AI 용어 추출 → 용어 저장`(AI 노드마다 재요청 노드 둘). 초벌 상태로 바꾸는 단계는 없다. 검사·검수 결과의 문제 유형 태그는 태그 붙이기 노드가 붙이고 뗀다. 형식 검사나 검수를 못 넘은 줄은 AI 수정(번역문과 앞 단계의 지적 `issues`·`categories`·`kind`를 읽고 지적된 곳만 고침) → 수정 번역 저장 → 형식 검사로 돌아가며, AI 수정이 3번 지난 뒤에도 못 넘으면(`AI 수정 3회 미만?`) "검토 필요"로 간다(새 프로젝트 기본 상태, 검토함에 나옴). 기본 상태는 홈 설정의 상태(처음엔 미번역 · 번역됨 · 검토 필요 · 완료)이고, 이미 번역이 있는 줄은 가져올 때 검토함이 아닌 첫 중간 상태(번역됨)다. 새 프로젝트는 태그 `AI 실패`도 갖는다(아직 템플릿에는 연결하지 않음).
  - 템플릿 목록(`WORKFLOW_TEMPLATES`, `@tw/shared`): 번역 · 청자 추정 · 인물·관계 추출 · 사건 추출 · 용어 추출 · 용어 번역 · 작품 분석. 새 프로젝트는 홈 설정이 고른 템플릿(처음엔 앞의 넷: 번역·청자 추정·인물·관계 추출·사건 추출)과 홈에 올린 워크플로를 갖고, 나머지는 "새 워크플로"에서 템플릿으로 만든다. 모자란 상태·태그는 비워 두고 검증이 고르라고 한다. "말투만 고치기"와 "초벌 번역"은 없앴다.
  - 용어 번역: `진입(용어) → AI 용어 번역(json: 표기·메모) → 용어 표기 저장`.
- 지시문은 프리셋 문장이 처음부터 채워진 상태로 보이고 편집할 수 있다.
- 자료 화면의 "작품 분석"·"인물 분석" 버튼은 저장된 워크플로를 고르는 일반 `RunDialog`를 연다(기존 결정 유지).

#### 3.3 스크립트 노드 JSON 필드
- 구현 완료(de952ba). 필드 타입은 2.1의 확장 타입을 같이 쓴다. 스크립트 결과도 반영 노드의 입력으로 매핑할 수 있다.

---

### 과제 4: `형식 검사`(`formatCheck`) 비정규식 규칙 확장 & 정규식 `[✦ AI로 규칙 만들기]`

#### 4.1 글자 수 · UTF-8 바이트 수 · 줄당 글자 수 · 줄 수 · 길이 비율 · 금칙어 규칙 추가
- **수정 파일 1**: [`packages/shared/src/format-check.ts`](file:///Users/bh2980/Desktop/translation_workbench/packages/shared/src/format-check.ts)
  - `FormatCheckOptions` 인터페이스 확장:
    ```ts
    export interface FormatCheckOptions {
      placeholders?: boolean;
      tags?: boolean;
      newlines?: boolean;
      emptyText?: boolean;
      numbers?: boolean;
      spaces?: boolean;
      particles?: boolean;
      particlesPattern?: string;
      /** 최대 글자 수 제한 (0 또는 미지정 시 비활성) */
      maxChars?: number;
      /** 최대 UTF-8 바이트 수 제한 (0 또는 미지정 시 비활성) */
      maxBytes?: number;
      /** 줄바꿈(\n) 기준 한 줄당 최대 글자 수 제한 */
      maxLineChars?: number;
      /** 최대 줄 수 제한 */
      maxLines?: number;
      /** 원문 글자 수 대비 최대 길이 비율 (예: 1.5 -> 원문의 1.5배 이하) */
      maxLengthRatio?: number;
      /** 쉼표(,)로 구분된 단순 금칙어 목록 */
      forbiddenWords?: string;
      customRules?: CustomFormatRule[];
      rules?: FormatRules | null;
    }
    ```
  - `FormatChecks` 인터페이스에 아래 필드 추가:
    ```ts
    lengthFailed: string[];
    forbiddenWordsHit: string[];
    ```
  - `checkFormat(source, translation, options)` 내부에 검사 로직 추가:
    ```ts
    const lengthFailed: string[] = [];
    if (options.maxChars && options.maxChars > 0 && translation.length > options.maxChars) {
      lengthFailed.push(`글자 수 초과 (${translation.length}/${options.maxChars}자)`);
    }
    if (options.maxBytes && options.maxBytes > 0) {
      const byteLen = new TextEncoder().encode(translation).length;
      if (byteLen > options.maxBytes) {
        lengthFailed.push(`바이트 수 초과 (${byteLen}/${options.maxBytes}바이트)`);
      }
    }
    const lines = translation.split('\n');
    if (options.maxLines && options.maxLines > 0 && lines.length > options.maxLines) {
      lengthFailed.push(`줄 수 초과 (${lines.length}/${options.maxLines}줄)`);
    }
    if (options.maxLineChars && options.maxLineChars > 0) {
      const longest = Math.max(...lines.map((l) => l.length));
      if (longest > options.maxLineChars) {
        lengthFailed.push(`한 줄 최대 글자 수 초과 (${longest}/${options.maxLineChars}자)`);
      }
    }
    if (options.maxLengthRatio && options.maxLengthRatio > 0 && source.trim().length > 0) {
      const ratio = translation.length / source.length;
      if (ratio > options.maxLengthRatio) {
        lengthFailed.push(`원문 대비 길이 비율 초과 (${ratio.toFixed(2)}배 > ${options.maxLengthRatio}배)`);
      }
    }
    const forbiddenWordsHit: string[] = [];
    if (options.forbiddenWords?.trim() && translation) {
      const words = options.forbiddenWords.split(',').map((w) => w.trim()).filter(Boolean);
      for (const word of words) {
        if (translation.includes(word)) forbiddenWordsHit.push(word);
      }
    }
    ```
  - `formatIssueMessages(checks)`에 메시지 추가:
    ```ts
    for (const msg of checks.lengthFailed ?? []) issues.push(msg);
    if (checks.forbiddenWordsHit?.length) issues.push(`금칙어 포함: ${checks.forbiddenWordsHit.join(', ')}`);
    ```
- **수정 파일 2**: [`packages/shared/src/functions.ts`](file:///Users/bh2980/Desktop/translation_workbench/packages/shared/src/functions.ts#L27-L43)
  - `formatCheckParams`에 `maxChars`, `maxBytes`, `maxLineChars`, `maxLines`, `maxLengthRatio`, `forbiddenWords` 스키마를 추가합니다.

#### 4.2 자연어로 정규식 만들기 (`POST /projects/:projectId/generate-regex`) 및 UI 연동
- **수정 파일 1**: [`apps/server/src/routes/projects.ts`](file:///Users/bh2980/Desktop/translation_workbench/apps/server/src/routes/projects.ts)
  - 엔드포인트 추가:
    ```ts
    .post(
      '/projects/:projectId/generate-regex',
      zValidator(
        'json',
        z.object({
          prompt: z.string().min(1).max(500),
          target: z.enum(['token', 'check']),
        }),
      ),
      async (c) => {
        const projectId = c.req.param('projectId');
        found(db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
        const { prompt, target } = c.req.valid('json');
        const sampleRows = db
          .select({ source: s.units.source, translation: s.units.translation })
          .from(s.units)
          .where(eq(s.units.projectId, projectId))
          .limit(20)
          .all();
        const modelChoice = editorAi.model; // 설정 › 에디터의 AI 모델
        const schema = z.object({
          label: z.string().describe('규칙의 짧은 한국어 이름 (예: 중괄호 변수, 영문 대문자 약어 금지)'),
          kind: target === 'token'
            ? z.enum(['placeholder', 'tag']).describe('placeholder(치환자) 또는 tag(서식 태그)')
            : z.enum(['forbidden', 'preserve', 'targetRequired']).describe('forbidden(번역문 금지), preserve(원문→번역 보존), targetRequired(번역문 필수)'),
          pattern: z.string().describe('슬래시(/) 없이 작성한 유효한 JavaScript RegExp 패턴 문자열'),
          example: z.string().describe('매칭 예시 문자열 1~2개'),
        });
        const result = await callObject({
          db,
          secrets,
          modelChoice,
          schema,
          prompt: [
            target === 'token'
              ? '사용자의 설명에 맞는 게임 대본 치환자(placeholder) 또는 서식 태그(tag)용 JavaScript 정규식 패턴을 작성하세요.'
              : '사용자의 설명에 맞는 번역 형식 검사(forbidden: 번역문 금지 패턴, preserve: 원문과 번역문에서 동일하게 보존할 패턴, targetRequired: 번역문에 반드시 있어야 할 패턴)용 JavaScript 정규식 패턴을 작성하세요.',
            `사용자 요청: ${prompt}`,
            sampleRows.length ? `대본 샘플:\n${sampleRows.slice(0, 10).map((r) => `- ${r.source}`).join('\n')}` : '',
          ].filter(Boolean).join('\n\n'),
        });
        const patErr = formatPatternError(result.pattern);
        if (patErr) throw new HTTPException(400, { message: `생성된 정규식이 올바르지 않습니다: ${patErr}` });
        return c.json(result);
      },
    )
    ```
- **수정 파일 2**: [`apps/web/src/components/format-rules.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/format-rules.tsx) & [`apps/web/src/components/workflow/node-config/function.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/workflow/node-config/function.tsx)
  - 두 화면 모두 사용자 정의 정규식 섹션 상단에 **`[✦ AI로 규칙 만들기]`** 인라인 입력창(프롬프트 `<Input placeholder="예: 대괄호 두 개로 감싼 변수 [[ID]]" />` + `<AiButton size="sm">만들기</AiButton>`)을 배치하여, 자연어로 입력하면 즉시 정규식 행이 추가되도록 구현합니다.

---

### 과제 5: `자료 › 인물·관계`의 `관계 표` 및 `그래프`에서 새 관계·말투 추가

- **수정 파일**: [`apps/web/src/routes/p.$projectId.knowledge.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/routes/p.$projectId.knowledge.tsx) (Line 541 부근)
- **문제 원인**:
  - Line 541이 `{!pairsView && spec.create && <Button ...><Plus /> {KINDS[tableKind]}</Button>}`로 되어 있어, `인물 표`(`display === 'characters'`)에서는 `+ 인물` 버튼이 보이지만 `관계 표`(`pairsView`)나 `그래프`(`graph`)에서는 추가 버튼이 아예 사라짐.
- **정확한 구현 코드**:
  - `tab === 'people' && (pairsView || graph)`일 때 `HeaderActions`에 **`<AddPairPopover>`**(`+ 관계·말투 추가`)를 렌더링합니다:
  ```tsx
  function AddPairPopover({
    projectId,
    characters,
    onCreated,
  }: {
    projectId: string;
    characters: Character[];
    onCreated: (pairKey: string) => void;
  }) {
    const [open, setOpen] = useState(false);
    const [fromName, setFromName] = useState('');
    const [toName, setToName] = useState('');
    const [level, setLevel] = useState('해요체');
    const [relKind, setRelKind] = useState('');
    const qc = useQueryClient();

    const submit = useMutation({
      mutationFn: async () => {
        const from = fromName.trim();
        const to = toName.trim();
        if (!from || !to) return;
        // 1. 화자 인물이 아직 없으면 생성
        const existingFrom = characters.find((c) => c.name.toLowerCase() === from.toLowerCase());
        let fromId = existingFrom?.id;
        if (!fromId) {
          const created = await unwrap(
            client.projects[':projectId'].characters.$post({
              param: { projectId },
              json: { name: from, aliases: [], profile: '', status: 'confirmed' },
            }),
          );
          fromId = created.id;
        }
        // 2. 청자가 특수 청자(others/self/group/public)가 아니고 인물이 없으면 생성
        const isSpecial = SPECIAL_LISTENERS.some((s) => s.key === to);
        let toId: string | undefined;
        if (!isSpecial) {
          const existingTo = characters.find((c) => c.name.toLowerCase() === to.toLowerCase());
          toId = existingTo?.id;
          if (!toId) {
            const created = await unwrap(
              client.projects[':projectId'].characters.$post({
                param: { projectId },
                json: { name: to, aliases: [], profile: '', status: 'confirmed' },
              }),
            );
            toId = created.id;
          }
        }
        // 3. 기본 말투 규칙 생성
        await unwrap(
          client.projects[':projectId']['speech-rules'].$post({
            param: { projectId },
            json: { fromName: from, toName: to, level: level.trim() || '해요체', address: '', note: '', status: 'confirmed' },
          }),
        );
        // 4. 두 인물 간 관계 종류를 입력했거나 둘 다 일반 인물인 경우 관계 생성
        if (fromId && toId && (relKind.trim() || !isSpecial)) {
          await unwrap(
            client.projects[':projectId'].relationships.$post({
              param: { projectId },
              json: { fromId, toId, kind: relKind.trim() || '지인', description: '', status: 'confirmed' },
            }),
          );
        }
        return pairKey(from, to);
      },
      onSuccess: (key) => {
        void qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
        setOpen(false);
        if (key) onCreated(key);
      },
    });
    // Popover UI: 화자 선택/입력, 청자 선택/입력(특수 청자 포함), 기본 말투(해요체/하십시오체/해라체/반말), 관계 요약 입력 및 [추가] 버튼
  }
  ```

---

### 과제 6: 그래프 조작 & 저장되는 보기(view)

> 6.1·6.2는 구현·검증 완료(f6a73ea, 2a677b8, 9b4c746). 6.3 이후는 2026-10-19 개정.

#### 6.1 `GraphCanvas` 마우스 조작 개편: 좌클릭 드래그 다중 선택 상자(Marquee) + 휠 클릭 드래그 이동(Pan)
- **수정 파일**: [`apps/web/src/components/graph/graph-canvas.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/graph/graph-canvas.tsx)
- **Props 확장 (`graph-canvas.tsx:132-164`)**:
  ```ts
  selectedIds?: Set<string>;
  onSelectMany?: (ids: Set<string>, primaryId?: string) => void;
  ```
- **`d3-zoom` 필터 변경 (`graph-canvas.tsx:547`)**:
  ```ts
  const zoom = d3zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([MIN_K, MAX_K])
    .filter((event: MouseEvent | WheelEvent | TouchEvent) => {
      if (event.type === 'wheel') return true;
      if (event.type === 'touchstart' || event.type === 'touchmove') return true;
      // 마우스 드래그 이동(Pan)은 휠 클릭(button === 1) 또는 Space 키를 누른 상태의 좌클릭만 허용
      if (event instanceof MouseEvent) {
        return event.button === 1 || (event.button === 0 && spacePressed.current);
      }
      return false;
    })
  ```
- **좌클릭 드래그 선택 상자(Marquee Selection) 처리**:
  - `<canvas>`에 `onPointerDown`, `onPointerMove`, `onPointerUp`을 추가하여 `event.button === 0 && !spacePressed.current`일 때:
    - 드래그 거리가 `4px` 미만이면 기존과 동일한 단일 클릭(`onClick`)으로 처리 (Shift/⌘ 클릭 시 `selectedIds`에 해당 노드를 토글 추가/제거).
    - 드래그 거리가 `4px` 이상이면 화면 좌표 `(startX, startY) ~ (curX, curY)`를 그래프 월드 좌표 `(wx0, wy0, wx1, wy1)`로 변환(`(clientX - rect.left - t.x) / t.k`)하고, `index.nodeIndex.search(minX, minY, maxX, maxY)`로 상자와 겹치는 모든 노드의 ID를 수집하여 `onSelectMany(nextSet)`을 호출합니다.
    - 드래그 중에는 `<canvas>` 위(또는 `draw()` 마지막 단계)에 반투명 선택 상자(`border border-primary bg-primary/10`)를 렌더링합니다.
- **다중 선택 노드 렌더링 (`graph-canvas.tsx:452`)**:
  ```ts
  const isSelected = node.id === selected || Boolean(props.current.selectedIds?.has(node.id));
  ```

#### 6.2 워크플로 캔버스(`ReactFlow`) 마우스 조작 통일 및 다중 노드 삭제/복제
- **수정 파일**: [`apps/web/src/routes/p.$projectId.workflows.$workflowId.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/routes/p.$projectId.workflows.$workflowId.tsx)
- `<ReactFlow>`에 다음 props를 전달하여 `GraphCanvas`와 조작 방식을 100% 통일합니다:
  ```tsx
  <ReactFlow
    selectionOnDrag
    panOnDrag={[1]}
    selectionMode={SelectionMode.Partial}
    ...
  />
  ```
- 우클릭 컨텍스트 메뉴에서 다중 선택된 노드(`nodes.filter(n => n.selected)`)가 2개 이상일 때 `선택한 노드 N개 복제` 및 `선택한 노드 N개 삭제`가 동작하도록 처리합니다.

#### 6.3 오른쪽 클릭은 선택·상세를 바꾸지 않는다 (버그)
- 현재 `GraphCanvas`의 `onContextMenu`가 `select(nodeId)`로 URL `node`를 바꿔 상세 패널이 열린다(장면 그래프·대사 그래프 모두).
- 고칠 것: 오른쪽 클릭은 메뉴의 대상만 기억하고(캔버스에 대상 강조), URL 선택과 패널은 그대로 둔다. 상세는 메뉴의 `상세 속성 열기`로만 연다. 워크플로 캔버스도 같은 규칙.

#### 6.4 저장되는 보기(view)
- **개념:** DB의 view처럼 **정의만 저장**하고 연결·배치는 원본 그래프에서 계산한다.
  - 저장: 남길 노드 id, 만든 방식(AI 요청문 / 직접), 노드별 남긴 이유(AI가 만든 경우), 이름.
  - 계산: 남긴 노드 사이의 **파생 연결** = 남긴 노드 A에서 남기지 않은 노드만 거쳐 남긴 노드 B에 닿는 원본 경로가 있으면 A→B. 거리 제한 없음(지금 `contractEdges`의 깊이 12 제한을 없애거나 크게 올린다). AI는 연결을 만들지 않는다.
  - 파생 연결마다 서버가 계산한 사실만 붙인다: `생략 · 대사 n줄 · 조건 k · 화자 …`. 누르면 생략된 실제 노드·대사 목록과 `원본에서 이 구간 보기`.
  - 배치: 남긴 노드 + 파생 연결만으로 ELK가 새로 배치한다(`nodeSetLayout`의 view 배치와 `viewEdges` 재사용, 방향별 캐시). 원본이 바뀌면 다시 계산하고, 원본에서 사라진 노드는 `원본에 없음`으로 표시한다.
  - 화면 표시: `보기 "이름" · 남김 n / 원본 m · 파생 연결 포함`. 파생 연결은 점선.
- **스키마:** `graph_views`에 `origin`(`ai`·`manual`), `request`(AI 요청문), `reasons`(노드 id → 이유), `updatedAt`을 더한다.
- **만들기**
  - **AI 간략 보기:** 그래프 상단 `AI 간략 보기` 버튼 → 채팅 패널이 열리고 현재 구역이 문맥으로 들어간다. 사용자가 "올렉 사망 분기만" 같은 요청을 쓰면 채팅 AI가 읽기 도구(`find_lines`, `line_context`, `find_reading_route`, `show_graph` 등)로 노드를 고르고 `show_graph`(남길 노드 + 이유 + 이름)로 보기를 저장한 뒤 그 보기를 연다. 그래프 전용 AI는 따로 만들지 않는다.
  - **직접 만들기:** 원본 그래프에서 박스·Shift 선택 → 오른쪽 클릭 `선택한 노드로 보기 만들기`.
- **열기·관리**
  - 그래프 상단의 `구역` 선택을 `보기` 선택으로 넓힌다: 원본 구역들 / 구분선 / 저장된 보기들. URL은 `section=view:<id>` 그대로(뒤로/앞으로·링크 공유).
  - 보기를 연 상태에서 오른쪽 상세 패널(Inspector): 이름 바꾸기, 만든 방식과 요청문, 노드·연결 수, `요청 고쳐 다시 만들기`(채팅으로 이어짐), 삭제. 노드를 고르면 "이 보기에 남긴 이유"가 함께 보인다.
  - 보기 안에서: 노드 오른쪽 클릭 `이 보기에서 빼기`. 원본 그래프에서 고른 노드 → `보기에 추가`.
  - 보기가 많아지면 표(DataTable) 관리 화면을 둔다(1차 범위 아님).
- **없앨 것:** 규칙 기반 `단순화 보기`(`simplify` URL 값, 대사 없는 노드 자동 제외), 세션 저장 숨김 노드(`tw.graph.hidden.*`, `이 노드 숨기기`, `주변 흐름만 보기`, `모두 표시` 배지). 숨기고 싶은 경우는 보기로 만든다.
- **AI 요약문(2차):** 생략 구간의 한 줄 요약은 1차에 넣지 않는다. 대사 목록만으로 읽기 어렵다는 판단이 서면, 파생 연결에 `✦ AI 요약` 표시를 단 보조 문구로 붙인다(노드로 만들지 않는다).

#### 6.5 채팅 `show_graph`
- 이미 구현: `between`(두 끝 사이의 모든 갈래), `exclude`(79c1d6a).
- 바꿀 것: `simplify` 옵션은 지운다. `nodes`(남길 노드)마다 `reason`을 받고, `mode: "view"`이면 위 보기로 저장한다. 결과는 보기 id와 여는 링크.

---

### 과제 7: 홈 설정 (새 프로젝트 기본값, 2026-10-27)

설계: `docs/DESIGN-APP-SETTINGS-2026-10-27.md`.
- **한 번 복사, 연동 없음.** 홈 › 설정(`/settings/...`)은 새 프로젝트가 만들어질 때 복사해 가는 기본값이다. 그 뒤 홈을 바꿔도 이미 있는 프로젝트는 그대로다. 맞추고 싶으면 사람이 설정 › 프로젝트의 "홈 기본값"에서 **가져오기**(홈 → 프로젝트) 또는 **홈 기본값으로 저장**(프로젝트 → 홈)을 누른다.
- **홈에 있는 것:** 연결, 상태·태그(사람이 만든 태그), 에디터 AI, 채팅(권한·새 대화 모델·권한 모드·저장한 지시), 워크플로(새 프로젝트가 받을 템플릿 + 프로젝트에서 올린 워크플로), AI 결과 바로 확정, 화면(테마). **프로젝트에만 있는 것:** 서식 규칙(파일 > 자동 감지), 번역 제외, 자동 표시 색, 이름·언어·그래프 상태.
- **연결은 프로젝트마다 따로다**(`connections.project_id`; null = 홈). 새 프로젝트는 홈 연결을 키까지 복사한다. 가져오기는 같은 이름 연결의 주소·키를 갱신하고(id 유지) 없는 것은 더한다. 프로젝트의 워크플로·실행·`--model 연결:모델`은 그 프로젝트의 연결만 찾는다. 2026-10-27 이전 데이터는 서버가 처음 뜰 때 한 번 프로젝트마다 연결을 복사하고 고른 것을 옮긴다(`services/connection-split.ts`, 그 전에 DB를 `backups/`에 복사).
- **목록은 이름으로 잇는다.** 가져오기는 상태·태그·저장한 지시 중 없는 이름만 더하고(대사가 가리키는 기존 것은 건드리지 않음), 워크플로는 새로 더한다. 올린 워크플로는 상태·태그·연결 id를 이름으로 적어 두고(`savedWorkflowSchema.refs`), 복사할 때 그 프로젝트의 같은 이름(상태는 종류·검토함으로도)을 찾는다. 못 찾으면 비워 두어 워크플로 검증이 묻는다.
- **채팅·CLI:** `read_app_defaults`(읽기), `pull_app_defaults`(제안, 연결·채팅 권한은 빼고), `loca defaults`, `loca defaults pull <섹션...>`. 홈 설정을 고치거나 올리는 일은 사람만 앱에서 한다.

---

### 과제 8: 앱 없이 에이전트가 끝까지 (CLI, 2026-10-30)

사람은 앱에서 연결·권한·워크플로를 세팅하고 디버깅할 때 앱을 켠다. 나머지는 코딩 에이전트가 `loca`로 스스로 판단해 하고, 채팅으로 결과만 보고한다. 앱으로 하는 일 대부분이 CLI로도 된다.

- **터미널 권한 모드:** 프로젝트 설정 `agentSettings.terminalPermissionMode`(수락/거절 · 자동 검토 · 바로 반영, 기본 수락/거절). 설정 › 채팅에서 사람이 정한다.
  - 터미널에는 대화가 없어 이 모드 하나를 따른다. 모드의 뜻은 채팅 대화의 권한 모드와 같다(`change-gate.ts`, 자동 검토는 실행·삭제·20개 넘는 변경·경고를 묻는다).
  - `loca import`도 같은 관문을 지난다.
  - 바로 반영된 것도 제안 기록에 남는다(`decidedBy` auto/bypass).
  - 터미널은 모드가 반영한 것만 `loca proposals undo`로 되돌린다. 사람이 수락한 것은 앱에서 되돌린다.
- **바로 하는 것(관문 없음):** 저장된 보기 만들기·고치기·지우기(번역 데이터가 아님), 실행 일시정지·취소(비용 없음), 새 프로젝트 만들기(`loca projects import`, 있던 프로젝트를 건드리지 않음), 노드·연결 시험(저장 안 함).
- **기다리기는 SSE:** `loca proposals wait`, `loca runs wait`, `runs start/resume/continue --wait`는 `/api/events`의 변경 알림을 받을 때마다 상태를 다시 읽는다. 반복 조회는 하지 않는다.
- **실행 운영:**
  - `continue_run` 도구(채팅·CLI 공용, 실행 권한)가 일시정지한 실행을 이어 하거나, 멈춘·끝난 실행을 실패 다시 보내기·다른 모델로 이어 한다. 러너의 `resumeRun`·`continueRun`을 DB 함수로 나눠 도구와 러너가 같이 쓴다.
  - `read_run`은 `notice`, 상태별 수, 끝난 곳(`ends`), **실패했거나 오류 출구로 빠진 줄**(`errors`, `errored`)을 준다.
  - 오류로 빠진 줄은 오류가 지워진 뒤에도 경로에서 찾는다(마지막 AI·HTTP·스크립트 시도가 `error`). 기본 워크플로는 AI 오류를 `검토 필요로`로 보내 "끝남"으로 마치기 때문이다.
  - `loca runs start --rerun-errors <실행>`은 그 줄만 새로 실행한다.
- **대사 그래프 보기를 범위로:**
  - `lineFilterSchema.view`(이름·id)로 `lines`·`export`·`check`·`runs plan/start --view`가 보기 안의 대사만 고른다.
  - `viewFlow`가 보기를 흐름 순서로 세운다: 보기 안의 선을 따르고, 선이 말하지 않는 곳(여러 시작, 나란한 갈래, 고리의 입구)은 대본 순서를 쓴다.
  - `loca views show`는 갈림·합쳐짐·선택지를 보여 준다. 내보내기는 보기를 흐름 순서로 낸다.
- **내보내기 문맥은 AI 노드와 같다:** `export -c N`의 `before`는 대본 순서가 아니라 대사 그래프를 거슬러 간다(`precedingLines`, AI 노드의 `GraphIndex` 그대로). 갈래가 합쳐지는 곳은 `beforeBranches`로 나눈다.
- **그 밖에 CLI로 연 것:**
  - `loca workflows test`: 스크립트·HTTP 노드 시험, 저장 전 파일도 된다.
  - `loca connections`: 목록과 모델 시험. 연결 추가와 키는 사람만 한다.
  - `loca regex`
  - `loca terms discover`: `discover_terms` 도구.
  - `loca statuses order`·`loca tags order`: `order_settings` 도구, 되돌리기 가능.
  - `loca projects import`
- **CLI로 열지 않은 것:**
  - 에디터의 한 줄 AI 번역·다듬기: 에이전트가 직접 번역(export/import)하거나 워크플로를 쓴다.
  - 자료·용어의 "사람이 확인함": 사람의 판단을 표시하는 것이라 사람만 한다.
  - 연결·키·권한·홈 설정: 사람만 한다.
- **skills:** 공통 규칙은 `.claude/skills/loca`(혼자 끝까지 하는 순서 포함)로 옮겼다. 스킬은 심볼릭 링크 없이 `.claude/skills/`에 바로 두어, Windows 클론에서도 Claude Code가 저장소를 열면 바로 찾는다.

---

### 과제 9: 실제 번역 한 바퀴에서 나온 개선 (2026-10-30)

실제 게임 프로젝트 하나를 터미널에서 끝까지 돌려 본 결과(인물 정리 → 말투 규칙 → 청자 → 재번역 417줄). 검토 필요로 빠진 106줄 중 105줄이 줄바꿈 하나 때문이었고, 용어 점검 34건이 거의 오탐이었다.

**A. 버그**
- **앞뒤 공백·줄바꿈은 원문을 따른다.** 번역문의 앞뒤 공백은 번역자가 다루지 않는다. `shared`의 `withSourceWhitespace(source, text)`가 원문의 앞뒤를 본문에 붙인다. 번역을 쓰는 두 곳(`saveLine`, `applyRunCandidate`)이 이것으로 저장하고, 같은 번역인지 비교하는 곳(충돌, 후보 재사용)도 같은 기준을 쓴다. 워크플로 반영의 문자열 `trim()`은 번역 텍스트(`saveCandidate.text`)에는 하지 않는다. 에디터는 본문만 보여 주고 받는다.
- **누가 했는지 바르게 남긴다.** 제안으로 들어온 변경은 내용을 만든 쪽이 AI다(`origin: ai`, 대사는 후보 `origin`). 확정은 사람이 앱에서 수락했으면 `human`, 자동 검토·바로 반영이면 `ai`. 제안을 반영할 때 도구에 `decidedBy`를 넘긴다.
- **청자 확신도 기준.** `set_listeners`는 확신도가 기준(0.9) 미만이라 "모름"으로 읽힐 줄을 결과에 따로 알린다.

**B. 작은 개선**
- **실행 결과:** 끝난 곳은 노드 id로 묶고 이름이 같으면 앞 노드로 구별한다. 대사가 오류 출구로 나간 뒤 다음 노드를 지나도 마지막 오류(`lastError`)는 남긴다. CLI의 "대상 상태" 표시(없어진 설정)는 지운다.
- **실행 범위:** `runScopeSchema`에 `speakers`(이름·별칭), `listeners`, `kinds`, `q`(원문 글자)를 더하고 `runs plan/start`에 `--speaker`·`--listener`·`--kind`·`-q`로 연다. `--key`가 1000개에서 잘리던 것을 고친다.
- **번역어 중복:** 서로 다른 원문의 확정 용어가 같은 번역어면 용어 표시 `#번역어 중복`(`duplicateTarget`). 막지 않는다(자동 확정을 켠 사람의 선택).
- **혼잣말:** 청자 `self`는 "정해진 청자"다(#청자 미상 아님). 번역 문맥은 혼잣말이라고 알리고, 인물 → `self` 말투 규칙이 있으면 그것을 쓴다.

**C. 구조**
- **용어 적용 범위:** 용어마다 `scope`(`all` · `ui` · `dialogue`)와 `matchCase`. 사용처, 용어 점검, 번역 문맥 주입이 같은 매처(`termMatcher`)로 범위와 대소문자를 지킨다. 품사·형태소 분석은 범위로 안 풀리는 경우가 나오면 다시 본다.
- **용어 번역어 후보:** 대사 번역처럼 용어도 번역어를 여럿 갖는다. `target`이 메인(번역 문맥·용어 검사에 쓰임), `targetCandidates`가 나머지(이전 메인, AI가 낸 다른 표기; migration 0097). 메인이 바뀌면 이전 메인은 후보로 내려간다. AI 용어 추출·용어 번역이 다른 표기를 내면 "AI 결과 바로 확정"이 켜져 있고 사람이 정한 메인이 아닐 때만 메인이 되고, 아니면 후보로 들어간다. 용어 창의 "다른 번역어"에서 메인으로 바꾼다.
- **용어 검사 노드:** 번역·검수 워크플로는 형식 검사 뒤에 용어 검사(`glossaryCheck`, 모델 호출 없음)를 둔다. 실패하면 용어 태그 → AI 수정, 통과하면 용어 태그를 뗀다.
- **판정 연결은 범용 출력으로:** 엔진은 연결 종류를 모른다. `runner.judgeLines`를 지우고, System One 연결은 `packages/ai`에서 AI 노드의 `verdict`·`choice`·`json`(예/아니오·숫자·보기 필드)을 자기 질문 형식으로 바꿔 답한다. 프롬프트·문맥(청자·말투 규칙 포함)은 다른 모델과 같다. 처리 못 하는 출력(`text`, 목록 필드, 묶음 전체)은 노드 검증이 막는다.
- **말투 판정 재료:** 조건 데이터 `unit.speechLevel`(그 줄의 화자 → 청자 말투 규칙 등급), 선택지 출처 `speechLevels`(말투 등급).
- **`loca check speech` 삭제.** 어미 정규식은 정확도가 낮다(실제 프로젝트 87줄: 등급 80%, Jev 94%). 에디터의 추정 표시만 남긴다. 말투는 워크플로의 판정이 본다.

**D. 기본 워크플로**
- **번역:** 그대로 둔다(번역 → 저장 → 형식 검사 → AI 검수). 말투 판정을 넣으면 일반 모델로는 묶음마다 호출이 하나 늘어 예산 검사(`pnpm budget`)에서 호출 수가 81~120% 늘었다(모의 모델 기준).
- **검수 (새 기본 워크플로):** 번역이 있는 대사를 상태로 골라(`runs start 검수 --status 번역됨`) 형식 검사 → 말투 판정(AI 선택 노드: 말투 등급, 조건 노드: 규칙이 없거나 같으면 통과, 확신도 0.7 미만은 AI 검수로) → AI 검수 → 통과면 완료, 실패면 AI 수정. 말투 판정 노드에는 판정 연결(Jev)을 고르는 것을 권한다.

**E. 실제 모델로 검수를 돌려 본 뒤 (2026-10-30)**
검수를 번역됨 대사 11줄에 돌렸더니 3줄이 대사의 "help me"를 UI 용어 "Help → 도움말" 위반으로 잡혀 AI 수정 세 번을 다 쓰고 검토 필요로 갔고, 그 사이 AI 수정이 `\r\n`을 `\n`으로 바꿔 저장했다.
- **줄바꿈 문자도 원문을 따른다.** `withSourceWhitespace`(이전 이름 `withSourceEdges`)가 본문의 줄바꿈을 원문 본문의 것으로 쓴다: 개수가 같으면 하나씩, 다르면 원문이 한 종류만 쓸 때 그 종류로(섞여 있으면 그대로).
- **바꾸지 않은 수정은 다시 돌지 않는다.** 번역 저장이 저장 전 번역과 같으면(공백·줄바꿈 기준도 같게) `unchanged`를 낸다. 번역·검수 템플릿은 수정 번역 저장 뒤 조건 "수정으로 바뀌었나?"를 두고, 아니면 바로 검토 필요로 보낸다.
- **이스케이프된 줄바꿈도 줄바꿈이다.** 다시 돌렸을 때 Agy CLI(Gemini)의 수정이 `\r`을 `&#13;`로 써서 그대로 저장됐다. 원문에 없는 공백 문자 참조(`&#13;`·`&#9;`·`&#x3000;`·`&nbsp;`·`&Tab;` 등, 가리키는 문자가 `\s`인 것)는 저장할 때 그 문자로 되돌린다(진짜 줄바꿈 바로 앞의 `&#13;`는 뺀다). 앞뒤 공백은 처음부터 `\s` 전체(탭, 줄바꿈 없는 공백, 전각 공백 포함)를 원문에 맞춘다.
- **UI 용어는 UI 줄에만.** AI 용어 추출이 종류 `ui`로 낸 용어는 범위 `ui`로 저장한다. 이미 있는 용어는 범위가 기본값(`all`)이고 사람이 정하지 않았을 때만 바꾼다.

**F. 번역됨 228줄 검수 (2026-10-30)**
227줄 완료(그중 16줄은 사람이 저장한 번역이라 AI 결과가 후보로만 남고 상태는 번역됨), 1줄 검토 필요, 9.7분, 호출 250개(말투 판정 233).
- **말투 규칙이 없으면 말투 판정을 건너뛴다.** 말투 판정 233번 중 화자가 있는 줄은 1줄이었다(나머지는 UI 줄, 규칙이 없어 판정과 상관없이 통과). 검수 템플릿은 판정 앞에 조건 "말투 규칙이 있나?"(`unit.speechLevel`)를 둔다.
- **"수정으로 바뀌었나?"는 AI 수정이 받은 문장과 견준다.** 사람이 저장한 줄에서는 실행의 문장이 줄이 받지 않은 후보라, 저장된 번역과 견주면 틀린다. 러너가 새 후보를 받을 때 그 전 문장을 `textBefore`로 남긴다.
- **미리보기의 기대 요청 수는 최대치를 넘지 않는다.** 과거 실행의 대사당 요청 수는 묶음 크기가 다른 작은 실행에서 나와, 228줄에 곱하면 106(최대 16)이 나왔다(실제 7).

**G. 되돌아가는 선이 있는 대사 그래프 (2026-10-30)**
인트로 대사는 다음(`NextText`)과 이전(`PreviousText`) 선이 쌍으로 있어 순환이다. ELK의 순환 끊기(`DEPTH_FIRST`)는 주어진 노드 순서대로 탐색을 시작하는데 노드를 저장된 순서로 넘겨서, 네 번째 대사가 ROOT가 되고 첫 대사가 아래쪽에 갔다.
- **노드를 대본 순서로 넘긴다.** 노드의 `rank`(첫 줄의 `seq`, 줄 없는 노드는 이어진 노드의 것에 한 걸음마다 아주 조금 더하거나 뺀 값; `script-rank.ts`)로 레이아웃 직전에 정렬한다. 접힌 줄은 구성원 중 가장 앞의 rank, 구역 사이 포털은 들어오는 쪽이 맨 앞, 나가는 쪽이 맨 뒤. 순환이 아닌 선은 그대로 둔다(ELK `MODEL_ORDER`는 순환이 아닌 선까지 대본 순서에 맞춰 뒤집어서 쓰지 않는다). 선은 하나도 빼지 않고 되돌아가는 선이 위로 그려진다. `LAYOUT_VERSION` 9.

**H. 그래프의 번역 카드 (2026-10-31)**
긴 대사에서 카드가 화면보다 길어져 스크롤도 안 됐다(에디터 아래의 "바뀐 곳"·번역 후보 3개·태그 줄이 원문만큼 길었다). 그래프의 카드는 한 줄을 확인하고 고쳐 다음으로 넘기는 작은 에디터다.
- **빼는 것:** 태그 줄, "바뀐 곳", 번역 후보와 유사 번역(에디터 `compact`; 후보를 안 보이니 ⌥⇧1…3도 끈다). 모두 줄의 상세·번역 화면에 있다. 카드에 기능을 더하지 않는다. 남은 후보: 줄 힌트(용어·말투 칩).
- **접지 않고 가둔다:** 카드는 캔버스 높이(위아래 여백 뺀 값)를 넘지 않는다. 머리줄(화자·이동·닫기)은 고정하고 나머지가 카드 안에서 스크롤된다. 긴 내용을 접어 두는 방식이 아니라, 원문과 번역이라는 두 영역이 정해진 높이 안에서 스크롤한다.
- 카드는 캔버스의 검색창·보기 칩 위에 뜬다(`CanvasFloat raised`): 머리줄이 가려지지 않는다.

**I. 오른쪽 패널의 윗줄 (2026-10-31)**
에이전트 탭이 `속성 | 에이전트 | 검색 | 접기` 줄 아래에 대화 목록·새 대화·닫기 줄을 따로 두었고, 그 닫기는 패널 접기와 같은 일을 했다. 대화 목록과 새 대화를 탭 줄(`DockHeaderSlot`)로 올리고 닫기를 없앴다: 채팅 본문이 줄 하나만큼 높아진다. 속성 탭의 상세 패널도 마찬가지다: 선택을 닫으면 패널도 닫혀 접기 버튼과 같은 일이라, 도크 안의 `InspectorHeader`는 `x`를 그리지 않는다(선택은 남는다). 도크가 없는 화면(홈 설정)에서는 `x`가 남는다.

**J. 이어진 대사 펼치기·접기 (2026-10-31)**
접힌 이어진 대사(`chain:`)는 서버 레이아웃에 박혀 있어, 펼칠 때마다 레이아웃을 다시 돌리면 "계산 중"이 뜬다. 한 줄로만 이어진 구간이라 펼침은 기하 연산으로 충분하다: `unfoldChains`(`unfold-chains.ts`)가 저장된 레이아웃에서 블록을 줄마다 한 칸으로 바꾸고, 블록 끝 뒤의 모든 것을 늘어난 만큼 밀어(가로 전체 폭) 겹침이 없다. 들어오는 선은 첫 줄에, 나가는 선은 마지막 줄에 이어지고 줄 사이의 선은 곧게 그린다(`link:`). 계산도 서버도 없이 즉시 된다.
- **상태는 주소에:** `open`(펼친 구간의 id 목록; 바꿀 때 `replace`). 없으면 노드가 40개 이하인 그래프·보기는 전부 펼치고 큰 그래프는 접는다(`AUTO_OPEN_NODES`); `[]`는 전부 접음.
- **버튼:** 접힌 카드 오른쪽 위 "펼치기", 펼친 구간의 첫 줄 오른쪽 위 "접기"(앱의 외곽선 버튼처럼 테두리와 화살표 선을 캔버스에 그리고, 올리면 배경이 바뀐다; 누름은 캔버스가 판정), 노드의 우클릭 메뉴에도 같은 항목.
- 줄 사이 선(`link:`)은 원래 선의 id가 아니라 그린 것이라 고르거나 고칠 수 없다.

**K. 그래프 오른쪽 패널의 줄 읽기 (2026-10-31)**
이어진 대사 패널은 줄마다 원문 아래에 연한 글자로 번역이 붙고 줄 사이에 구분이 없어, 번역이 흐리고 어디서 줄이 바뀌는지 알기 어려웠다.
- **`FlowLine`(`@loca/ui`):** 원문은 작고 연한 `text-xs`, 번역은 본문 `text-sm`에 왼쪽 세로선으로 원문과 짝을 짓는다. 줄 사이에 구분선(`FlowRow`), 번역이 없으면 점선 상자로 "번역 없음"을 말한다.
- **보기 전환:** 패널 머리 아래 `원문 | 번역 | 둘 다`. 화자 칸 폭처럼 이 화면의 설정(`localStorage`)이고 주소에는 넣지 않는다. 하나만 보일 때는 그것이 본문 글자다.

**L. 그래프 카드에도 원문·번역 (2026-10-31)**
캔버스 카드는 원문만 보였다. `원문 | 번역 | 둘 다`(`lib/graph-show.ts`, 캔버스 도구 줄)가 카드와 오른쪽 패널을 함께 바꾼다(한 설정, 이 브라우저에만 저장).
- 서버가 노드마다 첫 줄의 `translation`(앞 120자)을 같이 보낸다. 갱신은 `graph`가 `units`를 `IMPLIES`로 포함하므로 따로 잇지 않는다.
- 카드 크기는 그대로(레이아웃은 서버가 한 번 계산한다): 번역은 번역 두 줄, 둘 다는 원문 한 줄 위에 번역 한 줄(연한 글자 위에 본문 글자). 번역이 없으면 "번역 없음"을 기울여 연하게 그린다. "노드 찾기"는 번역 글자도 찾는다.

**M. 제안 카드가 말하는 것 (2026-10-31)**
자료 일괄 저장 카드는 입력만 읽어 `수정 · <id>`만 보였다(고치는 항목은 바뀐 필드만 보내므로 이름도 없다). 서버가 목록에 `details`를 붙인다(`proposal-details.ts`): 항목마다 무엇인지(이름, `화자 → 청자`)와 필드별 지금 값(수락한 뒤에는 되돌리기 호출이 담은 이전 값) → 새 값, 같은 값은 뺀다. `unitId`·묶음·상태·태그·워크플로 id는 이름으로 바꿔 보인다. 입력만으로 다 말하는 도구(용어 저장, 대사 변경 등)는 그대로다. 채팅 안의 도구 호출 카드(`tool-part`)는 아직 입력만 읽는다.

**N. 후보를 고르면 번역이 된다 (2026-10-31)**
에디터의 후보 목록에서 후보를 눌러도 글상자에 글만 들어가 "초안 보관됨"으로 남아, 번역으로 보이는데 저장이 안 된 줄이 생겼다(패널·캔버스는 저장된 값을 보인다). 서버는 `saveLine({ candidateId })`로 후보 선택을 이미 지원하고, 저장한 번역은 후보로 남으니 이전 번역을 잃지 않는다. 그래서 `takeSuggestion`: **이 줄의 후보**(`candidateId`가 있는 것)는 누르면(⌥⇧1…3 포함) 바로 저장하고 알린다; **다른 줄의 번역**(같은 원문·비슷한 줄)은 이 줄에 맞게 고칠 글이라 글상자에 초안으로 넣는다; 저장 안 한 타이핑이 있으면(글이 사라지므로) 후보도 초안으로 넣는다.

**O. 그래프 옆 패널: 노드와 흐름 (2026-10-31)**
노드를 누르면 흐름 목록만 나오고, 한 줄의 상세나 노드 정보는 볼 방법이 없었다(번역 화면으로 나가야 했다). 노드를 누르는 것은 그 노드를 보겠다는 뜻이라, 패널은 **`노드 | 흐름`** 두 보기를 갖는다(`FlowPane` `view`; 마지막으로 쓴 것을 기억, 기본은 흐름; `lib/graph-show.ts`).
- **흐름:** 선택한 노드(이어진 대사면 그 노드들)의 줄과 그 앞뒤 흐름을 순서대로. 앞뒤는 카드에서 ⌥↓가 넘어가는 규칙(`neighbour`)으로 갈림길·합류·끝까지, 6개씩 보이고 "더 보기"로 10개씩 는다. 멈춘 까닭을 말한다. 선택한 줄은 표시한다(앞뒤가 있을 때만).
- **노드:** 종류·키·장면, 대사를 접이식 행으로(`FlowDisclosure`; 한 줄이면 처음부터 펼침, 안에 `LineDetail bare`가 줄의 정보·후보·이력·검증을 보인다; "이 줄 고치기"는 카드를 연다), 연결(앞·뒤 노드와 길 위의 선택지; 누르면 그 노드를 고른다).
- **원문 | 번역 | 둘 다**는 패널에서 빼고 캔버스 도구 줄의 것 하나가 카드와 패널을 함께 바꾼다.
- 카드의 오른쪽 패널 아이콘은 이 노드 정보를 연다(번역 화면으로 나가지 않는다; 번역 화면 링크는 패널 아래에 있다).

**P. 줄 상세의 레이아웃 (2026-10-31)**
속성 구역(청자·번역 대상·태그·메모)이 위쪽을 차지해 번역에 쓰는 후보·TM·검증이 밀렸고, 태그와 청자는 헤더에도 있어 겹쳤다. 속성 구역을 없애고 헤더로 올렸다.
- **헤더:** 종류 줄 오른쪽에 번역 스위치(번역 대상 / 제외; 규칙으로 제외된 줄은 마우스를 올리면 이유)와 원문 편집; 제목 `화자 → 청자`의 청자가 바로 바꾸는 선택(`ListenerPicker inline`, 미상이면 "청자 미상"); 상태 줄; 태그와 메모는 자기 줄(`InspectorHeader below`; 메모가 없으면 `＋ 메모`).
- **구역 순서:** 번역 후보·TM → 말투와 인물 → 검증 → 이력 → 정보(대사 키, 원문, 대사 그래프) → AI 프롬프트. 헤더와 겹치던 장면·화자 행은 정보에서 뺐다(화자는 "말투와 인물"로).
- 헤더가 없는 곳(그래프 노드 탭의 접이식 행, `LineDetail bare`)은 같은 청자·번역 스위치·태그·메모를 행 맨 위의 작은 블록으로 보인다.

**Q. 후보 목록 대신 AI 제안과 이력 (2026-10-31, N·P를 대체)**
줄마다 쌓인 "후보"(지난 번역, 실행이 낸 번역, 가져온 번역)는 번역하는 사람에게 고를 거리가 아니었다: 대부분 이미 지나간 번역이고, 사람이 정해야 하는 것은 사람이 번역한 줄에 AI가 새로 낸 번역뿐이다. 후보는 세 상태를 가진다(`candidates.state`, 마이그레이션 0098이 기존 것을 나눔): `pending`(AI 제안, 결정을 기다림) · `history`(줄이 가졌거나 가진 번역) · `declined`(거절한 제안, 이력에 남음).
- **AI 제안이 생기는 곳:** 사람이 번역한 줄에 실행의 번역 저장이 닿을 때(줄은 그대로, 같은 실행의 앞 단계 제안은 대체, 사람 번역과 같으면 없음), 채팅·CLI의 `propose_translation`. 편집기의 AI 번역·다듬기는 결과가 바로 입력란에 들어가므로 제안이 아니다.
- **결정:** 편집기 아래(그래프 카드 포함)와 줄 상세 맨 위에 가장 새 제안 하나를 지금 번역과의 차이로 보이고 [적용][거절]. 적용은 그 제안으로 저장(`saveLine({candidateId})`), 입력란에 저장 안 한 글이 있으면 입력란에 넣기만 한다(저장하면 같은 글의 제안이 정리됨). 거절은 `POST /units/:unitId/candidates/:candidateId/decline`. 에이전트는 `decide_suggestion`(변경 관문). 기다리는 줄에는 #AI 제안 대기(`aiSuggestion`) 표시가 붙고 그것으로 거른다.
- **편집기:** 입력란 아래는 AI 제안과 비슷한 번역(TM, 다른 줄의 같은·비슷한 원문)뿐. ⋯ 메뉴는 늘 있고 원문 넣기(`Mod+Shift+S`)가 들어 있다. "바뀐 곳"은 이력으로 옮겼다.
- **줄 상세:** 헤더 첫 줄 `대사 · #번호 ⧉`(대사 키 복사, 툴팁에 키 전체) … 번역 스위치, 그래프 아이콘(노드 하나면 바로, 여럿이면 메뉴), 원문 편집. 구역은 AI 제안(있을 때만) → 비슷한 번역(3개 + 더 보기, 쓰기는 입력란으로) → 말투와 인물 → 검증 → 이력 → AI 프롬프트. 정보 구역은 없앴다(원문 복사는 줄 메뉴에).
- **이력:** 접힌 채로 시작한다(제목에 개수). 줄의 번역들(누가 냈는지, 앞 번역에서 바뀐 낱말)과 번역을 남기지 않은 실행을 시간순으로, 처음 3개 + 더 보기. 지난 번역은 되돌리기, 거절한 제안은 적용. 상태·태그·메모의 변경 기록은 아직 없다(필요해지면 따로).
- 그래프 노드 탭의 노드 키에도 복사 버튼.

**R. 화면 정리 묶음 (2026-10-31)**
- **이력:** 항목마다 머리 줄(누가 · 배지 · 언제)과 번역 두 줄 미리보기만. 누르면 전문과 "앞 번역과 다른 곳". 되돌리기(거절한 제안은 적용)는 머리 줄 오른쪽 끝에 두고, 마우스를 올리거나 열었을 때 보인다. 같은 글이 연달아 남으면 한 항목(×n). 번역을 남기지 않은 실행은 한 줄. 공용 부품 `HistoryList` `HistoryItem`.
- **채팅:** 첨부 `+`는 입력칸 위 첨부 줄의 맨 앞(첨부한 칩이 그 옆). 아래 줄은 모델·권한·사용량·보내기.
- **그래프 노드 탭:** 헤더 첫 줄 `종류 · 노드 키 ⧉`(노드 형식은 툴팁), 제목 화자, 아래 장면(여러 줄이면 줄 수). "노드" 구역은 없고, 이어진 노드는 헤더 아래 칩 한 줄(없으면 없음). 대사가 한 줄이면 접지 않고 그 줄과 "이 줄 고치기", 줄 상세 구역을 바로 보인다.
- **용어 적용 범위:** 태그의 붙는 곳처럼 `UI · 대사 · 문서` 체크박스(하나는 남음). 저장은 종류 목록(`terms.scope`, 마이그레이션 0099: all → 셋 모두, ui → UI, dialogue → 대사·문서). 도구·CLI는 목록을 받고 all / ui / dialogue 낱말도 읽는다.
- **실행 상세:** 개수는 탭(`대사별 120`). 필터가 걸렸을 때만 필터 줄(남은 수 · 필터 지우기).
- **말투·관계 줄:** 그래프 카드와 대본 행에서 자르지 않고 다 보인다.
- **AI 간략 보기 버튼은 없앴다.** 같은 일은 채팅에서 하거나 저장한 지시(`/`)로 한다.
- **앞뒤 공백:** AI 프롬프트에는 줄의 본문만 보낸다(앞뒤 공백은 저장할 때 원문 것이 붙는다). 모델이 이스케이프된 원문을 베껴 `GRAPHICS\n` 같은 용어를 만들던 원인. 용어의 원문·번역어는 앞뒤의 공백과 그것을 적은 `\n` `\r` `\t`를 떼고 저장한다(`termText`).
- 대사 표 머리 줄 아래 구분선.
- **뒤이은 정리:**
  - 이력의 되돌리기는 자리를 따로 차지하지 않고, 마우스를 올리거나 펼쳤을 때 날짜 자리에 뜬다(채팅 대화 목록의 개수와 같은 방식).
  - 채팅 `+`는 @가 아니라 이미지 파일 선택이다(붙여넣기·끌어 놓기와 같은 경로, 공용 부품 `FilePickButton`). 항목·화면 첨부는 입력칸에 @.
  - 실행 기록: 표 위에는 조치가 필요한 알림(멈춘 실행)만 둔다. 실행 ID·시작·모델·진행·호출·토큰·이어서 실행은 줄을 고르지 않았을 때의 오른쪽 패널("실행")에 있다.
  - 용어 상세: 등장 대사는 접힌 채로, 높이 제한 없이 처음 5개 + 더 보기. "대소문자 일치"는 설명 없이 스위치만.
  - 그래프 옆 패널: 번역 화면 열기는 헤더의 아이콘(노드 | 흐름 옆).
  - 앱이 저절로 떼는 태그는 없다: 번역이 바뀌어도(실행의 번역 저장, 사람의 저장) 문제 유형 태그를 떼지 않는다. 떼는 건 워크플로의 태그 떼기 노드이고, 기본 번역·검수 워크플로는 "수정으로 바뀌었나? → 예" 다음에 "지적 태그 모두 떼기"를 둔다(이전 프로젝트의 워크플로에는 이 노드가 없다).
  - 태그에 "설명"(마이그레이션 0101).
  - 검사·검수가 찾은 것을 적는 태그(형식 오류·용어 위반·말투 어긋남·의미 오류·문체 어색·기타 지적·AI 실패)는 보통 태그다(마이그레이션 0102: 역할을 없애고, 예전 짧은 이름은 뜻이 드러나는 이름으로, 없던 것은 만들고, 워크플로의 태그 노드는 id로). 새 프로젝트는 이 7개로 시작하고, 템플릿은 이름으로 찾아 잇는다. 태그 노드는 `tagIds`(고른 태그)와 `categoryTags`(AI 검수 등이 내는 종류 → 태그)로 붙이고 떼며 태그를 만들지 않는다. 앱이 따로 두는 태그는 자료의 `확인 권장` 하나뿐이다.
  - 확인 권장은 자동 태그다: 분석이 남긴 이유는 자료 항목의 `review_note`에 있고(인물·관계·말투 규칙·사건·노트), 이유가 있는 동안 #확인 권장이 붙고 사람이 확인함·버리기·고치기로 정하면 비워진다. 이름·색은 다른 자동 태그처럼 프로젝트마다 바꾼다. 마이그레이션 0104가 확인 권장 태그의 메모를 항목으로 옮기고 그 태그를 지우며 `tags.role`을 없앤다: 앱이 관리하는 태그는 남지 않는다.
  - 자동 태그는 줄·항목의 다른 칸에 보이지 않는 사실만이다(번역 불일치, AI 제안 대기, 확인 권장, 근거 부재, 대본 미등장, 번역어 중복). 행이 이미 보여 주는 것은 그 칸의 필터다: 최종 아님(상태), 정한 쪽 AI/사람(✦), 청자 모름(청자), 메모 있음, 번역 제외(숨기기 기본 / 함께 / 이것만, 행의 상태 칸에 "· 번역 제외"), 번역 비어 있음(용어). 앱 URL·CLI(`--unfinished` `--by` `--listener -` `--noted` `--excluded` `--empty-target`)·채팅 도구·실행 범위·워크플로 조건(`unit.final` `unit.statusBy` `unit.listenerUnknown` `unit.noted`)이 같은 필드를 쓴다. 마이그레이션 0105가 저장된 이름·색을 지우고 워크플로 조건을 새 필드로 바꾼다.
  - 자동 태그 11개는 프로젝트마다 이름·색을 바꿀 수 있다(설정 › 상태·태그에서 자동 태그를 누름, `markStyles`, 마이그레이션 0103). 설명과 붙는 곳은 앱의 것이다.
  - 설정 › 상태·태그의 태그 표에는 태그만 있다. 자동 표시 11개(#남은 줄 …)는 아무도 붙이지 않는 계산된 표시라 이 표에서 뺐고, 각 화면의 필터에 있다. 표시의 색은 처음 정한 색으로 고정(`markColors` 설정과 열은 마이그레이션 0100에서 삭제). 기본 항목은 17 → 6(AI 실패 + 문제 유형).

**나중에:** 문장 속 용어만 판정 연결로 적합성 확인. 일부러 틀린 말투로 만든 번역을 Jev가 잡는지 시험. Jev의 말투 확신도가 실제 대사에서 대부분 0.7 미만(0.45~0.68)이라 판정이 AI 검수로 넘어간다: 기준을 낮출지, 판정 질문을 바꿀지 본다.

### 과제 10: 브라우저 공책 — 바뀐 행만 오고 바뀐 줄만 다시 그린다 (2026-10-31)

문제: 같은 행이 질의마다 사본으로 있었고, 서버는 "주제가 바뀜"만 알려서 줄 하나가 바뀌어도 질의 여러 개를 통째로 다시 받고 화면 전체를 다시 그렸다(실행 중 대본 화면: 알림마다 약 230KB, 그중 필터에 맞는 모든 줄 id 207KB). 사본을 손으로 맞추는 코드(`unitChanges`, 화면별 낙관적 갱신)가 흩어져 있었다.

결정: TanStack DB 컬렉션(`@tanstack/react-db`)을 브라우저의 공책으로 쓰고, 원본은 서버 SQLite다.
- **행 피드**: 컬렉션에 들어가는 표마다 SQLite 트리거가 `row_changed`(`db/row-changes.ts`)로 바뀐 행 id를 적는다(0106·0107·0108). 쓰는 곳이 어디든(라우트·실행기·도구·가져오기) 빠지지 않는다. 변경 이벤트에 `rows`(컬렉션별 `upsert`·`delete`)와 `seq`가 실리고, 쓰기 응답은 `x-seq`를 준다. 스냅샷은 `GET /projects/:id/sync/:collection`.
- **통째로 받는 컬렉션**: 용어, 인물, 관계, 말투 규칙, 노트, 상태, 태그(`lib/terms.ts`, `lib/knowledge.ts`). 행 모양은 목록 라우트와 같은 함수(`feed.ts`).
- **대사**: 9천 줄을 다 들지 않는다. 화면은 `GET units/ids`(페이지의 id, 전체 개수, 페이지에 있는 장면의 줄 수)를 묻고 줄은 `units` 컬렉션에서 읽는다(`lib/units.ts`). 이벤트는 바뀐 줄의 **id만** 싣고(500개 넘으면 `reload`), 브라우저는 그중 들고 있는 줄만 `units/by-ids`로 다시 읽는다. 읽기마다 `seq`가 붙어 더 새것만 덮는다. 열린 줄의 AI 제안·실행 기록(`units/extras`)도 같은 방식으로 따로 든다. 상세 패널은 줄과 같은 칸을 줄 행에서, 제안·기록을 그 컬렉션에서, 무거운 문맥(이웃 줄, 말투 규칙 풀이, 그래프 노드, 장면의 이름들)만 `GET units/:id`로 읽고, 그 문맥은 피드가 그 줄이나 이웃을 부를 때와 자료·그래프가 바뀔 때만 다시 받는다(`useLineDetail`).
- **장면과 프로젝트**: 장면마다 진행(상태별 줄 수, 번역 제외, 청자 모름, AI가 정한 줄)이 한 행이다(`groups` 컬렉션, 0109). 프로젝트의 설정은 한 행(`project`, 0111)이고, 진행률·검토함·번역 제외·장면 수는 장면 행을 브라우저에서 더한다(`useProjectProgress`). 화자·청자(0111)와 실행(0110, 줄 상태별 개수 포함)도 행이다.
- **서버가 계산하는 목록**: 사건 흐름(어디서 일어나고 무엇으로 이어지는지)과 워크플로 목록(검사 오류 수)은 여러 표를 읽어 계산한다. 그 표들의 트리거가 컬렉션 전체를 적고(0113), 피드가 다시 계산해 마지막으로 보낸 것과 다른 행만 보낸다(`feed.ts` DERIVED).
- **컬렉션의 첫 불러오기**: 실패하면 1초부터 두 배씩 30초까지 기다리며 다시 시도한다(서버가 켜지는 중·다시 켜지는 중). 영구 실패 상태가 없어 화면은 "불러오는 중"을 보인다.
- **쓰기**: 늘 서버 API(와 터미널은 변경 관문)를 거친다. 화면은 먼저 바뀌고(`createOptimisticAction`), 응답의 `x-seq`가 피드로 돌아오면(`sent`, 대사는 다시 읽기까지 `idle`) 끝난다. 줄 쓰기는 모두 `changeLines`, 확정·버리기는 `decideItems`, 순서 바꾸기는 `reorderTaxonomy`.
- **필터 한 벌**: 용어·자료의 거르기(`termMatches`, `knowledgeMatches`, `pairMatches`)는 `@tw/shared`에 있고 화면과 목록 도구·CLI가 같이 쓴다. 대사 필터는 지금처럼 서버 SQL 하나(`unitConditions`)다.
- **표**: `DataTable`은 행 객체·선택·`rowDeps`가 그대로면 그 행을 다시 그리지 않는다. 대본의 줄(`LineItem`)도 같다.
- **주제(topics)가 남은 곳**: 화면이 묻는 답(필터의 페이지 id, 검색, 비슷한 번역 제안, 미리보기, 그래프·길 보기, 워크플로·실행의 상세, 제안함, 연결, 채팅)과 태그별 개수(`q.statusCounts`, `units` 아래: 줄과 함께 바뀐다), 그리고 CLI의 기다리기. `units → statuses` 함의는 뺐다(줄이 바뀌어도 워크플로 검사를 다시 받지 않는다).
- **처음에 "그대로 둔다"고 했다가 옮긴 것**: 장면별 진행 개수는 "장면 전체의 합이라 행이 아니다"라고 봤지만, 장면 하나의 개수는 그 장면의 행이다. 사건 흐름은 "서버 계산이 무겁다"고 봤지만, 계산한 결과를 행으로 보내면 된다. 둘 다 위처럼 옮겼다.

측정은 `docs/EVENTS-20.md`의 "브라우저 공책 후".

## 3. 단계별 실행 및 검증 체크리스트 (2026-10-19 개정)

1. **정리 — 첫 구현에서 개정과 맞지 않는 부분 제거**
   - [ ] `classifyTarget`, `attachClassifiedTag`, `shouldAutoApply`, `AUTO_APPLY_FUNCTIONS`, `autoApply`·`asCandidate`, 목적별 출력(`terms`·`knowledge`·`analysis`·`listener`)과 `sections`
   - [ ] 그래프 `simplify` URL 값·자동 제외, 세션 숨김 노드와 그 메뉴·배지, `show_graph`의 `simplify`
   - [ ] 오른쪽 클릭이 선택·상세를 바꾸는 버그(6.3)

2. **AI 노드 범용 출력 (과제 2)**
   - [ ] `packages/shared`: `output`(`text`·`verdict`·`choice`·`json`), `scope`(`line`·`batch`), `choice` 선택지·값 목록 출처, 재귀 `jsonFieldSchema`(목록·근거 타입)
   - [ ] 서버: 프롬프트는 지시문 + 출력 형식 강제 + 입력 형식 설명만. `analysisRequest`의 숨은 규칙 제거. 묶음 결과 저장과 대사별 참조
   - [ ] 웹: 출력 형태·단위 선택, 확장 필드 편집기(하위 필드 접기/펴기, JSON 스키마 텍스트), 프리셋 선택, 프롬프트 미리보기
   - [ ] mock LLM: 새 출력 형태와 묶음 출력에 응답(`mock-llm.test.ts`가 스키마 일치 확인)

3. **반영 노드 & 기본 워크플로 (과제 3)**
   - [ ] 반영 노드 11종(3.1 표)을 도구 서비스 위에 구현, 필드 매핑과 자동 채움, 매핑 누락 preflight
   - [ ] 기본 워크플로·템플릿을 실제 노드로 다시 작성(3.2), 기존 프로젝트의 기본 워크플로 교체(레거시 호환 없음)

4. **저장되는 보기 (과제 6.4–6.5)**
   - [ ] `graph_views` 컬럼 추가(`origin`·`request`·`reasons`·`updatedAt`) + 마이그레이션
   - [ ] 파생 연결 계산(거리 제한 없음)과 생략 구간 사실 요약, 원본 변경 시 재계산
   - [ ] `보기` 선택, 보기 상세 패널, 보기에서 빼기·보기에 추가·선택으로 보기 만들기, `AI 간략 보기` → 채팅
   - [ ] `show_graph`의 `nodes[].reason`·`mode: "view"`

5. **검증**
   - [ ] `pnpm typecheck`, `pnpm test`, `pnpm ui-rules`, `pnpm build`
   - [ ] 격리 `WORKBENCH_DATA_DIR` + `pnpm mock-llm` + `samples/realistic-9k.json`으로 브라우저 전체 여정: 작품 분석 워크플로 실행 → 결과가 바로 반영되는지 확인, 청자 추정 → 조건 → 청자 저장, 그래프 보기 만들기·열기·뒤로/앞으로
   - [ ] CLI·skills는 개발 종료 후 한 번에 맞춘다
