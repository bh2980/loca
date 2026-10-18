import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Sparkles, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  Button, Inspector, InspectorHeader, InspectorSection, Input, PropertyGrid, PropertyRow, Skeleton,
} from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { chatDock } from '@/lib/chat-dock';
import type { LayoutEdge } from './graph-canvas';

/** How many omitted nodes the pane reads lines for; the rest are counted. */
const OMITTED_SHOWN = 40;

/** The chat input text for asking the AI for a short view of what is on screen. */
export const briefViewPrompt = (where: string) => `그래프 ${where}에서 필요한 노드만 남긴 간략 보기를 만들어줘. 남길 기준: `;
/** The chat input text for making a view again from its old request. */
export const remakeViewPrompt = (label: string, request: string | null) => `보기 "${label}"를 다시 만들어줘.${request ? `\n이전 요청: ${request}` : ''}\n고칠 점: `;

/** Stored-view changes made from the graph; each refreshes through the graph SSE topic. */
export function useViewActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['graph', projectId, 'views'] });
  const create = useMutation({
    mutationFn: (input: { label: string; nodeIds: string[] }) => unwrap(client.projects[':projectId'].graph.views.$post({ param: { projectId }, json: input })),
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : '보기를 만들지 못했습니다.'),
  });
  const change = useMutation({
    mutationFn: (input: { id: string; label?: string; add?: string[]; remove?: string[] }) => {
      const { id, ...json } = input;
      return unwrap(client.projects[':projectId'].graph.views[':id'].$patch({ param: { projectId, id }, json: { add: [], remove: [], ...json } }));
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : '보기를 바꾸지 못했습니다.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(client.projects[':projectId'].graph.views[':id'].$delete({ param: { projectId, id } })),
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : '보기를 지우지 못했습니다.'),
  });
  return { create, change, remove };
}

