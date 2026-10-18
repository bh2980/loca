import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CircleAlert, CircleCheck, Network, Pencil } from 'lucide-react';
import { checkFormat, isUnknownListener, listenerLabel, needsListener, PALETTE, SPEECH_LEVEL_LABELS, speechLevelOf, TAG_SCOPES, termMatcher, type FormatRules, type KnowledgeStatus, type SpeechLevel } from '@tw/shared';
import { AiMark, Badge, Button, CandidateCard, ContextLine, InspectorHeader, Inspector, InspectorSection, InspectorTabs, PropertyGrid, PropertyRow, SpeakerIdentity, StatusIcon, TagChip, TagListEditor } from '@loca/ui';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { AiButton } from '@/components/ai-button';
import { AiContextPanel } from '@/components/ai-context';
import { TranslationEditor } from '@/components/translation-editor';
import { LineHints } from '@/components/script/line-row';
import { LineNote } from '@/components/script/line-note';
import { TokenText } from '@/components/editor/source-text';
import { ListenerPicker } from '@/components/script/listener-picker';
import { SpeakerCard } from '@/components/script/speaker-card';
import { SourceEditor } from '@/components/script/source-editor';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { lineTags, q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';
import { editorChecks, tokenPatternOf, withoutTokens } from '@/lib/line-context';
import { dateTime } from '@/lib/datetime';

const ORIGIN = { ai: 'AI', human: '사람', import: '가져옴', tool: '도구' } as const;
const STATE = { queued: '대기', running: '실행 중', done: '완료', failed: '실패', cancelled: '취소' } as const;
type LineRecord = InferResponseType<(typeof client.units)[':unitId']['$get']>;
export type LineTab = 'context' | 'candidates' | 'checks' | 'terms' | 'history';
export const LINE_TABS: LineTab[] = ['context', 'candidates', 'checks', 'terms', 'history'];

/** The selected dialogue's editor, context, candidates, checks, glossary and run history. */
export function LineDetail({
  projectId,
  unitId,
  onClose,
  showScene,
  editor,
  tab = 'context',
  onTab,
  aiNode,
  onAiNode,
}: {
  projectId: string;
  unitId: string;
  onClose?: () => void;
  showScene?: boolean;
  /** Show the translation editor in the pane (screens without an editing row). */
  editor?: boolean;
  tab?: LineTab;
  onTab: (tab: LineTab) => void;
  aiNode?: string;
  onAiNode: (value: string) => void;
}) {
  const unit = useQuery(q.unit(unitId));
  const statuses = useQuery(q.statuses(projectId));
  const terms = useQuery(q.terms(projectId));
  const project = useQuery(q.project(projectId));
  const people = useQuery(q.characters(projectId));
  const group = useQuery({ ...q.group(unit.data?.group.id ?? ''), enabled: Boolean(unit.data?.group.id) });
  const [draft, setDraft] = useDraft(`line:${unitId}`, unit.data?.translation ?? '');
  const [noting, setNoting] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  useReportView('line-detail', [
    unit.data && {
      kind: unit.data.kind === 'ui' ? 'UI 문자열' : unit.data.kind === 'document' ? '문서 원문' : '대사',
      id: unit.data.id,
      label: `${unit.data.speaker?.trim() ? `${unit.data.speaker.trim()}: ` : ''}${unit.data.source.slice(0, 40)}`,
      detail: JSON.stringify({ key: unit.data.key }),
    },
  ]);

  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[]; listener?: string | null }) => unwrap(client.units[':unitId'].$patch({ param: { unitId }, json })),
    onMutate: async (json) => ({ undo: await optimistic(queryClient, unitChanges([unitId], patchedLine(json))) }),
    onError: (error, _json, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });
  const check = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [unitId], checked: true } })),
    onMutate: async () => ({ undo: await optimistic(queryClient, unitChanges([unitId], patchedLine({ checked: true }))) }),
    onError: (error, _vars, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });

  const line = unit.data;
  const status = statuses.data?.statuses.find((item) => item.id === line?.statusId);
  const tags = lineTags(statuses.data?.tags);
  const lastRun = line?.history[0];
  const allTermsMatcher = useMemo(() => termMatcher(terms.data ?? [], (t) => t.source), [terms.data]);
  const matchedTerms = useMemo(
    () => (line ? allTermsMatcher.find(withoutTokens(line.source, tokenPatternOf(project.data?.formatRules))) : []),
    [line, allTermsMatcher, project.data?.formatRules],
  );
  const unknown = line ? isUnknownListener(line, project.data?.formatRules ?? undefined) : true;
  const cast = (people.data?.characters ?? []).filter((person) => person.status === 'confirmed').map((person) => ({ name: person.name, player: person.player }));
  const hasDialogueContext = line?.kind === 'dialogue' && Boolean(line.speaker?.trim());
  const kindLabel = line?.kind === 'ui' ? 'UI 문자열' : line?.kind === 'document' ? '문서 원문' : hasDialogueContext ? '대사' : '서술';
  const speakerTitle = line?.speaker || '화자 없음';
  const speakerPerson = line?.speaker ? people.data?.characters.find((person) => person.name.toLowerCase() === line.speaker!.toLowerCase() || person.aliases.some((alias) => alias.toLowerCase() === line.speaker!.toLowerCase())) : undefined;
  const listenerTitle = !line || !needsListener(line, project.data?.formatRules ?? undefined) || unknown || !line.listener ? '청자 미상' : listenerLabel(line.listener);

  const title = line ? (
    hasDialogueContext ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="truncate">{speakerTitle}</span>
        {!unknown && line.listener && (
          <>
            <span className="text-subtle-foreground">→</span>
            <span className="truncate">{listenerTitle}</span>
          </>
        )}
      </span>
    ) : (
      <span className="truncate">{line.group.title}</span>
    )
  ) : (
    '…'
  );

  const kind = line ? (
    hasDialogueContext ? (
      <span>{kindLabel} · #{line.seq}</span>
    ) : (
      <span className="truncate" title={line.source}>{kindLabel} · #{line.seq} · {line.source}</span>
    )
  ) : (
    '줄'
  );

  const metadata = line && (
    <>
      {status && <span className="inline-flex items-center gap-1"><StatusIcon status={status} />{status.name}</span>}
      {line.statusBy === 'ai' && <AiMark by="ai" />}
      {showScene ? <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id }} className="truncate hover:underline">{line.group.title}</Link> : <span className="truncate">{line.group.title}</span>}
      {line.tagIds.map((id) => {
        const tag = tags.find((item) => item.id === id);
        return tag ? <TagChip key={id} tag={tag} /> : null;
      })}
    </>
  );
  const graphTarget = line?.graphNodes[0];
  const attachedTags = line ? tags.filter((tag) => line.tagIds.includes(tag.id)) : [];
  const orderedTags = [...attachedTags.filter((tag) => tag.role), ...attachedTags.filter((tag) => !tag.role)];

  const createTagInline = async (name: string) => {
    if (!line) return;
    try {
      const color = (PALETTE[tags.length % PALETTE.length] as any).light ?? PALETTE[tags.length % PALETTE.length].hex;
      const res = await unwrap(client.projects[':projectId'].tags.$post({
        param: { projectId },
        json: { name, color, scope: [...TAG_SCOPES] },
      }));
      await patch.mutateAsync({ tagIds: [...line.tagIds, res.id] });
      queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['units', projectId] });
      queryClient.invalidateQueries({ queryKey: ['unit', line.id] });
      toast.success(`'${name}' 태그를 만들고 줄에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  const activeTab = tab === 'checks' || tab === 'history' ? 'checks' : 'context';

  if (line && editingSource) return <SourceEditor
    projectId={projectId}
    kind={line.kind === 'dialogue' ? 'scene' : line.kind}
    unitId={line.id}
    mode="edit-unit"
    onClose={() => setEditingSource(false)}
    onSaved={() => setEditingSource(false)}
    onDeleted={() => { setEditingSource(false); onClose?.(); }}
  />;

  return (
    <Inspector
      header={<InspectorHeader
        kind={kind}
        name={title}
        status={metadata}
        actions={line && <>
          <Button type="button" variant="outline" onClick={() => setEditingSource(true)}><Pencil /> 원문 편집</Button>
          {line.statusBy === 'ai' && <Button type="button" variant="outline" onClick={() => check.mutate()}>확인함</Button>}
        </>}
        onClose={onClose}
      />}
      loading={!line}
      tabs={<InspectorTabs value={activeTab} onChange={(next) => onTab(next as LineTab)} items={[
        { value: 'context', label: `번역 도우미${matchedTerms.length || (line?.candidates.length ?? 0) ? ` (${matchedTerms.length + (line?.candidates.length ?? 0)})` : ''}` },
        { value: 'checks', label: `검사·이력${(lastRun?.data.issues?.length ?? 0) + (line?.history.length ?? 0) ? ` (${(lastRun?.data.issues?.length ?? 0) + (line?.history.length ?? 0)})` : ''}` },
      ]} />}
    >
      {line && editor && <section className="border-b border-border-subtle p-4"><TranslationEditor projectId={projectId} unit={{ id: line.id, source: line.source, translation: line.translation, statusId: line.statusId, statusBy: line.statusBy, candidates: line.candidates }} statuses={statuses.data?.statuses ?? []} /></section>}
      {line && activeTab === 'context' && (
        <>
          {matchedTerms.length > 0 && (
            <LineTerms projectId={projectId} source={line.source} text={draft} terms={matchedTerms} rules={project.data?.formatRules} />
          )}

          {!!line.candidates.length && (
            <CandidateSection projectId={projectId} unit={line} draft={draft} setDraft={setDraft} tokenPattern={tokenPatternOf(project.data?.formatRules)} />
          )}

          {(line.neighbors.previous || line.neighbors.next) && (
            <InspectorSection title="앞뒤 대사">
              <NearbyDialogues previous={line.neighbors.previous} next={line.neighbors.next} tokenPattern={tokenPatternOf(project.data?.formatRules)} />
            </InspectorSection>
          )}

          <InspectorSection title="화자·청자·태그">
            <PropertyGrid>
              {line.speaker && <PropertyRow label="화자"><SpeakerCard projectId={projectId} name={line.speaker}><SpeakerIdentity speaker={line.speaker} /></SpeakerCard></PropertyRow>}
              {needsListener(line, project.data?.formatRules ?? undefined) && <PropertyRow label="청자">
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <ListenerPicker line={{ speaker: line.speaker, listener: line.listener, listenerOrigin: line.listenerOrigin, listenerConfidence: line.listenerConfidence, sceneNames: line.sceneNames }} cast={cast} onPick={(listener) => patch.mutate({ listener })} />
                </div>
              </PropertyRow>}
              {line.speech && <PropertyRow label="말투 규칙"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: line.speech.ruleId }} className="block truncate hover:underline" title={line.speech.rule}>{line.speech.rule}</Link></PropertyRow>}
              {line.speaker && <PropertyRow label="인물 자료"><Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'characters', ...(speakerPerson && { item: speakerPerson.id }) }} className="block truncate hover:underline">인물 표에서 보기</Link></PropertyRow>}
              <PropertyRow label="태그">
                <TagListEditor
                  tags={orderedTags}
                  allTags={tags}
                  onToggle={(tagId, add) => patch.mutate({ tagIds: add ? [...line.tagIds, tagId] : line.tagIds.filter((id) => id !== tagId) })}
                  onCreate={createTagInline}
                  heading="대사 태그"
                />
              </PropertyRow>
              <PropertyRow label="메모">
                {line.note || noting ? (
                  <LineNote unitId={line.id} note={line.note} editing={noting} onEditing={setNoting} />
                ) : (
                  <Button variant="ghost" onClick={() => setNoting(true)}>
                    메모 추가
                  </Button>
                )}
              </PropertyRow>
            </PropertyGrid>
            {line.speaker && <LineHints projectId={projectId} line={{ id: line.id, source: line.source, translation: line.translation, speaker: line.speaker, listener: line.listener, lastRun: lastRun ? { issues: lastRun.data.issues ?? [] } : null }} part="context" />}
          </InspectorSection>
        </>
      )}

      {line && activeTab === 'checks' && (
        <>
          {lastRun?.data.issues?.length ? (
            <InspectorSection title={<>최근 실행의 지적 · <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: lastRun.runId }} className="hover:underline">{lastRun.workflowName}</Link></>}>
              <ul className="space-y-1 text-sm text-warning">{lastRun.data.issues.map((issue, i) => <li key={i} className="flex items-start gap-1.5"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{issue}</li>)}</ul>
            </InspectorSection>
          ) : (
            <p className="px-4 py-2 text-sm text-muted-foreground">최근 실행에서 지적된 내용이 없습니다.</p>
          )}

          <LineChecks projectId={projectId} source={line.source} text={draft} rules={project.data?.formatRules} targetLanguage={project.data?.targetLanguage} speech={line.speech} />

          {line.history.length > 0 && <HistorySection projectId={projectId} history={line.history} defaultOpen />}

          <InspectorSection title="원본 정보 · 그래프">
            <PropertyGrid>
              <PropertyRow label="대사 키">
                <code className="font-mono text-xs break-all text-muted-foreground">{line.key}</code>
              </PropertyRow>
              <PropertyRow label="장면">
                {showScene ? <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.group.id, line: line.id }} className="block truncate hover:underline" title={line.group.title}>{line.group.title}</Link> : <span className="block truncate" title={line.group.title}>{line.group.title}</span>}
              </PropertyRow>
              {line.kind === 'dialogue' && (line.graphNodes.length > 0 || group.data?.kind === 'scene') && (
                <PropertyRow label="대사 그래프">
                  {line.graphNodes.length ? (
                    <ul className="space-y-1">
                      {line.graphNodes.map((item) => (
                        <li key={item.id} className="min-w-0">
                          <Link
                            to="/p/$projectId/graph"
                            params={{ projectId }}
                            search={{ scope: 'dialogue', scene: line.group.id, node: item.id, jump: true }}
                            className="flex min-w-0 items-center gap-1.5 hover:underline"
                            title={`${item.key}에서 열기`}
                          >
                            <Network className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 truncate">{item.key}에서 열기</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Link
                      to="/p/$projectId/graph"
                      params={{ projectId }}
                      search={{ scope: 'dialogue', scene: line.group.id, ...(graphTarget && { node: graphTarget.id, jump: true }) }}
                      className="block truncate hover:underline"
                    >
                      대사 그래프에서 열기
                    </Link>
                  )}
                </PropertyRow>
              )}
            </PropertyGrid>
          </InspectorSection>

          <InspectorSection title="AI 프롬프트 문맥 미리보기" defaultOpen={false}>
            <AiContextPanel projectId={projectId} unitKey={line.key} unitKind={line.kind} aiNode={aiNode} onAiNode={onAiNode} />
          </InspectorSection>
        </>
      )}
    </Inspector>
  );
}

function NearbyDialogues({ previous, next, tokenPattern }: { previous: LineRecord['neighbors']['previous']; next: LineRecord['neighbors']['next']; tokenPattern: RegExp | null }) {
  const visible = [previous, next].filter((row): row is NonNullable<typeof row> => row != null);
  return (
    <ol className="divide-y divide-border-subtle">
      {visible.map((row) => (
        <li key={row.id}>
          <ContextLine
            speaker={<SpeakerIdentity speaker={row.speaker} />}
            source={<TokenText text={row.source} source={row.source} pattern={tokenPattern} />}
            translation={row.translation ? <TokenText text={row.translation} source={row.source} pattern={tokenPattern} /> : undefined}
          />
        </li>
      ))}
    </ol>
  );
}

function CandidateSection({ projectId, unit, draft, setDraft, tokenPattern }: { projectId: string; unit: LineRecord; draft: string; setDraft: (text: string) => void; tokenPattern: RegExp | null }) {
  const origins = new Set(unit.candidates.map((candidate) => candidate.origin));
  const title = origins.size === 1 ? `${({ ai: 'AI', human: '사람', import: '가져온 것', tool: '도구' } as const)[unit.candidates[0]!.origin]} 후보` : '번역 후보';
  const subject = unit.kind === 'ui' ? 'UI 문자열' : unit.kind === 'document' ? '문서 원문' : '대사';
  return (
    <InspectorSection title={`${title} ${unit.candidates.length}`} actions={<>
      <AiButton variant="ghost" prompt={`${subject}의 번역 후보를 제안해줘.`}>AI 제안</AiButton>
      {unit.translation && <AiButton variant="ghost" send={false} prompt={`${subject}의 번역을 이렇게 다듬어줘: `}>다듬기</AiButton>}
    </>}>
      <ul className="space-y-2">
        {unit.candidates.map((candidate) => {
          const current = candidate.text === (unit.translation ?? null);
          const inEditor = draft !== (unit.translation ?? '') && candidate.text === draft;
          return (
            <li key={candidate.id}>
              <CandidateCard
                text={<TokenText text={candidate.text} source={unit.source} pattern={tokenPattern} className="whitespace-pre-wrap" />}
                current={current}
                source={<Badge variant="outline">{ORIGIN[candidate.origin]}</Badge>}
                meta={<span className="truncate">{[candidate.model, dateTime(candidate.createdAt)].filter(Boolean).join(' · ')}</span>}
                action={current ? <span className="shrink-0 font-medium text-foreground">현재 번역</span> : <Button variant="ghost" title={inEditor ? '현재 초안에 이미 있습니다' : '현재 번역 초안에 적용'} disabled={inEditor} onClick={() => setDraft(candidate.text)}>적용</Button>}
              />
            </li>
          );
        })}
        {!unit.candidates.length && <li className="text-sm text-muted-foreground">아직 후보가 없습니다.</li>}
      </ul>
    </InspectorSection>
  );
}

function HistorySection({ projectId, history, defaultOpen = true }: { projectId: string; history: LineRecord['history']; defaultOpen?: boolean }) {
  return (
    <InspectorSection title={`실행 이력 ${history.length}`} defaultOpen={defaultOpen}>
      {history.length ? (
        <ul className="space-y-2 text-sm">
          {history.map((item) => (
            <li key={item.id} className="space-y-0.5 rounded-md border p-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: item.runId }} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {item.workflowName}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">{STATE[item.state]}</span>
                <span className="shrink-0 text-xs text-subtle-foreground">{dateTime(item.createdAt)}</span>
              </div>
              {item.data.issues?.[0] && <p className="truncate text-xs text-warning">{item.data.issues[0]}</p>}
              {item.error && <p className="text-xs text-destructive">{item.error}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">이 줄이 포함된 실행이 없습니다.</p>
      )}
    </InspectorSection>
  );
}

/** Translation format checks against the line's current draft. */
function LineChecks({ projectId, source, text, rules, targetLanguage, speech }: { projectId: string; source: string; text: string; rules?: FormatRules; targetLanguage?: string; speech?: { listener: string; ruleId: string; rule: string; level: SpeechLevel; byOrder: boolean; routeDependent?: boolean; others?: boolean } | null }) {
  const formatIssues = text.trim() ? checkFormat(source, text, editorChecks(targetLanguage, true), rules) : [];
  const guessed = text.trim() ? speechLevelOf(text) : null;
  return (
    <>
      {speech && (
        <InspectorSection title={`말투 규칙 → ${listenerLabel(speech.listener)}${speech.others ? ' (그 밖의 사람 규칙)' : ''}${speech.routeDependent ? ' (루트에 따라 달라 대본 순서 기준)' : speech.byOrder ? ' (그래프 밖이라 대본 순서 기준)' : ''}`}>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', item: speech.ruleId }} className="min-w-0 truncate hover:underline">
              {speech.rule}
            </Link>
            <span className={cn('ml-auto shrink-0 text-xs', !guessed || speech.level === 'other' ? 'text-muted-foreground' : guessed === speech.level ? 'text-success' : 'text-warning')}>
              {!guessed || speech.level === 'other' ? '' : guessed === speech.level ? '맞음 (어미 추정)' : `번역은 ${SPEECH_LEVEL_LABELS[guessed]} (어미 추정)`}
            </span>
          </div>
        </InspectorSection>
      )}
      <InspectorSection title="형식">
        {!text.trim() ? (
          <p className="text-sm text-muted-foreground">번역이 없습니다.</p>
        ) : formatIssues.length ? (
          <ul className="space-y-1 text-sm text-warning">
            {formatIssues.map((issue) => (
              <li key={issue.code} className="flex items-start gap-1.5">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-3.5" />
            자리표시자·태그·줄바꿈이 원문과 맞습니다.
          </p>
        )}
      </InspectorSection>
    </>
  );
}

/** Glossary terms in the source and whether the working draft keeps each translation. */
function LineTerms({ projectId, text, terms }: { projectId: string; source?: string; text: string; terms: { id: string; source: string; target: string; status: KnowledgeStatus }[]; rules?: FormatRules }) {
  return (
    <InspectorSection title={`용어집 일치 (${terms.length})`}>
      {terms.length ? (
        <ul className="space-y-1.5 text-sm">
          {terms.map((term) => {
            const kept = Boolean(term.target.trim()) && text.toLowerCase().includes(term.target.toLowerCase());
            return (
              <li key={term.id} className="flex min-w-0 items-center gap-2">
                <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ term: term.id }} className="min-w-0 flex-1 truncate hover:underline">
                  <b>{term.source}</b> → {term.target || <span className="text-muted-foreground">(번역 없음)</span>}
                </Link>
                {term.status === 'candidate' && <Badge variant="outline">후보</Badge>}
                <span className={cn('shrink-0 text-xs', !text.trim() || !term.target ? 'text-muted-foreground' : kept ? 'text-success' : term.status === 'confirmed' ? 'text-warning' : 'text-muted-foreground')}>
                  {!text.trim() || !term.target ? '' : kept ? '번역에 있음' : '번역에 없음'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">원문에 나오는 용어가 없습니다.</p>
      )}
    </InspectorSection>
  );
}
