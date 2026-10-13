/** Bulk actions on the picked lines: the picks, their mutations, and the head row that offers them. */
import { useRef, useState, type ComponentProps } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { listenerLabel, SPECIAL_LISTENERS } from '@tw/shared';
import { StatusDot } from '@/components/status';
import { PickedBar, PickedLabel } from '@/components/picked-bar';
import { TagMenu } from '@/components/tag-menu';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { client, unwrap } from '@/lib/api';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { lineTags, q } from '@/lib/queries';
import { usePicked } from '@/lib/use-picked';

/** Lines picked by their checkboxes, and the bulk changes the head row makes to them (each shown at once, undone if the server refuses). */
export function useLineBulk({ projectId, pickKey, rows, tagName, marks }: { projectId: string; /** Names the list the picks belong to (scene or review box). */ pickKey: string; rows: { id: string; tagIds: string[]; statusBy: string }[] | undefined; tagName: (tagId: string) => string | undefined; marks: readonly string[] | undefined }) {
  const { picked, pick, clear: stopPicking } = usePicked(`script.${projectId}.${pickKey}`);
  const knownTags = useRef(new Map<string, string[]>());
  for (const row of rows ?? []) knownTags.current.set(row.id, row.tagIds);
  const tagState = (tagId: string): 'all' | 'some' | 'none' => {
    const flags = [...picked].map((id) => knownTags.current.get(id)?.includes(tagId) ?? false);
    return flags.every(Boolean) ? 'all' : flags.some(Boolean) ? 'some' : 'none';
  };
  const queryClient = useQueryClient();
  const undoOnError = (error: Error, _vars: unknown, context: { undo: () => void } | undefined) => {
    context?.undo();
    toast.error(error.message);
  };
  const setStatus = useMutation({
    mutationFn: (statusId: string) => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...picked], statusId } })),
    onMutate: async (statusId) => ({ undo: await optimistic(queryClient, unitChanges(picked, patchedLine({ statusId }))) }),
    onSuccess: () => toast.success(`${picked.size}개 대사의 상태를 바꿨습니다.`),
    onError: undoOnError,
  });
  const setListener = useMutation({
    mutationFn: (listener: string | null) => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...picked], listener } })),
    onMutate: async (listener) => ({ undo: await optimistic(queryClient, unitChanges(picked, patchedLine({ listener }))) }),
    onSuccess: (_data, listener) => toast.success(`${picked.size}개 대사의 청자를 ${listener ? listenerLabel(listener) : '미상'}(으)로 바꿨습니다.`),
    onError: undoOnError,
  });
  // 확인함: the statuses stay; a person now holds them, so the ✦ goes.
  const check = useMutation({
    mutationFn: (unitIds: string[]) => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds, checked: true } })),
    onMutate: async (unitIds) => ({ undo: await optimistic(queryClient, unitChanges(new Set(unitIds), patchedLine({ checked: true }))) }),
    onError: undoOnError,
    onSuccess: (_data, unitIds) => {
      toast.success(`${unitIds.length}개 대사를 확인했습니다.`);
      if (marks?.includes('ai')) stopPicking();
    },
  });
  const pickedByAi = (rows ?? []).filter((row) => picked.has(row.id) && row.statusBy === 'ai').map((row) => row.id);
  const setTag = useMutation({
    mutationFn: ({ tagId, add }: { tagId: string; add: boolean }) =>
      unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: add ? { unitIds: [...picked], addTagIds: [tagId] } : { unitIds: [...picked], removeTagIds: [tagId] } })),
    onMutate: async ({ tagId, add }) => ({ undo: await optimistic(queryClient, unitChanges(picked, patchedLine(add ? { addTagIds: [tagId] } : { removeTagIds: [tagId] }))) }),
    onError: undoOnError,
    onSuccess: (_data, { tagId, add }) => toast.success(`${picked.size}개 대사${add ? '에' : '에서'} #${tagName(tagId)} 태그를 ${add ? '붙였습니다' : '뗐습니다'}.`),
  });
  return { picked, pick, stopPicking, pickedByAi, tagState, setStatus, setListener, check, setTag };
}

export type LineBulk = ReturnType<typeof useLineBulk>;

