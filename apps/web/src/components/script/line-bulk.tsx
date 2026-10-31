/** Bulk actions on the picked lines: the picks, their mutations, and the head row that offers them. */
import { useMemo, useState, type ComponentProps } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { listenerLabel, SPECIAL_LISTENERS } from '@tw/shared';
import { TagMenu, Checkbox, EditorAction, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, StatusIcon, Text, TranslationColumnHeader, Input, SelectionBar } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { lineTags, q } from '@/lib/queries';
import { usePicked } from '@/lib/use-picked';
import { useCharacters } from '@/lib/knowledge';

/** Lines picked by their checkboxes, and the bulk changes the head row makes to them (each shown at once, undone if the server refuses). */
type SelectionRow = { id: string; tagIds: string[]; statusBy: string };

export function useLineBulk({ projectId, pickKey, rows, selectionRows, tagName, aiOnly }: { projectId: string; /** Names the list the picks belong to (scene or review box). */ pickKey: string; rows: SelectionRow[] | undefined; /** Metadata for every line in the current unpaged filter, so selections beyond the visible page keep correct bulk state. */ selectionRows?: SelectionRow[]; tagName: (tagId: string) => string | undefined; /** The list shows only lines the AI decided (정한 쪽 AI): 확인함 empties it. */ aiOnly: boolean }) {
  const { picked, pick, clear: stopPicking } = usePicked(`script.${projectId}.${pickKey}`);
  // Tags and who decided each line, from every list it has been in: picks can outlive the page they were made on.
  const [known, setKnown] = useState<{ from: unknown[]; tags: Map<string, string[]>; statusBy: Map<string, string> }>(() => ({ from: [], tags: new Map(), statusBy: new Map() }));
  if (known.from[0] !== rows || known.from[1] !== selectionRows) {
    const tags = new Map(known.tags);
    const statusBy = new Map(known.statusBy);
    for (const row of [...(selectionRows ?? []), ...(rows ?? [])]) {
      tags.set(row.id, row.tagIds);
      statusBy.set(row.id, row.statusBy);
    }
    setKnown({ from: [rows, selectionRows], tags, statusBy });
  }
  const tagState = (tagId: string): 'all' | 'some' | 'none' => {
    const flags = [...picked].map((id) => known.tags.get(id)?.includes(tagId) ?? false);
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
      if (aiOnly) stopPicking();
    },
  });
  const pickedByAi = [...picked].filter((id) => known.statusBy.get(id) === 'ai');
  const setTag = useMutation({
    mutationFn: ({ tagId, add }: { tagId: string; add: boolean }) =>
      unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: add ? { unitIds: [...picked], addTagIds: [tagId] } : { unitIds: [...picked], removeTagIds: [tagId] } })),
    onMutate: async ({ tagId, add }) => ({ undo: await optimistic(queryClient, unitChanges(picked, patchedLine(add ? { addTagIds: [tagId] } : { removeTagIds: [tagId] }))) }),
    onError: undoOnError,
    onSuccess: (_data, { tagId, add }) => toast.success(`${picked.size}개 대사${add ? '에' : '에서'} #${tagName(tagId)} 태그를 ${add ? '붙였습니다' : '뗐습니다'}.`),
  });
  // 번역 제외 by hand for the picked lines (null = the project's rules decide again).
  const setTranslate = useMutation({
    mutationFn: (translate: 'include' | 'exclude') => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...picked], translate } })),
    onMutate: async (translate) => ({ undo: await optimistic(queryClient, unitChanges(picked, patchedLine({ translate }))) }),
    onError: undoOnError,
    onSuccess: (_data, translate) => toast.success(`${picked.size}개 대사를 ${translate === 'exclude' ? '번역에서 뺐습니다' : '번역 대상으로 정했습니다'}.`),
  });
  return { picked, pick, stopPicking, pickedByAi, tagState, setStatus, setListener, check, setTag, setTranslate };
}

export type LineBulk = ReturnType<typeof useLineBulk>;

