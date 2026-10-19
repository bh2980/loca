/** Right-hand pane to add, edit or delete a project tag. */
import { Trash2 } from 'lucide-react';
import { DEFAULT_TAG_COLOR, TAG_SCOPES, TAG_SCOPE_LABELS } from '@tw/shared';
import { DangerZone, InspectorSection, InspectorField, InspectorFields, InspectorHeader, InspectorBlock, Inspector, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Checkbox, Input, Label } from '@loca/ui';
import { scopeLabel, type TagForm, type TagRowData } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';

const TAG_FIELD_LABEL: Record<keyof TagForm, string> = { name: '이름', color: '색상', scope: '붙는 곳' };

export function TagPane({ tag, pending, onClose, onSave, onDelete }: { tag?: TagRowData; pending: boolean; onClose: () => void; onSave: (form: TagForm, changed: Partial<TagForm>) => void; onDelete?: () => void }) {
  // Scope in the fixed place order so the comparison does not depend on how it was stored.
  const saved: TagForm = { name: tag?.name ?? '', color: tag?.color ?? DEFAULT_TAG_COLOR, scope: TAG_SCOPES.filter((place) => !tag || tag.scope.includes(place)) };
  const { draft: form, setDraft: setForm, dirty: changed, conflicts, keepMine, takeSaved } = useFormFrom(saved, tag && `tag.${tag.id}`);
  const dirty = !tag || changed;
  return (
    <Inspector header={<InspectorHeader kind="태그" name={tag ? `#${tag.name}` : '태그 추가'} status={tag ? `대사 ${tag.units.toLocaleString()}개` : undefined} onClose={onClose} />} footer={
        <Button disabled={!form.name.trim() || !dirty || pending} onClick={() => onSave(form, changedFields(form, saved))}>
          {tag ? '저장' : '추가'}
        </Button>
      }>
      {conflicts.length > 0 && <InspectorBlock><ChangedElsewhere fields={conflicts.map((field) => TAG_FIELD_LABEL[field as keyof TagForm])} onTakeSaved={takeSaved} onKeepMine={keepMine} /></InspectorBlock>}
      <InspectorSection title="설정">
        <InspectorFields>
          <InspectorField label="이름">
            <Input value={form.name} placeholder="새 태그 이름" disabled={!!tag?.role} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </InspectorField>
          <InspectorField label="색상">
            <Swatches value={form.color} onChange={(color) => setForm((current) => ({ ...current, color }))} />
          </InspectorField>
          {tag?.role ? (
            <InspectorField label="붙는 곳" description="역할 태그라 붙는 곳을 바꿀 수 없습니다.">
              <p className="text-sm">{scopeLabel(tag.scope)}</p>
            </InspectorField>
          ) : (
            <InspectorField label="붙는 곳" description="이미 붙은 곳은 태그를 먼저 떼야 뺄 수 있습니다.">
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
            </InspectorField>
          )}
        </InspectorFields>
      </InspectorSection>
      {tag && onDelete && (
        <DangerZone title="삭제">
          {tag.role ? (
            <p className="text-xs text-muted-foreground">역할 태그는 지울 수 없습니다. 색상만 바꿀 수 있습니다.</p>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">
                  <Trash2 /> 태그 삭제
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
        </DangerZone>
      )}
    </Inspector>
  );
}
