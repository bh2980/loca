import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { TextLink } from "./text-link"

const meta = { title: "Controls/TextLink", component: TextLink, args: { href: "#", children: "문서 보기" } } satisfies Meta<typeof TextLink>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const InText: Story = { render: () => <Text variant="caption">자세한 내용은 <TextLink href="#" underline="offset">용어집 문서</TextLink>를 보세요.</Text> }
export const Underlines: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      {([undefined, "always", "offset", "hover"] as const).map((underline) => <TextLink key={underline ?? "none"} href="#" underline={underline}>underline {underline ?? "없음"}</TextLink>)}
    </Stack>
  ),
}
export const Tones: Story = { render: () => <Stack gap="condensed" align="start"><TextLink href="#">inherit</TextLink><TextLink href="#" tone="muted">muted</TextLink><TextLink href="#" tone="muted" quiet>muted, quiet</TextLink></Stack> }
export const Variants: Story = { render: () => <Stack gap="condensed" align="start"><TextLink href="#" variant="caption">caption</TextLink><TextLink href="#" variant="caption" weight="normal">caption, normal weight</TextLink><TextLink href="#" block>block</TextLink></Stack> }
export const LongText: Story = { render: () => <Stack width="field-lg"><TextLink href="#" underline="offset">아주 긴 이름의 링크는 좁은 폭에서 여러 줄로 감싸집니다</TextLink></Stack> }
