import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/utils.ts';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium tracking-tight whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:[stroke-width:1.5px]",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-foreground/90 active:bg-foreground/95",
        indigo:
          "bg-accent-indigo text-accent-indigo-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] hover:opacity-95 active:opacity-90",
        destructive:
          "bg-destructive text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-destructive/90 focus-visible:ring-destructive/20 active:bg-destructive/95",
        outline:
          "border border-border/80 bg-surface-2 text-foreground shadow-2xs hover:bg-surface-1 hover:border-border active:bg-surface-1/80",
        secondary:
          "border border-border-subtle bg-surface-1 text-secondary-foreground hover:bg-surface-2 hover:border-border active:bg-surface-1/90",
        ghost:
          "text-muted-foreground hover:bg-surface-1 hover:text-foreground active:bg-surface-1/80",
        link: "text-accent-indigo underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 py-1.5 rounded-md",
        xs: "h-6 gap-1 rounded-sm px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3 [&_svg]:[stroke-width:1.4px]",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:[stroke-width:1.5px]",
        lg: "h-9 rounded-md px-4 text-sm has-[>svg]:px-3.5 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-8 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3 [&_svg]:[stroke-width:1.4px]",
        "icon-sm": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9 rounded-md [&_svg:not([class*='size-'])]:size-4",
        inline: "h-auto gap-1 rounded-sm px-1 py-0.5 text-xs font-medium [&_svg:not([class*='size-'])]:size-3 [&_svg]:[stroke-width:1.4px]",
        row: "h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal whitespace-normal rounded-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "sm", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
