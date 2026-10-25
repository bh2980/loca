/** Editor for a list of JSON fields (name / type / description, lists nest): an AI node's JSON output and a script's `data`. */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { JSON_FIELD_TYPES, JSON_FIELD_TYPE_LABELS, jsonFieldSchema, type JsonField, type JsonFieldType } from '@tw/shared';
import { Box, Button, ControlIdContext, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, FieldChildren, FieldReadRow, Icon, Inline, Input, NumberInput, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Text, Textarea, Bleed } from '@loca/ui';

const fieldsSchema = z.array(jsonFieldSchema);

/** A field's limits in its read row: 필수, or a number's range. */
const limitsLabel = (field: JsonField) =>
  field.type === 'number'
    ? field.min !== undefined || field.max !== undefined ? `${field.min ?? ''}~${field.max ?? ''}` : ''
    : field.required ? '필수' : '';

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
      <FieldReadRow
        role="button"
        tabIndex={0}
        aria-label={`${field.name || '필드'} 편집`}
        onClick={() => editing.open(path)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editing.open(path); } }}
      >
        <Inline minWidth={0} gap="tight">
          {/* Every row keeps the fold slot so names line up; only a list fills it. */}
          {field.type === 'list' ? (
            <Button
              variant="ghost"
              size="icon-xs"
              flush="block"
              width="icon"
              shrink={false}
              tone="muted"
              aria-label={`${field.name || '목록'} ${editing.folded.has(path) ? '펴기' : '접기'}`}
              aria-expanded={!editing.folded.has(path)}
              onClick={(event) => { event.stopPropagation(); editing.fold(path); }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Icon icon={ChevronRight} turn={!editing.folded.has(path)} />
            </Button>
          ) : <Box as="span" width="icon" shrink={false} />}
          <Text truncate mono variant="body" weight="semibold" tone="default">{field.name || 'name'}</Text>
          <Text marginLeft="tight" shrink={false} variant="caption" tone="muted">{[JSON_FIELD_TYPE_LABELS[field.type], limitsLabel(field), field.type === 'list' && editing.folded.has(path) && `필드 ${field.fields?.length ?? 0}개`].filter(Boolean).join(' · ')}</Text>
        </Inline>
        {field.description && <Text as="p" paddingLeft="comfortable" variant="caption" preserveLines tone="muted">{field.description}</Text>}
      </FieldReadRow>
    );
  }
  return (
    <Bleed ref={box} by="condensed" minWidth={0} spaceY="condensed" radius="md" background="sunken" padding="condensed" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); editing.open(null); } }}>
      <Inline minWidth={0} gap="condensed">
        <Box asChild height="control-sm" minWidth={0} grow mono variant="caption">
          <Input autoFocus value={field.name} placeholder="name" aria-label="이름" onChange={(event) => onChange({ name: event.target.value })} />
        </Box>
        <Select
          value={field.type}
          onValueChange={(value) => {
            const type = value as JsonFieldType;
            const { fields: children, ...rest } = field;
            onChange({ ...rest, type, ...(type === 'list' && { fields: children ?? [{ name: 'item', type: 'string', description: '' }] }) });
          }}
        >
          <Box asChild width="field" shrink={false}><SelectTrigger size="sm" aria-label="형식"><SelectValue /></SelectTrigger></Box>
          <SelectContent>{JSON_FIELD_TYPES.map((type) => <SelectItem key={type} value={type}>{JSON_FIELD_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" shrink={false} tone="muted" aria-label="필드 메뉴"><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={first} onClick={() => onMove(-1)}><ArrowUp /> 위로</DropdownMenuItem>
            <DropdownMenuItem disabled={last} onClick={() => onMove(1)}><ArrowDown /> 아래로</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => { editing.open(null); onRemove(); }}><Trash2 /> 삭제</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Inline>
      <Box asChild fieldSizing="content" minHeight="control-sm" resize="none" variant="caption">
        <Textarea rows={1} value={field.description} placeholder={descriptionPlaceholder} aria-label="설명" onChange={(event) => onChange({ description: event.target.value })} />
      </Box>
      {field.type === 'number' ? (
        <Inline gap="condensed" variant="caption" tone="muted">
          범위
          <Box asChild height="control-sm" width="field-sm" variant="caption"><NumberInput integer={false} optional aria-label="최소" placeholder="최소" value={field.min} onValueChange={(min) => onChange({ min })} /></Box>
          ~
          <Box asChild height="control-sm" width="field-sm" variant="caption"><NumberInput integer={false} optional aria-label="최대" placeholder="최대" value={field.max} onValueChange={(max) => onChange({ max })} /></Box>
        </Inline>
      ) : field.type !== 'boolean' && (
        <Inline as="label" gap="tight" variant="caption" tone="muted">
          <Switch checked={!!field.required} onCheckedChange={(required) => onChange({ required: required || undefined })} />
          필수
        </Inline>
      )}
    </Bleed>
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
    <Box spaceY="tight">
      {fields.map((field, index) => (
        <Box key={index} minWidth={0}>
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
            <FieldChildren active={editing.path?.startsWith(`${path}${index}.`)}>
              <FieldRows fields={field.fields ?? []} descriptionPlaceholder={descriptionPlaceholder} path={`${path}${index}.`} editing={editing} onChange={(children) => setField(index, { fields: children })} />
            </FieldChildren>
          )}
        </Box>
      ))}
      <Button variant="ghost" flush="start" tone="muted" onClick={add}><Plus /> 필드</Button>
    </Box>
  );
}

/** The 출력 필드 field, folded until opened: the rows, or the same fields as JSON behind the heading's JSON switch. */
export function JsonFieldsEditor({ label, fields, descriptionPlaceholder, onChange }: { label: string; fields: JsonField[]; descriptionPlaceholder: string; onChange: (fields: JsonField[]) => void }) {
  const [shown, setShown] = useState(false);
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
    <Box minWidth={0} spaceY="condensed">
      <Inline minHeight="control-sm" minWidth={0} justify="between" gap="condensed">
        <Button variant="ghost" flush="start" minWidth={0} gap="tight" paddingX="condensed" weight="normal" aria-expanded={shown} onClick={() => setShown((value) => !value)}>
          <Icon icon={ChevronRight} turn={shown} />
          {label}
          <Text tone="muted" tabular>{fields.length}</Text>
        </Button>
        {shown && (
          <Inline as="label" shrink={false} gap="tight" variant="caption" tone="muted">
            JSON
            <Switch checked={asSchema} onCheckedChange={setAsSchema} />
          </Inline>
        )}
      </Inline>
      {shown && (
        <ControlIdContext.Provider value={undefined}>
          {asSchema ? (
            <Box spaceY="tight">
              <Box asChild minHeight="textarea" mono variant="caption"><Textarea aria-label={`${label} JSON`} spellCheck={false} value={text} onChange={(event) => edit(event.target.value)} /></Box>
              {error && <Text as="p" variant="caption" tone="danger">{error}</Text>}
            </Box>
          ) : (
            <FieldRows fields={fields} descriptionPlaceholder={descriptionPlaceholder} path="" editing={editing} onChange={onChange} />
          )}
        </ControlIdContext.Provider>
      )}
    </Box>
  );
}
