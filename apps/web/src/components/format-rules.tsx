import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { compileFormatRules, FORMAT_PRESET_IDS, FORMAT_PRESETS, formatPatternError, matchTokens, type FormatRules } from '@tw/shared';
import { Badge, Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, SettingsSection } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
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

  const detectQuery = useQuery(q.detectFormatRules(projectId));
  const detected = detectQuery.data;

  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { formatRules: draft } })),
    onSuccess: () => toast.success('치환자·태그 문법을 저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });

  const togglePreset = (id: (typeof FORMAT_PRESET_IDS)[number], on: boolean) =>
    setDraft((current) => ({ ...current, presets: on ? [...new Set([...current.presets, id])] : current.presets.filter((preset) => preset !== id) }));
  const setRule = (index: number, patch: Partial<FormatRules['custom'][number]>) =>
    setDraft((current) => ({ ...current, custom: current.custom.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) }));

  const applyAutoDetect = () => {
    if (!detected) return;
    setDraft((current) => {
      const existingPatterns = new Set(current.custom.map((c) => c.pattern));
      const newCustom = (detected.customCandidates ?? [])
        .filter((candidate) => !existingPatterns.has(candidate.pattern))
        .map((c) => ({ label: c.label, kind: c.kind, pattern: c.pattern }));
      return {
        ...current,
        presets: [...new Set([...current.presets, ...detected.recommendedPresets])],
        custom: [...current.custom, ...newCustom],
      };
    });
    toast.success('대본에서 발견된 치환자·태그 문법을 적용했습니다.');
  };

  const placeholderPresets = FORMAT_PRESET_IDS.filter((id) => FORMAT_PRESETS[id].kind === 'placeholder');
  const tagPresets = FORMAT_PRESET_IDS.filter((id) => FORMAT_PRESETS[id].kind === 'tag');

  const renderPresetCard = (id: (typeof FORMAT_PRESET_IDS)[number]) => {
    const preset = FORMAT_PRESETS[id];
    const match = detected?.presets?.find((p) => p.id === id);
    const count = match?.count ?? 0;
    const examples = match?.examples ?? [];
    return (
      <label key={id} className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-sm transition-colors hover:bg-muted/50 cursor-pointer">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={draft.presets.includes(id)}
            onCheckedChange={(checked) => togglePreset(id, Boolean(checked))}
          />
          <span className="font-medium text-foreground">{preset.label}</span>
          {detected ? (
            count > 0 ? (
              <Badge variant="secondary" className="ml-auto text-xs">
                대본 {count.toLocaleString()}줄
              </Badge>
            ) : (
              <span className="ml-auto text-xs text-subtle-foreground">미등장</span>
            )
          ) : null}
        </div>
        <div className="pl-6 font-mono text-xs text-muted-foreground truncate">
          {examples.length > 0 ? examples.join('   ') : preset.example}
        </div>
      </label>
    );
  };

  return (
    <SettingsSection
      title="치환자·태그 문법"
      description="대본 에디터(원문 토큰 하이라이트·클릭 삽입)와 워크플로 형식 검사에서 무엇을 게임 치환자({name}, %s 등)·서식 태그(<b> 등)로 인식할지 정합니다. 개별 검사 항목과 추가 정규식 규칙은 워크플로의 ‘형식 검사’ 노드에서 설정합니다."
      headerActions={
        <Button variant="outline" onClick={applyAutoDetect} disabled={!detected || detectQuery.isPending}>
          <Sparkles className="size-3.5" /> 대본에서 자동 감지
        </Button>
      }
      actions={
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
      }
    >
      {conflicts.length > 0 && <ChangedElsewhere onTakeSaved={takeSaved} onKeepMine={keepMine} />}

      <div className="space-y-4">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-foreground">자리표시자 (변수 · 제어 문자)</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {placeholderPresets.map(renderPresetCard)}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-foreground">서식 태그</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {tagPresets.map(renderPresetCard)}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">직접 추가 (정규식)</p>
          <p className="text-xs text-muted-foreground">이 게임에만 쓰이는 고유한 치환자나 태그 문법을 정규식으로 등록합니다.</p>
        </div>

        {detected?.customCandidates && detected.customCandidates.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">대본에서 발견된 추가 규칙 추천</p>
              <span className="text-xs text-muted-foreground">대본에 규칙적으로 등장하는 패턴입니다</span>
            </div>
            <div className="space-y-1.5">
              {detected.customCandidates.map((cand) => {
                const alreadyAdded = draft.custom.some((c) => c.pattern === cand.pattern);
                return (
                  <div key={cand.pattern} className="flex items-center justify-between gap-2 text-xs rounded border border-border-subtle bg-background/50 px-2.5 py-1.5">
                    <div className="flex min-w-0 items-center gap-2 truncate">
                      <span className="font-medium text-foreground">{cand.label}</span>
                      <code className="font-mono text-xs text-muted-foreground">({cand.pattern})</code>
                      <Badge variant="secondary" className="text-xs">
                        대본 {cand.count.toLocaleString()}줄
                      </Badge>
                      {cand.examples.length > 0 && (
                        <span className="truncate text-muted-foreground">
                          예: {cand.examples.slice(0, 3).join('  ')}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2"
                      disabled={alreadyAdded}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          custom: [...current.custom, { label: cand.label, kind: cand.kind, pattern: cand.pattern }],
                        }));
                        toast.success(`'${cand.label}' 규칙을 추가했습니다.`);
                      }}
                    >
                      {alreadyAdded ? '추가됨' : '+ 추가'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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

      <div className="space-y-1.5 rounded-md bg-muted p-3">
        <p className="text-xs font-medium text-foreground">시험해 보기</p>
        <Textarea className="min-h-16 bg-background font-mono text-xs" value={sample} onChange={(event) => setSample(event.target.value)} />
        {(['placeholder', 'tag'] as const).map((kind) => (
          <p key={kind} className="text-xs">
            <span className="text-muted-foreground">{KIND[kind]}: </span>
            {found[kind].length ? found[kind].map((token, i) => <code key={i} className="mr-1 rounded bg-background px-1 py-0.5 ring-1 ring-border">{token}</code>) : <span className="text-muted-foreground">없음</span>}
          </p>
        ))}
      </div>
    </SettingsSection>
  );
}
