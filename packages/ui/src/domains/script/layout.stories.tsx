import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../../primitives/box"
import { Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { Button } from "../../controls/button"
import { Notice } from "../../patterns/notice"
import { GraphEndpointBar } from "./graph-endpoint-bar"
import { GraphScriptSplit } from "./graph-script-split"
import { ScriptWorkspace } from "./script-layout"

const meta = { title: "Domains/Script/Layout", decorators: [(Story) => <Box style={{ width: 760 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const START = { id: "12-001", label: "하윤: …여기 있었구나." }
const END = { id: "12-090", label: "도현: 아주 긴 마지막 대사가 한 줄을 넘으면 말줄임표로 줄어듭니다. 아주 긴 마지막 대사." }

/** Nothing picked, picking the start, a path found, a long label, and busy. */
export const EndpointBar: Story = {
  render: function Render() {
    const [step, setStep] = useState<"start" | "end">("start")
    return (
      <Stack gap="condensed">
        <GraphEndpointBar step="start" picking={false} canFind={false} onBeginPicking={() => {}} onClear={() => {}} />
        <GraphEndpointBar step={step} picking canFind={false} start={START} onStepChange={setStep} onClear={() => {}} />
        <GraphEndpointBar step="end" picking canFind start={START} end={END} onFind={() => {}} onClear={() => {}} />
        <GraphEndpointBar step="end" picking canFind busy start={START} end={END} />
        <GraphEndpointBar step="start" picking={false} canFind start={START} end={END} status={<Text variant="caption" tone="muted">대사 90줄</Text>} onBeginPicking={() => {}} onClear={() => {}} />
        <Notice variant="banner" tone="warning">경로가 너무 깁니다.</Notice>
      </Stack>
    )
  },
}

export const GraphAndScript: Story = {
  render: () => (
    <Box border="all" borderColor="default" style={{ height: 200 }}>
      <GraphScriptSplit id="story" graph={<Box padding="normal"><Text>그래프 (왼쪽)</Text></Box>}>
        <Box padding="normal"><Text>대본 (오른쪽)</Text></Box>
      </GraphScriptSplit>
    </Box>
  ),
}

export const Workspace: Story = {
  render: function Render() {
    const [open, setOpen] = useState(true)
    return (
      <Stack gap="condensed" align="start">
        <Button variant="outline" onClick={() => setOpen(!open)}>{open ? "장면 목록 닫기" : "장면 목록 열기"}</Button>
        <Box border="all" borderColor="default" style={{ height: 200, width: 760, display: "flex" }}>
          <ScriptWorkspace open={open} navigation={<Box padding="normal"><Text>장면 목록</Text></Box>}>
            <Box padding="normal"><Text>줄 목록</Text></Box>
          </ScriptWorkspace>
        </Box>
      </Stack>
    )
  },
}
