import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Spinner } from "./spinner"

const meta = { title: "Controls/Spinner", component: Spinner } satisfies Meta<typeof Spinner>
export default meta
type Story = StoryObj<typeof meta>

export const Sizes: Story = { render: () => <Inline gap="comfortable"><Spinner /><Spinner size="xs" /></Inline> }
export const Tones: Story = { render: () => <Inline gap="comfortable"><Spinner /><Spinner tone="accent" /></Inline> }
export const WithLabel: Story = { render: () => <Inline gap="condensed"><Spinner size="xs" /><Text variant="caption" tone="muted">번역 중…</Text></Inline> }
