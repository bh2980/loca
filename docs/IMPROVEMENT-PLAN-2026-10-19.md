# Translation Workbench (Loca) 추가 개선 및 고도화 상세 개발 명세서 (AI 구현 블루프린트)

작성일: 2026-10-19

> **문서 목적**: 본 문서는 사전 맥락이 없는 다른 AI 에이전트나 개발자가 이 문서 하나만 읽고도 설계자의 의도와 100% 동일한 코드·동작·UI를 즉시 구현할 수 있도록, **수정 대상 파일 경로, 줄 번호, 정확한 Zod 스키마/타입 정의, 핵심 알고리즘, 그리고 변경 전/후 코드 블록**까지 모두 포함한 코드 레벨 명세서입니다.

---

## 0. 필수 준수 아키텍처 및 코딩 규칙 (`AGENTS.md` 요약)

구현 시 아래 규칙을 **예외 없이** 준수해야 합니다:

1. **디자인 토큰 및 컴포넌트 규칙 (`@loca/ui`)**:
   - 색상은 반드시 `packages/ui/src/tokens/theme.css`의 시맨틱 토큰(`bg-panel`, `bg-muted/20`, `text-foreground`, `text-muted-foreground`, `text-subtle-foreground`, `border-border-subtle`, `text-primary`, `text-success`, `text-warning`, `text-destructive` 등)만 사용합니다. **임의의 Hex 색상이나 Tailwind 팔레트 색상(`bg-blue-500`, `text-emerald-600` 등) 사용 금지**.
   - 텍스트 크기는 `text-base`, `text-sm`, `text-xs`만 사용합니다 (`text-[11px]` 등 임의 픽셀 클래스 금지, 기존 `@loca/ui` 유틸리티인 `text-2xs`만 예외 허용).
   - 네이티브 `<button>` 태그를 직접 쓰지 않고 반드시 `@loca/ui`의 `<Button size="sm" ...>`을 사용합니다.
   - 단축키 표시는 하드코딩(`⌘`, `⌥`)하지 않고 반드시 `apps/web/src/lib/keys.ts`의 `keyLabel()`을 사용합니다.
2. **상태 관리 원칙**:
   - 페이지 상태(필터, 선택 항목, 탭, 단순화 토글 등)는 **URL Search Params**가 단일 진실 공급원(Source of Truth)입니다.
   - 뷰포트(Pan/Zoom 좌표), 미저장 초안(Draft), 임시 숨김 노드 집합(`hiddenIds`)은 `sessionStorage`에 보관하며, 패닝이나 폴링으로 브라우저 히스토리를 푸시하지 않습니다.
   - 서버 변경 사항은 SSE 토픽(`apps/server/src/events.ts`)으로 전파되며, 폴링(polling)을 추가하지 않습니다.

---

## 1. 전체 6대 개선 과제 요약

