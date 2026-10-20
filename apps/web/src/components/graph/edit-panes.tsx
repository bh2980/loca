import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button, Inspector, InspectorBlock, InspectorField, InspectorFields, InspectorHeader, Input, Skeleton, Textarea } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { PersonName } from '@/lib/person-colors';

const ORIGIN_LABELS = { import: '가져온 파일', human: '사람이 이음', ai: 'AI가 이음' } as const;

/** A line of the dialogue graph in the pane: its two ends, where it comes from, 삭제. */
export function EdgePane({ projectId, edgeId, onOpenNode, onRemove, onClose }: { projectId: string; edgeId: string; onOpenNode: (id: string) => void; onRemove?: () => void; onClose: () => void }) {
  const stored = edgeId.replace(/:(out|in)$/, '');
  const edge = useQuery({ queryKey: ['graph', projectId, 'edge', stored], queryFn: () => unwrap(client.projects[':projectId'].graph.edges[':edgeId'].$get({ param: { projectId, edgeId: stored } })) });
  const end = (side: 'from' | 'to') => {
    const node = edge.data![side];
    return (
      <Button variant="ghost" size="sm" className="h-auto w-full justify-start py-1.5 text-left" onClick={() => onOpenNode(node.id)}>
        <span className="min-w-0">
          <span className="block truncate text-xs text-muted-foreground">{node.speaker ? <PersonName projectId={projectId} name={node.speaker} /> : (node.label ?? node.kind)} · {node.key}</span>
          {node.text && <span className="block truncate text-sm">{node.text}</span>}
        </span>
      </Button>
    );
  };
  return (
    <Inspector header={<InspectorHeader kind="대사 그래프" name="선" onClose={onClose} />}>
      <InspectorBlock>
        {edge.isError ? (
          <p className="text-sm text-muted-foreground">이 선은 이제 없습니다.</p>
        ) : !edge.data ? (
          <Skeleton className="h-24" />
        ) : (
          <InspectorFields>
            <InspectorField label="출처">
              <p className="text-sm">{ORIGIN_LABELS[edge.data.origin]}</p>
            </InspectorField>
            {edge.data.label && (
              <InspectorField label="선택지">
                <p className="text-sm">{edge.data.label}</p>
              </InspectorField>
            )}
            <InspectorField label="앞">{end('from')}</InspectorField>
            <InspectorField label="뒤">{end('to')}</InspectorField>
          </InspectorFields>
        )}
      </InspectorBlock>
      {onRemove && edge.data && (
        <InspectorBlock>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
            <Trash2 /> 삭제
          </Button>
        </InspectorBlock>
      )}
    </Inspector>
  );
}

/** 이 대사 뒤에 대사 추가: the new line's text, speaker and listener; it goes in after the node (see insertLineAfter). */
export function InsertLinePane({ after, onAdd, onClose }: { after: { speaker: string | null; text: string | null }; onAdd: (line: { source: string; speaker: string | null; listener: string | null }) => Promise<unknown>; onClose: () => void }) {
  const [source, setSource] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [listener, setListener] = useState('');
  const [saving, setSaving] = useState(false);
  const add = async () => {
    setSaving(true);
    try {
      await onAdd({ source: source.trim(), speaker: speaker.trim() || null, listener: listener.trim() || null });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Inspector
      header={<InspectorHeader kind="대사 그래프" name="뒤에 대사 추가" onClose={onClose} />}
      footer={
        <div className="flex justify-end">
          <Button size="sm" disabled={!source.trim() || saving} onClick={() => void add()}>
            추가
          </Button>
        </div>
      }
    >
      <InspectorBlock>
        <InspectorFields>
          <InspectorField label="앞 대사">
            <p className="truncate text-sm text-muted-foreground">{[after.speaker, after.text].filter(Boolean).join(': ') || '대사 없음'}</p>
          </InspectorField>
          <InspectorField label="원문">
            <Textarea rows={3} autoFocus value={source} placeholder="원문을 입력하세요" onChange={(event) => setSource(event.target.value)} />
          </InspectorField>
          <InspectorField label="화자" description="이름을 그대로 적습니다. 비우면 지문·문구로 봅니다.">
            <Input value={speaker} placeholder="선택 사항" onChange={(event) => setSpeaker(event.target.value)} />
          </InspectorField>
          <InspectorField label="청자" description="비우면 미상으로 둡니다.">
            <Input value={listener} placeholder="선택 사항" onChange={(event) => setListener(event.target.value)} />
          </InspectorField>
        </InspectorFields>
      </InspectorBlock>
    </Inspector>
  );
}
