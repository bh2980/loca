/** Right-hand pane for an automatic tag: its name and colour are the project's to change; what it means is the app's. */
import { AUTO_MARKS, type AutoMark } from '@tw/shared';
import { InspectorHeader, Inspector, Button, Box, Chip, Input, Section, Field, KeyValue, KeyValueRow } from '@loca/ui';
import { scopeLabel } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';
import { useFormFrom } from '@/lib/use-form-from';

export interface MarkStyle {
  name: string;
  color: string;
}

/** An automatic tag: rename it and recolour it for this project; 기본값으로 takes both back to the app's. */
export function MarkPane({ mark, style, pending, onClose, onSave }: { mark: AutoMark; style: MarkStyle; pending: boolean; onClose: () => void; onSave: (style: MarkStyle) => void }) {
  const { draft, setDraft } = useFormFrom(style, `mark.${mark}`);
  const info = AUTO_MARKS[mark];
  const isDefault = draft.name.trim() === info.name && draft.color === info.color;
  const changed = draft.name.trim() !== style.name || draft.color !== style.color;
  return (
    <Inspector header={<InspectorHeader kind="자동 태그" name={`#${style.name}`} status={`붙는 곳: ${scopeLabel(info.on)}`} onClose={onClose} />} footer={
        <>
          <Button variant="outline" disabled={isDefault} onClick={() => setDraft({ name: info.name, color: info.color })}>
            기본값으로
          </Button>
          <Button disabled={!changed || !draft.name.trim() || pending} onClick={() => onSave({ name: draft.name.trim(), color: draft.color })}>
            저장
          </Button>
        </>
      }>
      <Section title="설정">
        <Box spaceY="normal">
          <Field label="이름">
            <Input value={draft.name} placeholder={info.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label="색상">
            <Swatches value={draft.color} onChange={(color) => setDraft((current) => ({ ...current, color }))} />
          </Field>
        </Box>
      </Section>
      <Section title="정보">
        <KeyValue>
          <KeyValueRow label="설명">{info.description}</KeyValueRow>
          <KeyValueRow label="미리보기">
            <Box asChild radius="base">
              <Chip variant="tint" color={draft.color}>
                #{draft.name.trim() || info.name}
              </Chip>
            </Box>
          </KeyValueRow>
        </KeyValue>
      </Section>
    </Inspector>
  );
}
