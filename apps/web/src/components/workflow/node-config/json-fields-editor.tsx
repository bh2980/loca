/** Editor for a list of JSON fields (name / type / description, lists nest): an AI node's JSON output and a script's `data`. */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { JSON_FIELD_TYPES, JSON_FIELD_TYPE_LABELS, jsonFieldSchema, type JsonField, type JsonFieldType } from '@tw/shared';
import { Button, ControlIdContext, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea, cn } from '@loca/ui';
import { Field } from '@/components/workflow/node-config/shared';

const fieldsSchema = z.array(jsonFieldSchema);

type Editing = { path: string | null; open: (path: string | null) => void; folded: Set<string>; fold: (path: string) => void };

/** One field: read as `name` · type over its description; a click opens just this field for editing (Esc or a click elsewhere closes it). */
function FieldItem({ field, path, first, last, descriptionPlaceholder, editing, onChange, onMove, onRemove }: { field: JsonField; path: string; first: boolean; last: boolean; descriptionPlaceholder: string; editing: Editing; onChange: (patch: Partial<JsonField> | JsonField) => void; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  const open = editing.path === path;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element;
      // Menus and select lists render in portals outside the box.
      if (box.current?.contains(target) || target.closest('[data-radix-popper-content-wrapper]')) return;
      editing.open(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, editing.open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${field.name || '필드'} 편집`}
        className="-mx-1.5 min-w-0 cursor-pointer rounded-md px-1.5 py-1 hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        onClick={() => editing.open(path)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editing.open(path); } }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-semibold text-foreground">{field.name || 'name'}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{JSON_FIELD_TYPE_LABELS[field.type]}{field.type === 'list' && editing.folded.has(path) && ` · 필드 ${field.fields?.length ?? 0}개`}</span>
          {field.type === 'list' && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="-my-1 shrink-0 text-muted-foreground"
              aria-label={`${field.name || '목록'} ${editing.folded.has(path) ? '펴기' : '접기'}`}
              aria-expanded={!editing.folded.has(path)}
              onClick={(event) => { event.stopPropagation(); editing.fold(path); }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ChevronRight className={cn('transition-transform', !editing.folded.has(path) && 'rotate-90')} />
            </Button>
          )}
        </div>
        {field.description && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{field.description}</p>}
      </div>
    );
  }
  return (
    <div ref={box} className="-mx-1.5 min-w-0 space-y-1.5 rounded-md bg-muted p-1.5" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); editing.open(null); } }}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Input autoFocus className="h-7 min-w-0 flex-1 font-mono text-xs" value={field.name} placeholder="name" aria-label="이름" onChange={(event) => onChange({ name: event.target.value })} />
        <Select
          value={field.type}
          onValueChange={(value) => {
            const type = value as JsonFieldType;
            const { fields: children, ...rest } = field;
            onChange({ ...rest, type, ...(type === 'list' && { fields: children ?? [{ name: 'item', type: 'string', description: '' }] }) });
          }}
        >
          <SelectTrigger size="sm" className="w-28 shrink-0" aria-label="형식"><SelectValue /></SelectTrigger>
          <SelectContent>{JSON_FIELD_TYPES.map((type) => <SelectItem key={type} value={type}>{JSON_FIELD_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground" aria-label="필드 메뉴"><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={first} onClick={() => onMove(-1)}><ArrowUp /> 위로</DropdownMenuItem>
            <DropdownMenuItem disabled={last} onClick={() => onMove(1)}><ArrowDown /> 아래로</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => { editing.open(null); onRemove(); }}><Trash2 /> 삭제</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Textarea rows={1} className="field-sizing-content min-h-7 resize-none text-xs" value={field.description} placeholder={descriptionPlaceholder} aria-label="설명" onChange={(event) => onChange({ description: event.target.value })} />
    </div>
  );
}

/** A list of fields; a list field's own fields sit one step in, behind a guide line. */
function FieldRows({ fields, descriptionPlaceholder, path, editing, onChange }: { fields: JsonField[]; descriptionPlaceholder: string; path: string; editing: Editing; onChange: (fields: JsonField[]) => void }) {
  const setField = (index: number, next: Partial<JsonField> | JsonField) => onChange(fields.map((field, i) => (i === index ? ('type' in next && 'name' in next && 'description' in next ? (next as JsonField) : { ...field, ...next }) : field)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...fields];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    onChange(next);
    editing.open(`${path}${index + by}`);
  };
  const add = () => {
    onChange([...fields, { name: `field${fields.length + 1}`, type: 'string', description: '' }]);
    editing.open(`${path}${fields.length}`);
  };
  return (
    <div className="space-y-1">
      {fields.map((field, index) => (
        <div key={index} className="min-w-0">
          <FieldItem
            field={field}
            path={`${path}${index}`}
            first={index === 0}
            last={index === fields.length - 1}
            descriptionPlaceholder={descriptionPlaceholder}
            editing={editing}
            onChange={(next) => setField(index, next)}
            onMove={(by) => move(index, by)}
            onRemove={() => onChange(fields.filter((_, i) => i !== index))}
          />
          {field.type === 'list' && !editing.folded.has(`${path}${index}`) && (
            <div className={cn('mt-1 ml-1 border-l-2 pl-3', editing.path?.startsWith(`${path}${index}.`) ? 'border-muted-foreground' : 'border-muted-foreground/30')}>
              <FieldRows fields={field.fields ?? []} descriptionPlaceholder={descriptionPlaceholder} path={`${path}${index}.`} editing={editing} onChange={(children) => setField(index, { fields: children })} />
            </div>
          )}
        </div>
      ))}
      <Button variant="ghost" className="-ml-2 text-muted-foreground" onClick={add}><Plus /> 필드</Button>
    </div>
  );
}

/** The 출력 필드 field: the rows, or the same fields as JSON behind the heading's JSON switch. */
export function JsonFieldsEditor({ label, fields, descriptionPlaceholder, onChange }: { label: string; fields: JsonField[]; descriptionPlaceholder: string; onChange: (fields: JsonField[]) => void }) {
  const [asSchema, setAsSchema] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const editing: Editing = {
    path: editingPath,
    open: setEditingPath,
    folded,
    fold: (path) => setFolded((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; }),
  };
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (asSchema) {
      setText(JSON.stringify(fields, null, 2));
      setError(null);
    }
  }, [asSchema]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (value: string) => {
    setText(value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      setError('JSON 형식이 아닙니다.');
      return;
    }
    const result = fieldsSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      setError(`${issue?.path.join('.') || '필드'}: ${issue?.message ?? '올바르지 않습니다.'}`);
      return;
    }
    setError(null);
    onChange(result.data);
  };
  return (
    <Field
      label={label}
      action={
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          JSON
          <Switch checked={asSchema} onCheckedChange={setAsSchema} />
        </label>
      }
    >
      <ControlIdContext.Provider value={undefined}>
        {asSchema ? (
          <div className="space-y-1">
            <Textarea aria-label={`${label} JSON`} spellCheck={false} value={text} className="min-h-40 font-mono text-xs" onChange={(event) => edit(event.target.value)} />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          <FieldRows fields={fields} descriptionPlaceholder={descriptionPlaceholder} path="" editing={editing} onChange={onChange} />
        )}
      </ControlIdContext.Provider>
    </Field>
  );
}
