import type { ReactNode } from 'react';
import { HEADER_ACTIONS_ID, HEADER_VIEWS_ID, PAGE_HEADING_ID } from './page';

export function PageHeader({ title, leading, tools }: { title: ReactNode; leading?: ReactNode; tools?: ReactNode }) {
  return <header className="flex h-12 shrink-0 items-center gap-3 border-b border-default bg-page px-4">
    {leading}
    <div className="relative flex min-w-0 items-center gap-2">
      <div id={PAGE_HEADING_ID} className="peer flex min-w-0 items-center gap-2 empty:hidden" />
      <h1 className="truncate text-base font-semibold peer-[:not(:empty)]:hidden">{title}</h1>
    </div>
    <div id={HEADER_VIEWS_ID} className="flex shrink-0 items-center gap-2 border-l border-default pl-3 empty:hidden" />
    <div id={HEADER_ACTIONS_ID} className="ml-auto flex min-w-0 items-center gap-2" />
    {tools}
  </header>;
}
