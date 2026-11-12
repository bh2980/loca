/** The one confirmation before tags are deleted: from a tag's pane, the list's bulk delete and a row's menu. */
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@loca/ui';
import type { TagRowData, WithoutUnits } from '@/components/settings/status-types';

type DeletedTag = Pick<WithoutUnits<TagRowData>, 'name' | 'units'>;

/**
 * What the confirmation says. A tag of the home's defaults has no line count (no project carries it yet); a project's tag
 * says how many lines lose it. Several tags are counted in the title and named with their own counts: lines can carry
 * more than one of them, so a sum would not be a number of lines.
 */
export function tagDeleteWording(tags: readonly DeletedTag[]): { title: string; description: string } {
  const several = tags.length > 1;
  const title = several ? `태그 ${tags.length}개를 삭제할까요?` : `“#${tags[0]?.name ?? ''}” 태그를 삭제할까요?`;
  if (tags.every((tag) => tag.units === undefined)) {
    return { title, description: `새로 만드는 프로젝트가 ${several ? '이 태그들을' : '이 태그를'} 받지 않습니다. 이미 있는 프로젝트는 그대로입니다.` };
  }
  const count = (tag: DeletedTag) => `대사 ${(tag.units ?? 0).toLocaleString()}개`;
  return several
    ? { title, description: `${tags.map((tag) => `#${tag.name}(${count(tag)})`).join(', ')}에서 태그가 제거됩니다. 이 태그들을 쓰는 워크플로 노드는 수정해야 합니다.` }
    : { title, description: `${count(tags[0]!)}에서 이 태그가 제거됩니다. 이 태그를 쓰는 워크플로 노드는 수정해야 합니다.` };
}

/** Open while `tags` is set; `onConfirm` deletes them, and the dialog closes either way (`onClose`). */
export function TagDeleteDialog({ tags, onClose, onConfirm }: { tags: readonly DeletedTag[] | null; onClose: () => void; onConfirm: () => void }) {
  const wording = tags?.length ? tagDeleteWording(tags) : null;
  return (
    <AlertDialog open={!!wording} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{wording?.title}</AlertDialogTitle>
          <AlertDialogDescription>{wording?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
