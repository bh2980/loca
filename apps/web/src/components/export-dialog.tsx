import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Download, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Bleed, Box, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ExpandableRow, Heading, Icon, Inline, Label, Notice, RadioGroup, RadioGroupItem, ScopeRow, Spinner, Stack, StatusIcon, Text } from '@loca/ui';
import type { ResultRequest, ResultRest } from '@loca/shared';
import { lineScopeSections, ScopePicker } from '@/components/scope-picker';
import { exportDialog, useExportDialog, type ExportStart } from '@/lib/export-dialog';
import { useGroups } from '@/lib/groups';
import { useTaxonomy } from '@/lib/knowledge';
import { downloadResults, rememberedRest, rememberRest, restParts, resultCheck, resultPlan, startStatuses } from '@/lib/results';

type Target = 'view' | 'units' | 'groups';

/** 번역 결과 내보내기, mounted once beside a project's pages: every way to it opens it through `exportDialog`. */
export function ExportDialog({ projectId }: { projectId: string }) {
  const start = useExportDialog();
  // The store outlives this component: leaving the project leaves its dialog, or coming back would open it again.
  useEffect(() => () => exportDialog.close(), [projectId]);
  return start ? <ExportBody key={start.id} projectId={projectId} start={start} /> : null;
}

/**
 * The file for the game, decided in one place: which lines, whose translation goes in, and what becomes of the rest, with the
 * count following every choice and what would break the game said right above the button. Nothing here stops the export.
 */
