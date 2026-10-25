import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Box, Button, Inspector, InspectorHeader, Input, Skeleton, Stack, Text, Textarea, Section, Field } from '@loca/ui';
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
      <Button variant="ghost" height="auto" width="full" justifyContent="start" paddingY="condensed" textAlign="start" onClick={() => onOpenNode(node.id)}>
        <Box as="span" minWidth={0}>
          <Text display="block" truncate variant="caption" tone="muted">{node.speaker ? <PersonName projectId={projectId} name={node.speaker} /> : (node.label ?? node.kind)} · {node.key}</Text>
          {node.text && <Text display="block" truncate variant="body">{node.text}</Text>}
        </Box>
      </Button>
    );
  };
  return (
    <Inspector header={<InspectorHeader kind="대사 그래프" name="선" onClose={onClose} />}>
      <Section>
        {edge.isError ? (
          <Text as="p" variant="body" tone="muted">이 선은 이제 없습니다.</Text>
        ) : !edge.data ? (
          <Skeleton height="placeholder-sm" />
        ) : (
          <Box spaceY="normal">
            <Field label="출처">
              <Text as="p" variant="body">{ORIGIN_LABELS[edge.data.origin]}</Text>
            </Field>
            {edge.data.label && (
              <Field label="선택지">
                <Text as="p" variant="body">{edge.data.label}</Text>
              </Field>
            )}
            <Field label="앞">{end('from')}</Field>
            <Field label="뒤">{end('to')}</Field>
          </Box>
        )}
      </Section>
      {onRemove && edge.data && (
        <Section>
          <Button variant="ghost" tone="danger" onClick={onRemove}>
            <Trash2 /> 삭제
          </Button>
        </Section>
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
        <Stack direction="row" justify="end">
          <Button disabled={!source.trim() || saving} onClick={() => void add()}>
            추가
          </Button>
        </Stack>
      }
    >
      <Section>
        <Box spaceY="normal">
          <Field label="앞 대사">
            <Text as="p" truncate variant="body" tone="muted">{[after.speaker, after.text].filter(Boolean).join(': ') || '대사 없음'}</Text>
          </Field>
          <Field label="원문">
            <Textarea rows={3} autoFocus value={source} placeholder="원문을 입력하세요" onChange={(event) => setSource(event.target.value)} />
          </Field>
          <Field label="화자" description="이름을 그대로 적습니다. 비우면 지문·문구로 봅니다.">
            <Input value={speaker} placeholder="선택 사항" onChange={(event) => setSpeaker(event.target.value)} />
          </Field>
          <Field label="청자" description="비우면 미상으로 둡니다.">
            <Input value={listener} placeholder="선택 사항" onChange={(event) => setListener(event.target.value)} />
          </Field>
        </Box>
      </Section>
    </Inspector>
  );
}
