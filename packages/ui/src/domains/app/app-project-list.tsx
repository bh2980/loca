import { Slot } from "@radix-ui/react-slot"
import { Languages } from "lucide-react"
import type * as React from "react"
import { Card, CardDescription, CardHeader, CardTitle } from "../../patterns/card"

/** The project list page's column: centered, at most 56rem wide, as tall as the window. */
export function ProjectListFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-6 py-12">{children}</div>
}

/** The app's mark beside its name. */
export function BrandMark() {
  return (
    <div className="flex size-8 items-center justify-center rounded-xs bg-accent text-on-accent">
      <Languages className="size-4" />
    </div>
  )
}

/** Makes the one link inside it a focusable card target (rounded, with a focus ring); the card is its child. */
export function ProjectCardLink({ children }: { children: React.ReactNode }) {
  return <Slot className="rounded-md focus-visible:ring-1 focus-visible:ring-focus focus-visible:outline-none">{children}</Slot>
}

/** A project in the list: its name, language pair and line count. */
export function ProjectCard({ name, sourceLanguage, targetLanguage, units }: { name: string; sourceLanguage: string; targetLanguage: string; units: number }) {
  return (
    <Card className="h-full border-default shadow-none transition-colors hover:bg-sunken hover:border-default">
      <CardHeader className="p-4">
        <CardTitle className="truncate text-sm font-semibold">{name}</CardTitle>
        <CardDescription className="flex items-center gap-2 text-xs text-muted">
          <span className="uppercase font-mono">{sourceLanguage}</span>→<span className="uppercase font-mono">{targetLanguage}</span>
          <span>·</span>
          <span className="tabular-nums">대사 {units.toLocaleString()}개</span>
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

/**
 * The home settings page: a left list of grouped links beside the body (no project sidebar, no chat).
 * `brand` is the way back to the project list; `nav` holds `AppSettingsNavGroup`s; the body is a flex column
 * that scrolls inside the page parts it holds.
 */
export function AppSettingsFrame({ brand, nav, children }: { brand: React.ReactNode; nav: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-svh min-h-0 bg-page">
      <nav aria-label="설정" className="flex w-64 shrink-0 flex-col gap-6 overflow-auto border-r border-default bg-sidebar px-3 py-4 text-sidebar">
        <div className="px-2">{brand}</div>
        {nav}
      </nav>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}

/** A titled group of links in the settings list, with an optional one-line note under the title. */
export function AppSettingsNavGroup({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-1 px-2 pb-1">
        <h2 className="text-xs font-medium text-muted">{title}</h2>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  )
}

/** One link in the settings list; the link element is its child (`<Link>`), made a row by this. */
export function AppSettingsNavItem({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <Slot
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-sm ring-focus outline-hidden hover:bg-sidebar-item focus-visible:ring-2 data-[active=true]:bg-sidebar-item data-[active=true]:font-semibold [&>svg]:size-4 [&>svg]:shrink-0"
      >
        {children}
      </Slot>
    </li>
  )
}
