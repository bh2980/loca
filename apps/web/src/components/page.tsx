import { usePageTitle } from "@/lib/view-context"
import {
  Page as BasePage,
  HeaderActions,
  HeaderViews,
  HEADER_ACTIONS_ID,
  StatusBarItem,
  type PageProps as BasePageProps,
} from "@loca/ui"

export { HeaderActions, HeaderViews, HEADER_ACTIONS_ID, StatusBarItem }

/** The app's page: it sets the document title. */
export function Page({ title, ...props }: BasePageProps) {
  usePageTitle(title ?? "")
  return <BasePage title={title} {...props} />
}
