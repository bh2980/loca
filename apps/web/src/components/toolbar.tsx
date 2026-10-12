import { useEffect, useState, type ReactNode } from 'react';
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

/**
 * Search box whose value lives in the URL: it commits on Enter or when focus leaves, not on every
 * key, so typing does not flood history. A clear button resets it.
 */
export function SearchInput({ value, onChange, placeholder, className }: { value?: string; onChange: (value: string | undefined) => void; placeholder: string; className?: string }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const commit = (next: string) => {
    const trimmed = next.trim() || undefined;
    if (trimmed !== (value || undefined)) onChange(trimmed);
  };
  return (
    <InputGroup className={cn('h-8 w-64', className)}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(text);
          if (event.key === 'Escape' && text) {
            event.stopPropagation();
            setText('');
            commit('');
          }
        }}
        onBlur={() => commit(text)}
      />
      {text && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label="지우기"
            onClick={() => {
              setText('');
              commit('');
            }}
          >
            <X />
          </InputGroupButton>
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
