import * as React from "react";
import { cn } from "../lib/utils.ts";
import { useControlId } from "./control-id";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, id, ...props }, ref) => {
    const controlId = useControlId(id);
    return (
      <input
        id={controlId}
        type={type}
        ref={ref}
        data-slot="input"
        className={cn(
          "h-7 w-full min-w-0 rounded-md border border-border bg-card px-2 py-1 text-xs transition-colors outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-subtle-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
          "focus-visible:border-primary focus-visible:ring-[1px] focus-visible:ring-primary/40",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
