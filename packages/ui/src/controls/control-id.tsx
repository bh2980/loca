import * as React from "react"

/**
 * The id a labelled field gives its control: a form field that renders <Label htmlFor={id}> wraps its
 * control in this, and Input, Textarea and SelectTrigger take the id when they have none of their
 * own, so every control gets its label as its accessible name without each call site wiring ids.
 */
export const ControlIdContext = React.createContext<string | undefined>(undefined)
export const useControlId = (own?: string) => own ?? React.useContext(ControlIdContext)
