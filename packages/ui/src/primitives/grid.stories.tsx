import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "./box"
import { Grid } from "./grid"
import { Text } from "./text"

const meta = { title: "Primitives/Grid", component: Grid, args: { columns: 3, gap: "condensed" } } satisfies Meta<typeof Grid>
export default meta
type Story = StoryObj<typeof meta>

const Cell = ({ children }: { children: string }) => <Box padding="condensed" radius="md" border="all" background="sunken"><Text variant="caption">{children}</Text></Box>

export const Columns: Story = { render: (args) => <Grid {...args}>{["하나", "둘", "셋", "넷", "다섯"].map((c) => <Cell key={c}>{c}</Cell>)}</Grid> }

/** `field`: a 5rem label column next to the value, as the change preview lists a proposal's fields. */
export const Fields: Story = {
  render: () => (
    <Box spaceY="tight">
      {[["작업", "새로 만들기"], ["이름", "하윤"], ["별칭", "윤아, 하"], ["역할", "주인공"]].map(([label, value]) => (
        <Grid key={label} columns="field" gap="condensed">
          <Text as="dt" variant="caption" tone="muted">{label}</Text>
          <Text as="dd" minWidth={0} breakWords>{value}</Text>
        </Grid>
      ))}
    </Box>
  ),
}

/** `responsive` stacks the columns on a narrow screen. */
export const Responsive: Story = { render: (args) => <Grid {...args} columns={2} responsive><Cell>왼쪽</Cell><Cell>오른쪽</Cell></Grid> }