| 번호 | 과제명 | 핵심 해결 목표 |
| :--- | :--- | :--- |
| **과제 1** | **에디터 인라인 문맥 완결화 & `LineDetail` 자동 열림 방지 및 단일 화면 개편** | 대사 클릭 시 우측 상세창이 강제로 열리지 않게 분리하고, 좌측 원문 아래에 **용어집(`원문 → 번역`)·말투·관계**, 우측 번역 아래에 **번역 후보·유사 번역(TM) 최대 3개**를 즉시 노출. 우측 `LineDetail`은 중복된 `번역 도우미` 탭을 없애고 단일 스크롤 심층 상세 화면으로 개편. |
| **과제 2** | **워크플로 AI 노드 출력 형태(`output`) 범용화 & `말투 규칙 검사` 제거** | 실효성이 낮은 어미 매칭 기반 `말투 규칙 검사`(`speechCheck`) 노드를 팔레트에서 제거. AI 노드의 출력을 **범용 출력 구조(Output Shape)**와 **프로젝트 반영 대상(`classifyTarget`: `listener` \| `tag` \| `none`)**으로 분리하여 선택지별 확률 추론·분류·조건 분기에 범용 활용. |
| **과제 3** | **워크플로 `스크립트` 노드 JSON 출력 스키마(`fields`) 지정 및 조건 분기 연동** | 스크립트 노드에 JSON 출력 필드(`name`, `type: string \| number \| boolean`, `description`) 선언 UI와 런타임 검증을 추가하고, `[AI로 작성]` 프롬프트 및 `조건 분기` 노드 빌더와 연동. |
| **과제 4** | **`형식 검사`(`formatCheck`) 비정규식 규칙 확장 & 정규식 `[✦ AI로 규칙 만들기]`** | 글자 수(`maxChars`), UTF-8 바이트 수(`maxBytes`), 줄당 글자 수(`maxLineChars`), 줄 수(`maxLines`), 원문 대비 길이 비율(`maxLengthRatio`), 금칙어(`forbiddenWords`) 추가. 설정 및 워크플로의 정규식 입력란에 자연어 → 정규식 생성(`POST /projects/:projectId/generate-regex`) 추가. |
| **과제 5** | **`자료 › 인물·관계`의 `관계 표` 및 `그래프`에서 관계·말투 추가** | `관계 표`와 `그래프` 상단에 `[+ 관계·말투 추가]` 팝오버를 두어 화자(`from`)와 청자(`to`)를 골라 새 관계·말투 규칙을 즉시 생성하고 `PairDetail`을 오픈. |
| **과제 6** | **그래프 드래그 상자 다중 선택 + 휠 클릭 이동 & 노드 숨기기 / AI 단순화(`show_graph`)** | 좌클릭 드래그는 다중 노드 선택 상자(Marquee Box), 휠 클릭 드래그는 화면 이동(Pan)으로 통일. 우클릭으로 다중 노드 숨기기/삭제 지원, 상단 `[단순화 보기]`(제어 노드 축약) 제공, AI 채팅 `show_graph`에 `between`·`excludeLines`·`simplify` 추가. |

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

### 과제 2: 워크플로 AI 노드 출력 형태(`output`) 범용화 & `말투 규칙 검사` 제거

