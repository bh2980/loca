/**
 * A picked frame's pane: its name (a field, always open), the nodes it holds (each opens its node), 프레임만 삭제 (its
 * nodes stay) and 삭제 (the frame and its nodes, as Delete does). Moving nodes in and out is done on the canvas, by where they are let go.
 */
import { Trash2, Ungroup } from 'lucide-react';
import { Box, Button, Field, Input, Inspector, InspectorHeader, Section, Stack, Text } from '@loca/ui';
import { nodeName, type WorkflowGroup, type WorkflowNode } from '@tw/shared';

export function FramePanel({ group, nodes, onRename, onUngroup, onDelete, onOpenNode, onClose }: {
  group: WorkflowGroup;
  nodes: readonly WorkflowNode[];
  onRename: (label: string) => void;
  onUngroup: () => void;
  onDelete: () => void;
  onOpenNode: (nodeId: string) => void;
  onClose: () => void;
}) {
  const members = group.nodeIds.flatMap((id) => nodes.filter((node) => node.id === id));
  return (
    <Inspector bare flush
      header={<InspectorHeader kind="프레임" name={group.label || '이름 없는 프레임'} onClose={onClose} />}
      footerStart={<><Button variant="ghost" tone="danger" onClick={onDelete}><Trash2 /> 삭제</Button><Button variant="ghost" onClick={onUngroup}><Ungroup /> 프레임만 삭제</Button></>}
    >
      <Section title="기본">
        <Field label="이름" description="그래프에서 이 단계를 읽는 이름입니다. 실행에는 쓰이지 않습니다.">
          {/* The frame takes each change (part of the unsaved edit like any other), so a rename on the canvas shows here too. */}
          <Input value={group.label} placeholder="단계 이름" onChange={(event) => onRename(event.target.value)} />
        </Field>
      </Section>
      <Section title={`노드 ${members.length}개`}>
        <Text as="p" variant="caption" tone="muted">삭제는 안의 노드까지 지웁니다(되돌리기로 돌아옵니다). 노드를 남기려면 프레임만 삭제하세요. 노드는 가운데가 놓인 곳의 프레임에 듭니다. 다른 프레임 안에 놓으면 그 프레임으로, 모든 프레임 밖에 놓으면 프레임에서 빠집니다. 프레임을 선택하고 가장자리를 끌면 크기를 바꿀 수 있습니다.</Text>
        <Box as="ul" spaceY="hair">
          {members.map((node) => (
            <li key={node.id}>
              <Button variant="ghost" width="full" justifyContent="start" weight="normal" onClick={() => onOpenNode(node.id)}>
                <Stack minWidth={0}><Text truncate>{nodeName(node)}</Text></Stack>
              </Button>
            </li>
          ))}
        </Box>
      </Section>
    </Inspector>
  );
}
