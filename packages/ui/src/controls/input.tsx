import * as React from "react";
import { cn } from "../lib/utils";
import { STYLE } from "../primitives/style";
import { useControlId } from "./control-id";

const SIZE = { xs: "h-6", sm: "", default: "h-8" } as const;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Height step: xs 1.5rem, sm 1.75rem (default), default 2rem. */
  size?: keyof typeof SIZE;
  /** A monospace face (a path, a key, a pattern). */
  mono?: boolean;
  /** Text size: caption (default) or body. */
  variant?: "caption" | "body";
  /** A set width (token name); without it the field fills its row. */
  width?: keyof typeof STYLE.width;
  /** Text alignment inside the field. */
  align?: "right";
  /** On a sunken box: takes the page color instead of the surface color. */
  onSunken?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, id, size = "sm", mono, variant, width, align, onSunken, ...props }, ref) => {
    const controlId = useControlId(id);
    return (
      <input
        id={controlId}
        type={type}
        ref={ref}
        data-slot="input"
        className={cn(
          "h-7 w-full min-w-0 rounded-md border border-default bg-surface px-2 py-1 text-xs transition-colors outline-none selection:bg-accent selection:text-on-accent placeholder:text-subtle disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
          "focus-visible:border-accent focus-visible:ring-[1px] focus-visible:ring-accent/40",
          "aria-invalid:border-danger aria-invalid:ring-danger/20",
          SIZE[size],
          mono && "font-mono",
          variant === "body" && "text-sm",
          width && STYLE.width[width],
          align === "right" && "text-right",
          onSunken && "bg-page",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export interface NumberInputProps extends Omit<InputProps, "type" | "value" | "onChange" | "min" | "max"> {
  value: number | null | undefined;
  /** Called with a number within min/max, or undefined when the field is left empty and `optional`. */
  onValueChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  /** Round to whole numbers (default). */
  integer?: boolean;
  /** Empty is a valid value (e.g. "auto", "off"); otherwise leaving it empty puts the last value back. */
  optional?: boolean;
}

/**
 * A number field that lets a person type freely: clearing it or typing past a bound is allowed while
 * typing, a value within the bounds is passed on at once, and leaving the field settles it (clamped,
 * or back to the last value when left empty and not `optional`).
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onValueChange, min, max, integer = true, optional = false, onBlur, onFocus, ...props }, ref) => {
    const [text, setText] = React.useState(value == null ? "" : String(value));
    const editing = React.useRef(false);
    React.useEffect(() => {
      if (!editing.current) setText(value == null ? "" : String(value));
    }, [value]);
    const clamp = (number: number) => {
      const rounded = integer ? Math.round(number) : number;
      return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, rounded));
    };
    return (
      <Input
        ref={ref}
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        min={min}
        max={max}
        value={text}
        onFocus={(event) => {
          editing.current = true;
          onFocus?.(event);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const number = Number(next);
          // Passed on only once it is a value the field would keep.
          if (next.trim() !== "" && Number.isFinite(number) && clamp(number) === number) onValueChange(number);
        }}
        onBlur={(event) => {
          editing.current = false;
          const number = Number(text);
          if (text.trim() === "" || !Number.isFinite(number)) {
            if (optional) onValueChange(undefined);
            else setText(value == null ? "" : String(value));
          } else {
            const settled = clamp(number);
            setText(String(settled));
            if (settled !== value) onValueChange(settled);
          }
          onBlur?.(event);
        }}
        {...props}
      />
    );
  }
);
NumberInput.displayName = "NumberInput";
