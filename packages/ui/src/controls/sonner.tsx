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
        info: <Info className="size-3.5" />,
        warning: <AlertTriangle className="size-3.5 text-warning" />,
        error: <AlertCircle className="size-3.5 text-danger" />,
        loading: <Loader2 className="size-3.5 animate-spin text-muted" />,
      }}
      style={
        {
          "--normal-bg": "var(--background-color-overlay)",
          "--normal-text": "var(--text-color-default)",
          "--normal-border": "var(--border-color-default)",
          "--border-radius": "var(--radius-sm)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
