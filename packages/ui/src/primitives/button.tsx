import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/utils.ts';
import { GAP, type StyleProps, splitStyle, styleVariants } from '../layout/style';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium tracking-tight whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        /* The one accent: the screen's primary action (one per screen or pane). */
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
        destructive:
          "bg-destructive text-background hover:bg-destructive/90 focus-visible:ring-destructive/20 active:bg-destructive/85",
        outline:
          "border border-input/60 bg-card text-foreground hover:bg-accent active:bg-chrome",
        secondary:
          "border border-border-subtle bg-chrome text-secondary-foreground hover:bg-accent hover:border-border active:bg-muted",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-chrome",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 py-1.5 rounded-md",
        xs: "h-6 gap-1 rounded-sm px-2 text-2xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 rounded-md px-4 text-sm has-[>svg]:px-3.5 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-8 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9 rounded-md [&_svg:not([class*='size-'])]:size-4",
        inline: "h-auto gap-1 rounded-sm px-1 py-0.5 text-xs font-medium [&_svg:not([class*='size-'])]:size-3",
        row: "h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal whitespace-normal rounded-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
);

/** A button takes the layout options (margin, padding, grow, radius...) and the type options `tone` and `weight` by name; `variant` and `size` are its own. */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants>,
    Omit<StyleProps, 'variant'> {
  asChild?: boolean;
  /** The space between the icon and the label (the size's own when none). */
  gap?: keyof typeof GAP.gap;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "sm", asChild = false, gap, ...allProps }, ref) => {
    const Comp = asChild ? Slot : "button";
    const [style, props] = splitStyle(allProps);
    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className: cn(gap && GAP.gap[gap], styleVariants(style), className) }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
