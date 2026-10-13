/** Right-hand pane to add, edit or delete a project tag. */
import { Trash2 } from 'lucide-react';
import { DEFAULT_TAG_COLOR, TAG_SCOPES, TAG_SCOPE_LABELS } from '@tw/shared';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { scopeLabel, type TagForm, type TagRowData } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';
import { changedFields, useFormFrom } from '@/lib/use-form-from';

export function TagPane({ tag, pending, onClose, onSave, onDelete }: { tag?: TagRowData; pending: boolean; onClose: () => void; onSave: (form: TagForm, changed: Partial<TagForm>) => void; onDelete?: () => void }) {
  // Scope in the fixed place order so the comparison does not depend on how it was stored.
  const saved: TagForm = { name: tag?.name ?? '', color: tag?.color ?? DEFAULT_TAG_COLOR, scope: TAG_SCOPES.filter((place) => !tag || tag.scope.includes(place)) };
  const { draft: form, setDraft: setForm, dirty: changed } = useFormFrom(saved);
  const dirty = !tag || changed;
  return (
    <DetailPane
      kicker="태그"
      title={tag ? `#${tag.name}` : '태그 추가'}
      subtitle={tag ? `대사 ${tag.units.toLocaleString()}개` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button disabled={!form.name.trim() || !dirty || pending} onClick={() => onSave(form, changedFields(form, saved))}>
            {tag ? '저장' : '추가'}
          </Button>
          {tag && onDelete && !tag.role && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">
                  <Trash2 /> 삭제
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>“#{tag.name}” 태그를 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>대사 {tag.units.toLocaleString()}개에서 이 태그가 제거됩니다. 이 태그를 쓰는 워크플로 노드는 수정해야 합니다.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>삭제</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </>
      }
    >
      <PaneSection title="설정">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="tag-name">이름</FieldLabel>
            <Input id="tag-name" value={form.name} placeholder="새 태그 이름" disabled={!!tag?.role} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field>
            <FieldLabel>색상</FieldLabel>
            <Swatches value={form.color} onChange={(color) => setForm((current) => ({ ...current, color }))} />
          </Field>
          <Field>
            <FieldLabel>붙는 곳</FieldLabel>
            {tag?.role ? (
              <p className="text-sm">{scopeLabel(tag.scope)}</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {TAG_SCOPES.map((place) => (
                  <div key={place} className="flex items-center gap-2">
                    <Checkbox
                      id={`tag-scope-${place}`}
                      checked={form.scope.includes(place)}
                      // At least one place stays.
                      disabled={form.scope.length === 1 && form.scope.includes(place)}
                      onCheckedChange={(on) => setForm((current) => ({ ...current, scope: TAG_SCOPES.filter((other) => (other === place ? on === true : current.scope.includes(other))) }))}
                    />
                    <Label htmlFor={`tag-scope-${place}`}>{TAG_SCOPE_LABELS[place]}</Label>
                  </div>
                ))}
              </div>
            )}
            <FieldDescription>{tag?.role ? '앱이 쓰는 태그라 붙는 곳을 바꿀 수 없습니다.' : '이 태그를 붙일 수 있고 메뉴·필터에 나오는 곳입니다. 이미 붙은 곳은 태그를 먼저 떼야 뺄 수 있습니다.'}</FieldDescription>
          </Field>
        </FieldGroup>
      </PaneSection>
    </DetailPane>
  );
}
