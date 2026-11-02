import type * as React from "react"
import { Box } from "../../primitives/box"
import { Text } from "../../primitives/text"
import { ExpandableRow } from "../../patterns/expandable-row"
import { Group } from "../../patterns/section"
import { Select, SelectContent, SelectTrigger, SelectValue } from "../../controls/select"
import { Chip, type ChipProps } from "../../patterns/chip"
import { cn } from "../../lib/utils"

/** A select that fills the width of its field: the trigger with the chosen value, the choices (`children`: SelectItem) in the list. */
export function SelectField({ value, onValueChange, ariaLabel, children }: { value?: string; onValueChange?: (value: string) => void; ariaLabel?: string; children: React.ReactNode }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger width="full" aria-label={ariaLabel}><SelectValue /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  )
}

/** A field of a JSON field list read as a row: pulled out past the padding, it highlights on hover and takes a focus ring (it opens the field for editing). */
export function FieldReadRow(props: Omit<React.HTMLAttributes<HTMLDivElement>, "className">) {
  return <div className="-mx-1 min-w-0 cursor-pointer rounded-md px-1 py-1 hover:bg-sunken focus-visible:ring-1 focus-visible:ring-focus focus-visible:outline-none" {...props} />
}

/** The fields of a list field, one step in behind a guide line that is darker while one of them is being edited. */
export function FieldChildren({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return <div className={cn("mt-1 ml-1 border-l-2 pl-2", active ? "border-neutral" : "border-neutral/30")}>{children}</div>
}

/**
 * A tag chip that is a toggle: faint until picked (`faint`), with the `sign` (+ / −) before it once it has a state, struck through when
 * `struck` (it will be taken off). The chip itself is the button.
 */
export function TagToggle({ tag, sign, faint, struck, ...props }: Omit<ChipProps, "as" | "variant" | "size" | "children" | "color" | "tone"> & { tag: { name: string; color: string }; sign?: string; faint?: boolean; struck?: boolean }) {
  return (
    <Chip as="button" variant="bare" {...props}>
      {sign && <Text variant="caption" tone="muted">{sign}</Text>}
      <Box asChild lineThrough={struck}>
        <Chip variant="tint" color={tag.color} faint={faint}>
          #{tag.name}
        </Chip>
      </Box>
    </Chip>
  )
}

/** The 상세 of a request: a folding group like every other (open at first, remembered), its parts below. */
export function RequestDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Group title={title} collapsible persistKey="request.details" spaceY="tight">
      <div>{children}</div>
    </Group>
  )
}

/** One part of a request's details: its name and size are visible, the content opens on demand. */
export function RequestPart({ title, size, children }: { title: string; size: React.ReactNode; children: React.ReactNode }) {
  return (
    <ExpandableRow ruled summary={<span className="font-medium">{title}</span>} meta={size}>
      {children}
    </ExpandableRow>
  )
}