/** The head row above the lines: column labels, or the picked lines' actions. */
export function LineHeadRow({ projectId, rows, bulk, statusList, tags }: { projectId: string; rows: { id: string; speaker: string | null }[]; bulk: LineBulk; statusList: { id: string; name: string; color: string }[]; tags: ComponentProps<typeof TagMenu>['tags'] }) {
  const { picked, pick, stopPicking, check, pickedByAi, setStatus, setListener, tagState, setTag } = bulk;
  const people = useQuery(q.characters(projectId));
  return (
    <>
      {!!rows.length && (
        <div className="flex min-h-10 shrink-0 items-center border-b bg-muted/30 text-xs text-muted-foreground">
          <span className="flex w-10 shrink-0 justify-center">
            <Checkbox
              aria-label="보이는 줄 모두 선택"
              checked={rows.every((row) => picked.has(row.id)) ? true : rows.some((row) => picked.has(row.id)) ? 'indeterminate' : false}
              onCheckedChange={(on) => pick(rows.map((row) => row.id), on === true)}
            />
          </span>
          {picked.size === 0 ? (
            <>
              <span className="min-w-0 flex-1 px-3">원문</span>
              <span className="min-w-0 flex-1 self-stretch border-l px-3 leading-10">번역</span>
            </>
          ) : (
            <PickedBar count={picked.size} onClear={stopPicking} className="flex-1 pr-4">
              <Button variant="outline" disabled={pickedByAi.length === 0 || check.isPending} aria-label="확인함" title="상태는 그대로 두고 사람이 확인한 것으로 표시합니다(✦ 없앰)" onClick={() => check.mutate(pickedByAi)}>
                <Check />
                <PickedLabel from="lg">확인함</PickedLabel>
                {pickedByAi.length ? <span className="tabular-nums">{pickedByAi.length}</span> : null}
              </Button>
              <Select value="" onValueChange={(statusId) => setStatus.mutate(statusId)}>
                <SelectTrigger size="sm" className="w-24 shrink-0" aria-label="상태 바꾸기">
                  <SelectValue placeholder="상태" />
                </SelectTrigger>
                <SelectContent>
                  {statusList.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <StatusDot color={item.color} /> {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <BulkListener speakers={[...new Set(rows.flatMap((row) => (row.speaker ? [row.speaker] : [])))]} cast={(people.data?.characters ?? []).filter((person) => person.status === 'confirmed').map((person) => person.name)} onPick={(listener) => setListener.mutate(listener)} />
              <TagMenu
                tags={tags}
                heading={`선택한 ${picked.size}개 대사의 태그`}
                state={tagState}
                onToggle={(tagId, add) => setTag.mutate({ tagId, add })}
              />
            </PickedBar>
          )}
        </div>
      )}
    </>
  );
}

const TYPE_NAME = '__type';

/**
 * 청자 바꾸기 for the picked lines (dialogue only; narration has no listener): the speakers in this
 * list first, then a group / the public / themself, the rest of the cast, or a typed name.
 */
function BulkListener({ speakers, cast, onPick }: { speakers: string[]; cast: string[]; onPick: (listener: string | null) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  const rest = cast.filter((name) => !speakers.includes(name));
  if (typing !== null)
    return (
      <Input
        autoFocus
        value={typing}
        onChange={(event) => setTyping(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter' && typing.trim()) {
            onPick(typing.trim());
            setTyping(null);
          } else if (event.key === 'Escape') setTyping(null);
        }}
        onBlur={() => setTyping(null)}
        placeholder="이름 입력 후 Enter"
        className="h-8 w-40"
        aria-label="청자 이름"
      />
    );
  return (
    <Select value="" onValueChange={(next) => (next === TYPE_NAME ? setTyping('') : onPick(next === '-' ? null : next))}>
      <SelectTrigger size="sm" className="w-24 shrink-0" aria-label="청자 바꾸기">
        <SelectValue placeholder="청자" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="-">미상</SelectItem>
        {speakers.length > 0 && (
          <SelectGroup>
            <SelectLabel>이 목록에서 말하는 사람</SelectLabel>
            {speakers.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>여러 사람 · 혼잣말</SelectLabel>
          {Object.entries(SPECIAL_LISTENERS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
        {rest.length > 0 && (
          <SelectGroup>
            <SelectLabel>다른 인물</SelectLabel>
            {rest.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectItem value={TYPE_NAME}>직접 입력…</SelectItem>
      </SelectContent>
    </Select>
  );
}
