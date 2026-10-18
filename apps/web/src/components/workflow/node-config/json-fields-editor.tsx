/** Editor for a list of JSON fields (name / type / description, lists nest): an AI node's JSON output and a script's `data`. */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { JSON_FIELD_TYPES, JSON_FIELD_TYPE_LABELS, jsonFieldSchema, type JsonField, type JsonFieldType } from '@tw/shared';
import { Button, ControlIdContext, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea } from '@loca/ui';
import { Field } from '@/components/workflow/node-config/shared';

const fieldsSchema = z.array(jsonFieldSchema);

/** One field per two lines (name · type · menu, then the description at full width); a list's fields sit one step in, behind a rule. */
function FieldRows({ fields, descriptionPlaceholder, onChange }: { fields: JsonField[]; descriptionPlaceholder: string; onChange: (fields: JsonField[]) => void }) {
  const setField = (index: number, patch: Partial<JsonField>) => onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...fields];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    onChange(next);
  };
  const add = () => onChange([...fields, { name: `field${fields.length + 1}`, type: 'string', description: '' }]);
  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div key={index} className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Input className="h-7 min-w-0 flex-1 font-mono text-xs" value={field.name} placeholder="name" aria-label={`필드 ${index + 1} 이름`} onChange={(event) => setField(index, { name: event.target.value })} />
            <Select
              value={field.type}
              onValueChange={(value) => {
                const type = value as JsonFieldType;
                const { fields: children, ...rest } = field;
                onChange(fields.map((item, i) => (i === index ? { ...rest, type, ...(type === 'list' && { fields: children ?? [{ name: 'item', type: 'string', description: '' }] }) } : item)));
              }}
            >
              <SelectTrigger size="sm" className="w-28 shrink-0" aria-label={`필드 ${index + 1} 형식`}><SelectValue /></SelectTrigger>
              <SelectContent>{JSON_FIELD_TYPES.map((type) => <SelectItem key={type} value={type}>{JSON_FIELD_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground" aria-label={`${field.name || '필드'} 메뉴`}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /> 위로</DropdownMenuItem>
                <DropdownMenuItem disabled={index === fields.length - 1} onClick={() => move(index, 1)}><ArrowDown /> 아래로</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onChange(fields.filter((_, i) => i !== index))}><Trash2 /> 삭제</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Textarea rows={1} className="field-sizing-content min-h-7 resize-none text-xs" value={field.description} placeholder={descriptionPlaceholder} aria-label={`필드 ${index + 1} 설명`} onChange={(event) => setField(index, { description: event.target.value })} />
          {field.type === 'list' && (
            <div className="mt-2 border-l border-border pl-3">
              <FieldRows fields={field.fields ?? []} descriptionPlaceholder={descriptionPlaceholder} onChange={(children) => setField(index, { fields: children })} />
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
          <FieldRows fields={fields} descriptionPlaceholder={descriptionPlaceholder} onChange={onChange} />
        )}
      </ControlIdContext.Provider>
    </Field>
  );
}
