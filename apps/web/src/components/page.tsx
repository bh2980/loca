import { usePageTitle } from "@/lib/reported-view"
import {
  Page as BasePage,
  HeaderActions,
  HeaderViews,
  StatusBarItem,
  type PageProps as BasePageProps,
} from "@loca/ui"

export { HeaderActions, HeaderViews, StatusBarItem }

/** The app's page: it sets the document title. */
export function Page({ title, ...props }: BasePageProps) {
  usePageTitle(title ?? "")
  return <BasePage title={title} {...props} />
}
