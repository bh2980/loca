import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bot, CheckCheck, Flag, GitBranch, Layers, Repeat, Square, Wand2 } from "lucide-react"
import { Box } from "../../primitives/box"
import { Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { TooltipProvider } from "../../controls/tooltip"
import { FlowHandle, type FlowHandleLook } from "./flow-handle"
import { FoldChip } from "./fold-chip"
import { NodeCard, NodeKindIcon, type NodeCardKind } from "./node-card"
import { NodeLibrary, type NodeLibraryGroup } from "./node-library"

const meta = { title: "Domains/Graph/Node card", decorators: [(Story) => <TooltipProvider><Box style={{ width: 520 }}><Story /></Box></TooltipProvider>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const KINDS: { kind: NodeCardKind; icon: typeof Bot; title: string; summary: string }[] = [
  { kind: "entry", icon: Flag, title: "시작", summary: "번역 안 한 줄" },
  { kind: "ai", icon: Bot, title: "AI 번역", summary: "gpt-6.1-sol · 말투 규칙 사용" },
  { kind: "apply", icon: CheckCheck, title: "번역 반영", summary: "검토 필요로 표시" },
  { kind: "status", icon: Layers, title: "상태 변경", summary: "번역함으로" },
  { kind: "function", icon: Wand2, title: "서식 검사", summary: "변수가 빠진 줄 찾기" },
  { kind: "condition", icon: GitBranch, title: "조건", summary: "서식이 맞는가" },
  { kind: "gather", icon: Layers, title: "모으기", summary: "장면 단위로" },
  { kind: "retry", icon: Repeat, title: "재요청", summary: "실패 시 절반으로 2번" },
  { kind: "call", icon: Repeat, title: "워크플로 호출", summary: "검수 워크플로" },
  { kind: "end", icon: Square, title: "끝", summary: "" },
]

/** Every kind of node, each in its own color and shape. */
export const Kinds: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      {KINDS.map(({ kind, icon: Glyph, title, summary }) => <NodeCard key={kind} kind={kind} width="vertical" icon={<Glyph />} title={title} summary={summary} />)}
    </Stack>
  ),
}

/** Selected, disabled, with errors, with warnings, and a long title and summary. */
export const States: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <NodeCard kind="ai" width="vertical" icon={<Bot />} title="AI 번역" summary="gpt-6.1-sol" selected />
      <NodeCard kind="ai" width="vertical" icon={<Bot />} title="AI 번역" summary="gpt-6.1-sol" disabled />
      <NodeCard kind="ai" width="vertical" icon={<Bot />} title="AI 번역" summary="모델을 고르지 않았습니다" errors={2} />
      <NodeCard kind="function" width="vertical" icon={<Wand2 />} title="서식 검사" summary="규칙이 없습니다" warnings={1} />
      <NodeCard kind="ai" width="vertical" icon={<Bot />} title="아주 긴 이름의 AI 번역 노드 이름이 줄어드는 모습" summary="아주 긴 요약 문장이 한 줄을 넘으면 말줄임표로 줄어듭니다. 아주 긴 요약 문장." />
      <NodeCard kind="ai" width="vertical" icon={<Bot />} title="AI 번역" summary="동시에 보내기" parallel={4} />
    </Stack>
  ),
}

/** A run's graph: lines waiting, working, failed and passed, with requests in flight. */
export const Live: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <NodeCard kind="ai" width="vertical" icon={<Bot />} title="AI 번역" summary="gpt-6.1-sol" parallel={4} live={{ queued: 12, running: 4, failed: 1, calls: 4, limit: 4, passed: 230 }} />
      <NodeCard kind="gather" width="vertical" icon={<Layers />} title="모으기" live={{ queued: 8, running: 0, failed: 0 }} />
      <NodeCard kind="retry" width="vertical" icon={<Repeat />} title="재요청" live={{ queued: 0, running: 0, failed: 0, retry: "다시 보냄 12 · 출력 잘림" }} />
    </Stack>
  ),
}

