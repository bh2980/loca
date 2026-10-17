import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { compileFormatRules, FORMAT_PRESET_IDS, FORMAT_PRESETS, formatPatternError, matchTokens, type FormatRules } from '@tw/shared';
import { Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, SettingsSection } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';

const KIND = { placeholder: '자리표시자', tag: '서식 태그' } as const;

/**
 * Which tokens the format check treats as placeholders and tags for this game. Common families
 * are checkboxes; anything else is a regular expression. A sample box shows what gets matched.
 */
export function FormatRulesSection({ projectId, rules }: { projectId: string; rules: FormatRules }) {
  const { draft, setDraft, dirty, reset, conflicts, keepMine, takeSaved } = useFormFrom<FormatRules>(rules, `format-rules.${projectId}`);
  const [sample, setSample] = useState('Hello {name}, %d left. <b>[PLAYER]</b> \\N[1]');
  const invalid = draft.custom.some((rule) => !rule.pattern.trim() || formatPatternError(rule.pattern));
  const compiled = compileFormatRules({ ...draft, custom: draft.custom.filter((rule) => rule.pattern.trim()) });
  const found = { placeholder: matchTokens(sample, compiled.placeholder), tag: matchTokens(sample, compiled.tag) };

  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { formatRules: draft } })),
    onSuccess: () => toast.success('형식 규칙을 저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  const togglePreset = (id: (typeof FORMAT_PRESET_IDS)[number], on: boolean) =>
    setDraft((current) => ({ ...current, presets: on ? [...new Set([...current.presets, id])] : current.presets.filter((preset) => preset !== id) }));
  const setRule = (index: number, patch: Partial<FormatRules['custom'][number]>) => setDraft((current) => ({ ...current, custom: current.custom.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) }));

  return (
    <SettingsSection
      title="형식 규칙"
      description="형식 검사(워크플로의 형식 검사 함수, 대사 패널)가 원문과 번역에서 같은 개수만큼 있어야 하는 토큰을 무엇으로 볼지 정합니다. 이 게임 문자열에 쓰이는 형식만 켜세요. 대괄호 변수와 BBCode는 비슷하게 생겼으니 둘 중 하나만 켜는 것이 좋습니다."
    >
      {conflicts.length > 0 && <ChangedElsewhere onTakeSaved={takeSaved} onKeepMine={keepMine} />}
      <div className="grid gap-2 sm:grid-cols-2">
        {FORMAT_PRESET_IDS.map((id) => {
          const preset = FORMAT_PRESETS[id];
          return (
            <label key={id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <Checkbox className="mt-0.5" checked={draft.presets.includes(id)} onCheckedChange={(checked) => togglePreset(id, Boolean(checked))} />
              <span className="min-w-0">
                {preset.label} <span className="text-xs text-muted-foreground">· {KIND[preset.kind]}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{preset.example}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">직접 추가 (정규식)</p>
        {draft.custom.map((rule, index) => {
          const error = rule.pattern.trim() ? formatPatternError(rule.pattern) : '패턴을 입력하세요.';
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input className="w-32" placeholder="이름" value={rule.label} onChange={(event) => setRule(index, { label: event.target.value })} />
                <Select value={rule.kind} onValueChange={(kind) => setRule(index, { kind: kind as 'placeholder' | 'tag' })}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="placeholder">자리표시자</SelectItem>
                    <SelectItem value="tag">서식 태그</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="flex-1 font-mono text-xs" placeholder="예: @[a-z]+@" value={rule.pattern} spellCheck={false} onChange={(event) => setRule(index, { pattern: event.target.value })} />
                <Button size="icon" variant="ghost" className="text-destructive" aria-label="규칙 삭제" onClick={() => setDraft((current) => ({ ...current, custom: current.custom.filter((_, i) => i !== index) }))}>
                  <Trash2 />
                </Button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          );
        })}
        <Button variant="outline" onClick={() => setDraft((current) => ({ ...current, custom: [...current.custom, { label: '', kind: 'placeholder', pattern: '' }] }))}>
          <Plus /> 규칙 추가
        </Button>
      </div>

      <div className="space-y-1.5 rounded-md bg-muted/40 p-3">
        <p className="text-xs font-medium">시험해 보기</p>
        <Textarea className="min-h-16 bg-background font-mono text-xs" value={sample} onChange={(event) => setSample(event.target.value)} />
        {(['placeholder', 'tag'] as const).map((kind) => (
          <p key={kind} className="text-xs">
            <span className="text-muted-foreground">{KIND[kind]}: </span>
            {found[kind].length ? found[kind].map((token, i) => <code key={i} className="mr-1 rounded bg-background px-1 py-0.5 ring-1 ring-border">{token}</code>) : <span className="text-muted-foreground">없음</span>}
          </p>
        ))}
      </div>

      <div className="flex gap-2">
        <Button disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={reset}>
            되돌리기
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
