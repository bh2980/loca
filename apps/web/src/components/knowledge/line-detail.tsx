import { Trash2 } from 'lucide-react';
import { Button, Inspector, InspectorBlock, InspectorField, InspectorHeader } from '@loca/ui';
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
      <InspectorBlock>
        <InspectorField label="출처">
          {step.source === 'graph' ? (
            <p className="text-sm">
              대사 그래프에서 계산했습니다. 플레이어가 {from.at?.key ? <code className="text-xs">{from.at.key}</code> : '앞 사건'} 대사에서 {to.at?.key ? <code className="text-xs">{to.at.key}</code> : '뒤 사건'} 대사로 갈 수 있습니다.
              {step.label && <span className="block text-muted-foreground">선택지: {step.label}</span>}
            </p>
          ) : (
            <p className="text-sm">직접 이었습니다 ({ORIGIN_LABELS[step.origin] ?? step.origin}). 대사 그래프에는 없는 연결입니다.</p>
          )}
        </InspectorField>
        <InspectorField label="사건">
          <span className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={() => onOpen(from.id)}>{from.title}</Button>
            <span className="self-center text-muted-foreground">→</span>
            <Button size="sm" variant="ghost" onClick={() => onOpen(to.id)}>{to.title}</Button>
          </span>
        </InspectorField>
      </InspectorBlock>
      {onRemove && (
        <InspectorBlock>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
            <Trash2 /> 삭제
          </Button>
        </InspectorBlock>
      )}
    </Inspector>
  );
}
