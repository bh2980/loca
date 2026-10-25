import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { DockContent, DockHeader, DockInspector, DockProvider, WorkspaceShell } from "./right-dock"
import { Inspector } from "./inspector"
import { InspectorHeader } from "./inspector-header"
import { SplitPane } from "./split-pane"

const meta = { title: "Patterns/RightDock", decorators: [(Story) => <Box style={{ width: 760 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The header of the dock: properties / agent switch, tools, fold button. */
export const Header: Story = {
  render: () => {
    const [mode, setMode] = useState<"properties" | "agent">("properties")
    return (
      <Stack gap="comfortable">
        <DockHeader mode={mode} onMode={setMode} onToggle={() => {}} tools={<Button variant="ghost" size="xs">새 대화</Button>} />
        <DockHeader mode="agent" onMode={() => {}} onToggle={() => {}} unread />
        <DockHeader mode="agent" onMode={() => {}} onToggle={() => {}} hasProperties={false} unread />
      </Stack>
    )
  },
}

/** Folded: only the tools and the button to open it again. */
export const Folded: Story = {
  render: () => <DockHeader mode="properties" onMode={() => {}} onToggle={() => {}} open={false} tools={<Button variant="ghost" size="xs">새 대화</Button>} />,
}

/** One resizable pane at the right of the workspace. Pages portal their inspector into it (`SplitPane` under a provider does this); with nothing selected it shows its empty text. */
export const Workspace: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    const [mode, setMode] = useState<"properties" | "agent">("properties")
    const [selected, setSelected] = useState<string>()
    return (
      <Box style={{ height: 320, display: "flex", flexDirection: "column" }} border="all" radius="md">
        <DockProvider>
          <WorkspaceShell
            open={open}
            onOpenChange={setOpen}
            dock={
              <>
                <DockHeader mode={mode} onMode={setMode} open onToggle={() => setOpen(false)} />
                {mode === "properties" ? <DockInspector empty="줄을 고르면 여기에 속성이 보입니다." /> : <Box padding="normal"><Text variant="body">에이전트 대화</Text></Box>}
              </>
            }
          >
            <SplitPane
              id="story-dock"
              fill="height"
              selectionKey={selected}
              pane={selected ? <Inspector bare header={<InspectorHeader kind="줄" name={selected} />}><Box padding="normal"><Text variant="body">{selected}의 속성</Text></Box></Inspector> : null}
            >
              <Stack padding="normal" gap="condensed" align="start">
                <Button variant="outline" onClick={() => setSelected("12-003")}>12-003 선택</Button>
                <Button variant="outline" onClick={() => setSelected(undefined)}>선택 해제</Button>
                {!open && <Button onClick={() => setOpen(true)}>오른쪽 패널 열기</Button>}
              </Stack>
            </SplitPane>
          </WorkspaceShell>
        </DockProvider>
      </Box>
    )
  },
}

/** `DockContent` puts any content into the dock; the latest, deepest one shows. */
export const Content: Story = {
  render: () => (
    <Box style={{ height: 200, display: "flex", flexDirection: "column" }} border="all" radius="md">
      <DockProvider>
        <WorkspaceShell open onOpenChange={() => {}} dock={<DockInspector />}>
          <Box padding="normal"><Text variant="body">본문</Text></Box>
          <DockContent><Box padding="normal"><Text variant="body">도크에 들어간 내용</Text></Box></DockContent>
        </WorkspaceShell>
      </DockProvider>
    </Box>
  ),
}
