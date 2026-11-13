import { TOOL_SPECS, type ProposalDetail } from '@loca/shared';
import { MarkChip } from '@/components/status';
import { diffRows } from '@/lib/text-diff';
import { Box, DiffText, Markdown, Grid, Inline, Text, SectionHeading } from '@loca/ui';

export const LABEL: Record<string, string> = Object.fromEntries(Object.entries(TOOL_SPECS).map(([name, spec]) => [name, spec.label]));

/** One detail, drawn by its kind (ProposalDetail, @loca/shared): the server's tool definition said what the change does. */
function Detail({ detail, pending }: { detail: ProposalDetail; pending: boolean }) {
  switch (detail.kind) {
    case 'fields':
      return (
        <Box as="dl" spaceY="tight">
          {detail.rows.map((row, index) => (
            <Grid key={index} columns="field" gap="condensed">
              <Text as="dt" variant="caption" tone="muted">{row.label}</Text>
              <Text as="dd" minWidth={0} breakWords>{row.code ? <Text as="pre" maxHeight="scroll-sm" overflow="auto" variant="caption" preserveLines>{row.value}</Text> : row.value}</Text>
            </Grid>
          ))}
        </Box>
      );
    case 'changes':
      return (
        <Box as="ul" maxHeight="scroll" spaceY="condensed" overflow="auto">
          {detail.items.map((item, index) => (
            <li key={index}>
              <Text as="p" weight="medium">{item.title}</Text>
              {item.changes.length ? (
                <Box as="dl" spaceY="tight">
                  {item.changes.map((change) => (
                    <Grid key={change.field} columns="field" gap="condensed">
                      <Text as="dt" variant="caption" tone="muted">{change.field}</Text>
                      <Box as="dd" minWidth={0}>
                        {change.before !== undefined ? (
                          <DiffText rows={diffRows(change.before, change.after)} />
                        ) : (
                          <Text as="p" breakWords preserveLines>{change.after}</Text>
                        )}
                      </Box>
                    </Grid>
                  ))}
                </Box>
              ) : (
                <Text as="p" variant="caption" tone="muted">바뀌는 내용이 없습니다.</Text>
              )}
            </li>
          ))}
        </Box>
      );
    case 'list':
      return (
        <div>
          {detail.title && <SectionHeading level="group">{detail.title}</SectionHeading>}
          <Box as="ul" maxHeight="scroll-sm" spaceY="hair" overflow="auto">
            {detail.items.map((item, index) => <li key={index}>{item}</li>)}
          </Box>
          {!!detail.more && <Text as="p" tone="muted">외 {detail.more.toLocaleString()}개</Text>}
        </div>
      );
    case 'text':
      return detail.format === 'markdown' ? <Markdown framed>{detail.text}</Markdown> : <Text as="pre" maxHeight="scroll-sm" overflow="auto" variant="caption" preserveLines>{detail.text}</Text>;
    case 'marks':
      return (
        <Box as="dl">
          <Grid columns="field" gap="condensed">
            <Text as="dt" variant="caption" tone="muted">{detail.label}</Text>
            <Inline as="dd" minWidth={0} wrap gap="tight">
              {detail.marks.map((mark) => <MarkChip key={mark} mark={mark} />)}
            </Inline>
          </Grid>
        </Box>
      );
    case 'lines':
      return (
        <Box spaceY="condensed">
          <p>
            대사 <b>{detail.total.toLocaleString()}</b>개 · 번역 {detail.translations.toLocaleString()} · 상태 {detail.statuses.toLocaleString()} · 태그 {detail.tagged.toLocaleString()}
            {detail.shown.length < detail.total && <Text tone="muted"> · 처음 {detail.shown.length}개만 표시</Text>}
          </p>
          <Box as="ul" maxHeight="scroll" spaceY="tight" overflow="auto">
            {detail.shown.map((line) => (
              <Box as="li" key={line.key} radius="base" border="all" paddingX="condensed" paddingY="tight">
                <Text mono variant="caption" tone="muted">{line.key}</Text>
                {line.translation !== undefined && <Text display="block">{line.translation}</Text>}
                {line.change && <Text display="block" tone="muted">{line.change}</Text>}
              </Box>
            ))}
          </Box>
        </Box>
      );
    case 'note':
      return detail.whilePending && !pending ? null : <Text as="p" tone={detail.tone}>{detail.text}</Text>;
  }
}

/**
 * What a proposed change does, as its tool's definition on the server says it (the proposal's details): each detail
 * is drawn by its kind, never by the tool's name, so a new tool needs nothing here.
 */
export function ChangePreview({ details, pending = true }: { details: readonly ProposalDetail[]; /** Still waiting for a decision: only then does it say what accepting will do. */ pending?: boolean }) {
  return (
    <Box spaceY="tight">
      {details.map((detail, index) => <Detail key={index} detail={detail} pending={pending} />)}
    </Box>
  );
}
