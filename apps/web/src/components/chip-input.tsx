import { useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@loca/ui';
import { cn } from '@/lib/utils';

/**
 * Several short values in one field (forms of address, aliases, people): typing a comma or Enter
 * turns the text into a chip, Backspace on an empty field removes the last one, and values used
 * elsewhere in the project are offered as you type.
 */
export function ChipInput({ id, value, onChange, suggestions = [], placeholder }: { id?: string; value: string[]; onChange: (value: string[]) => void; suggestions?: string[]; placeholder?: string }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const add = (raw: string) => {
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    const next = [...value];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    if (next.length !== value.length) onChange(next);
    setText('');
  };
  const needle = text.trim().toLowerCase();
  const offered = [...new Set(suggestions)].filter((option) => !value.includes(option) && (!needle || option.toLowerCase().includes(needle))).slice(0, 6);

  return (
    <div className="relative">
      <div
        className={cn('flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm shadow-xs', focused && 'border-ring ring-[3px] ring-ring/50')}
        onClick={() => input.current?.focus()}
      >
        {value.map((chip) => (
          <span key={chip} className="inline-flex items-center gap-0.5 rounded bg-muted py-0.5 pr-0.5 pl-2 text-xs">
            {chip}
            <Button variant="ghost" size="icon-xs" aria-label={`${chip} 빼기`} onClick={(event) => (event.stopPropagation(), onChange(value.filter((item) => item !== chip)))}>
              <X />
            </Button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          value={text}
          placeholder={value.length ? undefined : placeholder}
          aria-autocomplete="list"
          aria-controls={listId}
          className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
          onFocus={() => setFocused(true)}
          // Leaving the field keeps what was typed as a chip; the delay lets a suggestion click land first.
          onBlur={() => setTimeout(() => (setFocused(false), text.trim() && add(text)), 120)}
          onChange={(event) => (event.target.value.includes(',') ? add(event.target.value) : setText(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && text.trim()) {
              event.preventDefault();
              add(text);
            } else if (event.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
        />
      </div>
      {focused && offered.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          {offered.map((option) => (
            <li key={option} role="option" aria-selected={false}>
              <Button variant="ghost" size="row" className="text-sm" onMouseDown={(event) => event.preventDefault()} onClick={() => add(option)}>
                {option}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Forms of address are kept as one comma-separated string; these turn it into chips and back. */
export const splitList = (value: unknown) => (typeof value === 'string' ? value.split(',').map((part) => part.trim()).filter(Boolean) : []);
export const joinList = (value: string[]) => value.join(', ');
