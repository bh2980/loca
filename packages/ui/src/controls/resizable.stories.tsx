import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../primitives/box"
import { Text } from "../primitives/text"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable"

const meta = { title: "Controls/Resizable", component: ResizablePanelGroup } satisfies Meta<typeof ResizablePanelGroup>
export default meta
type Story = StoryObj<typeof meta>

const Pane = ({ children }: { children: string }) => <Box padding="comfortable"><Text variant="caption">{children}</Text></Box>

export const Horizontal: Story = {
  render: () => (
    <Box height="placeholder-xl" border="all" radius="md">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize={30} minSize={15}><Pane>목록</Pane></ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={70}><Pane>본문</Pane></ResizablePanel>
      </ResizablePanelGroup>
    </Box>
  ),
}

export const WithHandle: Story = {
  render: () => (
    <Box height="placeholder-xl" border="all" radius="md">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize={50}><Pane>원문</Pane></ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50}><Pane>번역</Pane></ResizablePanel>
      </ResizablePanelGroup>
    </Box>
  ),
}

export const Vertical: Story = {
  render: () => (
    <Box height="placeholder-xl" border="all" radius="md">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize={50}><Pane>위</Pane></ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50}><Pane>아래</Pane></ResizablePanel>
      </ResizablePanelGroup>
    </Box>
  ),
}
