import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { lineExclusion, PALETTE, TAG_SCOPES, type LineTranslate } from '@tw/shared';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  StatusIcon,
  TagSubMenu,
  Text,
  DropdownMenuSubContent,
} from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { SOURCE_GROUP_LABEL, SOURCE_UNIT_LABEL } from '@/lib/labels';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { useSaveLine } from '@/lib/line-save';
import { useTaxonomy } from '@/lib/knowledge';
import { sent } from '@/lib/collections';

/** What the line menu needs of a line. */
export interface MenuLine {
  id: string;
  key: string;
  source: string;
  translation: string | null;
  statusId: string;
  tagIds: string[];
  translate?: LineTranslate | null;
  groupKind: 'scene' | 'ui' | 'document';
}

/**
 * The one menu of a line, wherever the line is (the 대사 list's ⋯ and right-click, a node of the
 * dialogue graph): open it (번역 편집, 상세), 상태 변경 · 태그 · 번역 대상/제외, the copies, 그래프에서
 * 보기, 원문 편집, a new line in its scene. Items whose action a place does not have are left out.
 */
export function LineMenuItems({ projectId, line, onEdit, editLabel = '번역 편집', onOpenDetail, onShowInGraph, onEditSource, onAddLine }: {
  projectId: string;
  line: MenuLine;
  onEdit?: () => void;
  editLabel?: string;
  onOpenDetail?: () => void;
  onShowInGraph?: () => void;
  onEditSource?: () => void;
  onAddLine?: () => void;
}) {
  const queryClient = useQueryClient();
  const taxonomy = useTaxonomy(projectId);
  const project = useQuery(q.project(projectId)).data;
  const statusList = taxonomy.statuses ?? [];
  const tags = (taxonomy.tags ?? []).filter((tag) => !tag.scope || tag.scope.includes('lines'));
  const excluded = lineExclusion(line, project?.formatRules ?? undefined, project?.exclusionRules, project?.sourceLanguage) !== null;
  const saveLine = useSaveLine();
  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[]; translate?: 'include' | 'exclude' }) => unwrap(client.units[':unitId'].$patch({ param: { unitId: line.id }, json })),
    onMutate: async (json) => ({ undo: await optimistic(queryClient, unitChanges([line.id], patchedLine(json))) }),
    onError: (error, _json, context) => {
      context?.undo();
      toast.error(error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['units', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['units', 'detail', line.id] });
    },
  });
  const toggleTag = (tagId: string, add: boolean) => patch.mutate({ tagIds: add ? [...line.tagIds, tagId] : line.tagIds.filter((id) => id !== tagId) });
  const createTag = async (name: string) => {
    try {
      const color = PALETTE[tags.length % PALETTE.length].hex;
      const created = await sent(projectId, client.projects[':projectId'].tags.$post({ param: { projectId }, json: { name, color, scope: [...TAG_SCOPES] } }));
      await patch.mutateAsync({ tagIds: [...line.tagIds, created.id] });
      toast.success(`'${name}' 태그를 만들고 줄에 붙였습니다.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '태그를 만들지 못했습니다.');
    }
  };
  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(`${what}을 복사했습니다.`);
  };
  return (
    <>
      {onEdit && <DropdownMenuItem onClick={onEdit}>{editLabel}</DropdownMenuItem>}
      {onOpenDetail && <DropdownMenuItem onClick={onOpenDetail}>상세 열기</DropdownMenuItem>}
      {(onEdit || onOpenDetail) && <DropdownMenuSeparator />}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>상태 변경</DropdownMenuSubTrigger>
        <DropdownMenuSubContent width="menu">
          {statusList.map((item) => (
            <DropdownMenuCheckboxItem key={item.id} checked={line.statusId === item.id} onCheckedChange={() => line.statusId !== item.id && saveLine.mutate({ unitId: line.id, text: line.translation ?? '', statusId: item.id })}>
              <StatusIcon status={item} />
              <Text truncate>{item.name}</Text>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <TagSubMenu tags={tags} state={(tagId) => (line.tagIds.includes(tagId) ? 'all' : 'none')} onToggle={toggleTag} onCreate={createTag} heading="태그" label="태그" icon={false} />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{excluded ? '번역 제외' : '번역 대상'}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent width="menu">
          <DropdownMenuRadioGroup value={excluded ? 'exclude' : 'include'} onValueChange={(value) => patch.mutate({ translate: value as 'include' | 'exclude' })}>
            <DropdownMenuRadioItem value="include">번역 대상</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="exclude">제외</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => copy(line.source, '원문')}>원문 복사</DropdownMenuItem>
      {line.translation && <DropdownMenuItem onClick={() => copy(line.translation!, '번역')}>번역 복사</DropdownMenuItem>}
      <DropdownMenuItem onClick={() => copy(line.key, '대사 키')}>키 복사</DropdownMenuItem>
      {onShowInGraph && <DropdownMenuItem onClick={onShowInGraph}>그래프에서 보기</DropdownMenuItem>}
      {(onEditSource || onAddLine) && <DropdownMenuSeparator />}
      {onEditSource && <DropdownMenuItem onClick={onEditSource}>원문 편집</DropdownMenuItem>}
      {onAddLine && <DropdownMenuItem onClick={onAddLine}>{`이 ${SOURCE_GROUP_LABEL[line.groupKind]}에 ${SOURCE_UNIT_LABEL[line.groupKind]} 추가`}</DropdownMenuItem>}
    </>
  );
}

/** The line menu for a line known by id (a node of the dialogue graph): its items once the line is loaded. */
export function LineMenuFor({ projectId, unitId, ...actions }: { projectId: string; unitId: string } & Omit<Parameters<typeof LineMenuItems>[0], 'projectId' | 'line'>) {
  const unit = useQuery(q.unit(unitId));
  if (!unit.data) return <DropdownMenuItem disabled>불러오는 중…</DropdownMenuItem>;
  const data = unit.data;
  return <LineMenuItems projectId={projectId} line={{ id: data.id, key: data.key, source: data.source, translation: data.translation, statusId: data.statusId, tagIds: data.tagIds, translate: data.translate, groupKind: data.kind === 'dialogue' ? 'scene' : data.kind }} {...actions} />;
}
