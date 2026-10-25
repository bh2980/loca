import type { Meta, StoryObj } from "@storybook/react-vite"
import { ServerNotice } from "./server-notice"

const meta: Meta<typeof ServerNotice> = { title: "App/ServerNotice", component: ServerNotice }
export default meta

export const Connecting: StoryObj<typeof ServerNotice> = { args: { children: "서버에 연결하는 중…" } }