/** The head row above the lines: column labels, or the picked lines' actions. */
export function LineHeadRow({ projectId, rows, bulk, statusList, tags }: { projectId: string; rows: { id: string; speaker: string | null }[]; bulk: LineBulk; statusList: { id: string; name: string; color: string }[]; tags: ComponentProps<typeof TagMenu>['tags'] }) {
  const { picked, pick, stopPicking, check, pickedByAi, setStatus, setListener, tagState, setTag, setTranslate } = bulk;
  const people = useCharacters(projectId);
  const project = useQuery(q.project(projectId));
  const sourceLanguage = project.data?.sourceLanguage?.split('-')[0]?.toLocaleUpperCase();
  const targetLanguage = project.data?.targetLanguage?.split('-')[0]?.toLocaleUpperCase();

  const { ids, allFinal, hasAi, pickedInView } = useMemo(() => {
    const ids = rows.map((row) => row.id);
    const pickedCount = rows.reduce((acc, row) => (picked.has(row.id) ? acc + 1 : acc), 0);
    const allFinal = rows.length > 0 && pickedCount === rows.length;
    const hasAi = pickedByAi.length > 0;
    const pickedInView = pickedCount > 0;
    return { ids, allFinal, hasAi, pickedInView };
  }, [rows, picked, pickedByAi]);

  return (
    <>
      {!!rows.length && (
        <TranslationColumnHeader
          checkbox={<Checkbox
            aria-label="보이는 줄 모두 선택"
            checked={allFinal ? true : pickedInView ? 'indeterminate' : false}
            onCheckedChange={(on) => pick(ids, on === true)}
          />}
          source={<span>원문{sourceLanguage && <Text marginLeft="tight" tone="subtle">· {sourceLanguage}</Text>}</span>}
          translation={<span>번역{targetLanguage && <Text marginLeft="tight" tone="subtle">· {targetLanguage}</Text>}</span>}
          selection={picked.size > 0 ? (
            <SelectionBar grow count={picked.size} onClear={stopPicking}>
              <EditorAction icon={Check} variant="outline" disabled={!hasAi || check.isPending} aria-label="AI가 정한 줄을 확인함" onClick={() => check.mutate(pickedByAi)}>
                확인함{hasAi ? ` ${pickedByAi.length}` : ''}
              </EditorAction>
              <Select value="" onValueChange={(statusId) => setStatus.mutate(statusId)}>
                <SelectTrigger width="field-sm" fixed aria-label="상태 바꾸기">
                  <SelectValue placeholder="상태" />
                </SelectTrigger>
                <SelectContent>
                  {statusList.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <StatusIcon status={item} /> {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <BulkListener speakers={[...new Set(rows.flatMap((row) => (row.speaker ? [row.speaker] : [])))]} cast={(people.data ?? []).filter((person) => person.status === 'confirmed').map((person) => person.name)} onPick={(listener) => setListener.mutate(listener)} />
              <TagMenu
                tags={tags}
                heading="태그"
                state={tagState}
                onToggle={(tagId, add) => setTag.mutate({ tagId, add })}
              />
              <Select value="" onValueChange={(value) => setTranslate.mutate(value as 'include' | 'exclude')}>
                <SelectTrigger width="field" fixed aria-label="번역 대상 바꾸기">
                  <SelectValue placeholder="번역 대상" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="include">번역 대상</SelectItem>
                  <SelectItem value="exclude">제외</SelectItem>
                </SelectContent>
              </Select>
            </SelectionBar>
          ) : undefined}
        />
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
        size="default"
        width="field-lg"
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
        placeholder="이름"
        aria-label="청자 이름"
      />
    );
  return (
    <Select value="" onValueChange={(next) => (next === TYPE_NAME ? setTyping('') : onPick(next === '-' ? null : next))}>
      <SelectTrigger width="field-sm" fixed aria-label="청자 바꾸기">
        <SelectValue placeholder="청자" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="-">미상</SelectItem>
        {speakers.length > 0 && (
          <SelectGroup>
            <SelectLabel>화자</SelectLabel>
            {speakers.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>여럿 · 혼잣말</SelectLabel>
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
