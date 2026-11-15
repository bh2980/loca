import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert } from 'lucide-react';
import { sourceFileSchema, type SourceFile } from '@loca/shared';
import { Page } from '@/components/page';
import { type ColumnDef, DataTable, Box, Button, Checkbox, FileDropZone, Heading, Icon, Inline, KeyValue, KeyValueRow, Notice, NoticeDescription, PageBody, ScopeRow, Section, Spinner, Text } from '@loca/ui';
import { addSourceFile, sourceDiff, undoSourceFile, useSourceImports } from '@/lib/source-import';
import type { FeedRow } from '@/lib/collections';

export const Route = createFileRoute('/p/$projectId/import')({
  component: ImportSource,
});

type Picked = { id: string; name: string; file: SourceFile } | { id: string; name: string; issues: { path: string; message: string }[] };
type Added = Awaited<ReturnType<typeof addSourceFile>>;

/** Where a 원문 넣기 came from: a person here, an accepted proposal (the terminal, a chat), or the file the project was made from. */
const SOURCE_VIA = { app: '앱', proposal: '제안', new: '새 프로젝트' } as const;
const KNOWLEDGE_LABELS = { characters: '인물', relationships: '관계', documents: '노트', terms: '용어', events: '사건', speechRules: '말투' } as const;
const some = (keys: readonly string[], shown = 5) => (keys.length > shown ? `${keys.slice(0, shown).join(', ')} 외 ${keys.length - shown}개` : keys.join(', '));
const count = (keys: readonly string[]) => (keys.length ? `${keys.length.toLocaleString()}개 · ${some(keys)}` : '없음');

/**
 * 원문 넣기: a standard file (loca/v1) into this project, matched by key. The file is checked here, compared with the
 * project on the server (what is new, what the project has otherwise, what nothing has), and its new keys go in at
 * one press; formats its new lines use that the format rules lack are asked about first. 되돌리기 takes it all back.
 */
