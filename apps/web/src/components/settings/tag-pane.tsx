/** Right-hand pane to add, edit or delete a project tag. */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DEFAULT_TAG_COLOR, TAG_SCOPES, TAG_SCOPE_LABELS } from '@tw/shared';
import { InspectorHeader, Inspector, Button, Checkbox, Input, Inline, Label, Stack, Text, Textarea, Section, Field, Box } from '@loca/ui';
import { scopeLabel, type TagForm, type TagRowData, type WithoutUnits } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';
import { TagDeleteDialog } from '@/components/settings/tag-delete-dialog';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';

const TAG_FIELD_LABEL: Record<keyof TagForm, string> = { name: '이름', color: '색상', description: '설명', scope: '붙는 곳' };

export function TagPane({ tag, pending, onClose, onSave, onDelete }: { tag?: WithoutUnits<TagRowData>; pending: boolean; onClose: () => void; onSave: (form: TagForm, changed: Partial<TagForm>) => void; onDelete?: () => void }) {
  // Scope in the fixed place order so the comparison does not depend on how it was stored.
  const saved: TagForm = { name: tag?.name ?? '', color: tag?.color ?? DEFAULT_TAG_COLOR, description: tag?.description ?? '', scope: TAG_SCOPES.filter((place) => !tag || tag.scope.includes(place)) };
  const { draft: form, setDraft: setForm, dirty: changed, conflicts, keepMine, takeSaved } = useFormFrom(saved, tag && `tag.${tag.id}`);
  const dirty = !tag || changed;
  const [asking, setAsking] = useState(false);
  return (
    <Inspector footerStart={tag && onDelete ? (
            <>
              <Button variant="ghost" tone="danger" onClick={() => setAsking(true)}>
                <Trash2 /> 태그 삭제
              </Button>
              <TagDeleteDialog tags={asking ? [tag] : null} onClose={() => setAsking(false)} onConfirm={onDelete} />
            </>
          ) : undefined} header={<InspectorHeader kind="태그" name={tag ? `#${tag.name}` : '태그 추가'} status={tag?.units !== undefined ? `대사 ${tag.units.toLocaleString()}개` : undefined} onClose={onClose} />} footer={
        <Button disabled={!form.name.trim() || !dirty || pending} onClick={() => onSave(form, changedFields(form, saved))}>
          {tag ? '저장' : '추가'}
        </Button>
      }>
      {conflicts.length > 0 && <Section><ChangedElsewhere fields={conflicts.map((field) => TAG_FIELD_LABEL[field as keyof TagForm])} onTakeSaved={takeSaved} onKeepMine={keepMine} /></Section>}
      <Section title="설정">
        <Box spaceY="normal">
          <Field label="이름">
            <Input value={form.name} placeholder="새 태그 이름" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label="설명">
            <Textarea rows={2} value={form.description} placeholder="이 태그를 언제 붙이는지 (선택)" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </Field>
          <Field label="색상">
            <Swatches value={form.color} onChange={(color) => setForm((current) => ({ ...current, color }))} />
          </Field>
          <Field label="붙는 곳" description="이미 붙은 곳은 태그를 먼저 떼야 뺄 수 있습니다.">
              <Stack direction="row" wrap gap="comfortable">
                {TAG_SCOPES.map((place) => (
                  <Inline key={place} gap="condensed">
                    <Checkbox
                      id={`tag-scope-${place}`}
                      checked={form.scope.includes(place)}
                      // At least one place stays.
                      disabled={form.scope.length === 1 && form.scope.includes(place)}
                      onCheckedChange={(on) => setForm((current) => ({ ...current, scope: TAG_SCOPES.filter((other) => (other === place ? on === true : current.scope.includes(other))) }))}
                    />
                    <Label htmlFor={`tag-scope-${place}`}>{TAG_SCOPE_LABELS[place]}</Label>
                  </Inline>
                ))}
              </Stack>
            </Field>
        </Box>
      </Section>
    </Inspector>
  );
}
