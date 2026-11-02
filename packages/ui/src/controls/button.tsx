import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/utils';
import { GAP, type StyleProps, splitStyle, styleVariants } from '../primitives/style';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-md text-xs font-medium tracking-tight whitespace-nowrap transition-all outline-none focus-visible:border-focus focus-visible:ring-[2px] focus-visible:ring-focus/40 disabled:pointer-events-none disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-invalid:border-danger aria-invalid:ring-danger/20 select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        /* The one accent: the screen's primary action (one per screen or pane). */
        default:
          "bg-accent text-on-accent hover:bg-accent/90 active:bg-accent/85",
        destructive:
          "bg-danger text-inverse hover:bg-danger/90 focus-visible:ring-danger/20 active:bg-danger/85",
        outline:
          "border border-input/60 bg-surface text-default hover:bg-hover active:bg-chrome",
        secondary:
          "border border-subtle bg-chrome text-default hover:bg-hover hover:border-default active:bg-sunken",
        ghost:
          "text-muted hover:bg-hover hover:text-default active:bg-chrome",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 py-2 rounded-md",
        xs: "h-6 gap-1 rounded-sm px-2 text-2xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 rounded-md px-4 text-sm has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-8 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9 rounded-md [&_svg:not([class*='size-'])]:size-4",
        inline: "h-auto gap-1 rounded-sm px-1 py-0.5 text-xs font-medium [&_svg:not([class*='size-'])]:size-3",
        row: "h-auto w-full justify-start gap-2 px-2 py-2 text-left font-normal whitespace-normal rounded-sm",
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
  /** Pulls a ghost button out past the space around it so its text or its row lines up: `start` over its own left padding, `block` over its own height above and below (an icon button in a line of text). */
  flush?: 'start' | 'block';
  /** Marks the button as a hover group: an `Icon` with `turn="group"` inside it turns with the button's `data-state`. */
  group?: boolean;
  /** Where the content sits across the button's height when it wraps onto several lines (the start, not the middle). */
  align?: 'start';
  /** Hidden until the row it sits in is hovered or holds focus: `true` for a `ListItem` with `group`, `"row"` for a table row (a `DataTable` row). */
  reveal?: boolean | 'row';
  /** The color a muted button takes under the pointer, when not the default one (a delete). */
  hoverTone?: 'danger';
  /**
   * Turns the button off and says why (no model chosen, nothing to run): the reason is its tooltip
   * and its accessible description. It stays focusable and hoverable so the reason can be read; a
   * click does nothing. Prefer it to `disabled` wherever the reason is not obvious from the screen.
   */
  disabledReason?: string | false | null;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "sm", asChild = false, gap, flush, group, align, reveal, hoverTone, disabledReason, ...allProps }, ref) => {
    const Comp = asChild ? Slot : "button";
    const [style, props] = splitStyle(allProps);
    const reasonId = React.useId();
    const button = (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className: cn(gap && GAP.gap[gap], flush === 'start' && (size === 'inline' ? '-ml-1' : '-ml-2'), flush === 'block' && '-my-1', group && 'group', align === 'start' && 'items-start', reveal === 'row' ? 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100' : reveal && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100', hoverTone === 'danger' && 'hover:text-danger', styleVariants(style), className) }))}
        {...props}
        {...(disabledReason ? {
          disabled: false,
          'aria-disabled': true,
          'aria-describedby': cn(props['aria-describedby'], reasonId),
          // A trigger's own handler (a dialog's, a form's submit) checks for this and stands down.
          onClick: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
        } : {})}
      />
    );
    if (!disabledReason) return button;
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
        {/* The description screen readers read, there whether or not the tooltip is open. */}
        <span id={reasonId} hidden>{disabledReason}</span>
      </>
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
