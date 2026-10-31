import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Box, InspectorHeader, Inspector, InspectorList, InspectorResult, Button, SeamStateChip, Text, ListItem, Section } from '@loca/ui';
import { TokenText } from '@/components/editor/source-text';
import { client, unwrap } from '@/lib/api';
import { tokenPatternOf } from '@/lib/line-context';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { PersonName } from '@/lib/person-colors';
import { useProject } from '@/lib/project';

type Line = { unitId: string; key: string; groupId: string; speaker: string | null; source: string; translation: string | null };

/**
 * 이음새 점검: a seam of the path view, where this route's new lines hand back
 * into lines of an earlier route. Shows the route's last lines before the seam, a divider, and the
 * first lines of the earlier route after it. Read-only; a line opens in the script view to be
 * changed. The mark is stored with a signature of what was read.
 */
export function SeamCheckPane({ projectId, nodeId, onClose }: { projectId: string; nodeId: string; onClose: () => void }) {
  const detail = useQuery(q.seamDetail(projectId, nodeId));
  const project = useProject(projectId);
  const tokens = tokenPatternOf(project.data?.formatRules ?? undefined);
  const data = detail.data;
  const mark = useMutation({
    mutationFn: (sig: string) => unwrap(client.projects[':projectId']['seam-checks'][':nodeId'].$put({ param: { projectId, nodeId }, json: { sig } })),
    onError: (error) => toast.error(error.message),
  });
  const unmark = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['seam-checks'][':nodeId'].$delete({ param: { projectId, nodeId } })),
    onError: (error) => toast.error(error.message),
  });
  useReportView('graph-node', [data && { kind: '이음새', id: nodeId, label: `이음새 점검 · ${(data.after[0]?.source ?? '').slice(0, 40)}` }]);

  const state = data?.check?.state;
  const line = (item: Line) => (
    <ListItem layout="inline" key={item.unitId} align="start" gap="condensed" group paddingY="condensed" data-testid="seam-line">
      <Box minWidth={0} grow spaceY="hair" variant="body">
        <Text as="p" variant="caption" tone="muted">{item.speaker ? <PersonName projectId={projectId} name={item.speaker} /> : '지문·문구'}</Text>
        <TokenText text={item.source} source={item.source} pattern={tokens} />
        {item.translation ? <Text asChild tone="muted"><TokenText text={item.translation} source={item.source} pattern={tokens} /></Text> : <Text as="p" variant="caption" tone="muted">번역 없음</Text>}
      </Box>
      <Button variant="ghost" size="icon-xs" asChild shrink={false} reveal>
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: item.groupId, line: item.unitId }} title="번역 화면에서 열기" aria-label="번역 화면에서 열기">
          <FileText />
        </Link>
      </Button>
    </ListItem>
  );
  const lines = (items: Line[], empty: string) =>
    items.length ? <InspectorList>{items.map(line)}</InspectorList> : <Text as="p" variant="body" tone="muted">{empty}</Text>;

  return (
    <Inspector header={<InspectorHeader kind="경로" name="이음새" status={data && <SeamStateChip state={state} />} onClose={onClose} />} footer={
        data ? (
          <>
            {state === 'stale' && (
              <Button variant="outline" disabled={unmark.isPending} onClick={() => unmark.mutate()}>
                점검 취소
              </Button>
            )}
            <Button disabled={mark.isPending || unmark.isPending} onClick={() => (state === 'checked' ? unmark.mutate() : mark.mutate(data.sig))}>
              {state === 'checked' ? '점검 취소' : '점검함'}
            </Button>
          </>
        ) : undefined
      } loading={detail.isPending}>
      {detail.isError && (
        <Section>
          <InspectorResult tone="error">이음새 정보를 불러오지 못했습니다: {detail.error.message}</InspectorResult>
        </Section>
      )}
      {data && state === 'stale' && (
        <Section>
          <InspectorResult tone="info">점검한 뒤 이 줄들의 번역이 바뀌었습니다.</InspectorResult>
        </Section>
      )}
      {data && (
        <div data-testid="seam-route">
          {data.before.map((entry, i) => (
            <Section key={entry.from} title={data.before.length > 1 ? `이번 길 ${i + 1}/${data.before.length}` : '이번 길'}>
              {lines(entry.lines, '이 갈래에는 이음새 앞 대사가 없습니다.')}
            </Section>
          ))}
          <Section title="번역한 길">{lines(data.after, '이음새 뒤에 대사가 없습니다.')}</Section>
        </div>
      )}
    </Inspector>
  );
}
