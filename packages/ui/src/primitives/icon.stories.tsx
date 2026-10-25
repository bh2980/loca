import type { Meta, StoryObj } from "@storybook/react-vite"
import { ChevronRight, Inbox } from "lucide-react"
import { Icon } from "./icon"
import { Inline, Stack } from "./stack"
import { Text } from "./text"

const meta = { title: "Primitives/Icon", component: Icon, args: { icon: Inbox } } satisfies Meta<typeof Icon>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** xs 12px, sm 14px, md 16px; with no size the icon takes the size of the control around it. */
export const Sizes: Story = {
  render: () => (
    <Inline gap="comfortable">
      <Icon icon={Inbox} size="xs" />
      <Icon icon={Inbox} size="sm" />
      <Icon icon={Inbox} size="md" />
    </Inline>
  ),
}

export const Tones: Story = {
  render: () => (
    <Inline gap="comfortable">
      {(["default", "muted", "subtle", "accent", "danger", "warning", "success"] as const).map((tone) => <Icon key={tone} icon={Inbox} size="md" tone={tone} aria-label={tone} />)}
    </Inline>
  ),
}

/** A chevron that turns when its section opens: by prop, or by the data-state of a `group` parent. */
export const Turning: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline gap="condensed"><Icon icon={ChevronRight} size="sm" turn={false} /><Text variant="caption" tone="muted">닫힘</Text></Inline>
      <Inline gap="condensed"><Icon icon={ChevronRight} size="sm" turn /><Text variant="caption" tone="muted">열림</Text></Inline>
    </Stack>
  ),
}

export const Faded: Story = {
  render: () => (
    <Inline gap="comfortable">
      <Icon icon={Inbox} size="md" />
      <Icon icon={Inbox} size="md" opacity={50} />
    </Inline>
  ),
}
