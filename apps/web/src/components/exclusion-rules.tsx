import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { EXCLUSION_REASON_LABELS, exclusionReason, formatPatternError, type ExclusionRules, type FormatRules } from '@tw/shared';
import { Button, Field, FieldContent, FieldDescription, FieldLabel, GroupHeading, Input, SettingsSection, Switch } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';

const SWITCHES: { key: 'empty' | 'formatOnly' | 'noLetters' | 'noSourceScript'; label: string; description: string }[] = [
  { key: 'empty', label: '빈 원문', description: '비었거나 공백·줄바꿈뿐인 원문' },
  { key: 'formatOnly', label: '서식만 있는 원문', description: '위 서식 규칙의 치환자·태그를 빼면 아무것도 남지 않는 원문 ({0}, <br>)' },
  { key: 'noLetters', label: '글자 없는 원문', description: '숫자·기호·구두점뿐인 원문 (..., 100%, —)' },
  { key: 'noSourceScript', label: '원문 언어 글자가 없는 원문', description: '원문 언어의 글자가 하나도 없는 원문 (영어 대본의 일본어 줄). 다른 글자로 된 이름도 번역할 수 있으니 기본은 끔' },
];

/**
 * 번역 제외: which extracted lines are not for translation. They leave progress, the remaining lines,
 * runs, exports and checks; each line can still be set by hand in its details.
 */
export function ExclusionRulesSection({ projectId, rules, formatRules, sourceLanguage, excludedCount }: { projectId: string; rules: ExclusionRules; formatRules: FormatRules; sourceLanguage: string; excludedCount: number }) {
  const { draft, setDraft, dirty, reset, conflicts, keepMine, takeSaved } = useFormFrom<ExclusionRules>(rules, `exclusion-rules.${projectId}`);
  const [sample, setSample] = useState('');
  const invalid = draft.patterns.some((rule) => !rule.pattern.trim() || formatPatternError(rule.pattern));
  const usable = { ...draft, patterns: draft.patterns.filter((rule) => rule.pattern.trim() && !formatPatternError(rule.pattern)) };
  const sampleReason = sample ? exclusionReason(sample, formatRules, usable, sourceLanguage) : null;

  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { exclusionRules: draft } })),
    onSuccess: () => toast.success('번역 제외 규칙을 저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  const setPattern = (index: number, patch: Partial<ExclusionRules['patterns'][number]>) =>
    setDraft((current) => ({ ...current, patterns: current.patterns.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) }));

  return (
    <SettingsSection
      title="번역 제외"
      description="번역할 대상이 아닌 원문. 진행률·남은 줄·실행·내보내기·검사에서 빠지고, 번역은 건드리지 않습니다. 줄마다 상세에서 직접 정할 수도 있습니다."
      headerActions={
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ marks: ['excluded'] }} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          지금 {excludedCount.toLocaleString()}줄 제외
        </Link>
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
        {SWITCHES.map((item) => (
          <Field key={item.key} orientation="horizontal">
            <Switch id={`exclusion-${item.key}`} checked={draft[item.key]} onCheckedChange={(on) => setDraft((current) => ({ ...current, [item.key]: on }))} />
            <FieldContent>
              <FieldLabel htmlFor={`exclusion-${item.key}`}>{item.label}</FieldLabel>
              <FieldDescription>{item.description}</FieldDescription>
            </FieldContent>
          </Field>
        ))}

        <div className="space-y-2">
          <GroupHeading>제외 패턴</GroupHeading>
          <p className="text-xs text-muted-foreground">원문이 이 정규식에 맞으면 뺍니다. 예: 개발용 키 ^[A-Z0-9_]+$</p>
          {draft.patterns.map((rule, index) => {
            const error = rule.pattern.trim() ? formatPatternError(rule.pattern) : '패턴을 입력하세요.';
            return (
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input className="w-32" placeholder="이름" value={rule.label} onChange={(event) => setPattern(index, { label: event.target.value })} />
                  <Input className="flex-1 font-mono text-sm" placeholder="예: ^[A-Z0-9_]+$" value={rule.pattern} spellCheck={false} onChange={(event) => setPattern(index, { pattern: event.target.value })} />
                  <Button size="icon" variant="ghost" className="text-destructive" aria-label="패턴 삭제" onClick={() => setDraft((current) => ({ ...current, patterns: current.patterns.filter((_, i) => i !== index) }))}>
                    <Trash2 />
                  </Button>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
            );
          })}
          <Button variant="outline" onClick={() => setDraft((current) => ({ ...current, patterns: [...current.patterns, { label: '', pattern: '' }] }))}>
            <Plus /> 패턴 추가
          </Button>
        </div>

        <div className="space-y-1.5 rounded-md bg-muted p-3">
          <GroupHeading>시험</GroupHeading>
          <Input className="bg-background font-mono text-sm" placeholder="원문을 넣어 보세요" value={sample} onChange={(event) => setSample(event.target.value)} />
          {sample && <p className="text-sm">{sampleReason ? <>제외: <span className="font-medium">{EXCLUSION_REASON_LABELS[sampleReason]}</span></> : <span className="text-muted-foreground">번역 대상</span>}</p>}
        </div>
      </div>
    </SettingsSection>
  );
}
