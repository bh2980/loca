import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { importFileSchema, type ImportFile } from '@loca/shared';
import { Box, Button, Checkbox, Field, FileDropZone, Grid, Heading, Inline, Input, KeyValue, KeyValueRow, ProjectListFrame, ScopeRow, Section, SectionHeading, SegmentedControl, Spinner, Stack, Text } from '@loca/ui';
import { LanguagePicker } from '@/components/language-picker';
import { createProject, importProjectFile, validateProjectFile } from '@/lib/project';
import { param, searchParams } from '@/lib/search';

export const Route = createFileRoute('/new')({
  validateSearch: searchParams({ from: param.oneOfOr(['empty', 'file'], 'empty') }),
  component: NewProject,
});

type Checked = Extract<Awaited<ReturnType<typeof validateProjectFile>>, { ok: true }>;
type Picked = { name: string; file: ImportFile; checked: Checked } | { name: string; issues: { path: string; message: string }[] };

const START = [
  { value: 'empty', label: '빈 프로젝트' },
  { value: 'file', label: '파일에서' },
];

/**
 * 새 프로젝트: a name and two languages, and either nothing (the lines are written or put in later) or a standard file
 * (loca/v1), checked here with what it holds, what looks off and the formats to turn on. A project made from a file is
 * an empty one with the file put in, as 원문 넣기 does; the file then shows in its 가져온 기록.
 */
