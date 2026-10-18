/** Editor for a list of JSON fields (name / type / description): an AI node's JSON output and a script's `data`. */
import { Plus, Trash2 } from 'lucide-react';
import type { JsonField } from '@tw/shared';
import { Button, ControlIdContext, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@loca/ui';

export function JsonFieldsEditor({ fields, descriptionPlaceholder, onChange }: { fields: JsonField[]; descriptionPlaceholder: string; onChange: (fields: JsonField[]) => void }) {
  const setField = (index: number, patch: Partial<JsonField>) => onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  return (
    <ControlIdContext.Provider value={undefined}>
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={index} className="flex min-w-0 items-center gap-1.5">
            <Input className="h-8 w-28 shrink-0 font-mono text-xs" value={field.name} placeholder="name" aria-label={`필드 ${index + 1} 이름`} onChange={(event) => setField(index, { name: event.target.value })} />
            <Select value={field.type} onValueChange={(value) => setField(index, { type: value as JsonField['type'] })}>
              <SelectTrigger size="sm" className="w-24" aria-label={`필드 ${index + 1} 형식`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="string">문자열</SelectItem><SelectItem value="number">숫자</SelectItem><SelectItem value="boolean">참거짓</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-8 min-w-0 flex-1 text-xs" value={field.description} placeholder={descriptionPlaceholder} aria-label={`필드 ${index + 1} 설명`} onChange={(event) => setField(index, { description: event.target.value })} />
            <Button size="icon" variant="ghost" className="text-destructive" aria-label="필드 삭제" onClick={() => onChange(fields.filter((_, i) => i !== index))}><Trash2 /></Button>
          </div>
        ))}
        <Button variant="outline" onClick={() => onChange([...fields, { name: `field${fields.length + 1}`, type: 'string', description: '' }])}><Plus /> 필드 추가</Button>
      </div>
    </ControlIdContext.Provider>
  );
}
