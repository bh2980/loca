/** Presentation roles describe source behavior, never a simulated execution. */
export type GraphSemanticShape='script'|'condition'|'wait'|'event'|'state'|'connector'|'unknown';
export interface GraphSemanticNode {kind?:string;unitIds:string[];conditions?:unknown;metadata?:Record<string,unknown>}
export interface GraphNodeSemantics {sourceType:string;shape:GraphSemanticShape;label:string;summary:string;verified:boolean;runtimeGuard:boolean;evidence?:string}
type Definition=Pick<GraphNodeSemantics,'shape'|'label'|'summary'|'runtimeGuard'|'evidence'>;
const il='analysis/binary/managed/Assembly-CSharp.dll/all_methods.il.txt';
const definition=(shape:GraphSemanticShape,label:string,summary:string,method:string,runtimeGuard=false):Definition=>({shape,label,summary,runtimeGuard,evidence:`${il} · ${method}`});

/** Exact serialized class identities, checked against this build's managed IL.
 * Several actions also wait for completion; shape describes their main role and
 * runtimeGuard preserves that additional behavior. No class substring guessing. */
const orwellTypes:Record<string,Definition>={
 EmptyState:definition('connector','통과 연결','실행 완료를 기록하고 다음 연결로 진행합니다. 자체 조건이나 추가 동작은 없습니다.','EmptyState::Execute; FlowState::Execute; FlowState::EvaluateConditions'),
 IfElseState:definition('condition','조건 분기','조건 결과에 따라 원본 출력 pin 0 또는 1을 선택합니다.','IfElseState::EvaluateOutgoingConnectionPin',true),
 OrState:definition('condition','진입 조건','통과한 입력 연결 수를 원본 기준 개수와 비교합니다.','OrState::CanBeExecuted',true),
 AtLeastState:definition('condition','완료 개수 조건','참조한 상태 중 완료한 개수를 기준 개수와 비교합니다.','AtLeastState::EvaluateConditions',true),
 DocumentViewedState:definition('condition','열람 조건','문서·메일·채팅의 열람 여부, 인물 프로필 열람 또는 자료 발견을 확인합니다.','DocumentViewedState::EvaluateConditions',true),
 AtClockTimeState:definition('wait','시각 대기','게임 시각 이벤트에 등록하고 대기 완료 여부를 확인합니다.','AtClockTimeState::Execute; AtClockTimeState::EvaluateConditions',true),
 DelayState:definition('wait','시간 지연','지정된 초만큼 지연한 뒤 대기 완료 여부를 확인합니다.','DelayState::Execute; DelayState::EvaluateConditions',true),
 WaitState:definition('wait','상태 대기','흐름 이벤트에 등록하고 대기 완료 여부를 확인합니다.','WaitState::Execute; WaitState::EvaluateConditions',true),
 OnGameEventCallbackState:definition('event','게임 이벤트 조건','지정된 게임 이벤트가 발생했는지 확인합니다.','OnGameEventCallbackState::EvaluateConditions',true),
 ToolEventState:definition('event','도구 이벤트 조건','지정된 도구의 열림 여부를 확인합니다.','ToolEventState::EvaluateConditions',true),
 ToolUnlockedState:definition('state','도구 해제','지정된 도구를 사용할 수 있게 합니다.','ToolUnlockedState::Execute → ApplicationManager::UnlockApplication'),
 NewPersonState:definition('state','인물 해제','지정된 인물을 프로필에서 사용할 수 있게 합니다.','NewPersonState::Execute → Profile::UnlockPerson'),
 NewTargetPersonState:definition('state','대상 인물 설정','지정된 인물을 조사 대상으로 설정합니다.','NewTargetPersonState::Execute → Profile::SetTargetPerson'),
 MergePersonsState:definition('state','인물 병합','원본 인물과 대상 인물을 프로필에서 병합합니다.','MergePersonsState::Execute → Profile::MergePersons'),
 NewCommentaryState:definition('state','코멘터리 시작','원본 시작 상태들로 코멘터리 하위 FSM을 시작하며 전체 코멘트 완료를 확인합니다.','NewCommentaryState::Execute → OrwellFlowFSM::Init; NewCommentaryState::EvaluateConditions',true),
 NewChatState:definition('state','대화 시작','원본 시작 상태들로 대화 하위 FSM을 시작하며 대화 종료를 확인합니다.','NewChatState::Execute → OrwellFlowFSM::Init; NewChatState::EvaluateConditions',true),
 NewChatMessageState:definition('script','대화 문장','대화 메시지를 표시하고 표시 완료 여부를 확인합니다.','NewChatMessageState::Execute → Listener::ShowChatMessage; NewChatMessageState::EvaluateConditions',true),
 NewCommentaryLineState:definition('script','코멘터리 문장','코멘터리 문장을 표시하며 클릭·표시 유지 조건을 확인합니다.','NewCommentaryLineState::Execute → CommentaryTool::ShowCommentaryLine; NewCommentaryLineState::EvaluateConditions',true),
 NewDataChunkState:definition('state','자료 해제','자료를 해제하고 제출 완료 여부를 확인합니다.','NewDataChunkState::Execute; NewDataChunkState::EvaluateConditions',true),
 UpdateProfileState:definition('state','프로필 갱신','원본 프로필 업데이트를 적용합니다.','UpdateProfileState::Execute → Profile::ApplyProfileUpdate'),
 UpdateDocumentState:definition('state','문서 갱신','원본 문서를 새 문서로 갱신합니다.','UpdateDocumentState::Execute → Reader::UpdateDocument'),
 NewBookmarkState:definition('state','북마크 추가','지정된 문서의 북마크를 추가합니다.','NewBookmarkState::Execute → Reader::AddBookmark'),
 NewMailState:definition('state','메일 추가','지정된 메일을 수신 목록에 추가합니다.','NewMailState::Execute → Listener::AddMail'),
 NewTickerReportState:definition('state','뉴스 표시','뉴스 도구에 새 보도를 표시합니다.','NewTickerReportState::Execute → TickerTool::DisplayNewTickerReport'),
 NewDebriefingElementState:definition('state','결과 항목 추가','로그아웃 결과에 항목을 추가합니다.','NewDebriefingElementState::Execute → LogoutTool::AddElement'),
 NewObjectiveState:definition('state','목표 추가','새 조사 목표를 추가합니다.','NewObjectiveState::Execute → IngameMenuTool::AddNewObjective'),
 ObjectiveSolvedState:definition('state','목표 완료','참조한 조사 목표를 완료 상태로 설정합니다.','ObjectiveSolvedState::Execute → IngameMenuTool::SetObjectiveCompleted'),
 OpenDocumentState:definition('state','자료 열기','원본 자료 종류에 해당하는 문서·메일·프로필·대화를 엽니다.','OpenDocumentState::Execute'),
 OpenAppOrTabState:definition('state','도구·탭 전환','지정된 도구나 탭을 열거나 닫습니다.','OpenAppOrTabState::Execute → ApplicationManager::OpenApplication / ApplicationManager::CloseApplication'),
 InsiderAccessState:definition('state','기기 접근 추가','기기 북마크를 추가합니다.','InsiderAccessState::Execute → Insider::AddDeviceBookmark'),
 ChangeInsiderStatusState:definition('state','기기 상태 변경','기기의 온라인 상태를 변경합니다.','ChangeInsiderStatusState::Execute → Insider::SetDeviceOnlineStatus'),
 InsiderDocumentUpdateState:definition('state','기기 문서 갱신','기기 문서·북마크를 추가하거나 제거하고 링크를 갱신합니다.','InsiderDocumentUpdateState::Execute'),
 UnlockAchievementState:definition('state','도전 과제 해제','원본 실행 조건에 맞으면 도전 과제를 해제합니다.','UnlockAchievementState::Execute → SteamStatsAndAchievements::UnlockAchievement'),
 BlockCommentsState:definition('state','코멘터리 차단','코멘터리 도구의 코멘트 표시를 차단합니다.','BlockCommentsState::Execute → CommentaryTool::BlockCommentaries'),
 LevelCompleteState:definition('state','단계 완료','로그아웃 결과 화면을 표시하고 결과 화면 열림을 확인합니다.','LevelCompleteState::Execute; LevelCompleteState::EvaluateConditions',true),
 UpdateDropState:definition('state','제출 갱신','제출 상태를 등록하고 업로드·하위 흐름 완료를 확인합니다.','UpdateDropState::Execute; UpdateDropState::EvaluateConditions',true),
 UpdateDropRepeatableState:definition('state','반복 제출 흐름','제출 하위 FSM을 구성하고 올바른 업데이트 제출 여부를 확인합니다.','UpdateDropRepeatableState::CreateSubFSM; UpdateDropRepeatableState::EvaluateConditions',true),
 InfluencerFollowerCountState:definition('state','팔로워 수 변경','팔로워 수와 표시 텍스트를 갱신합니다.','InfluencerFollowerCountState::Execute → Profile::AddInfluencerFollowerCount'),
 InfluencerThesisState:definition('state','주장 표시','주장 텍스트를 설정하고 애니메이션 완료를 확인합니다.','InfluencerThesisState::Execute; InfluencerThesisState::EvaluateConditions',true),
 WeatherState:definition('state','날씨 변경','날씨·설명·온도 표시를 변경합니다.','WeatherState::Execute → WeatherTool::ChangeWeather'),
 PlayMusicState:definition('state','음악 재생','지정된 음악을 재생합니다.','PlayMusicState::Execute → AtmoController::PlayMusicPiece'),
 FadeAtmoLayerState:definition('state','배경음 페이드','지정된 배경음 레이어를 페이드합니다.','FadeAtmoLayerState::Execute → AtmoController::FadeAtmoLayer'),
};

