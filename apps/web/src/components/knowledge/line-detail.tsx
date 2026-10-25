import { Trash2 } from 'lucide-react';
import { Button, Inline, Inspector, InspectorHeader, Text, Section, Field } from '@loca/ui';
import type { FlowEvent } from './event-flow';

const ORIGIN_LABELS: Record<string, string> = { human: '사람', ai: 'AI', import: '가져오기', script: '대본' };

/**
 * A line of the 사건 흐름 in the pane: where it comes from (the dialogue graph, with the two lines
 * that join, or drawn by hand) and 삭제. A derived line deleted here stays away when the flow is
 * computed again; ⌘/Ctrl+Z brings it back.
 */
export function LineDetail({ from, to, onOpen, onRemove, onClose }: { from: FlowEvent; to: FlowEvent; onOpen: (id: string) => void; onRemove?: () => void; onClose: () => void }) {
  const step = from.next.find((candidate) => candidate.id === to.id);
  if (!step) return null;
  return (
    <Inspector header={<InspectorHeader kind="사건 연결" name={`${from.title} → ${to.title}`} onClose={onClose} />}>
      <Section>
        <Field label="출처">
          {step.source === 'graph' ? (
            <Text as="p" variant="body">
              대사 그래프에서 계산했습니다. 플레이어가 {from.at?.key ? <Text as="code" variant="caption">{from.at.key}</Text> : '앞 사건'} 대사에서 {to.at?.key ? <Text as="code" variant="caption">{to.at.key}</Text> : '뒤 사건'} 대사로 갈 수 있습니다.
              {step.label && <Text display="block" tone="muted">선택지: {step.label}</Text>}
            </Text>
          ) : (
            <Text as="p" variant="body">직접 이었습니다 ({ORIGIN_LABELS[step.origin] ?? step.origin}). 대사 그래프에는 없는 연결입니다.</Text>
          )}
        </Field>
        <Field label="사건">
          <Inline as="span" wrap gap="tight">
            <Button variant="ghost" onClick={() => onOpen(from.id)}>{from.title}</Button>
            <Text tone="muted">→</Text>
            <Button variant="ghost" onClick={() => onOpen(to.id)}>{to.title}</Button>
          </Inline>
        </Field>
      </Section>
      {onRemove && (
        <Section>
          <Button variant="ghost" tone="danger" onClick={onRemove}>
            <Trash2 /> 삭제
          </Button>
        </Section>
      )}
    </Inspector>
  );
}
