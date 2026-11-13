/** Bulk actions on the picked lines: the picks, their mutations, and the head row that offers them. */
import { useMemo, useState, type ComponentProps } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { listenerLabel, SPECIAL_LISTENERS } from '@loca/shared';
import { Button, TagMenu, Checkbox, EditorAction, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, StatusIcon, Text, TranslationColumnHeader, Input, SelectionBar } from '@loca/ui';
import { chatDock } from '@/lib/chat-dock';
import { pickedLinesItem } from '@/lib/reported-view';
import { usePicked } from '@/lib/use-picked';
import { useCharacters } from '@/lib/knowledge';
import { useProject } from '@/lib/project';
import { patchPickedLines } from '@/lib/line-writes';
import { usePickedLines } from '@/lib/line-picks';

/** What a bulk change that carries revs came to, for the toast: lines changed since they were seen are left as they are. */
const skippedNote = (skipped: number) => (skipped ? ` 그사이 바뀐 ${skipped.toLocaleString()}개는 그대로 두었습니다.` : '');

/**
 * Lines picked by their checkboxes, and the bulk changes the head row makes to them (each shown at once, undone if
 * the server refuses). What the bar says of the picks (which an AI decided, how far each tag is on them) is read
 * from the lines the browser holds and asked for the rest (usePickedLines): picks outlive the page they were made on.
 */
export function useLineBulk({ projectId, pickKey, tagName, aiOnly }: { projectId: string; /** Names the list the picks belong to (scene or review box). */ pickKey: string; tagName: (tagId: string) => string | undefined; /** The list shows only lines the AI decided (정한 쪽 AI): 확인함 empties it. */ aiOnly: boolean }) {
  const { picked, pick, clear: stopPicking } = usePicked(`script.${projectId}.${pickKey}`);
  const { byAi: pickedByAi, tagState } = usePickedLines(projectId, picked);
  // Each change shows at once and is put back if the server refuses; one sent while another is on its way waits for it (patchPickedLines).
  const fail = (error: Error) => toast.error(error.message);
  const setStatus = useMutation({
    mutationFn: (statusId: string) => patchPickedLines(projectId, [...picked], { statusId }),
    onSuccess: ({ changed: count, skipped }) => void toast.success(`${count.toLocaleString()}개 대사의 상태를 바꿨습니다.${skippedNote(skipped)}`),
    onError: fail,
  });
  const setListener = useMutation({
    mutationFn: (listener: string | null) => patchPickedLines(projectId, [...picked], { listener }).then(({ changed }) => changed),
    onSuccess: (count, listener) => void toast.success(`${count.toLocaleString()}개 대사의 청자를 ${listener ? listenerLabel(listener) : '미상'}(으)로 바꿨습니다.`),
    onError: fail,
  });
  // 확인함: the statuses stay; a person now holds them, so the ✦ goes.
  const check = useMutation({
    mutationFn: (unitIds: string[]) => patchPickedLines(projectId, unitIds, { checked: true }),
    onError: fail,
    onSuccess: ({ changed: count, skipped }) => {
      toast.success(`${count.toLocaleString()}개 대사를 확인했습니다.${skippedNote(skipped)}`);
      if (aiOnly) stopPicking();
    },
  });
  const setTag = useMutation({
    mutationFn: ({ tagId, add }: { tagId: string; add: boolean }) => patchPickedLines(projectId, [...picked], add ? { addTagIds: [tagId] } : { removeTagIds: [tagId] }).then(({ changed }) => changed),
    onError: fail,
    onSuccess: (count, { tagId, add }) => void toast.success(`${count.toLocaleString()}개 대사${add ? '에' : '에서'} #${tagName(tagId)} 태그를 ${add ? '붙였습니다' : '뗐습니다'}.`),
  });
  // 번역 제외 by hand for the picked lines.
  const setTranslate = useMutation({
    mutationFn: (translate: 'include' | 'exclude') => patchPickedLines(projectId, [...picked], { translate }).then(({ changed }) => changed),
    onError: fail,
    onSuccess: (count, translate) => void toast.success(`${count.toLocaleString()}개 대사를 ${translate === 'exclude' ? '번역에서 뺐습니다' : '번역 대상으로 정했습니다'}.`),
  });
  return { picked, pick, stopPicking, pickedByAi, tagState, setStatus, setListener, check, setTag, setTranslate };
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
              <Button variant="ghost" onClick={() => chatDock.attach(projectId, [pickedLinesItem([...picked])])}><MessageSquarePlus /> 채팅에 넣기</Button>
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