function ExportBody({ projectId, start }: { projectId: string; start: ExportStart }) {
  const groups = useGroups(projectId);
  const { statuses } = useTaxonomy(projectId);
  const [target, setTarget] = useState<Target>(start.unitIds?.length ? 'units' : start.view ? 'view' : 'groups');
  // Every group starts picked once they are in: the whole project.
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set());
  const [groupFilter, setGroupFilter] = useState('');
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !groups.data) return;
    seeded.current = true;
    setPickedGroups(new Set(groups.data.map((group) => group.id)));
  }, [groups.data]);
  const whole = pickedGroups.size === (groups.data?.length ?? 0);
  // Nothing picked asks nothing: the dialog says to pick a range instead (an empty list is not a filter).
  const unpicked = target === 'groups' && !pickedGroups.size;
  const filter: ResultRequest['filter'] = target === 'units' ? { ids: start.unitIds } : target === 'view' ? start.view!.filter : whole || unpicked ? {} : { groups: [...pickedGroups] };

  // Until someone ticks a status, what goes in follows the target.
  const [edited, setEdited] = useState<Set<string> | null>(null);
  const started = useMemo(() => startStatuses(target, statuses ?? [], target === 'view' ? start.view?.filter : undefined), [target, statuses, start.view]);
  const checked = edited ?? started;
  const [rest, setRest] = useState<ResultRest>(() => rememberedRest(projectId));
  const request: ResultRequest = { filter, statuses: [...checked].sort(), rest };
  const ready = Boolean(statuses && groups.data) && !unpicked;

  const plan = useQuery({ ...resultPlan(projectId, request), enabled: ready });
  const check = useQuery({ ...resultCheck(projectId, request), enabled: ready });
  const data = unpicked ? undefined : plan.data;
  const stale = plan.isPlaceholderData;
  const save = useMutation({
    mutationFn: () => downloadResults(projectId, request),
    onSuccess: () => {
      rememberRest(projectId, rest);
      toast.success(`${(data?.inFile ?? 0).toLocaleString()}줄을 내보냈습니다`);
      exportDialog.close();
    },
    // Said in the dialog, which stays open.
    onError: () => undefined,
  });
  const blocked = unpicked ? '내보낼 범위를 고르세요.' : !data ? '줄 수를 세는 중입니다.' : stale ? '바꾼 범위로 다시 세는 중입니다.' : !data.total ? '이 범위에는 대사가 없습니다.' : !data.translated ? '들어갈 번역이 없습니다. 넣을 번역을 고르세요.' : false;
  const shownStatuses = (statuses ?? []).filter((status) => (data?.statuses[status.id] ?? 0) > 0);
  const restTotal = data?.rest.total ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && exportDialog.close()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>번역 결과 내보내기</DialogTitle>
          <DialogDescription>게임에 넣을 파일을 만듭니다.</DialogDescription>
        </DialogHeader>
        <Bleed by="tight" maxHeight="dialog" spaceY="comfortable" overflow="auto" paddingX="tight" paddingY="hair">
          <Box as="fieldset" spaceY="condensed">
            <Heading as="legend" minWidth={0} marginBottom="condensed">대상</Heading>
            {(start.view || start.unitIds?.length) ? (
              <Box asChild gap="condensed"><RadioGroup value={target} onValueChange={(value) => setTarget(value as Target)}>
                {start.view && (
                  <Box asChild variant="body" weight="normal"><Label>
                    <RadioGroupItem value="view" />
                    <span>
                      지금 보는 범위{target === 'view' && data && <Text tone="muted" tabular> {data.total.toLocaleString()}줄</Text>}
                      <Text display="block" variant="caption" tone="muted">{start.view.label}{start.view.filters > 0 && ` · 필터 ${start.view.filters}개`}</Text>
                    </span>
                  </Label></Box>
                )}
                {!!start.unitIds?.length && (
                  <Box asChild variant="body" weight="normal"><Label>
                    <RadioGroupItem value="units" />
                    고른 대사 <Text tone="muted" tabular>{start.unitIds.length.toLocaleString()}줄</Text>
                  </Label></Box>
                )}
                <Box asChild variant="body" weight="normal"><Label>
                  <RadioGroupItem value="groups" />
                  직접 고르기
                </Label></Box>
              </RadioGroup></Box>
            ) : null}
            {target === 'groups' && (
              <Box marginLeft={start.view || start.unitIds?.length ? 'spacious' : undefined}>
                <ScopePicker sections={lineScopeSections(groups.data ?? [])} unit="줄" picked={pickedGroups} setPicked={setPickedGroups} filter={groupFilter} setFilter={setGroupFilter} />
              </Box>
            )}
          </Box>

          <Box as="fieldset" spaceY="tight">
            <Heading as="legend" minWidth={0} marginBottom="condensed">넣을 번역</Heading>
            {shownStatuses.map((status) => (
              <ScopeRow key={status.id}>
                <Checkbox
                  checked={checked.has(status.id)}
                  onCheckedChange={(on) => {
                    const next = new Set(checked);
                    if (on === true) next.add(status.id);
                    else next.delete(status.id);
                    setEdited(next);
                  }}
                />
                <StatusIcon status={status} />
                <Text minWidth={0} grow truncate>{status.name}</Text>
                <Text shrink={false} variant="caption" tone="muted" tabular>{data!.statuses[status.id]!.toLocaleString()}줄</Text>
              </ScopeRow>
            ))}
            {data && !shownStatuses.length && <Text as="p" variant="caption" tone="muted">이 범위에는 번역할 대사가 없습니다.</Text>}
          </Box>

          <Box as="fieldset" spaceY="condensed">
            <Heading as="legend" minWidth={0} marginBottom="condensed">
              나머지 줄{data && restTotal > 0 && <Text marginLeft="tight" variant="caption" weight="normal" tone="muted" tabular>{restTotal.toLocaleString()}줄 · {restParts(data.rest, statuses ?? [])}</Text>}
            </Heading>
            <Box asChild gap="condensed"><RadioGroup value={rest} onValueChange={(value) => setRest(value as ResultRest)}>
              <Box asChild variant="body" weight="normal"><Label>
                <RadioGroupItem value="source" />
                <span>
                  원문으로 넣기
                  <Text display="block" variant="caption" tone="muted">모든 키가 파일에 들어갑니다</Text>
                </span>
              </Label></Box>
              <Box asChild variant="body" weight="normal"><Label>
                <RadioGroupItem value="omit" />
                <span>
                  파일에서 빼기
                  <Text display="block" variant="caption" tone="muted">없는 키를 원문으로 처리하는 게임에 맞습니다</Text>
                </span>
              </Label></Box>
            </RadioGroup></Box>
          </Box>

          {!!data?.sample.length && (
            <ExpandableRow summary={<Text>파일 미리보기 <Text tone="muted">· JSON</Text></Text>}>
              <Box as="pre" maxHeight="scroll-sm" overflow="auto" radius="base" background="sunken" padding="condensed" variant="caption" preserveLines>{JSON.stringify(data.sample, null, 2)}</Box>
            </ExpandableRow>
          )}
        </Bleed>

        {/* Right above the button: what in this file may break the game. It warns; it does not stop anything. */}
        {check.data && check.data.total > 0 ? <FormatWarning projectId={projectId} check={check.data} /> : null}
        {check.isPending && ready && <Text as="p" variant="caption" tone="muted" role="status"><Spinner size="xs" /> 형식을 점검하는 중…</Text>}
        {check.isError && (
          <Text as="p" variant="caption" tone="muted" role="status">
            형식을 점검하지 못했습니다. <Button variant="ghost" size="inline" onClick={() => void check.refetch()}>다시</Button>
          </Text>
        )}
        {save.isError && <Text as="p" variant="body" tone="danger">내보내지 못했습니다: {save.error.message}</Text>}
        <DialogFooter>
          {/* What the file holds, beside the button that makes it: the button already says how many lines. */}
          <Inline grow minWidth={0}>
            <Text variant="caption" tone={plan.isError && !data ? 'danger' : 'muted'} tabular aria-live="polite">
              {data ? (
                <>번역 {data.translated.toLocaleString()}{restTotal > 0 && (rest === 'source' ? ` · 원문 ${restTotal.toLocaleString()}` : ` · ${restTotal.toLocaleString()}줄 뺌`)}</>
              ) : plan.isError ? (
                <>줄 수를 세지 못했습니다: {plan.error.message} <Button variant="ghost" size="inline" onClick={() => void plan.refetch()}>다시 시도</Button></>
              ) : (
                '세는 중…'
              )}
            </Text>
          </Inline>
          <Button variant="outline" onClick={() => exportDialog.close()}>취소</Button>
          <Button disabled={save.isPending} disabledReason={blocked} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner /> : <Download />} {data ? `${data.inFile.toLocaleString()}줄 내보내기` : '내보내기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** How many lines in the file break the source's format; 보기 lists them, each opening its line. */
function FormatWarning({ projectId, check }: { projectId: string; check: { total: number; rows: { id: string; key: string; issue: string }[] } }) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="tight">
      <Notice variant="banner" tone="warning" role="status" actions={<Button variant="ghost" size="inline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '접기' : '보기'}</Button>}>
        <Inline as="span" gap="tight"><Icon icon={TriangleAlert} size="xs" shrink={false} /> 형식 오류 {check.total.toLocaleString()}줄이 파일에 들어갑니다</Inline>
      </Notice>
      {open && (
        <Box as="ul" maxHeight="scroll-sm" spaceY="tight" overflow="auto" variant="caption">
          {check.rows.map((row) => (
            <li key={row.id}>
              <Text asChild mono underline="offset"><Link to="/p/$projectId/script" params={{ projectId }} search={{ line: row.id, detail: true }} onClick={() => exportDialog.close()}>{row.key}</Link></Text>
              <Text tone="muted"> {row.issue}</Text>
            </li>
          ))}
          {check.total > check.rows.length && <Text as="li" tone="muted" tabular>외 {(check.total - check.rows.length).toLocaleString()}줄</Text>}
        </Box>
      )}
    </Stack>
  );
}
