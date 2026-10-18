import { usePageTitle } from "@/lib/view-context"
import {
  Page as BasePage,
  HeaderActions,
  HEADER_ACTIONS_ID,
  StatusBarItem,
  type PageProps as BasePageProps,
} from "@loca/ui"

export { HeaderActions, HEADER_ACTIONS_ID, StatusBarItem }

export function Page({ title, ...props }: BasePageProps) {
  usePageTitle(title ?? "")
  return <BasePage title={title} {...props} />
}
