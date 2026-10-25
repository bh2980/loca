/** Right-hand pane for a built-in automatic tag: only its color is the project's to change. */
import { AUTO_MARKS, type AutoMark } from '@tw/shared';
import { InspectorHeader, Inspector, Button, Box, Chip, Section, Field, KeyValue, KeyValueRow } from '@loca/ui';
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
      <Section title="정보">
        <KeyValue>
          <KeyValueRow label="뜻">{info.description}</KeyValueRow>
          <KeyValueRow label="미리보기">
            <Box asChild radius="base">
              <Chip variant="tint" color={draft}>
                #{info.name}
              </Chip>
            </Box>
          </KeyValueRow>
        </KeyValue>
      </Section>
      <Section title="설정">
        <Box spaceY="normal">
          <Field label="색상">
            <Swatches value={draft} onChange={setDraft} />
          </Field>
        </Box>
      </Section>
    </Inspector>
  );
}
