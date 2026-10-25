import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { compileFormatRules, FORMAT_PRESET_IDS, FORMAT_PRESETS, formatPatternError, matchTokens, type FormatRules } from '@tw/shared';
import { Box, Button, Checkbox, Icon, Grid, Inline, Count, RulesPresetCard, RulesPresetExample, Select, SelectContent, SelectItem, SelectValue, Stack, Text, Input, SelectTrigger, Textarea, Section, SectionHeading } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { AiRegexInput } from '@/components/ai-regex-input';

const KIND = { placeholder: '치환자', tag: '서식 태그' } as const;

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
      <RulesPresetCard key={id}>
        <Inline gap="condensed">
          <Checkbox
            checked={draft.presets.includes(id)}
            onCheckedChange={(checked) => togglePreset(id, Boolean(checked))}
          />
          <Text weight="medium" tone="default">{preset.label}</Text>
          {detected ? (
            count > 0 ? (
              <Box asChild marginLeft="auto">
                <Count>
                  대본 {count.toLocaleString()}줄
                </Count>
              </Box>
            ) : (
              <Text variant="caption" tone="subtle" marginLeft="auto">미등장</Text>
            )
          ) : null}
        </Inline>
        <RulesPresetExample lead="대본에서 찾은 예" found={examples} fallback={preset.example} />
      </RulesPresetCard>
    );
  };

  return (
    <Section variant="page"
      title="서식 규칙"
      actions={
        <Button variant="outline" onClick={applyAutoDetect} disabled={!detected || detectQuery.isPending}>
          <Icon icon={Sparkles} size="sm" /> 자동 감지
        </Button>
      }
      footer={
        <Stack direction="row" gap="condensed">
          <Button disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
            저장
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={reset}>
              되돌리기
            </Button>
          )}
        </Stack>
      }
    >
      {conflicts.length > 0 && <ChangedElsewhere onTakeSaved={takeSaved} onKeepMine={keepMine} />}

      <Box spaceY="comfortable">
        <Box spaceY="condensed">
          <SectionHeading level="group">치환자</SectionHeading>
          <Grid columns="twoFromSm" gap="condensed">
            {placeholderPresets.map(renderPresetCard)}
          </Grid>
        </Box>

        <Box spaceY="condensed">
          <SectionHeading level="group">서식 태그</SectionHeading>
          <Grid columns="twoFromSm" gap="condensed">
            {tagPresets.map(renderPresetCard)}
          </Grid>
        </Box>
      </Box>

      <Box spaceY="normal">
        <SectionHeading level="group">정규식</SectionHeading>

        <AiRegexInput
          projectId={projectId}
          target="token"
          onRule={(rule) => {
            if (rule.kind !== 'placeholder' && rule.kind !== 'tag') return;
            setDraft((current) => ({ ...current, custom: [...current.custom, { label: rule.label, kind: rule.kind, pattern: rule.pattern }] }));
            toast.success(`'${rule.label}' 규칙을 추가했습니다. 저장해야 적용됩니다.`);
          }}
        />

        {detected?.customCandidates && detected.customCandidates.length > 0 && (
          <Box spaceY="condensed" radius="md" border="all" borderColor="default" background="sunkenTint" padding="normal">
            <Inline justify="between">
              <SectionHeading level="group">추천 규칙</SectionHeading>
            </Inline>
            <Box spaceY="snug">
              {detected.customCandidates.map((cand) => {
                const alreadyAdded = draft.custom.some((c) => c.pattern === cand.pattern);
                return (
                  <Inline key={cand.pattern} justify="between" gap="condensed" radius="base" border="all" borderColor="subtle" background="pageTint" paddingX="cozy" paddingY="snug" variant="body">
                    <Inline gap="condensed" minWidth={0} truncate>
                      <Text weight="medium" tone="default">{cand.label}</Text>
                      <Text as="code" mono variant="caption" tone="muted">({cand.pattern})</Text>
                      <Count>
                        대본 {cand.count.toLocaleString()}줄
                      </Count>
                      {cand.examples.length > 0 && (
                        <Text truncate variant="caption" tone="muted">
                          예: {cand.examples.slice(0, 3).join('  ')}
                        </Text>
                      )}
                    </Inline>
                    <Button
                      variant="outline"
                      height="control-xs"
                      paddingX="condensed"
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
                  </Inline>
                );
              })}
            </Box>
          </Box>
        )}

        {draft.custom.map((rule, index) => {
          const error = rule.pattern.trim() ? formatPatternError(rule.pattern) : '패턴을 입력하세요.';
          return (
            <Box key={index} spaceY="tight">
              <Inline gap="condensed">
                <Input width="field-md" placeholder="이름" value={rule.label} onChange={(event) => setRule(index, { label: event.target.value })} />
                <Select value={rule.kind} onValueChange={(kind) => setRule(index, { kind: kind as 'placeholder' | 'tag' })}>
                  <SelectTrigger width="field">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="placeholder">치환자</SelectItem>
                    <SelectItem value="tag">서식 태그</SelectItem>
                  </SelectContent>
                </Select>
                <Box asChild grow><Input mono variant="body" placeholder="예: @[a-z]+@" value={rule.pattern} spellCheck={false} onChange={(event) => setRule(index, { pattern: event.target.value })} /></Box>
                <Button size="icon" variant="ghost" tone="danger" aria-label="규칙 삭제" onClick={() => setDraft((current) => ({ ...current, custom: current.custom.filter((_, i) => i !== index) }))}>
                  <Trash2 />
                </Button>
              </Inline>
              {error && <Text as="p" variant="caption" tone="danger">{error}</Text>}
            </Box>
          );
        })}
        <Button variant="outline" onClick={() => setDraft((current) => ({ ...current, custom: [...current.custom, { label: '', kind: 'placeholder', pattern: '' }] }))}>
          <Plus /> 규칙 추가
        </Button>
      </Box>

      <Box spaceY="snug" radius="md" background="sunken" padding="normal">
        <SectionHeading level="group">시험</SectionHeading>
        <Box asChild minHeight="textarea-xs"><Textarea mono variant="body" value={sample} onChange={(event) => setSample(event.target.value)} /></Box>
        {(['placeholder', 'tag'] as const).map((kind) => (
          <Text as="p" key={kind} variant="body">
            <Text tone="muted">{KIND[kind]}: </Text>
            {found[kind].length ? found[kind].map((token, i) => <Text as="code" key={i} marginRight="tight" radius="base" background="page" paddingX="tight" paddingY="hair" ring="line">{token}</Text>) : <Text tone="muted">없음</Text>}
          </Text>
        ))}
      </Box>
    </Section>
  );
}
