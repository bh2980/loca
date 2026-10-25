import type { Meta, StoryObj } from "@storybook/react-vite"
import { Check, Network, X } from "lucide-react"
import { useState } from "react"
import { Box } from "../layout/box"
import { Grid } from "../layout/grid"
import { Inline, Stack } from "../layout/stack"
import { Button } from "../primitives/button"
import { Icon } from "../primitives/icon"
import { Progress } from "../primitives/progress"
import { Spinner } from "../primitives/spinner"
import { Text } from "../primitives/text"
import { AttachmentChip } from "./attachment-chip"
import { CompactionNotice, ErrorNotice, SourceExcerpt, ToolCallRow, ToolCard, ToolCardHeader, ToolErrorCard } from "./tool-card"

const meta = { title: "Chat/Tool calls and cards", decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const OUTPUT = JSON.stringify({ sceneId: "scene-12", lines: [{ key: "12-001", speaker: "하윤", source: "…여기 있었구나." }] }, null, 1)

export const ToolCallStates: Story = {
  render: () => (
    <Stack gap="condensed">
      <ToolCallRow status="running" label="장면 대사 읽기" />
      <ToolCallRow status="done" label="장면 대사 읽기" detail={<span>· 21번째부터</span>} output={OUTPUT} />
      <ToolCallRow status="error" label="인물 찾기" output="인물 목록을 읽지 못했습니다: 프로젝트가 닫혀 있습니다." />
    </Stack>
  ),
}

export const ToolCallExpanded: Story = { render: () => <ToolCallRow status="done" label="장면 대사 읽기" output={OUTPUT} defaultOpen /> }

const Fields = ({ rows }: { rows: [string, string][] }) => (
  <Box as="dl" spaceY="tight">
    {rows.map(([label, value]) => (
      <Grid key={label} columns="field" gap="condensed">
        <Text as="dt" variant="caption" tone="muted">{label}</Text>
        <Text as="dd" minWidth={0} breakWords>{value}</Text>
      </Grid>
    ))}
  </Box>
)

const Decision = () => (
  <Stack direction="row" justify="end" gap="condensed" border="top" paddingX="normal" paddingY="condensed">
    <Button variant="outline"><X /> 거절</Button>
    <Button><Check /> 수락</Button>
  </Stack>
)

/** A change waiting for the person's decision. */
export const ProposalPending: Story = {
  render: () => (
    <ToolCard>
      <ToolCardHeader title="인물 저장" suffix={<Text weight="normal" tone="muted">· CLI</Text>} />
      <Box paddingX="normal" paddingY="condensed" variant="body">
        <Fields rows={[["작업", "새로 만들기"], ["이름", "하윤"], ["별칭", "윤아, 하"], ["역할", "주인공"]]} />
        <Text as="p" marginTop="condensed" border="top" paddingTop="condensed" tone="muted">자동 검토가 넘김: 같은 이름의 인물이 이미 있습니다.</Text>
      </Box>
      <Decision />
    </ToolCard>
  ),
}

export const ProposalAccepted: Story = {
  render: () => (
    <ToolCard>
      <ToolCardHeader title="용어 저장"><Text tone="success">자동 검토로 용어집에 반영됨</Text></ToolCardHeader>
      <Box paddingX="normal" paddingY="condensed" variant="body">
        <Box as="ul" maxHeight={48} spaceY="hair" overflow="auto">
          <li>추가 · <b>옥상</b> → rooftop</li>
          <li>추가 · <b>하윤</b> → Hayun</li>
        </Box>
      </Box>
      <Stack direction="row" justify="end" border="top" paddingX="normal" paddingY="condensed"><Button variant="outline">되돌리기</Button></Stack>
    </ToolCard>
  ),
}

export const ProposalFailed: Story = {
  render: () => (
    <ToolCard>
      <ToolCardHeader title="대사 삭제"><Text tone="danger">적용하려 했지만 실패 · 그사이 대사가 바뀌었습니다</Text></ToolCardHeader>
      <Box paddingX="normal" paddingY="condensed" variant="body">
        <Fields rows={[["삭제", "원문 대사 3개"], ["id", "12-001, 12-002, 12-003"]]} />
      </Box>
    </ToolCard>
  ),
}

export const ProposalRunning: Story = {
  render: () => (
    <ToolCard>
      <ToolCardHeader title="번역 실행"><Text tone="muted">적용 중</Text><Spinner size="xs" /></ToolCardHeader>
      <Box paddingX="normal" paddingY="condensed" variant="body"><Fields rows={[["워크플로", "초벌 번역"], ["범위", "장면·묶음 2개"]]} /></Box>
    </ToolCard>
  ),
}

/** The 실행 확인 card of a /workflow: waiting for an answer, then following the run. */
export const RunCardWaiting: Story = {
  render: () => (
    <Box spaceY="condensed" radius="md" border="all" background="muted" paddingX="normal" paddingY="condensed" variant="body" role="group" aria-label="초벌 번역 실행 확인">
      <Text as="p" weight="medium">/초벌 번역</Text>
      <Stack direction="row" wrap gap="tight"><AttachmentChip kind="장면" label="1장 · 옥상에서" title="1장 · 옥상에서" /></Stack>
      <p>대상 <Text as="b" weight="medium" tabular>128</Text> · AI 요청 <Text as="b" weight="medium" tabular>13</Text> · 약 2분 · $0.04</p>
      <Inline gap="condensed">
        <Button variant="secondary">실행</Button>
        <Button variant="ghost">취소</Button>
        <Text variant="caption" tone="muted">입력창이 비었을 때 Enter 실행 · Esc 취소</Text>
      </Inline>
    </Box>
  ),
}

const Run = ({ percent, status, failed }: { percent: number; status: string; failed?: number }) => (
  <Box spaceY="condensed" radius="md" border="all" background="muted" paddingX="normal" paddingY="condensed" variant="body" role="group">
    <Text as="p" weight="medium">/초벌 번역</Text>
    <Box spaceY="snug" role="status">
      <Progress value={percent} aria-label="실행 진행" />
      <Inline as="p" wrap gapX="condensed" variant="caption" tone="muted">
        <span>{status}</span>
        <Text tabular>{Math.round(1.28 * percent)} / 128</Text>
        {failed ? <Text tabular>실패 {failed}</Text> : null}
        <Text asChild marginLeft="auto" underline="offset"><a href="#run">실행 보기</a></Text>
      </Inline>
    </Box>
  </Box>
)

export const RunCardRunning: Story = { render: () => <Run percent={42} status="진행 중" failed={2} /> }
export const RunCardDone: Story = { render: () => <Run percent={100} status="완료" /> }

export const GraphLink: Story = {
  render: () => (
    <Inline gap="condensed" radius="lg" border="all" background="background" paddingX="normal" paddingY="condensed" variant="caption">
      <Icon icon={Network} size="sm" tone="muted" />
      <Text minWidth={0} grow truncate>옥상 장면 · 노드 14개 강조</Text>
      <Button variant="outline">그래프에서 보기</Button>
    </Inline>
  ),
}

/** The reading route result: where it starts and ends, each opening to the full source line. */
export const ReadingRoute: Story = {
  render: () => (
    <ToolCard>
      <Inline gap="condensed" border="bottom" background="muted" paddingX="normal" paddingY="snug" variant="body" weight="semibold">
        <Icon icon={Network} size="sm" tone="muted" />
        <span>경로 대본</span>
        <Text marginLeft="auto" weight="normal" tone="muted">대사 42줄</Text>
      </Inline>
      <Grid gap="condensed" paddingX="normal" paddingY="condensed" variant="body">
        <SourceExcerpt heading="시작 · 12-001 · 하윤" text="…여기 있었구나. 한참 찾았잖아. 교실에도 없고 매점에도 없고, 결국 옥상까지 올라왔어." expandLabel="원문 펼쳐 보기" />
        <SourceExcerpt heading="끝 · 12-042" text="내일은 같이 가자." expandLabel="원문 펼쳐 보기" />
      </Grid>
      <Stack direction="row" justify="end" border="top" paddingX="normal" paddingY="condensed"><Button variant="outline">경로 따라 번역 열기</Button></Stack>
    </ToolCard>
  ),
}

export const Errors: Story = {
  render: () => (
    <Stack gap="condensed">
      <ToolErrorCard>
        <Inline gap="condensed" weight="medium" tone="danger"><Icon icon={X} size="sm" />경로 대본</Inline>
        <Text as="p" marginTop="tight">시작 대사와 끝 대사가 이어지지 않습니다.</Text>
      </ToolErrorCard>
      <ErrorNotice>모델 서버가 응답하지 않습니다.</ErrorNotice>
    </Stack>
  ),
}

export const Compaction: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false)
    return (
      <CompactionNotice title="앞 대화를 요약했습니다" open={open} onToggle={() => setOpen(!open)}>
        하윤과 민재의 관계, 1~3장의 말투 규칙을 정리했고 용어 12개를 용어집에 넣었습니다.
      </CompactionNotice>
    )
  },
}
