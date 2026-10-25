import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

const meta = { title: "Controls/Tabs", component: Tabs } satisfies Meta<typeof Tabs>
export default meta
type Story = StoryObj<typeof meta>

const Demo = ({ variant, orientation, disabled }: { variant?: "default" | "line"; orientation?: "vertical"; disabled?: boolean }) => (
  <Tabs defaultValue="a" orientation={orientation}>
    <TabsList variant={variant}>
      <TabsTrigger value="a">대사</TabsTrigger>
      <TabsTrigger value="b">인물</TabsTrigger>
      <TabsTrigger value="c" disabled={disabled}>아주 긴 이름의 탭 하나</TabsTrigger>
    </TabsList>
    <TabsContent value="a"><Text variant="caption">대사 목록</Text></TabsContent>
    <TabsContent value="b"><Text variant="caption">인물 목록</Text></TabsContent>
  </Tabs>
)

export const Variants: Story = { render: () => <Stack gap="comfortable"><Demo /><Demo variant="line" /></Stack> }
export const Vertical: Story = { render: () => <Demo orientation="vertical" /> }
export const Disabled: Story = { render: () => <Demo disabled /> }
