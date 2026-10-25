import type { Meta, StoryObj } from "@storybook/react-vite"
import { ChevronRight } from "lucide-react"
import { Icon } from "../primitives/icon"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Button } from "./button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible"

const meta = { title: "Controls/Collapsible", component: Collapsible } satisfies Meta<typeof Collapsible>
export default meta
type Story = StoryObj<typeof meta>

const Demo = ({ defaultOpen, disabled }: { defaultOpen?: boolean; disabled?: boolean }) => (
  <Collapsible defaultOpen={defaultOpen} disabled={disabled}>
    <CollapsibleTrigger asChild><Button variant="ghost" group><Icon icon={ChevronRight} turn="group" />고급 설정</Button></CollapsibleTrigger>
    <CollapsibleContent><Stack padding="condensed"><Text variant="caption">{"펼쳐진 내용이 여기에 보입니다. ".repeat(3)}</Text></Stack></CollapsibleContent>
  </Collapsible>
)

export const Closed: Story = { render: () => <Demo /> }
export const Open: Story = { render: () => <Demo defaultOpen /> }
export const Disabled: Story = { render: () => <Demo disabled /> }