/** Rename in place: the name is text until clicked, saved on Enter or blur, dropped on Esc. */
function InlineName({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };
  if (!editing)
    return (
      <Button variant="ghost" className="-ml-2 max-w-full justify-start" aria-label="보기 이름 바꾸기" onClick={() => setEditing(true)}>
        <span className="truncate">{value}</span>
        <Pencil className="text-muted-foreground" />
      </Button>
    );
  return (
    <Input
      autoFocus
      value={draft}
      maxLength={80}
      aria-label="보기 이름"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

/** The right pane of an open view: its name, how it was made, its size and what it can no longer find. */
export function ViewInspector({ projectId, viewId, shownNodes, derivedEdges, onClose, onDeleted }: { projectId: string; viewId: string; shownNodes: number; derivedEdges: number; onClose: () => void; onDeleted: () => void }) {
  const view = useQuery(q.graphView(projectId, viewId));
  const actions = useViewActions(projectId);
  const [confirming, setConfirming] = useState(false);
  if (!view.data)
    return (
      <Inspector header={<InspectorHeader kind="보기" name="불러오는 중…" onClose={onClose} />} loading>
        {null}
      </Inspector>
    );
  const data = view.data;
  const ai = data.origin === 'ai';
  return (
    <Inspector
      header={<InspectorHeader kind={ai ? '보기 · AI가 만듦' : '보기 · 직접 만듦'} name={data.label} onClose={onClose} />}
      footer={
        <>
          {ai && (
            <Button
              variant="outline"
              onClick={() => chatDock.prefill(projectId, remakeViewPrompt(data.label, data.request))}
            >
              <Sparkles /> 요청 고쳐 다시 만들기
            </Button>
          )}
          <Button variant="outline" className="ml-auto text-destructive" onClick={() => setConfirming(true)}>
            <Trash2 /> 삭제
          </Button>
        </>
      }
    >
      <InspectorSection title="이름">
        <InlineName value={data.label} onSave={(label) => actions.change.mutate({ id: data.id, label })} />
      </InspectorSection>
      <InspectorSection title="만든 방식">
        <PropertyGrid>
          <PropertyRow label="방식">{ai ? 'AI가 채팅으로 고름' : '그래프에서 직접 고름'}</PropertyRow>
          <PropertyRow label="수정">{new Date(data.updatedAt).toLocaleString()}</PropertyRow>
        </PropertyGrid>
        {data.request && <p className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-card px-3 py-2 text-sm">{data.request}</p>}
      </InspectorSection>
      <InspectorSection title="크기">
        <PropertyGrid>
          <PropertyRow label="남긴 노드">{data.nodeIds.length.toLocaleString()}개</PropertyRow>
          <PropertyRow label="화면 노드">{shownNodes.toLocaleString()}개</PropertyRow>
          <PropertyRow label="파생 연결">{derivedEdges.toLocaleString()}개 · 남기지 않은 노드를 건너뛰는 선</PropertyRow>
        </PropertyGrid>
      </InspectorSection>
      {data.missing.length > 0 && (
        <InspectorSection title="원본에 없음">
          <p className="text-sm text-destructive">남긴 노드 {data.missing.length.toLocaleString()}개가 원본 그래프에서 사라졌습니다. 이 보기에는 그려지지 않습니다.</p>
          <Button variant="outline" className="mt-2" onClick={() => actions.change.mutate({ id: data.id, remove: data.missing })}>
            없는 노드 정리
          </Button>
        </InspectorSection>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>보기 "{data.label}"를 지울까요?</AlertDialogTitle>
            <AlertDialogDescription>보기만 지워집니다. 원본 그래프와 대사는 그대로입니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                actions.remove.mutate(data.id, {
                  onSuccess: () => {
                    toast.success('보기를 지웠습니다.');
                    onDeleted();
                  },
                })
              }
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Inspector>
  );
}

/** "이 보기에 남긴 이유" above a node's lines, when the AI gave one. */
export function ViewReason({ reason }: { reason: string }) {
  return (
    <InspectorSection title="이 보기에 남긴 이유" className="shrink-0">
      <p className="text-sm">{reason}</p>
    </InspectorSection>
  );
}

/** A derived edge's omitted stretch: the lines of the nodes it skips (facts from the source graph), and a way to the source. */
export function OmittedPane({ projectId, edge, sections, onOpenSource, onClose }: {
  projectId: string;
  edge: LayoutEdge;
  sections: { name: string; groupIds: string[] }[];
  onOpenSource: (section: string | undefined, nodeId: string) => void;
  onClose: () => void;
}) {
  const omitted = edge.omitted;
  const ids = omitted?.nodeIds ?? [];
  const shown = useMemo(() => ids.slice(0, OMITTED_SHOWN), [ids]);
  const details = useQueries({ queries: shown.map((id) => q.graphNode(id, projectId)) });
  const first = details[0]?.data;
  const section = first?.groupId ? sections.find((item) => item.groupIds.includes(first.groupId!))?.name : undefined;
  return (
    <Inspector
      header={<InspectorHeader kind="파생 연결" name={edge.label ?? '생략한 구간'} onClose={onClose} />}
      footer={
        <Button disabled={!first} onClick={() => ids[0] && onOpenSource(section, ids[0])}>
          원본에서 이 구간 보기
        </Button>
      }
    >
      <InspectorSection title="생략한 구간">
        <p className="text-sm text-muted-foreground">
          이 보기에 남기지 않은 노드 {ids.length.toLocaleString()}개를 거치는 원본 경로입니다. 연결은 원본 그래프에서 계산한 것이며 AI가 만든 것이 아닙니다.
        </p>
      </InspectorSection>
      <InspectorSection title={`대사 ${omitted?.lines.toLocaleString() ?? 0}줄`}>
        {details.length === 0 && <p className="text-sm text-muted-foreground">생략한 대사가 없습니다.</p>}
        <ul className="space-y-2">
          {details.map((result, index) =>
            result.data ? (
              result.data.units.length ? (
                result.data.units.map((unit) => (
                  <li key={unit.id} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 text-sm">
                    <span className="truncate text-xs text-muted-foreground">{unit.speaker ?? '지문·화면 문구'}</span>
                    <span className="min-w-0 break-words">{unit.source}</span>
                  </li>
                ))
              ) : (
                <li key={shown[index]} className="text-xs text-muted-foreground">
                  대사 없는 노드 · {result.data.label ?? result.data.key}
                </li>
              )
            ) : (
              <li key={shown[index]}>
                <Skeleton className="h-4" />
              </li>
            ),
          )}
        </ul>
        {ids.length > shown.length && <p className="mt-2 text-xs text-muted-foreground">노드 {(ids.length - shown.length).toLocaleString()}개는 원본에서 확인하세요.</p>}
      </InspectorSection>
    </Inspector>
  );
}
