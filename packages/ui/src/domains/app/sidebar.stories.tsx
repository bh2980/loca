import type { Meta, StoryObj } from "@storybook/react-vite"
import { FolderOpen, Home, Languages, Settings, Workflow } from "lucide-react"
import { Box } from "../../primitives/box"
import {
  Sidebar,
  SidebarBrand,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuIcon,
  SidebarMenuItem,
  SidebarMenuLabel,
  SidebarProvider,
} from "./sidebar"

const meta = { title: "Domains/App/Sidebar" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Demo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <SidebarProvider open={!collapsed}>
      {/* A transform makes the sidebar's fixed position follow this box. */}
      <Box border="all" borderColor="default" style={{ width: 280, height: 360, transform: "translateZ(0)" }}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarBrand mark="LOCA" compactMark="L" title="번역 작업대" detail="샘플 프로젝트와 아주 긴 이름의 프로젝트" />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel icon={<Languages />}>작업</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem><SidebarMenuButton isActive tooltip="홈"><SidebarMenuIcon><Home /></SidebarMenuIcon><SidebarMenuLabel>홈</SidebarMenuLabel></SidebarMenuButton></SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="대본"><SidebarMenuIcon><FolderOpen /></SidebarMenuIcon><SidebarMenuLabel>대본</SidebarMenuLabel></SidebarMenuButton>
                  <SidebarMenuBadge>12</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem><SidebarMenuButton tooltip="워크플로"><SidebarMenuIcon><Workflow /></SidebarMenuIcon><SidebarMenuLabel>아주 긴 이름의 화면 이름이 줄어드는 모습</SidebarMenuLabel></SidebarMenuButton></SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="설정"><SidebarMenuIcon><Settings /></SidebarMenuIcon><SidebarMenuLabel>설정</SidebarMenuLabel></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
          </SidebarFooter>
        </Sidebar>
      </Box>
    </SidebarProvider>
  )
}

export const Expanded: Story = { render: () => <Demo /> }

/** Collapsed to icons: names hide, the active screen keeps its mark and tooltips take over. */
export const Collapsed: Story = { render: () => <Demo collapsed /> }
