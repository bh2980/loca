import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

/**
 * The one row above a table: search and view switches on the left, then (right) a count and the
 * screen's own actions. Every list uses it, so they all read the same way.
 */
export function Toolbar({ children, count, actions, className }: { children?: ReactNode; count?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2', className)}>
      {children}
      <div className="ml-auto flex items-center gap-2">
        {count != null && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
        {actions}
      </div>
    </div>
  );
}

/** How long typing pauses before a search is applied. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The one search box: the list filters as you type (applied after a short pause, never mid-IME
 * composition) and Esc or the clear button resets it at once. Callers write the value to the URL
 * with `replace: true`, so typing adds no history entries.
 */
export function SearchInput({ value, onChange, placeholder, className, end }: { value?: string; onChange: (value: string | undefined) => void; placeholder: string; className?: string; end?: ReactNode }) {
  const [text, setText] = useState(value ?? '');
  const sent = useRef(value || undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const composing = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // A value that did not come from here (a link, Back, a cleared filter) replaces the text.
  useEffect(() => {
    if ((value || undefined) !== sent.current) {
      clearTimeout(timer.current);
      sent.current = value || undefined;
      setText(value ?? '');
    }
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = (next: string) => {
    const trimmed = next.trim() || undefined;
    if (trimmed === sent.current) return;
    sent.current = trimmed;
    onChangeRef.current(trimmed);
  };
  const schedule = (next: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), SEARCH_DEBOUNCE_MS);
  };
  const clear = () => {
    clearTimeout(timer.current);
    setText('');
    apply('');
  };
  return (
    <InputGroup className={cn('h-8 w-64', className)}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          if (!composing.current) schedule(event.target.value);
        }}
        onCompositionStart={() => {
          composing.current = true;
          clearTimeout(timer.current);
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          schedule(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text) {
            event.stopPropagation();
            clear();
          }
        }}
      />
      {(text || end) && (
        <InputGroupAddon align="inline-end" className="text-xs tabular-nums">
          {end}
          {text && (
            <InputGroupButton size="icon-xs" aria-label="지우기" onClick={clear}>
              <X />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/** Server paging under a table: range, then previous / next. Hidden when everything fits on one page. */
export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2">
      <span className="text-xs text-muted-foreground tabular-nums">
        {(page * pageSize + 1).toLocaleString()}–{Math.min(total, (page + 1) * pageSize).toLocaleString()} / {total.toLocaleString()}
      </span>
      <Button variant="outline" size="icon" aria-label="이전 페이지" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="icon" aria-label="다음 페이지" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight />
      </Button>
    </div>
  );
}

export interface FilterChip {
  key: string;
  label: ReactNode;
  /** Plain text for the clear button's name when the label is not text. */
  name?: string;
  clear: () => void;
}

/** The filters that are set, as removable chips next to the search (same look as the script list's). */
export function FilterChips({ chips }: { chips: FilterChip[] }) {
  return chips.map((chip) => (
    <Button key={chip.key} variant="secondary" onClick={chip.clear} aria-label={`${chip.name ?? chip.label} 필터 지우기`}>
      {chip.label} <X />
    </Button>
  ));
}