function NewProject() {
  const { from } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [form, setForm] = useState({ name: '', description: '', sourceLanguage: 'en', targetLanguage: 'ko' });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [checking, setChecking] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Offered formats the person turned off; the rest are turned on with the file.
  const [declined, setDeclined] = useState<Set<string>>(new Set());

  const file = from === 'file' && picked && 'file' in picked ? picked : null;
  const ready = Boolean(form.name.trim()) && form.sourceLanguage.trim().length >= 2 && form.targetLanguage.trim().length >= 2 && (from === 'empty' || !!file);

  const create = useMutation({
    mutationFn: async () => {
      const facts = { name: form.name.trim(), description: form.description, sourceLanguage: form.sourceLanguage, targetLanguage: form.targetLanguage };
      if (!file) return createProject(facts);
      const formats = file.checked.formats.map((format) => format.id).filter((id) => !declined.has(id));
      return importProjectFile({ ...file.file, project: { ...file.file.project, ...facts } }, { name: file.name, formats });
    },
    onSuccess: ({ projectId }) => void navigate({ to: '/p/$projectId', params: { projectId } }),
    onError: (error) => toast.error(error.message),
  });

  async function load(chosen: File | undefined) {
    if (!chosen) return;
    setChecking(true);
    setDeclined(new Set());
    try {
      const data = JSON.parse(await chosen.text()) as unknown;
      const checked = await validateProjectFile(data);
      if (!checked.ok) return setPicked({ name: chosen.name, issues: checked.issues });
      const parsed = importFileSchema.parse(data);
      setPicked({ name: chosen.name, file: parsed, checked });
      // The file says what the project is; the person may still rename it or correct a language.
      setForm({ name: parsed.project.name, description: parsed.project.description ?? '', sourceLanguage: parsed.project.sourceLanguage, targetLanguage: parsed.project.targetLanguage });
    } catch (error) {
      setPicked({ name: chosen.name, issues: [{ path: '', message: `JSON을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}` }] });
    } finally {
      setChecking(false);
    }
  }

  return (
    <ProjectListFrame>
      <Stack as="header" direction="row" align="center" gap="normal" marginBottom="wide">
        <Button asChild variant="ghost" size="icon" aria-label="프로젝트 목록">
          <Link to="/"><ArrowLeft /></Link>
        </Button>
        <SectionHeading level="page" as="h1">새 프로젝트</SectionHeading>
      </Stack>

      <Box spaceY="wide">
        <Section variant="page" title="어떻게 시작할까요?" description={from === 'empty' ? '빈 프로젝트로 만들고, 대사는 그 안에서 쓰거나 원문 넣기로 파일에서 넣습니다.' : '게임에서 뽑은 표준 파일(loca/v1)로 만듭니다. 파일은 먼저 검사하고, 만든 뒤에도 원문 넣기로 더할 수 있습니다.'}>
          <SegmentedControl ariaLabel="시작하는 방법" value={from} onChange={(next) => void navigate({ search: { from: next as 'empty' | 'file' }, replace: true })} items={START} />
          {from === 'file' && (
            <Box spaceY="normal" marginTop="normal">
              <FileDropZone accept=".json,application/json" dragging={dragging} onDraggingChange={setDragging} onFile={(chosen) => void load(chosen)}>
                {picked ? <Text weight="medium" tone="default">{picked.name}</Text> : dragging ? '여기에 놓기' : '파일을 끌어다 놓거나 눌러서 선택'}
              </FileDropZone>
              {checking && (
                <Inline as="p" gap="condensed" variant="body" tone="muted">
                  <Spinner /> 파일을 검사하는 중…
                </Inline>
              )}
              {picked && 'issues' in picked && (
                <Box maxHeight="scroll" overflow="auto" radius="md" border="all" background="sunken" padding="normal" variant="body">
                  <Text as="p" marginBottom="condensed" weight="semibold" tone="danger">형식 오류 {picked.issues.length.toLocaleString()}개: 이 파일로는 만들 수 없습니다.</Text>
                  <Box as="ul" spaceY="tight" mono>
                    {picked.issues.map((issue, index) => (
                      <li key={index}>
                        <Text tone="muted">{issue.path || '(파일)'}</Text> {issue.message}
                      </li>
                    ))}
                  </Box>
                </Box>
              )}
              {file && (
                <>
                  <KeyValue align="start" framed>
                    {(
                      [
                        ['장면·그룹', file.checked.summary.groups],
                        ['대사', file.checked.summary.units],
                        ['그래프 노드', file.checked.summary.graphNodes],
                        ['그래프 연결', file.checked.summary.graphEdges],
                        ['인물', file.checked.summary.characters],
                        ['관계', file.checked.summary.relationships],
                        ['말투 규칙', file.checked.summary.speechRules],
                        ['사건', file.checked.summary.events],
                        ['노트', file.checked.summary.documents],
                        ['용어', file.checked.summary.terms],
                        ['번역 제외로 보이는 원문', file.checked.summary.excluded],
                      ] as const
                    ).map(([label, value]) => (
                      <KeyValueRow key={label} label={label}>
                        <Text tabular>{value.toLocaleString()}</Text>
                      </KeyValueRow>
                    ))}
                  </KeyValue>
                  {file.checked.warnings.length > 0 && (
                    <Box as="ul" maxHeight="scroll-sm" spaceY="tight" overflow="auto" radius="md" border="all" padding="normal" variant="body">
                      {file.checked.warnings.map((warning) => (
                        <li key={warning.message}>
                          <Text tone="warning">{warning.message}</Text>
                          {warning.examples.length > 0 && <Text display="block" truncate mono variant="caption" tone="muted">예: {warning.examples.join(', ')}</Text>}
                        </li>
                      ))}
                    </Box>
                  )}
                  {file.checked.formats.length > 0 && (
                    <Box as="fieldset" spaceY="tight">
                      <Heading as="legend" minWidth={0} marginBottom="condensed">이 서식도 서식 규칙에 켜시겠습니까?</Heading>
                      <Text as="p" variant="caption" tone="muted">파일의 원문에 보이는 표시입니다. 켜면 번역 점검이 번역문에서 빠졌는지 보고, AI 번역에 그대로 두라고 알립니다. 나중에 설정 › 프로젝트에서 바꿀 수 있습니다.</Text>
                      {file.checked.formats.map((format) => (
                        <ScopeRow key={format.id}>
                          <Checkbox
                            checked={!declined.has(format.id)}
                            onCheckedChange={(on) => {
                              const next = new Set(declined);
                              if (on === true) next.delete(format.id);
                              else next.add(format.id);
                              setDeclined(next);
                            }}
                          />
                          <Text minWidth={0} grow truncate>{format.label}</Text>
                          <Text shrink={false} variant="caption" tone="muted" mono>{format.examples.slice(0, 3).join(' ')}</Text>
                          <Text shrink={false} variant="caption" tone="muted" tabular>{format.count.toLocaleString()}줄</Text>
                        </ScopeRow>
                      ))}
                    </Box>
                  )}
                </>
              )}
            </Box>
          )}
        </Section>

        <Section
          variant="page"
          title="프로젝트"
          description="원문 언어는 게임의 언어, 번역 언어는 옮길 언어입니다. 나중에 설정 › 프로젝트에서 바꿀 수 있습니다."
          footer={
            <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
              {create.isPending && <Spinner />} {file ? `대사 ${file.checked.summary.units.toLocaleString()}개로 만들기` : '만들기'}
            </Button>
          }
        >
          <Box spaceY="normal">
            <Field label="이름">
              <Input autoFocus={from === 'empty'} value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="예: Monaco" />
            </Field>
            <Field label="설명">
              <Input value={form.description} maxLength={500} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="선택" />
            </Field>
            <Grid columns="twoFromSm" gap="normal">
              <Field label="원문 언어">
                <LanguagePicker ariaLabel="원문 언어" value={form.sourceLanguage} onChange={(sourceLanguage) => setForm({ ...form, sourceLanguage })} />
              </Field>
              <Field label="번역 언어">
                <LanguagePicker ariaLabel="번역 언어" value={form.targetLanguage} onChange={(targetLanguage) => setForm({ ...form, targetLanguage })} />
              </Field>
            </Grid>
          </Box>
        </Section>
      </Box>
    </ProjectListFrame>
  );
}
