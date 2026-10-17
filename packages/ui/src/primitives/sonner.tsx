import * as React from "react"
import {
  CheckCircle2,
  Info,
  Loader2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CheckCircle2 className="size-3.5 text-success" />,
        info: <Info className="size-3.5 text-info" />,
        warning: <AlertTriangle className="size-3.5 text-warning" />,
        error: <AlertCircle className="size-3.5 text-destructive" />,
        loading: <Loader2 className="size-3.5 animate-spin text-muted-foreground" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-sm)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