/** Explicit conventional schema names support imported/synthetic graphs without
 * pretending their names prove behavior from the Orwell binary. */
const conventional:Record<string,GraphSemanticShape>={ConditionState:'condition',DecisionState:'condition',BranchState:'condition',ChoiceState:'condition',CheckState:'condition',IfState:'condition',If:'condition',JoinState:'connector',ConnectorState:'connector',JunctionState:'connector',EventState:'event',TriggerState:'event',SetFlagState:'state',Script:'script',ScriptState:'script',DialogueState:'script'};
Object.assign(conventional,{condition:'condition',decision:'condition',branch:'condition',choice:'condition',check:'condition',if:'condition',wait:'wait',delay:'wait',pause:'wait',timer:'wait',event:'event',trigger:'event',signal:'event',notification:'event',state:'state',action:'state',set:'state',assign:'state',update:'state',flag:'state',connector:'connector',join:'connector',junction:'connector',merge:'connector',script:'script',dialogue:'script',content:'script'});
const labels:Record<GraphSemanticShape,string>={script:'원문',condition:'조건·분기',wait:'대기',event:'이벤트',state:'상태 변경',connector:'통과·연결',unknown:'역할 미분석'};
export function graphNodeSemantics(node:GraphSemanticNode):GraphNodeSemantics{
 const sourceType=node.kind?.trim().split('.').at(-1)??'',known=orwellTypes[sourceType];
 if(known)return {sourceType,...known,verified:true};
 const declared=conventional[sourceType],shape=declared??(node.unitIds.length?'script':'unknown');
 return {sourceType,shape,label:labels[shape],runtimeGuard:shape==='condition'||shape==='wait'||shape==='event',verified:false,
  summary:declared?`원본 타입 ${sourceType}의 명시적 분류입니다. 이 데이터의 실행 코드 근거는 연결되지 않았습니다.`:sourceType?`원본 타입 ${sourceType}의 실행 역할이 아직 분석 목록에 없습니다.${node.unitIds.length?' 연결된 원문을 표시합니다.':''}`:'원본 타입 정보가 없어 실행 역할을 분류할 수 없습니다.'};
}
/** Unknown named source controls stay addressable even when text is linked. */
export function isGraphControlNode(node:GraphSemanticNode){const meaning=graphNodeSemantics(node);return meaning.shape!=='script'||(!meaning.verified&&!!node.kind&&!conventional[meaning.sourceType]);}
/** Scheduling/serialization fields are not runtime guard expressions. */
export function graphNodeHasRuntimeGuard(node:GraphSemanticNode):boolean{
 const meaning=graphNodeSemantics(node);if(meaning.verified)return meaning.runtimeGuard;
 if(meaning.runtimeGuard)return true;
 const meaningful=(value:unknown):boolean=>{
  if(value===undefined||value===null||value===''||value===false)return false;
  if(Array.isArray(value))return value.some(meaningful);
  if(typeof value==='object')return Object.entries(value).some(([key,item])=>!['_priority','priority','_ignoreSaveGameLoadingOrder','ignoreSaveGameLoadingOrder'].includes(key)&&meaningful(item));
  return true;
 };return meaningful(node.conditions);
}
/** Read all supported import envelopes without changing the original metadata. */
export function graphNodeSourceLabel(node:GraphSemanticNode):string|undefined{
 const object=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
 const metadata=node.metadata,sourceNodes=metadata?.sourceNodes;
 const records=[object(metadata?.rawNode),...(Array.isArray(sourceNodes)?sourceNodes.map(item=>object(object(item)?.rawNode)):[]),object(metadata?.rawObject)];
 for(const raw of records){const context=object(raw?.context)??object(raw?.data);for(const value of [context?._stateName,context?.m_Name])if(typeof value==='string'&&value.trim())return value;}
 return undefined;
}
