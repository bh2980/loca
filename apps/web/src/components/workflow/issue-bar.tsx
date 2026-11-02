import { Box, Button, Notice, Stack } from '@loca/ui';
import { nodeName, type WorkflowIssue, type WorkflowNode } from '@tw/shared';

/** The same error on several nodes is one row: the first node's name, how many more, and the message. */
export function issueRows(issues: WorkflowIssue[], nodes: WorkflowNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return [...Map.groupBy(issues.filter((issue) => issue.level === 'error'), (issue) => issue.message)].map(([message, list]) => {
    const named = list.flatMap((issue) => (issue.nodeId && byId.has(issue.nodeId) ? [byId.get(issue.nodeId)!] : []));
    const who = named.length === 0 ? '' : named.length === 1 ? `${nodeName(named[0]!)}: ` : `${nodeName(named[0]!)} 외 ${named.length - 1}개 노드: `;
    return { message: `${who}${message}`, nodeId: named[0]?.id };
  });
}

/**
 * Why the workflow cannot run, above the canvas: each error once, with 고치기 to select the node it is
 * on. Warnings stay in the status bar; they do not stop a run.
 */
export function WorkflowIssueBar({ issues, nodes, onFix }: { issues: WorkflowIssue[]; nodes: WorkflowNode[]; onFix: (nodeId: string) => void }) {
  const rows = issueRows(issues, nodes);
  if (!rows.length) return null;
  return (
    <Box border="bottom" paddingX="comfortable" paddingY="condensed">
      <Stack gap="tight" role="alert">
        {rows.map((row) => (
          <Notice key={row.message} variant="banner" tone="danger" actions={row.nodeId && <Button variant="outline" size="inline" paddingX="condensed" onClick={() => onFix(row.nodeId!)}>고치기</Button>}>
            {row.message}
          </Notice>
        ))}
      </Stack>
    </Box>
  );
}
