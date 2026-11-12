/** Bulk actions on the picked lines: the picks, their mutations, and the head row that offers them. */
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { listenerLabel, SPECIAL_LISTENERS } from '@tw/shared';
import { TagMenu, Checkbox, EditorAction, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, StatusIcon, Text, TranslationColumnHeader, Input, SelectionBar } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { changeLines, lineRev, patchedLine } from '@/lib/units';
import { lineTags, q } from '@/lib/queries';
import { usePicked } from '@/lib/use-picked';
import { useCharacters } from '@/lib/knowledge';
import { useProject } from '@/lib/project';

/** Lines picked by their checkboxes, and the bulk changes the head row makes to them (each shown at once, undone if the server refuses). */
type SelectionRow = { id: string; tagIds: string[]; statusBy: string; /** The line's rev when it was picked: for picks past this page, which the browser does not hold. */ rev?: number };
type Known = { tags: Map<string, string[]>; statusBy: Map<string, string>; revs: Map<string, number> };

const learn = (known: Known, rows: readonly SelectionRow[]): Known => {
  const tags = new Map(known.tags);
  const statusBy = new Map(known.statusBy);
  const revs = new Map(known.revs);
  for (const row of rows) {
    tags.set(row.id, row.tagIds);
    statusBy.set(row.id, row.statusBy);
    if (row.rev !== undefined) revs.set(row.id, row.rev);
  }
  return { tags, statusBy, revs };
};

/** What a bulk change that carries revs came to, for the toast: lines changed since they were picked are left as they are. */
const skippedNote = (skipped: number) => (skipped ? ` 그사이 바뀐 ${skipped.toLocaleString()}개는 그대로 두었습니다.` : '');

