import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bot, Scissors, Trash2 } from "lucide-react"
import { useState } from "react"
import { Box } from "../../primitives/box"
import { Inline, Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { Button } from "../../controls/button"
import { TooltipProvider } from "../../controls/tooltip"
import { Chip } from "../../patterns/chip"
import { CanvasDirectionControl, type CanvasDirection } from "./canvas-direction-control"
import { CanvasFloat, CanvasOverlay, CanvasSurface, GraphCanvasElement, GraphMinimap, SelectionRect } from "./canvas-surface"
import { CanvasToolbar } from "./canvas-toolbar"
import { SelectionToolbox } from "./selection-toolbox"

const meta = { title: "Domains/Graph/Canvas", decorators: [(Story) => <TooltipProvider><Box style={{ width: 520 }}><Story /></Box></TooltipProvider>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Direction({ disabled, variant, compactLabels }: { disabled?: boolean; variant?: "default" | "ghost"; compactLabels?: boolean }) {
  const [direction, setDirection] = useState<CanvasDirection>("horizontal")
  return <CanvasDirectionControl direction={direction} onDirectionChange={setDirection} disabled={disabled} variant={variant} compactLabels={compactLabels} />
}

export const DirectionControl: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <Direction />
      <Direction variant="ghost" />
      <Direction disabled />
    </Stack>
  ),
}

/** The frame with its dot grid, an overlay of tools and details, a floating slot, and the drawing elements. */
export const Surface: Story = {
  render: () => (
    <CanvasSurface style={{ height: 240 }} grow={false}>
      <CanvasOverlay
        tools={<><Chip as="p" variant="note">노드 3개 선택</Chip><Button variant="outline">찾기</Button></>}
        details={<Chip as="p" variant="note">장면 경유 연결 7</Chip>}
      />
      <GraphCanvasElement tabIndex={0} width={520} height={240} aria-label="대사 그래프" />
      <SelectionRect style={{ left: 120, top: 100, width: 140, height: 80 }} />
      <CanvasFloat style={{ opacity: 1, transform: "translate(300px, 110px)" }}><Chip as="p" variant="note">따라다니는 슬롯</Chip></CanvasFloat>
      <GraphMinimap width={96} height={64} aria-label="전체 보기" />
    </CanvasSurface>
  ),
}

export const Toolbar: Story = {
  render: function Render() {
    const [direction, setDirection] = useState<CanvasDirection>("vertical")
    const [minimap, setMinimap] = useState(true)
    const [folds, setFolds] = useState(false)
    return (
      <Stack gap="normal" align="start">
        <CanvasToolbar zoomPercent={100} onZoomIn={() => {}} onZoomOut={() => {}} onFit={() => {}} />
        <CanvasSurface style={{ width: 520, height: 70 }} grow={false}>
          <CanvasToolbar
            zoomPercent={73.4}
            onZoomIn={() => {}}
            onZoomOut={() => {}}
            onFit={() => {}}
            onResetZoom={() => {}}
            onLayout={() => {}}
            layoutLabel="다시 정렬"
            foldsOpen={folds}
            onToggleFolds={() => setFolds(!folds)}
            direction={direction}
            onDirectionChange={setDirection}
            minimapVisible={minimap}
            onToggleMinimap={() => setMinimap(!minimap)}
          />
        </CanvasSurface>
        <CanvasToolbar zoomPercent={100} onZoomIn={() => {}} onZoomOut={() => {}} onFit={() => {}} direction="horizontal" onDirectionChange={() => {}} directionDisabled />
      </Stack>
    )
  },
}

export const Toolbox: Story = {
  render: () => (
    <Inline gap="normal" align="start">
      <SelectionToolbox
        actions={[
          { id: "ai", label: "AI로 번역", icon: <Bot />, onSelect: () => {} },
          { id: "cut", label: "여기서 끊기", icon: <Scissors />, onSelect: () => {}, disabled: true },
          { id: "del", label: "삭제", icon: <Trash2 />, onSelect: () => {}, destructive: true },
        ]}
      />
      <Text variant="caption" tone="muted">동작이 없으면 아무것도 그리지 않습니다.</Text>
      <SelectionToolbox actions={[]} />
    </Inline>
  ),
}
