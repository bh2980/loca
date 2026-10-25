import { useId, useMemo, type ComponentProps, type ReactNode } from "react"
import { cva } from "class-variance-authority"
import { cn } from "../lib/utils"
import { STYLE } from "../primitives/style"
import { ControlIdContext } from "../controls/control-id"
import { Label } from "../controls/label"
import { HelpTip } from "../controls/tooltip"

/**
 * The one field family: a control with its label, and what to know about it.
 *
 * Two ways to write a field, same parts:
 * - `<Field label="모델" description="..." help="..." error="..." action={...}>{control}</Field>`: the field of a pane, always the same
 *   shape in a ~360px column: a small label over the control, then a one-line description or error. `action` sits right of the label
 *   (a small button or switch). Two kinds of explanation, never mixed: `description` (shown) says how to fill it in (a format, what empty
 *   means); `help` (a ? beside the label) says what the setting is and what changing it does. `width` fixes the width by size name for a
 *   field in a row of fields. Read-only values use `KeyValue` instead.
 * - `<Field><Field.Label/>{control}<Field.Description/></Field>`: a field of a settings form, with `orientation="horizontal"` for a
 *   switch or checkbox before its label. `Field.Group` stacks the fields of a form (`nested` indents them under the switch they belong
 *   to, `lead` leaves room above), `Field.Content` is the label and description beside a control, `Field.Set` switches off the fields it
 *   holds together.
 */
function FieldRoot(props: FieldProps) {
  return isLabelled(props) ? <LabelledField {...props} /> : <FormField {...props} />
}

function isLabelled(props: FieldProps): props is LabelledFieldProps {
  return "label" in props && props.label !== undefined
}

interface LabelledFieldProps {
  label: ReactNode
  description?: ReactNode
  help?: ReactNode
  error?: ReactNode
  action?: ReactNode
  children: ReactNode
  /** A fixed width, by size name (`field-lg`), for a field in a row of fields. */
  width?: keyof typeof STYLE.width
}

type FormFieldProps = Omit<ComponentProps<"div">, "className"> & { orientation?: "vertical" | "horizontal"; label?: undefined }

export type FieldProps = LabelledFieldProps | FormFieldProps

function LabelledField({ label, description, help, error, action, children, width }: LabelledFieldProps) {
  const id = useId()
  return (
    <div className={cn("min-w-0 space-y-1.5", width && STYLE.width[width])}>
      <div className="flex min-h-5 min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <label htmlFor={id} className="min-w-0 truncate text-xs text-muted">
            {label}
          </label>
          {help && <HelpTip>{help}</HelpTip>}
        </span>
        {action}
      </div>
      <ControlIdContext.Provider value={id}>{children}</ControlIdContext.Provider>
      {error ? <p className="text-xs text-danger">{error}</p> : description ? <p className="text-xs text-muted">{description}</p> : null}
    </div>
  )
}

const formFieldVariants = cva("group/field flex w-full gap-3 data-[invalid=true]:text-danger", {
  variants: {
    orientation: {
      vertical: ["flex-col [&>*]:w-full [&>.sr-only]:w-auto"],
      horizontal: [
        "flex-row items-center",
        "[&>[data-slot=field-label]]:flex-auto",
        "has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      ],
    },
  },
  defaultVariants: { orientation: "vertical" },
})

function FormField({ orientation = "vertical", ...props }: FormFieldProps) {
  return <div role="group" data-slot="field" data-orientation={orientation} className={formFieldVariants({ orientation })} {...props} />
}

function FieldContent(props: Omit<ComponentProps<"div">, "className">) {
  return <div data-slot="field-content" className="group/field-content flex flex-1 flex-col gap-1.5 leading-snug" {...props} />
}

/** `choice` is the label of a checkbox or switch on its own line: body size, normal weight, no field styling. */
function FieldLabel({ variant = "field", children, ...props }: Omit<ComponentProps<typeof Label>, "className"> & { variant?: "field" | "choice" }) {
  if (variant === "choice") return <Label className="text-sm font-normal" {...props}>{children}</Label>
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit gap-2 text-xs font-normal leading-snug text-muted group-data-[orientation=horizontal]/field:text-sm group-data-[orientation=horizontal]/field:text-default group-data-[disabled=true]/field:opacity-50",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>*]:data-[slot=field]:p-4",
        "has-data-[state=checked]:border-accent has-data-[state=checked]:bg-accent/5 dark:has-data-[state=checked]:bg-accent/10"
      )}
      {...props}
    >
      {children}
    </Label>
  )
}

/** `attached`: a note right under the control it explains (touches the control, unlike a field's own description). */
function FieldDescription({ attached, ...props }: Omit<ComponentProps<"p">, "className"> & { attached?: boolean }) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-sm leading-normal font-normal text-muted group-has-[[data-orientation=horizontal]]/field:text-balance",
        "last:mt-0 nth-last-2:-mt-1 [[data-variant=legend]+&]:-mt-1.5",
        "[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-accent",
        attached && "mt-1"
      )}
      {...props}
    />
  )
}

function FieldError({
  children,
  errors,
  ...props
}: Omit<ComponentProps<"div">, "className"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [...new Map(errors.map((error) => [error?.message, error])).values()]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map((error, index) => error?.message && <li key={index}>{error.message}</li>)}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div role="alert" data-slot="field-error" className="text-sm font-normal text-danger" {...props}>
      {content}
    </div>
  )
}

/**
 * The fields of a form. `gap` is the space between fields (wide 32px, comfortable 16px); `nested` indents them under the switch they
 * belong to with a rule on its left; `lead` leaves room above (a group that opens under its trigger).
 */
function FieldGroup({ gap = "comfortable", nested, lead, ...props }: Omit<ComponentProps<"div">, "className"> & { gap?: "wide" | "comfortable"; nested?: boolean; lead?: boolean }) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "group/field-group @container/field-group flex w-full flex-col data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4",
        gap === "wide" ? "gap-8" : "gap-4",
        nested && "border-l border-subtle pl-4",
        lead && "pt-3"
      )}
      {...props}
    />
  )
}

/** A set of fields that is switched off together (`disabled`). */
function FieldSet(props: Omit<ComponentProps<"fieldset">, "className">) {
  return <fieldset className="min-w-0" {...props} />
}

export const Field = Object.assign(FieldRoot, {
  Label: FieldLabel,
  Description: FieldDescription,
  Error: FieldError,
  Content: FieldContent,
  Group: FieldGroup,
  Set: FieldSet,
})
