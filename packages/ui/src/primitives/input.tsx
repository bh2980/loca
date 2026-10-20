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
