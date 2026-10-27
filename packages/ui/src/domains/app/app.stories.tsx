import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../../primitives/box"
import { Grid } from "../../primitives/grid"
import { Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { AppSettingsFrame, AppSettingsNavGroup, AppSettingsNavItem, BrandMark, ProjectCard, ProjectCardLink, ProjectListFrame } from "./app-project-list"
import { FileDropZone } from "./app-import"
import { StatusChipLink } from "./app-project-home"
import { useState } from "react"
import { StepMarker, TodoIcon } from "./app-project-home"
import { Notice } from "../../patterns/notice"
import { Progress } from "../../patterns/progress"
import { Chip } from "../../patterns/chip"
import { Count } from "../../patterns/count"

const meta = { title: "Domains/App/Project", decorators: [(Story) => <Box maxWidth="full" style={{ width: 520 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The project list: the app mark and a project card. */
export const ProjectList: Story = {
  render: () => (
    <Stack gap="normal">
      <BrandMark />
      <Grid columns="twoFromSm" gap="normal">
        <ProjectCard name="샘플 프로젝트" sourceLanguage="ja" targetLanguage="ko" units={1234} />
      </Grid>
    </Stack>
  ),
}

/** A card with a very long name and no lines yet; the name truncates. */
export const ProjectCardEdges: Story = {
  render: () => (
    <Grid columns="twoFromSm" gap="normal">
      <ProjectCard name="아주 긴 이름의 프로젝트: 어느 학원 로맨스 게임의 전체 시나리오 번역 (1차 초안)" sourceLanguage="ja" targetLanguage="ko" units={0} />
      <ProjectCard name="대사 많은 프로젝트" sourceLanguage="en" targetLanguage="ko" units={9000} />
    </Grid>
  ),
}

/** The link that makes a whole card a focusable target, and the page column that holds the list. */
export const LinkAndFrame: Story = {
  render: () => (
    <ProjectListFrame>
      <Stack gap="normal">
        <ProjectCardLink><a href="#project"><ProjectCard name="샘플 프로젝트" sourceLanguage="ja" targetLanguage="ko" units={1234} /></a></ProjectCardLink>
      </Stack>
    </ProjectListFrame>
  ),
}

/** The import drop zone: waiting, a file over it, and with the chosen file's name. */
export const ImportDropZone: Story = {
  render: () => {
    const [dragging, setDragging] = useState(false)
    const [name, setName] = useState<string>()
    return (
      <Stack gap="normal">
        <FileDropZone accept=".json" dragging={dragging} onDraggingChange={setDragging} onFile={(file) => setName(file?.name)}>{name ?? "파일을 끌어 놓거나 눌러서 고르세요"}</FileDropZone>
        <FileDropZone accept=".json" dragging onDraggingChange={() => {}} onFile={() => {}}>여기에 놓으세요</FileDropZone>
        <FileDropZone accept=".json" dragging={false} onDraggingChange={() => {}} onFile={() => {}}>realistic-9k-with-a-very-long-file-name-that-keeps-going.json</FileDropZone>
      </Stack>
    )
  },
}

/** A status link on the project home: it tints under the pointer. */
export const StatusLinks: Story = {
  render: () => (
    <Stack gap="tight" align="start">
      <StatusChipLink><a href="#a">번역 중 · 120줄</a></StatusChipLink>
      <StatusChipLink><a href="#b">검토 필요 · 3줄</a></StatusChipLink>
    </Stack>
  ),
}

/** Getting-started steps (done, current, to do) and a to-do's icon tile, normal and alert. */
export const HomeRows: Story = {
  render: () => (
    <Stack gap="normal">
      <Stack direction="row" gap="condensed">
        <StepMarker state="done">1</StepMarker>
        <StepMarker state="current">2</StepMarker>
        <StepMarker state="todo">3</StepMarker>
      </Stack>
      <Stack direction="row" gap="condensed">
        <TodoIcon>1</TodoIcon>
        <TodoIcon alert>2</TodoIcon>
      </Stack>
    </Stack>
  ),
}

/** The status bar popovers' small parts. */
export const StatusPopover: Story = {
  render: () => (
    <Notice>
      <Stack direction="row" gap="condensed">
        <Chip size="tight">실행 중</Chip>
        <Count>2건</Count>
      </Stack>
      <Stack direction="row" gap="condensed">
        <Progress size="sm" grow value={40} />
        <Text variant="caption" tone="muted">4/10</Text>
      </Stack>
    </Notice>
  ),
}

/** The home settings frame: grouped links on the left, the page on the right. */
export const SettingsFrame: Story = {
  decorators: [(Story) => <Box style={{ width: 860, height: 420 }}><Story /></Box>],
  render: () => (
    <AppSettingsFrame
      brand={<Stack direction="row" gap="condensed"><BrandMark /><Text weight="semibold">프로젝트 목록</Text></Stack>}
      nav={
        <>
          <AppSettingsNavGroup title="새 프로젝트 기본값" note="새로 만드는 프로젝트에만 쓰입니다. 이미 있는 프로젝트는 각 프로젝트 설정의 '홈 기본값'에서 가져옵니다.">
            <AppSettingsNavItem active><a href="#connections">연결</a></AppSettingsNavItem>
            <AppSettingsNavItem><a href="#statuses">상태·태그</a></AppSettingsNavItem>
            <AppSettingsNavItem><a href="#editor">에디터 AI</a></AppSettingsNavItem>
          </AppSettingsNavGroup>
          <AppSettingsNavGroup title="화면">
            <AppSettingsNavItem><a href="#appearance">테마</a></AppSettingsNavItem>
          </AppSettingsNavGroup>
        </>
      }
    >
      <Box padding="normal"><Text>본문</Text></Box>
    </AppSettingsFrame>
  ),
}
