/** Right-hand pane to add or edit one status. */
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { DEFAULT_STATUS_COLOR } from '@tw/shared';
import { DangerZone, InspectorSection, InspectorField, InspectorFields, InspectorToggle, InspectorHeader, InspectorBlock, Inspector, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@loca/ui';
import { STATUS_KIND } from '@/lib/labels';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { type Kind, type StatusForm, type StatusRowData } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';

/** Add or edit one status: its fields are a draft until saved; the order buttons act at once. */
const STATUS_FIELD_LABEL: Record<keyof StatusForm, string> = { name: '이름', color: '색상', kind: '종류', inReview: '검토함', humanOnly: '워크플로 지정 안 함' };

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
        <Button disabled={!form.name.trim() || !dirty || pending} onClick={() => onSave(form, changedFields(form, saved))}>
          {status ? '저장' : '추가'}
        </Button>
      }>
      {conflicts.length > 0 && <InspectorBlock><ChangedElsewhere fields={conflicts.map((field) => STATUS_FIELD_LABEL[field as keyof StatusForm])} onTakeSaved={takeSaved} onKeepMine={keepMine} /></InspectorBlock>}
      <InspectorSection title="설정">
        <InspectorFields>
          <InspectorField label="이름">
            <Input value={form.name} placeholder="새 상태 이름" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </InspectorField>
          <InspectorField label="색상">
            <Swatches value={form.color} onChange={(color) => setForm((current) => ({ ...current, color }))} />
          </InspectorField>
          <InspectorField label="종류">
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
          </InspectorField>
          {status && onMove && (
            <InspectorField label="순서">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground">{index + 1} / {count}</span>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" disabled={index === 0 || reordering} onClick={() => onMove(-1)} aria-label={`${status.name} 위로`}>
                    <ArrowUp />
                  </Button>
                  <Button variant="outline" size="icon" disabled={index === count - 1 || reordering} onClick={() => onMove(1)} aria-label={`${status.name} 아래로`}>
                    <ArrowDown />
                  </Button>
                </div>
              </div>
            </InspectorField>
          )}
          <InspectorToggle label="검토함" description="검토함 목록에 이 상태의 대사를 모읍니다." checked={form.inReview} onChange={(inReview) => setForm((current) => ({ ...current, inReview }))} />
          <InspectorToggle label="워크플로 지정 안 함" description="워크플로가 이 상태로 바꾸려 하면 검토함으로 보냅니다. 사람만 지정합니다." checked={form.humanOnly} onChange={(humanOnly) => setForm((current) => ({ ...current, humanOnly }))} />
        </InspectorFields>
      </InspectorSection>
      {onDelete && (
        <DangerZone title="삭제">
          <Button variant="outline" className="text-destructive" disabled={count < 2} onClick={onDelete}>
            <Trash2 /> 상태 삭제
          </Button>
          {count < 2 && <p className="text-xs text-muted-foreground">상태가 하나뿐이면 지울 수 없습니다.</p>}
        </DangerZone>
      )}
    </Inspector>
  );
}
