/** Right-hand pane for a built-in automatic tag: only its color is the project's to change. */
import { AUTO_MARKS, type AutoMark } from '@tw/shared';
import { InspectorSection, InspectorField, InspectorFields, InspectorHeader, Inspector, PropertyGrid, PropertyRow, Button, TagPreviewChip } from '@loca/ui';
import { scopeLabel } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';
import { useFormFrom } from '@/lib/use-form-from';

/** A built-in automatic tag: only its color is the project's to change. */
export function MarkPane({ mark, color, pending, onClose, onSave }: { mark: AutoMark; color: string; pending: boolean; onClose: () => void; onSave: (color: string) => void }) {
  const { draft, setDraft } = useFormFrom(color);
  const info = AUTO_MARKS[mark];
  return (
    <Inspector header={<InspectorHeader kind="자동 태그" name={`#${info.name}`} status={`붙는 곳: ${scopeLabel(info.on)}`} onClose={onClose} />} footer={
        <>
          <Button variant="outline" disabled={draft === info.color} onClick={() => setDraft(info.color)}>
            기본 색으로
          </Button>
          <Button disabled={draft === color || pending} onClick={() => onSave(draft)}>
            저장
          </Button>
        </>
      }>
      <InspectorSection title="정보">
        <PropertyGrid>
          <PropertyRow label="뜻">{info.description}</PropertyRow>
          <PropertyRow label="미리보기">
            <TagPreviewChip color={draft}>
              #{info.name}
            </TagPreviewChip>
          </PropertyRow>
        </PropertyGrid>
      </InspectorSection>
      <InspectorSection title="설정">
        <InspectorFields>
          <InspectorField label="색상">
            <Swatches value={draft} onChange={setDraft} />
          </InspectorField>
        </InspectorFields>
      </InspectorSection>
    </Inspector>
  );
}
