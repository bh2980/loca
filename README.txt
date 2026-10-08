Translation Workbench — 로컬 번역 작업실 / v0.2 개편
2026-10-09 (Asia/Seoul)

원문 흐름을 탐색하고, AI와 작품 자료를 준비하고, 사용자가 구성한 프로세스로
번역 후보·검수·수정·확정을 진행하는 로컬 작업실입니다.

실행: 이 폴더의 PowerShell에서 .\start.ps1
주소: http://127.0.0.1:4317
개발: npm run dev / 검사: npm run typecheck / 테스트: npm test
사용 안내: USAGE.txt
현재 구현·검증·남은 범위: IMPLEMENTATION_STATUS.txt
기준 계획: DEVELOPMENT_PLAN_V2.txt / 사용자 여정: UX_FLOW_PLAN.txt

저장소에서 처음 실행하기
  Node.js와 npm을 설치한 뒤 이 폴더에서 .\start.ps1을 실행합니다.
  수동 실행: npm ci → npm run build → npm start
  실제 검증 환경은 Windows / Node.js 26입니다.
  저장소에는 앱 소스, 모의 데이터, 테스트, 개발 문서만 포함합니다.
  .workbench/의 DB·인증 정보, artifacts/의 게임 추출물·실행 기록,
  node_modules/와 빌드 결과는 포함하지 않습니다.
  아래 artifacts/ 참조는 개발 당시의 로컬 증거이며 저장소에 첨부되지 않습니다.
  일반 실행은 상위 폴더에 의존하지 않습니다. 선택적인 Orwell 가져오기 스크립트만
  별도 추출 데이터(analysis/, extracted/, orwell_1_reorder/)가 필요합니다.

빠른 흐름
  장면 지도 → 장면 읽기/대사 흐름 → 원문·번역·화자·ID 검색 → 대사 상세
  프로젝트 채팅 → 조사·자료 초안 → 피드백/편집 → 수락 → 작품 자료·인물/관계
  프로세스 → 대상·프로필·노드/연결 설정 → 검사·모의 시험 → 저장·실행
  실행 기록 → 대사별 결과·사람 확인 → 후보/대표 번역·상태·라벨 → 백업/내보내기

장면·대사 그래프와 프로세스 편집기는 크기에 관계없이 D3 + Canvas를 사용합니다.
React Flow 의존성은 제거했습니다. 원본 ID·조건·간선·미확인 참조를 보존합니다.
원문의 제어 흐름은 탐색용이며 실제 사건 순서나 인물의 지식을 확정하지 않습니다.
사용자 작업 프로세스의 조건은 별도 실행기가 저장한 정의대로 평가합니다.

채팅 초안은 수락 전 프로젝트 본문이나 번역 문맥에 반영되지 않습니다.
명시적으로 시작한 프로세스는 선택한 대상 안에서 설정한 행동을 자동 수행하며,
사람 확인 노드에 도착한 대상만 대기합니다. 두 승인 경계는 서로 다릅니다.

채팅 도구 호출은 OpenAI 호환 Chat Completions/Responses 연결만 지원합니다.
Codex/Grok/Antigravity/Claude CLI와 System One은 채팅을 지원하지 않습니다.
기존 구조화 번역용 API/CLI 연결은 유지합니다. 연결 가능 표시가 해당 서버·모델의
인증·도구 호출 지원·품질을 증명하지 않으며 실제 호출에서 확인합니다.

검증은 임시 DB·모의 모델·로컬 모의 HTTP·읽기 전용 Orwell 복사본으로 진행했습니다.
채팅 초안 수락과 인물·관계·근거 왕복, 프로세스 조건 변경/대사별 분기/사람 대기와
재시작 보존을 브라우저에서 확인했습니다. 실제 AI 번역 품질 검증과는 다릅니다.
현재 브라우저 증거: artifacts/v2-browser-verification.txt
전체 그래프 드래그 149 rAF 표본 p95는 18.2ms였습니다. 측정 환경·범위는 검증 기록을 참조하세요.
SSE 부분 응답·중지/후속 요청, 상태·라벨 범위 필터, 과거 실행/편집 흐름 전환을 브라우저에서 확인했습니다.
새 버전 4317 기동 후 사용자 Orwell2 8,157개 원문과 기존 자료 해시가 모두 일치했습니다.
자료 보존 증거: artifacts/v2-live-preservation.json.
프로필 복제·JSON 이식·저장·재로드까지 브라우저에서 확인했습니다.
최종 자동 검사 390/390, 루트/웹 타입 검사와 배포 빌드가 통과했습니다.
실제 AI 품질과 모든 기기의 FPS를 보증하지 않습니다. 최종 상태는 IMPLEMENTATION_STATUS.txt에 기록합니다.

기존 실제 호출 기록은 해당 날짜·범위의 증거입니다. 새 채팅/프로세스 전체의
실서비스 지원을 의미하지 않습니다.
  artifacts/live-smoke-2026-10-08/VALIDATION_REPORT.txt
  artifacts/harness-validation-2026-10-08/VALIDATION_REPORT.txt
  artifacts/ui-orwell-2026-10-08/VALIDATION_REPORT.txt

작업 상태는 로컬 SQLite에, API 비밀값은 별도 Windows DPAPI 저장소에 보관합니다.
프로젝트 백업은 채팅·제안·후보·자료·흐름 정의/실행 기록을 포함하며 인증 비밀값은
제외합니다. 복원만으로 AI나 외부 요청이 자동 시작되지 않습니다.
원본 게임, orwell_1_reorder, 상위 orwell_dll은 변경하지 않습니다.