/** Ports with their handles, an open exit, a folded branch, the start mark, and a fold-close mark. */
export const PortsAndFolds: Story = {
  render: () => (
    <Stack gap="normal" align="start">
      <NodeCard
        kind="condition"
        width="vertical"
        icon={<GitBranch />}
        title="조건"
        summary="서식이 맞는가"
        inputHandle={<span />}
        outputs={[
          { id: "yes", label: "맞음", handle: <span /> },
          { id: "no", label: "틀림", tone: "warning", handle: <span />, fold: { text: "실패 시 절반으로 2번 → 검토 필요", live: "대기 2 · 실패 3", errors: 1, onToggle: () => {} } },
          { id: "err", label: "실패", tone: "destructive", open: true },
        ]}
      />
      <NodeCard kind="entry" width="entry" icon={<Flag />} title="시작" start={{ label: "시작", onOpen: () => {} }} outputs={[{ id: "out", label: "", handle: <span /> }]} />
      <NodeCard kind="apply" width="vertical" icon={<CheckCheck />} title="번역 반영" foldClose={() => {}} />
    </Stack>
  ),
}

export const Horizontal: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <NodeCard kind="ai" width="horizontal" direction="horizontal" icon={<Bot />} title="AI 번역" summary="gpt-6.1-sol · 말투 규칙 사용 · 두 줄까지 보이는 요약 문장입니다. 이 문장은 길어서 줄어듭니다." outputs={[{ id: "ok", label: "통과" }, { id: "fail", label: "실패", tone: "destructive" }]} />
      <NodeCard kind="condition" width="horizontal" direction="horizontal" icon={<GitBranch />} title="조건" summary="서식이 맞는가" selected />
    </Stack>
  ),
}

/** The fold chip: closed, with live counts, with errors, with warnings, long text, and open. */
export const FoldChips: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <FoldChip text="태그 2개" onToggle={() => {}} />
      <FoldChip text="실패 시 절반으로 2번 → 검토 필요" live="대기 2 · 실패 3" onToggle={() => {}} />
      <FoldChip text="접힌 노드" errors={2} onToggle={() => {}} />
      <FoldChip text="접힌 노드" warnings={1} onToggle={() => {}} />
      <FoldChip text="아주 긴 이름의 접힌 노드들이 한 줄을 넘으면 줄어듭니다 아주 긴 이름" onToggle={() => {}} />
      <FoldChip text="태그 2개" open onToggle={() => {}} />
    </Stack>
  ),
}

/** The connection points by what they are (they take the look of the handle inside). */
export const Handles: Story = {
  render: () => {
    const looks: FlowHandleLook[] = ["workflow", "workflow-warning", "workflow-danger", "anchor", "person", "event", "event-idle", "hidden"]
    return (
      <Stack gap="condensed">
        {looks.map((look) => (
          <Stack key={look} direction="row" gap="condensed">
            <Box position="relative" style={{ width: 24, height: 24 }}><FlowHandle look={look}><span style={{ position: "absolute", left: 6, top: 6, borderRadius: 9999 }} /></FlowHandle></Box>
            <Text variant="caption" tone="muted">{look}</Text>
          </Stack>
        ))}
      </Stack>
    )
  },
}

export const KindIcons: Story = {
  render: () => (
    <Stack gap="tight">
      {KINDS.map(({ kind, icon }) => <Stack key={kind} direction="row" gap="condensed"><NodeKindIcon icon={icon} kind={kind} /><Text variant="caption">{kind}</Text></Stack>)}
    </Stack>
  ),
}

const GROUPS: NodeLibraryGroup[] = [
  { id: "ai", label: "AI", items: [{ id: "translate", label: "AI 번역", kind: "ai", icon: <Bot />, description: "원문을 번역합니다" }, { id: "review", label: "AI 검수", kind: "ai", icon: <Bot /> }] },
  { id: "flow", label: "흐름", items: [{ id: "cond", label: "조건", kind: "condition", icon: <GitBranch /> }, { id: "retry", label: "아주 긴 이름의 재요청 노드가 줄어드는 모습", kind: "retry", icon: <Repeat /> }] },
]

/** The searchable palette: full, and empty (no groups, so every search is empty). */
export const Library: Story = {
  render: () => (
    <Stack gap="normal">
      <Box border="all" borderColor="default" style={{ width: 260 }}><NodeLibrary groups={GROUPS} onSelect={() => {}} /></Box>
      <Box border="all" borderColor="default" style={{ width: 260 }}><NodeLibrary groups={[]} onSelect={() => {}} placeholder="노드 찾기" /></Box>
    </Stack>
  ),
}

