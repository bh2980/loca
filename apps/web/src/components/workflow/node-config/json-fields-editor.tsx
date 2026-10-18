/** Editor for a list of JSON fields (name / type / description, lists nest): an AI node's JSON output and a script's `data`. */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { JSON_FIELD_TYPES, JSON_FIELD_TYPE_LABELS, jsonFieldSchema, type JsonField, type JsonFieldType } from '@tw/shared';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, ControlIdContext, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea } from '@loca/ui';

const fieldsSchema = z.array(jsonFieldSchema);

function FieldRows({ fields, descriptionPlaceholder, depth, onChange }: { fields: JsonField[]; descriptionPlaceholder: string; depth: number; onChange: (fields: JsonField[]) => void }) {
  const setField = (index: number, patch: Partial<JsonField>) => onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...fields];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    onChange(next);
  };
  const add = () => onChange([...fields, { name: `field${fields.length + 1}`, type: 'string', description: '' }]);
  return (
    <div className="space-y-2">
      {fields.map((field, index) => (
        <Collapsible key={index} defaultOpen asChild>
          <div className="space-y-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              {field.type === 'list' ? (
                <CollapsibleTrigger asChild>
                  <Button size="icon-sm" variant="ghost" className="group shrink-0" aria-label={`${field.name || '필드'} 하위 필드 접고 펴기`}>
                    <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                  </Button>
                </CollapsibleTrigger>
              ) : <span className="size-7 shrink-0" />}
              <Input className="h-8 w-28 shrink-0 font-mono text-xs" value={field.name} placeholder="name" aria-label={`필드 ${index + 1} 이름`} onChange={(event) => setField(index, { name: event.target.value })} />
              <Select
                value={field.type}
                onValueChange={(value) => {
                  const type = value as JsonFieldType;
                  const { fields: children, ...rest } = field;
                  onChange(fields.map((item, i) => (i === index ? { ...rest, type, ...(type === 'list' && { fields: children ?? [{ name: 'item', type: 'string', description: '' }] }) } : item)));
                }}
              >
                <SelectTrigger size="sm" className="w-32 shrink-0" aria-label={`필드 ${index + 1} 형식`}><SelectValue /></SelectTrigger>
                <SelectContent>{JSON_FIELD_TYPES.map((type) => <SelectItem key={type} value={type}>{JSON_FIELD_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="h-8 min-w-0 flex-1 text-xs" value={field.description} placeholder={descriptionPlaceholder} aria-label={`필드 ${index + 1} 설명`} onChange={(event) => setField(index, { description: event.target.value })} />
              <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label="위로" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp /></Button>
              <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label="아래로" disabled={index === fields.length - 1} onClick={() => move(index, 1)}><ChevronDown /></Button>
              <Button size="icon-sm" variant="ghost" className="shrink-0 text-destructive" aria-label="필드 삭제" onClick={() => onChange(fields.filter((_, i) => i !== index))}><Trash2 /></Button>
            </div>
            {field.type === 'list' && (
              <CollapsibleContent>
                <div className="ml-4 border-l border-border-subtle pl-3">
                  <p className="mb-1.5 text-xs text-muted-foreground">{field.name || '목록'}의 항목마다 채울 필드</p>
                  <FieldRows fields={field.fields ?? []} descriptionPlaceholder={descriptionPlaceholder} depth={depth + 1} onChange={(children) => setField(index, { fields: children })} />
                </div>
              </CollapsibleContent>
            )}
          </div>
        </Collapsible>
      ))}
      <Button variant="outline" onClick={add}><Plus /> {depth ? '하위 필드 추가' : '필드 추가'}</Button>
    </div>
  );
}

export function JsonFieldsEditor({ fields, descriptionPlaceholder, onChange }: { fields: JsonField[]; descriptionPlaceholder: string; onChange: (fields: JsonField[]) => void }) {
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
    <ControlIdContext.Provider value={undefined}>
      <div className="space-y-2">
        <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          JSON 스키마로 편집
          <Switch checked={asSchema} onCheckedChange={setAsSchema} />
        </label>
        {asSchema ? (
          <>
            <Textarea aria-label="필드 JSON 스키마" spellCheck={false} value={text} className="min-h-40 font-mono text-xs" onChange={(event) => edit(event.target.value)} />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </>
        ) : (
          <FieldRows fields={fields} descriptionPlaceholder={descriptionPlaceholder} depth={0} onChange={onChange} />
        )}
      </div>
    </ControlIdContext.Provider>
  );
}
