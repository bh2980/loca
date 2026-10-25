import { usePageTitle } from "@/lib/view-context"
import {
  Page as BasePage,
  ReadingPage,
  HeaderActions,
  HeaderViews,
  HEADER_ACTIONS_ID,
  StatusBarItem,
  type PageProps as BasePageProps,
} from "@loca/ui"

export { HeaderActions, HeaderViews, HEADER_ACTIONS_ID, StatusBarItem }

/** `reading` lays the content in a centered reading column (the project home). */
export function Page({ title, reading, ...props }: BasePageProps & { reading?: boolean }) {
  usePageTitle(title ?? "")
  const Frame = reading ? ReadingPage : BasePage
  return <Frame title={title} {...props} />
}