#### 2.1 `말투 규칙 검사` (`speechCheck`) 함수 노드 팔레트 제거
- **수정 파일**: [`packages/shared/src/functions.ts`](file:///Users/bh2980/Desktop/translation_workbench/packages/shared/src/functions.ts) (Lines 182–189)
- **정확한 변경 코드**:
  ```ts
  // 변경 전
  export const PALETTE_FUNCTION_NAMES: FunctionName[] = [
    'setStatus',
    'assignTags',
    'formatCheck',
    'termCheck',
    'speechCheck',
    'http',
    'script',
  ];

  // 변경 후: 'speechCheck' 제거 (FUNCTIONS.speechCheck 정의는 기존 저장된 워크플로 호환을 위해 유지)
  export const PALETTE_FUNCTION_NAMES: FunctionName[] = [
    'setStatus',
    'assignTags',
    'formatCheck',
    'termCheck',
    'http',
    'script',
  ];
  ```

#### 2.2 AI 노드 출력 형태(`AI_OUTPUTS`) 범용화 및 `classifyTarget` 바인딩 추가
- **수정 파일 1**: [`packages/shared/src/workflow.ts`](file:///Users/bh2980/Desktop/translation_workbench/packages/shared/src/workflow.ts) (Lines 55–94)
  ```ts
  export const AI_OUTPUTS: Record<AiOutputType, { label: string; description: string; ports: PortSpec[] }> = {
    candidate: {
      label: '문장 생성 (번역·윤문)',
      description: '대사마다 번역문·수정문 등 새 문장을 만들어 후보로 기록합니다.',
      ports: [{ id: 'out', label: '다음' }],
    },
    verdict: {
      label: '통과·실패 판정 (검수·규칙 확인)',
      description: '번역 품질·말투·설정 일관성 등을 판정해 통과/실패 두 출구로 나눕니다.',
      ports: [
        { id: 'pass', label: '통과' },
        { id: 'fail', label: '실패' },
      ],
    },
    listener: {
      label: '분류 · 추론 (선택지 + 확신도)',
      description: '대사마다 대상(청자·분류값·감정 등)과 확신도(0~1)를 추론합니다. 청자·태그에 반영하거나 조건 분기에 쓸 수 있습니다.',
      ports: [{ id: 'out', label: '다음' }],
    },
    terms: {
      label: '용어 추출 (원문 → 번역)',
      description: '대사에서 반복되는 고유명사·전문용어를 뽑아 용어집에 반영합니다.',
      ports: [{ id: 'out', label: '다음' }],
    },
    knowledge: {
      label: '자료 추출 (인물·관계·사건·말투)',
      description: '장면에서 드러난 인물, 관계 변화, 사건, 말투 규칙을 추출해 자료에 반영합니다.',
      ports: [{ id: 'out', label: '다음' }],
    },
    analysis: {
      label: '통합 작품 분석 (문서·인물·용어 일괄)',
      description: '선택한 범위에서 세계관·줄거리 문서, 인물·관계·말투·사건, 용어집 초안을 한 번에 추출합니다.',
      ports: [{ id: 'out', label: '다음' }],
    },
    json: {
      label: '사용자 정의 JSON (다중 필드)',
      description: '직접 정의한 JSON 필드(문자열·숫자·참/거짓)를 대사마다 채워 다음 노드로 넘깁니다.',
      ports: [{ id: 'out', label: '다음' }],
    },
  };

  export const CLASSIFY_TARGETS = ['listener', 'tag', 'none'] as const;
  export type ClassifyTarget = (typeof CLASSIFY_TARGETS)[number];
  ```
  - `aiNodeConfigSchema`(`workflow.ts:75`)에 다음 필드를 추가합니다:
    ```ts
    /** When output === 'listener' (분류·추론), where to apply the inferred value: 'listener' (default), 'tag' (attach matching line tag), or 'none' (output variable only). */
    classifyTarget: z.enum(CLASSIFY_TARGETS).default('listener').optional(),
    ```

- **수정 파일 2**: [`apps/server/src/engine/prompts.ts`](file:///Users/bh2980/Desktop/translation_workbench/apps/server/src/engine/prompts.ts) (Lines 35–42 및 215–222)
  - `outputSchema`의 `case 'listener':`에서 `listener`(하위 호환)와 범용 `value`를 모두 받을 수 있게 확장하고 정규화합니다:
    ```ts
    case 'listener':
      return lineItems(
        z.object({
          listener: z.string().nullable().optional().describe('추론한 대상 이름/분류값 (청자 추론 시 청자 이름 또는 self/group/public/others, 판단 불가 시 null)'),
          value: z.string().nullable().optional().describe('범용 분류·추론 결과값 (listener와 동일하게 사용 가능)'),
          confidence: z.number().describe('0(전혀 모름)부터 1(확실함)까지의 확신도'),
          reason: z.string().optional().describe('판단 근거 한 줄 요약'),
        }).transform((item) => {
          const val = item.value !== undefined ? item.value : (item.listener ?? null);
          return {
            listener: val,
            value: val,
            confidence: item.confidence,
            ...(item.reason ? { reason: item.reason } : {}),
          };
        }),
      );
    ```
  - `composePrompt`의 `config.output === 'listener'`(Lines 215–222)에서:
    - `config.classifyTarget === 'tag'` 또는 `config.classifyTarget === 'none'`일 때는 청자 후보 안내 대신 `"각 줄을 지시문에 따라 분류·추론하여 결과를 value(또는 listener)와 확신도(confidence, 0~1)로 답하세요."`를 프롬프트에 추가합니다.
    - 기본값(`config.classifyTarget === 'listener' || !config.classifyTarget`)일 때는 기존의 청자 후보 목록 안내를 그대로 유지합니다.

- **수정 파일 3**: [`apps/server/src/engine/runner.ts`](file:///Users/bh2980/Desktop/translation_workbench/apps/server/src/engine/runner.ts)
  - `shouldAutoApply(definition, node)` 및 `callLines`:
    - `node.config.output === 'listener'`일 때:
      - `const target = node.config.classifyTarget ?? 'listener';`
      - `target === 'none'`이면 DB에 아무것도 자동 반영하지 않고 `outcome.output`(`{ listener, value, confidence, reason }`)만 `runItems.data.outputs[node.id]`에 기록합니다.
      - `target === 'listener'`이면 기존과 동일하게 `syncFunctions.setListener`를 실행합니다.
      - `target === 'tag'`이면 추론된 `outcome.output.value`(또는 `listener`)와 이름이 일치하는 프로젝트 대사 태그(`s.tags`)를 찾아 `attachUnitTags(tx, run.projectId, [row.id], { add: [matchedTag.id], remove: [] })`를 수행합니다.

- **수정 파일 4**: [`apps/web/src/components/workflow/node-config/ai.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/workflow/node-config/ai.tsx)
  - `<InspectorSection title="출력">` 내부에서 `config.output === 'listener'`일 때 **추론 결과 활용 방식(`classifyTarget`)** 선택기를 렌더링합니다:
    ```tsx
    {config.output === 'listener' && (
      <Field label="추론 결과 활용 방식" hint="추론한 값과 확신도(confidence)는 항상 다음 조건 분기 노드에서도 사용할 수 있습니다.">
        <Select
          value={config.classifyTarget ?? 'listener'}
          onValueChange={(val) => set({
            classifyTarget: val as 'listener' | 'tag' | 'none',
            autoApply: val !== 'none',
          })}
          disabled={readOnly}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="listener">대사의 청자(listener)에 자동 반영</SelectItem>
            <SelectItem value="tag">일치하는 이름의 대사 태그 부착</SelectItem>
            <SelectItem value="none">변수(value · confidence)로만 출력 (조건 분기용)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    )}
    ```

- **수정 파일 5**: [`apps/web/src/components/workflow/node-config/condition.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/workflow/node-config/condition.tsx)
  - `자주 쓰는 조건` 섹션에서 앞선 노드 중 `node.type === 'ai' && node.config.output === 'listener'`인 노드가 있으면:
    - **확신도 조건**: `outputs.<nodeId>.confidence >= 0.8` (임계치 입력 가능)
    - **분류·추론값 조건**: `outputs.<nodeId>.value == "선택지"` (값 입력 가능)
  - 앞선 노드 중 `node.type === 'ai' && node.config.output === 'json'`인 노드가 있으면:
    - 선언된 `node.config.fields`의 각 필드를 드롭다운으로 골라 `outputs.<nodeId>.<field.name>` 조건식을 즉시 생성할 수 있게 합니다.

---

### 과제 3: 워크플로 `스크립트` 노드 JSON 출력 형식(`fields`) 지정 및 조건 분기 연동

#### 3.1 `scriptParams`에 `fields` 추가 (`packages/shared/src/functions.ts`)
- **수정 위치**: [`packages/shared/src/functions.ts`](file:///Users/bh2980/Desktop/translation_workbench/packages/shared/src/functions.ts#L88-L103)
- **정확한 변경 코드**:
  ```ts
  export const scriptFieldSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean']),
    description: z.string().default(''),
  });
  export type ScriptField = z.infer<typeof scriptFieldSchema>;

  export const scriptParams = z.object({
    description: z.string().default(''),
    code: z
      .string()
      .default(
        `// line: { source, translation, speaker, listener, candidate, outputs }\n// return { port: 'out', candidate, data: { ... } }\nreturn { port: 'out' };`,
      ),
    ports: z.array(z.string().min(1)).min(1).default(['out']),
    fields: z.array(scriptFieldSchema).default([]),
  });
  ```

#### 3.2 서버 샌드박스 실행 시 JSON `fields` 검증 (`apps/server/src/engine/functions/index.ts` & `apps/server/src/routes/workflows.ts`)
- **검증 헬퍼 함수 추가 (`apps/server/src/engine/functions/index.ts`)**:
  ```ts
  export function validateScriptData(
    raw: Record<string, unknown> | undefined,
    fields: { name: string; type: 'string' | 'number' | 'boolean' }[],
  ): Record<string, unknown> {
    const data: Record<string, unknown> = { ...(raw ?? {}) };
    for (const field of fields) {
      if (!field.name.trim()) continue;
      const val = data[field.name];
      if (val === undefined || val === null) {
        data[field.name] = field.type === 'number' ? 0 : field.type === 'boolean' ? false : '';
        continue;
      }
      if (field.type === 'number' && typeof val !== 'number') {
        const num = Number(val);
        if (Number.isNaN(num)) throw new Error(`스크립트 출력 필드 '${field.name}'의 값이 숫자가 아닙니다: ${String(val)}`);
        data[field.name] = num;
      } else if (field.type === 'boolean' && typeof val !== 'boolean') {
        data[field.name] = Boolean(val);
      } else if (field.type === 'string' && typeof val !== 'string') {
        data[field.name] = String(val);
      }
    }
    return data;
  }
  ```
- `runAsyncFunction`(`functions/index.ts:312`) 및 `POST /projects/:projectId/script-test`(`routes/workflows.ts:171`)에서 `validateScriptData(result.data, params.fields)`를 호출해 검증된 JSON을 반환합니다.
- `POST /projects/:projectId/script-assist`(`routes/workflows.ts:190`)에서 `ports`와 `fields`를 함께 받아 AI가 선언된 `ports` 중 하나와 `data: { <fields> }` 구조로 코드를 작성하도록 프롬프트에 명시합니다.

#### 3.3 프론트엔드 `ScriptConfig`에 JSON 필드 편집기 추가 및 `ConditionEditor` 연동
- **수정 파일 1**: [`apps/web/src/components/workflow/node-config/function.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/workflow/node-config/function.tsx#L378-L426)
  - `ScriptConfig` 컴포넌트 하단(`출구 목록` 아래)에 **`출력 데이터 형식 (JSON 필드)`** 섹션을 추가하여 필드 이름(`name`), 타입(`문자열` | `숫자` | `참/거짓`), 설명(`description`)을 추가/삭제할 수 있게 합니다 (`ai.tsx`의 `JsonFields`와 동일한 컴팩트 UI 패턴 사용).
- **수정 파일 2**: [`apps/web/src/components/workflow/node-config/condition.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/components/workflow/node-config/condition.tsx)
  - 앞선 노드 중 `node.type === 'function' && node.config.fn === 'script'`이고 `node.config.params.fields?.length > 0`인 노드가 있으면, `자주 쓰는 조건`에서 해당 스크립트 노드의 출력 필드(`outputs.<nodeId>.<field.name>`)를 선택해 비교 조건식을 즉시 생성할 수 있게 합니다.

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
        const modelChoice = defaultModelChoice(db, projectId);
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

### 과제 6: 그래프 드래그 상자 다중 선택 + 휠 클릭 이동 & 노드 숨기기 / AI 그래프 단순화 (`show_graph`)

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

#### 6.3 장면·대사 그래프 노드 숨기기(`hiddenIds`) & 상단 `[단순화 보기]`(`simplify`) 및 축약 엣지 연결
- **수정 파일**: [`apps/web/src/routes/p.$projectId.graph.tsx`](file:///Users/bh2980/Desktop/translation_workbench/apps/web/src/routes/p.$projectId.graph.tsx)
- **URL Search & SessionStorage 상태**:
  - `GraphSearch`에 `simplify?: true` 추가 (`validateSearch`: `simplify: raw.simplify === true || raw.simplify === 'true' ? true : undefined`).
  - 수동 숨김 노드 집합 `hiddenIds: Set<string>`는 `sessionStorage` 키 `tw.graph.hidden.${projectId}.${search.scope}.${chosen ?? 'all'}`에 저장.
- **숨김 노드 필터링 및 축약 엣지(Edge Contraction) 알고리즘**:
  - 숨길 노드 집합 `excludedIds`를 계산합니다:
    - `hiddenIds`에 포함된 모든 노드 ID
    - `search.simplify === true`일 때는 대사가 없는 제어/상태/허브 노드(`node.kind !== 'script' && node.kind !== 'choice' && node.kind !== 'chain' && node.kind !== 'portal' && (node.total ?? 0) === 0`)를 `excludedIds`에 자동 추가합니다.
  - `visibleNodes = rawNodes.filter(n => !excludedIds.has(n.id))`
  - **축약 엣지 생성(`contractEdges(rawEdges, excludedIds, byId)`)**:
    - 기존 `rawEdges` 중 양 끝점이 모두 가시 노드(`!excludedIds.has(e.from) && !excludedIds.has(e.to)`)인 엣지는 그대로 유지합니다.
    - 가시 노드 `u`에서 출발해 하나 이상의 `excludedIds` 노드를 거쳐 가시 노드 `v`에 도달하는 경로가 있으면(BFS 탐색, 최대 깊이 12), `u`의 하단 중앙(가로 방향일 때는 우측 중앙)에서 `v`의 상단 중앙(가로 방향일 때는 좌측 중앙)으로 이어지는 직선/곡선 축약 엣지(`{ id: `bypass:${u}->${v}`, from: u, to: v, points: [x1, y1, x2, y2] }`)를 생성해 추가합니다 (중복 `(u, v)` 쌍은 제거).
- **우클릭 컨텍스트 메뉴 및 상단 바 UI**:
  - `HeaderActions`(`scope === 'dialogue'`):
    - **`[단순화 보기]`** 토글 버튼 (`variant={search.simplify ? 'secondary' : 'ghost'}`, 클릭 시 `simplify: search.simplify ? undefined : true`).
  - 캔버스 상단 오버레이:
    - `hiddenIds.size > 0 || search.simplify`일 때 `숨긴 노드 N개 · [모두 표시]` 배지 버튼을 노출하여 원클릭으로 복원 가능.
  - 우클릭 메뉴(`contextMenu`):
    - 다중 선택(`selectedIds.size > 1`) 시:
      - `선택한 노드 ${selectedIds.size}개 숨기기`
      - `선택한 노드 ${selectedIds.size}개만 남기기 (나머지 숨기기)`
      - `선택한 노드의 대사로 워크플로 실행…`
    - 단일 노드 우클릭 시:
      - `이 노드 숨기기`
      - `이 노드 주변 흐름만 보기 (앞뒤 2단계 외 숨기기)`
    - 숨긴 노드가 있을 때:
      - `숨긴 노드 모두 다시 표시 (${hiddenIds.size}개)`

#### 6.4 AI 채팅 에이전트 `show_graph` 도구의 구간 서브그래프 추출(`between`) 및 제어 노드 단순화(`simplify`)
- **수정 파일**:
  1. [`apps/server/src/services/graph-views.ts`](file:///Users/bh2980/Desktop/translation_workbench/apps/server/src/services/graph-views.ts)
  2. [`apps/server/src/services/layout.ts`](file:///Users/bh2980/Desktop/translation_workbench/apps/server/src/services/layout.ts)
  3. [`apps/server/src/services/agent-tools.ts`](file:///Users/bh2980/Desktop/translation_workbench/apps/server/src/services/agent-tools.ts)
- **상세 구현**:
  1. **`NodePick` 인터페이스 및 `pickNodes` 확장 (`apps/server/src/services/graph-views.ts`)**:
     ```ts
     export interface NodePick {
       scenes?: string[];
       speakers?: string[];
       lines?: string[];
       q?: string;
       /** 시작 대사/노드와 끝 대사/노드 사이의 모든 분기 경로에 놓인 노드들을 추출 */
       between?: { start: string; end: string };
       /** 결과에서 제외할 대사 키 또는 노드 ID 목록 */
       exclude?: string[];
       /** 제어·상태 노드를 제외하고 대사·선택지 노드만 남길지 여부 */
       simplify?: boolean;
       around?: number;
     }
     ```
     - **`between: { start, end }` 알고리즘**:
       - `start`와 `end` 참조(대사 키, 대사 ID, 노드 키, 노드 ID, 또는 대사 텍스트 부분 일치)를 각각의 그래프 노드 ID 집합 `startNodes`, `endNodes`로 해석합니다.
       - 프로젝트의 방향 그래프 `graphEdges`에서:
         - `forwardReachable`: `startNodes`에서 순방향(`from -> to`)으로 도달 가능한 모든 노드 집합 ( + 그 노드에 매달린 dead-end 자식 대사 노드 포함)
         - `backwardReachable`: `endNodes`에서 역방향(`to -> from`)으로 도달 가능한 모든 노드 집합 ( + `startNodes`/`endNodes`에 매달린 자식 대사 노드 포함)
         - 두 집합의 교집합(`id ∈ forwardReachable && id ∈ backwardReachable`)과 그 노드에 직접 연결된 선택지(`choice`)/첨부 대사 노드를 `nodes`에 추가합니다.
         - 이렇게 하면 단일 선형 경로만 뽑는 `find_reading_route`와 달리, **특정 사건의 시작부터 끝 사이에 존재하는 모든 선택지 갈래(Branching subgraph)**가 통째로 수집됩니다!
     - **`simplify: true` 및 `exclude` 처리**:
       - `exclude`에 지정된 대사 키/노드 ID를 `nodes`에서 제거합니다.
       - `pick.simplify`가 `true`이면 수집된 `nodes` 중에서 대사가 없는 내부 제어·상태 노드(`kind !== 'script' && kind !== 'choice' && unitIds.length === 0`)를 제거합니다.
  2. **`nodeSetLayout`의 숨김 노드 우회 연결 지원 (`apps/server/src/services/layout.ts`)**:
     - `nodeSetLayout(db, projectId, key, nodeIds, label, direction)`에서 `wanted = new Set(nodeIds)`에 포함되지 않은 중간 제어 노드를 통과해 `wanted` 내의 두 노드가 이어지는 경우, ELK 레이아웃 입력 엣지에 우회 엣지(`u -> v`)를 추가하여 `simplify: true`로 제어 노드를 빼더라도 ELK가 대사·선택지 노드들을 끊김 없이 위에서 아래로 매끄럽게 배치하도록 합니다.
  3. **`show_graph` 도구 스키마 확장 (`apps/server/src/services/agent-tools.ts` Lines 243–265)**:
     ```ts
     show_graph: tool({
       description:
         'Show the user a focused or simplified part of the dialogue graph: pick nodes by scenes, speakers, lines, q, or between (all branches between a start and end line/node). Set simplify=true (default when mode="only") to strip non-dialogue control/state nodes and show only dialogue & choice branches cleanly.',
       inputSchema: z.object({
         scenes: z.array(z.string().min(1)).max(500).default([]),
         speakers: z.array(z.string().min(1)).default([]),
         lines: z.array(z.string().min(1)).max(5000).default([]),
         q: z.string().optional(),
         between: z.object({ start: z.string().min(1), end: z.string().min(1) }).optional(),
         exclude: z.array(z.string().min(1)).default([]),
         simplify: z.boolean().default(true),
         around: z.number().int().min(0).max(5).default(0),
         mode: z.enum(['mark', 'only']).default('only'),
         label: z.string().max(80).describe('Short title for this simplified graph view, e.g. "올렉 바케이 사망 분기 (단순화)".'),
       }),
       ...
     ```

---

## 3. 단계별 실행 및 검증 체크리스트

1. **Step 1 — Shared 스키마 & 서버 엔진 구현 (`packages/shared`, `apps/server`)**
   - [ ] `packages/shared/src/functions.ts`: `PALETTE_FUNCTION_NAMES`에서 `'speechCheck'` 제거, `scriptParams`에 `fields` 추가, `formatCheckParams`에 길이·바이트·줄 수·비율·금칙어 추가
   - [ ] `packages/shared/src/format-check.ts`: `checkFormat` 및 `formatIssueMessages`에 길이·바이트·줄 수·비율·금칙어 검사 로직 구현
   - [ ] `packages/shared/src/workflow.ts`: `AI_OUTPUTS` 범용 라벨/설명 개편 및 `classifyTarget` 스키마 추가
   - [ ] `apps/server/src/engine/prompts.ts` & `runner.ts`: `classifyTarget` (`listener` | `tag` | `none`) 처리
   - [ ] `apps/server/src/engine/functions/index.ts` & `routes/workflows.ts`: 스크립트 `fields` 검증(`validateScriptData`) 및 `script-assist` 프롬프트 반영
   - [ ] `apps/server/src/routes/projects.ts`: `POST /projects/:projectId/generate-regex` 엔드포인트 추가
   - [ ] `apps/server/src/services/graph-views.ts`, `layout.ts`, `agent-tools.ts`: `show_graph`의 `between`, `exclude`, `simplify` 및 우회 엣지 레이아웃 구현
   - [ ] 검증: `pnpm --filter @tw/shared test && pnpm --filter @tw/server test`

2. **Step 2 — 에디터 · 상세 · 설정 · 자료 · 워크플로 UI 구현 (`apps/web`)**
   - [ ] `apps/web/src/components/script/line-list.tsx`: `showDetailPane = Boolean(search.line && search.detail)` 적용하여 대사 클릭 시 상세창 자동 오픈 차단
   - [ ] `apps/web/src/components/editor/source-text.tsx`: 비선택 줄에서도 확정 용어 점선 밑줄 및 뜻 툴팁 표시
   - [ ] `apps/web/src/components/script/line-row.tsx` & `route-list.tsx`: 선택 줄 좌측 원문 바로 아래에 `<LineHints>`(용어집 칩 클릭 삽입 + 말투·관계 요약) 표시
   - [ ] `apps/web/src/components/translation-editor.tsx`: 우측 번역 입력창 아래에 후보 & 유사 번역(TM) 상위 3개 상시 노출 (`⌥⇧1~3`, 유사도 배지, 원문 단어 차이 하이라이트, `+N개 더보기`)
   - [ ] `apps/web/src/components/line-detail.tsx`: `번역 도우미` 탭 및 `InspectorTabs` 제거, 단일 스크롤 심층 상세 화면으로 개편
   - [ ] `apps/web/src/components/workflow/node-config/ai.tsx`, `function.tsx`, `condition.tsx` & `format-rules.tsx`: `classifyTarget` 선택기, 스크립트 JSON `fields` 편집기, 조건 분기 빌더 연동, 길이·바이트·금칙어 입력란, `[✦ AI로 규칙 만들기]` 구현
   - [ ] `apps/web/src/routes/p.$projectId.knowledge.tsx`: `관계 표` 및 `그래프` 상단에 `[+ 관계·말투 추가]` 팝오버 구현

3. **Step 3 — 그래프 드래그 상자 다중 선택 · 휠 클릭 이동 · 노드 숨기기 (`apps/web`)**
   - [ ] `apps/web/src/components/graph/graph-canvas.tsx`: `d3-zoom` 필터(휠 클릭/Space 드래그만 Pan), 좌클릭 드래그 Marquee Box 다중 선택(`selectedIds`), 다중 선택 하이라이트 렌더링
   - [ ] `apps/web/src/routes/p.$projectId.workflows.$workflowId.tsx`: `ReactFlow` `selectionOnDrag` + `panOnDrag={[1]}` 및 다중 노드 삭제/복제
   - [ ] `apps/web/src/routes/p.$projectId.graph.tsx`: 다중/단일 노드 숨기기(`hiddenIds`), 주변 흐름만 보기, 상단 `[단순화 보기]`(`simplify`), 숨겨진 노드 구간 축약 엣지 연결

4. **Step 4 — 전체 타입체크, 테스트 및 프로덕션 빌드 검증**
   - [ ] `pnpm typecheck`
   - [ ] `pnpm test`
   - [ ] `pnpm build`
