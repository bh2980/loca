import type { Meta, StoryObj } from "@storybook/react-vite"
import { useId, type ReactNode } from "react"
import { Braces, GitFork, ScanSearch } from "lucide-react"
import { STATUS_COLORS } from "@tw/shared"
import { ExitTag, ExitTagAdd, ExitTagList, type ExitTagItem } from "./exit-tag"
import { NodeCard } from "./node-card"
import { WorkflowFrame, WorkflowFrameTint } from "./workflow-frame"

const meta = { title: "Domains/Graph/Exit tag", parameters: { layout: "fullscreen" } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const FORMAT = STATUS_COLORS[0]!
const TERM = STATUS_COLORS[1]!
const DONE = STATUS_COLORS[2]!
const REVIEW = STATUS_COLORS[3]!

const removeAll: ExitTagItem[] = [
  { kind: "tag", action: "remove", name: "형식 오류", color: FORMAT },
  { kind: "tag", action: "remove", name: "용어 위반", color: TERM },
  { kind: "tag", action: "remove", name: "말투 어긋남", color: STATUS_COLORS[4]! },
  { kind: "tag", action: "remove", name: "의미 오류", color: STATUS_COLORS[5]! },
  { kind: "tag", action: "remove", name: "문체 어색", color: STATUS_COLORS[6]! },
  { kind: "tag", action: "remove", name: "기타 지적", color: STATUS_COLORS[7]! },
  { kind: "tag", action: "remove", name: "AI 실패", color: STATUS_COLORS[8]! },
  { kind: "status", name: "완료", color: DONE, statusKind: "final" },
]

// Tags a result decides: named by the step, with the tags set for its values.
const fail: ExitTagItem[] = [{ kind: "tag", action: "add", name: "AI 검수", fromResult: true, options: removeAll.filter((item) => item.kind === "tag").slice(0, 6).map(({ name, color }) => ({ name, color })) }]

/** Light and dark side by side. */
const Both = ({ children, width }: { children: () => ReactNode; width: number }) => (
  <div className="flex flex-wrap gap-6 p-6">
    <div className="rounded-lg bg-page p-4 text-default" style={{ width }}><p className="mb-3 text-xs text-muted">라이트</p>{children()}</div>
    <div className="dark rounded-lg bg-page p-4 text-default" style={{ width }}><p className="mb-3 text-xs text-muted">다크</p>{children()}</div>
  </div>
)

/** Each kind of chip, together, picked, zoomed out, in a run, and the way to add one on a bare line. */
export const States: Story = {
  render: () => (
    <Both width={700}>
      {() => (
        <div className="grid grid-cols-4 items-start gap-5">
          <Labeled text="태그 1개 제거"><ExitTag items={[{ kind: "tag", action: "remove", name: "형식 오류", color: FORMAT }]} /></Labeled>
          <Labeled text="태그 1개 추가"><ExitTag items={[{ kind: "tag", action: "add", name: "형식 오류", color: FORMAT }]} /></Labeled>
          <Labeled text="AI 검수 결과에 따라 추가"><ExitTag items={fail} /></Labeled>
          <Labeled text="상태 바꾸기"><ExitTag items={[{ kind: "status", name: "검토 필요", color: REVIEW, inReview: true }]} /></Labeled>
          <Labeled text="상태 + 태그 7개 제거"><ExitTag items={removeAll} /></Labeled>
          <Labeled text="고름 (출구 패널이 열림)"><ExitTag selected items={[{ kind: "tag", action: "add", name: "형식 오류", color: FORMAT }]} /></Labeled>
          <Labeled text="멀리서 볼 때 (배율 낮음)"><ExitTag compact items={removeAll} /></Labeled>
          <Labeled text="조건의 예/아니요와 함께"><ExitTag label="아니요" items={[{ kind: "status", name: "검토 필요", color: REVIEW, inReview: true }]} /></Labeled>
          <Labeled text="동작 없는 선에 마우스를 올렸을 때"><ExitTagAdd /></Labeled>
        </div>
      )}
    </Both>
  ),
}

const Labeled = ({ text, children }: { text: string; children: ReactNode }) => (
  <div className="space-y-1.5"><p className="text-xs text-subtle">{text}</p>{children}</div>
)

/** Places a thing on the scene at (x, y); `center` puts its middle on x, `middle` on y too. */
const At = ({ x, y, center, middle, children, width }: { x: number; y: number; center?: boolean; middle?: boolean; width?: number; children: ReactNode }) => (
  <div className="absolute" style={{ left: x, top: y, width, transform: middle ? "translate(-50%, -50%)" : center ? "translateX(-50%)" : undefined }}>{children}</div>
)

type Line = { d: string; tone?: "neutral" | "warning" | "destructive"; picked?: boolean; end?: boolean }
const STROKE = { neutral: "var(--stroke-graph-edge)", warning: "var(--stroke-warning)", destructive: "var(--stroke-danger)" }

/** Lines under the nodes and marks, as the canvas draws them; a picked exit's line in the accent, thicker. An end line has no arrow. */
function Lines({ lines, width, height }: { lines: Line[]; width: number; height: number }) {
  const id = useId()
  return (
  <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
    <defs>
      {(["neutral", "warning", "destructive", "picked"] as const).map((tone) => (
        <marker key={tone} id={`${id}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={tone === "picked" ? "var(--stroke-accent)" : STROKE[tone]} />
        </marker>
      ))}
    </defs>
    {lines.map((line, index) => (
      <path key={index} d={line.d} fill="none" strokeLinejoin="round" strokeLinecap="round"
        stroke={line.picked ? "var(--stroke-accent)" : STROKE[line.tone ?? "neutral"]} strokeWidth={line.picked ? 2.5 : 1.75}
        markerEnd={line.end ? undefined : `url(#${id}-${line.picked ? "picked" : line.tone ?? "neutral"})`} />
    ))}
  </svg>
  )
}

/** An exit's dot on a node's edge (the canvas's handle); a picked exit's is ringed. */
const Dot = ({ x, y, tone = "neutral", picked }: { x: number; y: number; tone?: "neutral" | "warning" | "destructive"; picked?: boolean }) => (
  <span className={"absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface " + (picked ? "ring-2 ring-accent/50" : "")} style={{ left: x, top: y, background: STROKE[tone] }} />
)

const pass: ExitTagItem[] = removeAll
const error: ExitTagItem[] = [{ kind: "status", name: "검토 필요", color: REVIEW, inReview: true }]

/**
 * The editor around the densest exits, AI 검수 (통과 → 완료 and seven tags off, 실패 → the findings on, 오류 → 검토 필요).
 * Nothing sits under the node: an exit's mark is on its line's long run, in the room between frames; an exit that ends the
 * flow draws a short line out past its frame's edge, and its mark is that line's end. `hover`: the 통과 mark's hover card.
 */
function Scene({ hover }: { hover?: boolean }) {
  const W = 820
  const H = 560
  const x = [115, 190, 265]
  return (
    <div className="relative" style={{ width: W, height: H }}>
      <At x={40} y={40}><div style={{ width: 300, height: 260 }}><WorkflowFrameTint /></div></At>
      <At x={500} y={40}><div style={{ width: 300, height: 260 }}><WorkflowFrameTint /></div></At>
      <At x={500} y={372}><div style={{ width: 300, height: 170 }}><WorkflowFrameTint /></div></At>
      <Lines width={W} height={H} lines={[
        // From 자동 검사, in by the side under the header.
        { d: "M 0 88 L 182 88 Q 190 88 190 96 L 190 110" },
        // 통과 → AI 용어 추출: up the room between the frames, in by the side.
        { d: "M 115 198 L 115 214 Q 115 222 123 222 L 412 222 Q 420 222 420 214 L 420 96 Q 420 88 428 88 L 642 88 Q 650 88 650 96 L 650 110" },
        // 실패 (picked) → 수정 루프, under the frame.
        { d: "M 190 198 L 190 412 Q 190 420 198 420 L 642 420 Q 650 420 650 428 L 650 440", tone: "warning", picked: true },
        // 오류: ends the flow, just past the frame's edge.
        { d: "M 265 198 L 265 314", tone: "destructive", end: true },
        { d: "M 650 198 L 650 222" },
      ]} />
      <At x={40} y={40}><div style={{ width: 300, height: 260 }} className="pointer-events-none"><WorkflowFrame label="AI 검수" meta="노드 1" onRename={() => {}} onUngroup={() => {}} /></div></At>
      <At x={500} y={40}><div style={{ width: 300, height: 260 }} className="pointer-events-none"><WorkflowFrame label="용어 추출" meta="노드 2" onRename={() => {}} onUngroup={() => {}} /></div></At>
      <At x={500} y={372}><div style={{ width: 300, height: 170 }} className="pointer-events-none"><WorkflowFrame label="수정 루프" meta="노드 4" onRename={() => {}} onUngroup={() => {}} /></div></At>

      <At x={78} y={110} width={224}><NodeCard kind="ai" icon={<ScanSearch />} title="AI 검수" badge="mock" summary="판정 · 장면별" retry={{ text: "재시도 규칙 2개" }} /></At>
      <Dot x={x[0]!} y={198} /><Dot x={x[1]!} y={198} tone="warning" picked /><Dot x={x[2]!} y={198} tone="destructive" />
      <At x={538} y={110} width={224}><NodeCard kind="ai" icon={<Braces />} title="AI 용어 추출" badge="mock" summary="JSON · 장면별" retry={{ text: "재시도 최대 5번" }} /></At>
      <At x={538} y={222} width={224}><NodeCard kind="apply" icon={<Braces />} verb="저장" title="용어 저장" /></At>
      <At x={538} y={440} width={224}><NodeCard kind="condition" icon={<GitFork />} title="AI 수정 3회 미만?" /></At>

      <At x={420} y={155} middle><ExitTag exit="통과" items={pass} /></At>
      <At x={420} y={420} middle><ExitTag exit="실패" selected items={fail} /></At>
      <At x={265} y={314} center><ExitTag exit="오류" items={error} /></At>
      {hover && (
        <At x={840} y={110}>
          <p className="mb-1.5 text-xs text-subtle">통과 표지에 마우스를 올리면</p>
          <div className="w-40 rounded-md border border-default bg-surface p-2 shadow-md"><ExitTagList items={pass} /></div>
        </At>
      )}
    </div>
  )
}

/** The editor at 100% (통과's hover card open), light and dark. */
export const Editor: Story = { render: () => <Both width={1060}>{() => <Scene hover />}</Both> }

/** The same at the fit-to-screen zoom (52%), as the whole workflow opens. */
export const Fit: Story = {
  render: () => (
    <Both width={460}>
      {() => <div style={{ width: 820 * 0.52, height: 560 * 0.52 }}><div style={{ transform: "scale(0.52)", transformOrigin: "0 0" }}><Scene /></div></div>}
    </Both>
  ),
}
