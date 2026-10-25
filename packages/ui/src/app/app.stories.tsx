import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../layout/box"
import { Stack } from "../layout/stack"
import { Text } from "../primitives/text"
import { BrandMark, ProjectCard, ProjectGrid } from "./app-project-list"
import { RowChevron, StepList, StepMarker, TodoIcon } from "./app-project-home"
import { CountBadge, NoticeBox, RunProgressBar, RunStatusBadge } from "./app-shell"

const meta = { title: "App/Parts", decorators: [(Story) => <Box maxWidth="full" style={{ width: 520 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The project list: the app mark and a project card. */
export const ProjectList: Story = {
  render: () => (
    <Stack gap="normal">
      <BrandMark />
      <ProjectGrid>
        <ProjectCard name="샘플 프로젝트" sourceLanguage="ja" targetLanguage="ko" units={1234} />
      </ProjectGrid>
    </Stack>
  ),
}

/** Getting-started steps (done, current, to do) and a to-do's icon tile, normal and alert. */
export const HomeRows: Story = {
  render: () => (
    <Stack gap="normal">
      <StepList>
        <StepMarker state="done">1</StepMarker>
        <StepMarker state="current">2</StepMarker>
        <StepMarker state="todo">3</StepMarker>
      </StepList>
      <Stack direction="row" gap="condensed">
        <TodoIcon>1</TodoIcon>
        <TodoIcon alert>2</TodoIcon>
        <RowChevron />
      </Stack>
    </Stack>
  ),
}

/** The status bar popovers' small parts. */
export const StatusPopover: Story = {
  render: () => (
    <NoticeBox>
      <Stack direction="row" gap="condensed">
        <RunStatusBadge variant="default">실행 중</RunStatusBadge>
        <CountBadge variant="secondary">2건</CountBadge>
      </Stack>
      <Stack direction="row" gap="condensed">
        <RunProgressBar value={40} />
        <Text variant="caption" tone="muted">4/10</Text>
      </Stack>
    </NoticeBox>
  ),
}