export function useLineBulk({ projectId, pickKey, rows, tagName, aiOnly }: { projectId: string; /** Names the list the picks belong to (scene or review box). */ pickKey: string; rows: SelectionRow[] | undefined; tagName: (tagId: string) => string | undefined; /** The list shows only lines the AI decided (정한 쪽 AI): 확인함 empties it. */ aiOnly: boolean }) {
  const { picked, pick, clear: stopPicking } = usePicked(`script.${projectId}.${pickKey}`);
  // Tags and who decided each line, from every list it has been in and every scene picked whole (remember): picks can outlive the page they were made on.
  const [known, setKnown] = useState<Known & { from: unknown }>(() => ({ from: undefined, tags: new Map(), statusBy: new Map(), revs: new Map() }));
  if (known.from !== rows) setKnown({ from: rows, ...learn(known, rows ?? []) });
  const remember = (more: readonly SelectionRow[]) => setKnown((now) => ({ ...now, ...learn(now, more) }));
  // Picks kept from before (a reload, another page): what the bar needs of them is asked for once.
  const asked = useRef(new Set<string>());
  const unknown = useMemo(() => [...picked].filter((id) => !known.tags.has(id) && !asked.current.has(id)), [picked, known]);
  useEffect(() => {
    const ids = unknown.filter((id) => !asked.current.has(id));
    if (!ids.length) return;
    for (const id of ids) asked.current.add(id);
    unwrap(client.projects[':projectId'].units.meta.$post({ param: { projectId }, json: { ids } })).then(({ rows: meta }) => remember(meta), () => undefined);
  }, [unknown]); // eslint-disable-line react-hooks/exhaustive-deps
  // A bulk change the server took, on what is known of the picked lines, at once.
  const changed = (ids: readonly string[], change: (row: Omit<SelectionRow, 'id' | 'rev'>) => Omit<SelectionRow, 'id' | 'rev'>) =>
    setKnown((now) => ({ ...now, ...learn(now, ids.flatMap((id) => (now.tags.has(id) ? [{ id, ...change({ tagIds: now.tags.get(id)!, statusBy: now.statusBy.get(id)! }) }] : []))) }));
  /**
   * Each picked line's rev as this browser last saw it: the held line's own, else the one it had when it was picked.
   * A change that decides a status (상태, 확인함) sends them, so a line a run or another window changed since is skipped.
   */
  const revsOf = (ids: readonly string[]) => Object.fromEntries(ids.flatMap((id) => {
    const rev = lineRev(projectId, id) ?? known.revs.get(id);
    return rev === undefined ? [] : [[id, rev] as const];
  }));
  /** After a change, the picks past this page are read again: their revs moved with it, and a skipped one is as it was. */
  const reread = async (ids: readonly string[]) => {
    const away = ids.filter((id) => lineRev(projectId, id) === undefined);
    for (let at = 0; at < away.length; at += 20_000) await unwrap(client.projects[':projectId'].units.meta.$post({ param: { projectId }, json: { ids: away.slice(at, at + 20_000) } })).then(({ rows: meta }) => remember(meta), () => undefined);
  };
  const byPerson = (row: Omit<SelectionRow, 'id'>) => ({ ...row, statusBy: 'human' });
  const tagState = (tagId: string): 'all' | 'some' | 'none' => {
    const flags = [...picked].map((id) => known.tags.get(id)?.includes(tagId) ?? false);
    return flags.every(Boolean) ? 'all' : flags.some(Boolean) ? 'some' : 'none';
  };
  // Each change shows at once (changeLines) and is put back if the server refuses.
  const fail = (error: Error) => toast.error(error.message);
  const setStatus = useMutation({
    mutationFn: (statusId: string) => {
      const unitIds = [...picked];
      return changeLines(projectId, unitIds, patchedLine({ statusId }), () => client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds, statusId, revs: revsOf(unitIds) } })).then((answer) => ({ unitIds, ...answer }));
    },
    onSuccess: ({ unitIds, changed: count, skipped }) => {
      changed(unitIds, byPerson);
      toast.success(`${count.toLocaleString()}개 대사의 상태를 바꿨습니다.${skippedNote(skipped)}`);
      return reread(unitIds);
    },
    onError: fail,
  });
  const setListener = useMutation({
    mutationFn: (listener: string | null) => changeLines(projectId, picked, patchedLine({ listener }), () => client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...picked], listener } })),
    onSuccess: (_data, listener) => {
      toast.success(`${picked.size}개 대사의 청자를 ${listener ? listenerLabel(listener) : '미상'}(으)로 바꿨습니다.`);
      return reread([...picked]);
    },
    onError: fail,
  });
  // 확인함: the statuses stay; a person now holds them, so the ✦ goes.
  const check = useMutation({
    mutationFn: (unitIds: string[]) => changeLines(projectId, unitIds, patchedLine({ checked: true }), () => client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds, checked: true, revs: revsOf(unitIds) } })),
    onError: fail,
    onSuccess: ({ changed: count, skipped }, unitIds) => {
      changed(unitIds, byPerson);
      toast.success(`${count.toLocaleString()}개 대사를 확인했습니다.${skippedNote(skipped)}`);
      if (aiOnly) stopPicking();
      return reread(unitIds);
    },
  });
  const pickedByAi = [...picked].filter((id) => known.statusBy.get(id) === 'ai');
  const setTag = useMutation({
    mutationFn: ({ tagId, add }: { tagId: string; add: boolean }) => {
      const unitIds = [...picked];
      return changeLines(projectId, unitIds, patchedLine(add ? { addTagIds: [tagId] } : { removeTagIds: [tagId] }), () => client.projects[':projectId'].units.$patch({ param: { projectId }, json: add ? { unitIds, addTagIds: [tagId] } : { unitIds, removeTagIds: [tagId] } })).then(() => unitIds);
    },
    onError: fail,
    onSuccess: (unitIds, { tagId, add }) => {
      changed(unitIds, (row) => ({ ...row, tagIds: add ? [...new Set([...row.tagIds, tagId])] : row.tagIds.filter((id) => id !== tagId) }));
      toast.success(`${unitIds.length}개 대사${add ? '에' : '에서'} #${tagName(tagId)} 태그를 ${add ? '붙였습니다' : '뗐습니다'}.`);
    },
  });
  // 번역 제외 by hand for the picked lines (null = the project's rules decide again).
  const setTranslate = useMutation({
    mutationFn: (translate: 'include' | 'exclude') => changeLines(projectId, picked, patchedLine({ translate }), () => client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...picked], translate } })),
    onError: fail,
    onSuccess: (_data, translate) => {
      toast.success(`${picked.size}개 대사를 ${translate === 'exclude' ? '번역에서 뺐습니다' : '번역 대상으로 정했습니다'}.`);
      return reread([...picked]);
    },
  });
  return { picked, pick, remember, stopPicking, pickedByAi, tagState, setStatus, setListener, check, setTag, setTranslate };
}

export type LineBulk = ReturnType<typeof useLineBulk>;

/** The head row above the lines: column labels, or the picked lines' actions. */
export function LineHeadRow({ projectId, rows, bulk, statusList, tags, allMatching }: { projectId: string; rows: { id: string; speaker: string | null }[]; bulk: LineBulk; statusList: { id: string; name: string; color: string }[]; tags: ComponentProps<typeof TagMenu>['tags']; /** The list has more than this page: how many, and picking them all. */ allMatching?: { total: number; filtered: boolean; onPick: () => void } }) {
  const { picked, pick, stopPicking, check, pickedByAi, setStatus, setListener, tagState, setTag, setTranslate } = bulk;
  const people = useCharacters(projectId);
  const project = useProject(projectId);
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
            <SelectionBar grow count={picked.size} onClear={stopPicking} more={allFinal && allMatching && allMatching.total > picked.size ? { label: `${allMatching.filtered ? '필터에 맞는 ' : ''}${allMatching.total.toLocaleString()}줄 모두 고르기`, onSelect: allMatching.onPick } : undefined}>
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
          <SelectLabel>특별한 청자</SelectLabel>
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