function ImportSource() {
  const { projectId } = Route.useParams();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [dragging, setDragging] = useState(false);
  // Formats the person said not to turn on; the rest of what is offered is turned on with the lines.
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  // The keys the project has that the file gives otherwise are changed too (a game patch); off, they stay.
  const [update, setUpdate] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);

  const file = picked && 'file' in picked ? picked.file : null;
  const diff = useQuery({ ...sourceDiff(projectId, picked?.id ?? '', file!), enabled: !!file });
  const formats = (diff.data?.formats ?? []).filter((format) => !declined.has(format.id)).map((format) => format.id);

  const add = useMutation({
    mutationFn: () => addSourceFile(projectId, { ...file!, formats, update, name: picked?.name }),
    onSuccess: (result) => setAdded(result),
    onError: (error) => toast.error(error.message),
  });
  const undo = useMutation({
    mutationFn: (token: string) => undoSourceFile(projectId, token),
    onSuccess: () => (setAdded(null), toast.success('더한 것을 되돌렸습니다.')),
    onError: (error) => toast.error(error.message),
  });

  async function load(chosen: File | undefined) {
    if (!chosen) return;
    const id = `${chosen.name}:${chosen.size}:${chosen.lastModified}:${Date.now()}`;
    setAdded(null);
    setDeclined(new Set());
    setUpdate(false);
    try {
      const parsed = sourceFileSchema.safeParse(JSON.parse(await chosen.text()));
      setPicked(parsed.success ? { id, name: chosen.name, file: parsed.data } : { id, name: chosen.name, issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
    } catch (error) {
      setPicked({ id, name: chosen.name, issues: [{ path: '', message: `JSON을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}` }] });
    }
  }

  const data = diff.data;
  const knowledgeAdded = data ? Object.values(data.knowledge).reduce((sum, item) => sum + item.added, 0) : 0;
  const changed = data ? [...data.units.changed, ...data.groups.changed, ...data.graph.nodes.changed] : [];
  const restart = data ? data.units.changed.filter((item) => item.fields.includes('source')).length : 0;
  const adds = (data ? data.groups.added.length + data.units.added.length + data.graph.nodes.added.length + data.graph.edges.added + knowledgeAdded : 0) + (update ? changed.length : 0);
  const blocked = !!data?.unresolved.length;
  const nodes = data ? data.graph.nodes.added.length + data.graph.nodes.own : 0;
  // Per kind, the items of the file the project lacks (added) or has (kept as it is).
  const knowledgeOf = (part: 'added' | 'existing') => (data ? Object.entries(KNOWLEDGE_LABELS).flatMap(([kind, label]) => { const n = data.knowledge[kind as keyof typeof KNOWLEDGE_LABELS][part]; return n ? [`${label} ${n.toLocaleString()}`] : []; }) : []);
  const newKnowledge = knowledgeOf('added');
  const keptKnowledge = knowledgeOf('existing');

  return (
    <Page title="원문 넣기" flush>
      <PageBody label="원문 넣기">
        <Box spaceY="wide">
          <Section variant="page" title="파일" description="표준 파일(loca/v1)에서 이 프로젝트에 없는 key와 지식(인물·관계·말투·사건·노트·용어)만 더합니다. 이미 있는 대사와 지식은 파일과 달라도 바꾸지 않고, 파일에 없는 대사도 지우지 않습니다. 파일은 프로젝트에 있는 묶음·대사·노드·인물을 key나 이름으로 가리켜도 됩니다.">
            <FileDropZone accept=".json,application/json" dragging={dragging} onDraggingChange={setDragging} onFile={(chosen) => void load(chosen)}>
              {picked ? <Text weight="medium" tone="default">{picked.name}</Text> : dragging ? '여기에 놓기' : '파일을 끌어다 놓거나 눌러서 선택'}
            </FileDropZone>
            {picked && 'issues' in picked && (
              <Box maxHeight="scroll" overflow="auto" radius="md" border="all" background="sunken" padding="normal" variant="body">
                <Text as="p" marginBottom="condensed" weight="semibold" tone="danger">형식 오류 {picked.issues.length.toLocaleString()}개: 이 파일은 넣을 수 없습니다.</Text>
                <Box as="ul" spaceY="tight" mono>
                  {picked.issues.slice(0, 50).map((issue, index) => (
                    <li key={index}>
                      <Text tone="muted">{issue.path || '(파일)'}</Text> {issue.message}
                    </li>
                  ))}
                </Box>
              </Box>
            )}
          </Section>

          {added && (
            <Notice
              variant="banner"
              role="status"
              actions={
                <>
                  <Button variant="ghost" disabled={!added.undoId || undo.isPending} onClick={() => added.undoId && undo.mutate(added.undoId)}>
                    {undo.isPending && <Spinner />} 되돌리기
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/p/$projectId/script" params={{ projectId }}>대사 화면에서 보기</Link>
                  </Button>
                </>
              }
            >
              더했습니다: 묶음 {added.added.groups.toLocaleString()} · 대사 {added.added.units.toLocaleString()} · 그래프 노드 {added.added.graphNodes.toLocaleString()} · 연결 {added.added.graphEdges.toLocaleString()}
              {Object.values(added.knowledge.added).some(Boolean) && ` · 지식 ${Object.entries(KNOWLEDGE_LABELS).flatMap(([kind, label]) => { const n = added.knowledge.added[kind as keyof typeof KNOWLEDGE_LABELS]; return n ? [`${label} ${n.toLocaleString()}`] : []; }).join(' · ')}`}
              {added.formats.length > 0 && ` · 서식 규칙에 켬 ${added.formats.join(', ')}`}
              {added.updated.units + added.updated.groups + added.updated.graphNodes > 0 && ` · 바꿈: 대사 ${added.updated.units.toLocaleString()} · 묶음 ${added.updated.groups} · 노드 ${added.updated.graphNodes}${added.updated.restarted ? ` (다시 번역할 대사 ${added.updated.restarted.toLocaleString()})` : ''}`}
              {added.updated.skipped.length > 0 && ` · 바꾸지 않음 ${added.updated.skipped.length}개 (${some(added.updated.skipped.map((skip) => `${skip.key}: ${skip.reason}`), 2)})`}
              {added.tagsSkipped.length > 0 && ` · 붙이지 않은 태그 ${some(added.tagsSkipped.map((skip) => `${skip.key}: ${skip.reason}`), 2)}`}
            </Notice>
          )}

          {file && (
            <Section
              variant="page"
              title="더할 것"
              footer={
                <Button disabled={!data || blocked || !adds || add.isPending} onClick={() => add.mutate()}>
                  {add.isPending && <Spinner />} {data && data.units.added.length ? `대사 ${data.units.added.length.toLocaleString()}개 더하기` : update && changed.length ? '바꾸기' : '더하기'}
                </Button>
              }
            >
              {diff.isPending && (
                <Inline as="p" gap="condensed" variant="body" tone="muted">
                  <Spinner /> 프로젝트와 맞춰 보는 중…
                </Inline>
              )}
              {diff.error && <Text as="p" variant="body" tone="danger">{diff.error.message}</Text>}
              {data && (
                <Box spaceY="comfortable">
                  {!adds && !blocked && <Text as="p" variant="body" tone="muted">더할 것이 없습니다. 파일의 key와 지식이 모두 프로젝트에 있습니다.{changed.length > 0 && ' 다르게 적힌 key는 아래에서 파일대로 바꿀 수 있습니다.'}</Text>}
                  {adds - (update ? changed.length : 0) > 0 && (
                    <KeyValue align="start" framed>
                      <KeyValueRow label="묶음">{count(data.groups.added)}</KeyValueRow>
                      <KeyValueRow label="대사">{count(data.units.added)}</KeyValueRow>
                      <KeyValueRow label="그래프 노드">
                        <Text tabular>{nodes.toLocaleString()}개</Text>
                        {data.graph.nodes.own > 0 && <Text tone="muted"> · 새 장면 대사에 하나씩 붙는 {data.graph.nodes.own.toLocaleString()}개 포함</Text>}
                      </KeyValueRow>
                      <KeyValueRow label="연결"><Text tabular>{data.graph.edges.added.toLocaleString()}개</Text></KeyValueRow>
                      {newKnowledge.length > 0 && <KeyValueRow label="지식">{newKnowledge.join(' · ')}</KeyValueRow>}
                    </KeyValue>
                  )}

                  {data.formats.length > 0 && !blocked && adds > 0 && (
                    <Box as="fieldset" spaceY="tight">
                      <Heading as="legend" minWidth={0} marginBottom="condensed">새 서식을 서식 규칙에 같이 켜시겠습니까?</Heading>
                      <Text as="p" variant="caption" tone="muted">켜면 번역 점검이 번역문에서 이 표시가 빠졌는지 보고, AI 번역에 그대로 두라고 알립니다. 나중에 설정 › 프로젝트에서 바꿀 수 있습니다.</Text>
                      {data.formats.map((format) => (
                        <ScopeRow key={format.id}>
                          <Checkbox
                            checked={!declined.has(format.id)}
                            onCheckedChange={(on) => {
                              const next = new Set(declined);
                              if (on === true) next.delete(format.id);
                              else next.add(format.id);
                              setDeclined(next);
                            }}
                          />
                          <Text minWidth={0} grow truncate>{format.label}</Text>
                          <Text shrink={false} variant="caption" tone="muted" mono>{format.examples.slice(0, 3).join(' ')}</Text>
                          <Text shrink={false} variant="caption" tone="muted" tabular>{format.count.toLocaleString()}줄</Text>
                        </ScopeRow>
                      ))}
                    </Box>
                  )}

                  {blocked && (
                    <Notice tone="danger" icon={<Icon icon={CircleAlert} />} title={`어디에도 없는 참조 ${data.unresolved.length.toLocaleString()}개: 이대로는 넣을 수 없습니다`}>
                      <NoticeDescription>
                        <Box as="ul" spaceY="tight" mono>
                          {data.unresolved.slice(0, 30).map((item) => (
                            <li key={item.path}>
                              <Text tone="muted">{item.path}</Text> {item.message}
                            </li>
                          ))}
                        </Box>
                      </NoticeDescription>
                    </Notice>
                  )}
                  {data.warnings.map((warning) => (
                    <Notice key={warning} tone="warning">{warning}</Notice>
                  ))}

                  {changed.length > 0 && !blocked && (
                    <Box as="fieldset" spaceY="tight">
                      <Heading as="legend" minWidth={0} marginBottom="condensed">프로젝트와 다르게 적힌 key {changed.length.toLocaleString()}개{!update && <Text variant="caption" weight="normal" tone="muted"> · 그대로 둠</Text>}</Heading>
                      <Text as="p" variant="caption" tone="muted">{some(changed.map((item) => `${item.key}: ${item.fields.join('·')}`), 5)}</Text>
                      <ScopeRow>
                        <Checkbox checked={update} onCheckedChange={(on) => setUpdate(on === true)} />
                        <Text minWidth={0} grow>파일대로 바꾸기{restart > 0 && <Text tone="muted"> · 원문이 바뀐 대사 {restart.toLocaleString()}개는 번역을 남긴 채 다시 번역할 상태로</Text>}</Text>
                      </ScopeRow>
                      <Text as="p" variant="caption" tone="muted">사람이 정한 청자, 묶음의 종류, 노드에 담긴 대사는 바꾸지 않습니다. 되돌리기로 함께 되돌립니다.</Text>
                    </Box>
                  )}

                  <Box as="ul" spaceY="tight" variant="caption" tone="muted">
                    {data.units.missing.length > 0 && <li>그대로 둠: 파일이 다시 가져온 묶음에서 빠진 대사 {data.units.missing.length.toLocaleString()}개 ({some(data.units.missing, 3)})</li>}
                    {keptKnowledge.length > 0 && <li>그대로 둠: 프로젝트에 이미 있는 {keptKnowledge.join(' · ')} (같은 이름의 인물, 같은 원문의 용어, 같은 제목의 노트·사건…)</li>}
                  </Box>
                </Box>
              )}
            </Section>
          )}

          <ImportLog projectId={projectId} undoing={undo.isPending} onUndo={(token) => undo.mutate(token)} />
        </Box>
      </PageBody>
    </Page>
  );
}

type ImportEntry = FeedRow['sourceImports'];

/** What one 원문 넣기 brought, in a line. */
function entrySummary({ summary }: ImportEntry) {
  const knowledge = Object.entries(KNOWLEDGE_LABELS).flatMap(([kind, label]) => { const n = summary.knowledge[kind as keyof typeof KNOWLEDGE_LABELS]; return n ? [`${label} ${n.toLocaleString()}`] : []; });
  const { added, updated } = summary;
  return [
    (added.groups || added.units || added.graphNodes || added.graphEdges) && `묶음 ${added.groups.toLocaleString()} · 대사 ${added.units.toLocaleString()} · 노드 ${added.graphNodes.toLocaleString()} · 연결 ${added.graphEdges.toLocaleString()}`,
    knowledge.length && `지식 ${knowledge.join(' · ')}`,
    (updated.units || updated.groups || updated.graphNodes) && `바꿈 대사 ${updated.units.toLocaleString()} · 묶음 ${updated.groups} · 노드 ${updated.graphNodes}${updated.restarted ? ` (다시 번역 ${updated.restarted.toLocaleString()})` : ''}`,
    summary.formats.length && `서식 ${summary.formats.join(', ')}`,
  ].filter(Boolean).join(' · ');
}

/** 가져온 기록: each file that added to or changed the project, with 되돌리기 while its undo record is kept (30 days). */
function ImportLog({ projectId, undoing, onUndo }: { projectId: string; undoing: boolean; onUndo: (token: string) => void }) {
  const entries = useSourceImports(projectId);
  const columns: ColumnDef<ImportEntry, unknown>[] = [
    { id: 'at', header: '언제', meta: { width: 128, tone: 'muted', tabular: true }, cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) },
    { id: 'name', header: '파일', meta: { width: 140, hideable: false }, cell: ({ row }) => row.original.name ?? '(이름 없음)' },
    { id: 'via', header: '경로', meta: { width: 84, tone: 'muted' }, cell: ({ row }) => SOURCE_VIA[row.original.via] },
    { id: 'summary', header: '내용', meta: { wrap: true }, cell: ({ row }) => entrySummary(row.original) },
    {
      id: 'undo', header: '', meta: { width: 104, dense: true, resizable: false },
      cell: ({ row }) => (row.original.undoneAt ? <Text tone="muted">되돌림</Text> : row.original.undoId ? <Button variant="ghost" disabled={undoing} onClick={() => onUndo(row.original.undoId!)}>되돌리기</Button> : <Text tone="muted">되돌릴 수 없음</Text>),
    },
  ];
  return (
    <Section variant="page" title="가져온 기록" description="이 프로젝트에 원문을 넣은 기록입니다. 되돌리기는 넣은 뒤 30일 동안 할 수 있고, 그때 더하고 바꾼 것을 한 번에 되돌립니다.">
      <DataTable id="source-imports" compact columns={columns} rows={entries.data} rowId={(row) => row.id} loading={entries.isLoading} empty="아직 원문을 넣은 기록이 없습니다." />
    </Section>
  );
}
