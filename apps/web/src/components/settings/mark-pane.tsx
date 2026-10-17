/** Right-hand pane for a built-in automatic tag: only its color is the project's to change. */
import { AUTO_MARKS, type AutoMark } from '@tw/shared';
import { DetailPane, PaneSection, Button, Field, FieldDescription, FieldGroup, FieldLabel } from '@loca/ui';
import { chipStyle } from '@/components/status';
import { scopeLabel } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';
import { useFormFrom } from '@/lib/use-form-from';

/** A built-in automatic tag: only its color is the project's to change. */
export function MarkPane({ mark, color, pending, onClose, onSave }: { mark: AutoMark; color: string; pending: boolean; onClose: () => void; onSave: (color: string) => void }) {
  const { draft, setDraft } = useFormFrom(color);
  const info = AUTO_MARKS[mark];
  return (
    <DetailPane
      kicker="기본 태그"
      title={`#${info.name}`}
      subtitle={`붙는 곳: ${scopeLabel(info.on)}`}
      onClose={onClose}
      footer={
        <>
          <Button disabled={draft === color || pending} onClick={() => onSave(draft)}>
            저장
          </Button>
          <Button variant="outline" disabled={draft === info.color} onClick={() => setDraft(info.color)}>
            기본 색으로
          </Button>
        </>
      }
    >
      <PaneSection title="설정">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>뜻</FieldLabel>
            <FieldDescription>{info.description}. 앱이 읽어 내므로 이름을 바꾸거나 지울 수 없습니다.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>색상</FieldLabel>
            <Swatches value={draft} onChange={setDraft} />
          </Field>
          <Field>
            <FieldLabel>미리보기</FieldLabel>
            <span>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium" style={chipStyle(draft)}>
                #{info.name}
              </span>
            </span>
          </Field>
        </FieldGroup>
      </PaneSection>
    </DetailPane>
  );
}
