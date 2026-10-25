import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline, Stack } from "../layout/stack"
import { Box } from "../layout/box"
import { Checkbox } from "../primitives/checkbox"
import { Text } from "../primitives/text"
import { ReadinessDot, ScopeRow } from "./run-dialog-parts"

const meta = { title: "Workflow/Run dialog parts", decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The scope list: the 전체 row, then a kind with its fold arrow's space, lit under the pointer. */
export const ScopeRows: Story = {
  render: () => (
    <Box radius="md" border="all" padding="tight">
      <ScopeRow kind="all">
        <Checkbox checked />
        <Text minWidth={0} grow>전체</Text>
        <Text shrink={false} variant="caption" weight="normal" tone="muted" tabular>1,204줄</Text>
      </ScopeRow>
      <Inline paddingLeft="condensed">
        <ScopeRow kind="section">
          <Checkbox checked="indeterminate" />
          <Text minWidth={0} grow truncate>대사</Text>
          <Text shrink={false} variant="caption" tone="muted" tabular>12개 · 980줄</Text>
        </ScopeRow>
      </Inline>
    </Box>
  ),
}

export const Readiness: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline gap="condensed"><ReadinessDot ok /><Text variant="body" tone="muted">청자 모두 정해짐</Text></Inline>
      <Inline gap="condensed"><ReadinessDot ok={false} /><Text variant="body">후보 용어 3개</Text></Inline>
    </Stack>
  ),
}
