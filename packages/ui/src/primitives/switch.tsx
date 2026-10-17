import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cn } from "../lib/utils"

function Switch({
  className,
  size = "sm",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "xs" | "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-border/80 bg-input/40 shadow-xs transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        "data-[size=xs]:h-3 data-[size=xs]:w-5",
        "data-[size=sm]:h-4 data-[size=sm]:w-7",
        "data-[size=default]:h-5 data-[size=default]:w-9",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-xs transition-transform",
          "group-data-[size=xs]/switch:size-2 group-data-[size=xs]/switch:data-[state=checked]:translate-x-2 group-data-[size=xs]/switch:data-[state=unchecked]:translate-x-0.5",
          "group-data-[size=sm]/switch:size-3 group-data-[size=sm]/switch:data-[state=checked]:translate-x-3.5 group-data-[size=sm]/switch:data-[state=unchecked]:translate-x-0.5",
          "group-data-[size=default]/switch:size-4 group-data-[size=default]/switch:data-[state=checked]:translate-x-4.5 group-data-[size=default]/switch:data-[state=unchecked]:translate-x-0.5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
