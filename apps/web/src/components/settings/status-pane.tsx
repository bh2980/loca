/** Right-hand pane to add or edit one status. */
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { DEFAULT_STATUS_COLOR } from '@tw/shared';
import { InspectorSection, PropertyRow, PropertyGrid, InspectorHeader, Inspector, Button, Field, FieldDescription, FieldGroup, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@loca/ui';
import { STATUS_KIND } from '@/lib/labels';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { type Kind, type StatusForm, type StatusRowData } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';

/** Add or edit one status: its fields are a draft until saved; the order buttons act at once. */
const STATUS_FIELD_LABEL: Record<keyof StatusForm, string> = { name: '이름', color: '색상', kind: '종류', inReview: '검토함에 표시', humanOnly: '사람만 지정' };

export function StatusPane({
  status,
  index = 0,
  count = 0,
  pending,
  reordering,
  onClose,
  onSave,
  onMove,
  onDelete,
}: {
  status?: StatusRowData;
  index?: number;
  count?: number;
  pending: boolean;
  reordering?: boolean;
  onClose: () => void;
  /** The whole form (to add) and the fields that differ from the saved status (to edit). */
  onSave: (form: StatusForm, changed: Partial<StatusForm>) => void;
  onMove?: (delta: number) => void;
  onDelete?: () => void;
}) {
  const saved: StatusForm = { name: status?.name ?? '', color: status?.color ?? DEFAULT_STATUS_COLOR, kind: status?.kind ?? 'normal', inReview: status?.inReview ?? false, humanOnly: status?.humanOnly ?? false };
  const { draft: form, setDraft: setForm, dirty: changed, conflicts, keepMine, takeSaved } = useFormFrom(saved, status && `status.${status.id}`);
  const dirty = !status || changed;
  return (
    <Inspector header={<InspectorHeader kind="상태" name={status ? status.name : '상태 추가'} status={status ? `대사 ${status.units.toLocaleString()}개` : undefined} onClose={onClose} />} footer={
        <>
          <Button disabled={!form.name.trim() || !dirty || pending} onClick={() => onSave(form, changedFields(form, saved))}>
            {status ? '저장' : '추가'}
          </Button>
          {onDelete && (
            <Button variant="outline" className="text-destructive" disabled={count < 2} onClick={onDelete}>
              <Trash2 /> 삭제
            </Button>
          )}
        </>
      }>
      {conflicts.length > 0 && <ChangedElsewhere fields={conflicts.map((field) => STATUS_FIELD_LABEL[field as keyof StatusForm])} onTakeSaved={takeSaved} onKeepMine={keepMine} />}
      <InspectorSection title="설정">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="status-name">이름</FieldLabel>
            <Input id="status-name" value={form.name} placeholder="새 상태 이름" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field>
            <FieldLabel>색상</FieldLabel>
            <Swatches value={form.color} onChange={(color) => setForm((current) => ({ ...current, color }))} />
          </Field>
          <Field>
            <FieldLabel>종류</FieldLabel>
            <Select value={form.kind} onValueChange={(kind) => setForm((current) => ({ ...current, kind: kind as Kind }))}>
              <SelectTrigger className="w-full" aria-label="종류">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_KIND) as Kind[]).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {STATUS_KIND[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="status-review">검토함에 표시</FieldLabel>
            <Switch id="status-review" checked={form.inReview} onCheckedChange={(inReview) => setForm((current) => ({ ...current, inReview }))} />
          </Field>
          <FieldDescription>켜면 이 상태의 대사가 검토함에 모입니다.</FieldDescription>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="status-human">사람만 지정</FieldLabel>
            <Switch id="status-human" checked={form.humanOnly} onCheckedChange={(humanOnly) => setForm((current) => ({ ...current, humanOnly }))} />
          </Field>
          <FieldDescription>워크플로는 이 상태 대신 검토함으로 보냅니다.</FieldDescription>
        </FieldGroup>
      </InspectorSection>
      {status && onMove && (
        <InspectorSection title="순서">
          <PropertyGrid>
            <PropertyRow label={`${index + 1} / ${count}`}>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" disabled={index === 0 || reordering} onClick={() => onMove(-1)} aria-label={`${status.name} 위로`}>
                  <ArrowUp />
                </Button>
                <Button variant="outline" size="icon" disabled={index === count - 1 || reordering} onClick={() => onMove(1)} aria-label={`${status.name} 아래로`}>
                  <ArrowDown />
                </Button>
              </div>
            </PropertyRow>
          </PropertyGrid>
        </InspectorSection>
      )}
    </Inspector>
  );
}
