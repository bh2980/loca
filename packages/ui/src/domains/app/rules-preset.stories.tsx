import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../../primitives/box"
import { Grid } from "../../primitives/grid"
import { Inline, Stack } from "../../primitives/stack"
import { Button } from "../../controls/button"
import { Checkbox } from "../../controls/checkbox"
import { Input } from "../../controls/input"
import { Textarea } from "../../controls/textarea"
import { TextLink } from "../../controls/text-link"
import { Text } from "../../primitives/text"
import { Chip } from "../../patterns/chip"
import { Count } from "../../patterns/count"
import { Notice } from "../../patterns/notice"
import { RulesPresetCard, RulesPresetExample } from "./rules-preset"

const meta = { title: "Domains/App/Rules and chips", decorators: [(Story) => <Box style={{ width: 520 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Format rules: preset cards, a suggestion found in the script, a rule row and the sample box. */
export const FormatRules: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Notice
        variant="banner"
        tone="warning"
        actions={<><Button variant="outline" size="inline" paddingX="condensed">바뀐 내용 불러오기</Button><Button variant="ghost" size="inline" paddingX="condensed">내 수정 유지</Button></>}
      >
        고치는 동안 이 항목이 다른 곳에서 바뀌었습니다. 아래는 아직 저장하지 않은 내 수정입니다.
      </Notice>
      <Grid columns="twoFromSm" gap="condensed">
        <RulesPresetCard>
          <Inline gap="condensed">
            <Checkbox defaultChecked />
            <Text weight="medium" tone="default">중괄호 변수</Text>
            <Box asChild marginLeft="auto"><Count>대본 1,204줄</Count></Box>
          </Inline>
          <RulesPresetExample lead="대본에서 찾은 예" found={["{name}", "{0}"]} fallback="{name}" />
        </RulesPresetCard>
        <RulesPresetCard>
          <Inline gap="condensed">
            <Checkbox />
            <Text weight="medium" tone="default">HTML 태그</Text>
            <Text variant="caption" tone="subtle" marginLeft="auto">미등장</Text>
          </Inline>
          <RulesPresetExample lead="대본에서 찾은 예" found={[]} fallback="<b>굵게</b>" />
        </RulesPresetCard>
      </Grid>
      <Box spaceY="condensed" radius="md" border="all" borderColor="default" background="sunkenTint" padding="normal">
        <Inline justify="between" gap="condensed" radius="base" border="all" borderColor="subtle" background="pageTint" paddingX="cozy" paddingY="snug" variant="body">
          <Text>@name@</Text>
          <Button variant="outline" height="control-xs" paddingX="condensed">+ 추가</Button>
        </Inline>
      </Box>
      <Inline gap="condensed"><Input width="field-md" placeholder="이름" /><Box asChild grow><Input mono variant="body" placeholder="예: @[a-z]+@" /></Box></Inline>
      <Box spaceY="snug" radius="md" background="sunken" padding="normal"><Box asChild minHeight="textarea-xs"><Textarea mono variant="body" defaultValue="Hello {name}" /></Box><Input onSunken mono variant="body" placeholder="원문을 넣어 보세요" /></Box>
      <TextLink href="#x" variant="caption" tone="muted" underline="offset" quiet>지금 12줄 제외</TextLink>
    </Stack>
  ),
}

/** A preset card with the examples found, with none found (the fallback), and with a long example that truncates. */
export const PresetCards: Story = {
  render: () => (
    <Stack gap="condensed">
      <RulesPresetCard>
        <Inline gap="condensed"><Checkbox defaultChecked /><Text weight="medium" tone="default">중괄호 변수</Text></Inline>
        <RulesPresetExample lead="대본에서 찾은 예" found={["{name}", "{0}", "{count}"]} fallback="{name}" />
      </RulesPresetCard>
      <RulesPresetCard>
        <Inline gap="condensed"><Checkbox /><Text weight="medium" tone="default">HTML 태그</Text></Inline>
        <RulesPresetExample lead="대본에서 찾은 예" found={[]} fallback="<b>굵게</b>" />
      </RulesPresetCard>
      <RulesPresetCard>
        <Inline gap="condensed"><Checkbox defaultChecked /><Text weight="medium" tone="default">긴 예시</Text></Inline>
        <RulesPresetExample lead="대본에서 찾은 예" found={["<color=#ff0000>빨간 글씨</color>", "<size=20>큰 글씨</size>", "<i>기울임</i>"]} fallback="" />
      </RulesPresetCard>
    </Stack>
  ),
}

