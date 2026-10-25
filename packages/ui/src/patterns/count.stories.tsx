import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline } from "../primitives/stack"
import { Count } from "./count"

const meta = { title: "Patterns/Count", component: Count } satisfies Meta<typeof Count>
export default meta
type Story = StoryObj<typeof meta>

/** neutral: a quiet pill; accent: what waits for you; warning: a mono figure to look at. */
export const Tones: Story = {
  render: () => (
    <Inline gap="condensed">
      <Count>12</Count>
      <Count tone="accent">3건 대기</Count>
      <Count tone="warning">2</Count>
    </Inline>
  ),
}

export const Large: Story = {
  render: () => (
    <Inline gap="condensed">
      <Count>9,000</Count>
      <Count tone="accent">1,240건 대기</Count>
      <Count tone="warning">9,000</Count>
    </Inline>
  ),
}

export const Empty: Story = {
  render: () => <Inline gap="condensed"><Count>0</Count><Count tone="accent">0건 대기</Count></Inline>,
}
