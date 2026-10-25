import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FileUp } from 'lucide-react';
import { Box, Button, Dialog, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, FileDropZone, Inline, Spinner, Text, DialogContent, KeyValue, KeyValueRow } from '@loca/ui';
import { client, unwrap } from '@/lib/api';

type Validation = Awaited<ReturnType<typeof validate>>;
const validate = (body: unknown) => unwrap(client.projects.validate.$post({ json: body }));

/** Pick a standard-format file → see what it contains or exactly where it is invalid → create. */
export function ImportProjectDialog({ trigger }: { trigger?: React.ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null);
  const [result, setResult] = useState<Validation | { ok: false; parseError: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const create = useMutation({
    mutationFn: (data: unknown) => unwrap(client.projects.$post({ json: data as never })),
    onSuccess: (summary) => {
      setOpen(false);
      void navigate({ to: '/p/$projectId', params: { projectId: summary.projectId } });
    },
  });

  const [dragging, setDragging] = useState(false);

  async function load(picked: File | undefined) {
    if (!picked) return;
    setResult(null);
    setChecking(true);
    try {
      const data = JSON.parse(await picked.text()) as unknown;
      setFile({ name: picked.name, data });
      setResult(await validate(data));
    } catch (error) {
      setFile(null);
      setResult({ ok: false, parseError: error instanceof Error ? error.message : String(error) });
    } finally {
      setChecking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), next || (setFile(null), setResult(null)))}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <FileUp /> 표준 파일 가져오기
          </Button>
        )}
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>새 프로젝트 가져오기</DialogTitle>
        </DialogHeader>
        {/* Click to pick, or drop the file here. */}
        <FileDropZone accept=".json,application/json" dragging={dragging} onDraggingChange={setDragging} onFile={(picked) => void load(picked)}>
          {file ? <Text weight="medium" tone="default">{file.name}</Text> : dragging ? '여기에 놓기' : '파일을 끌어다 놓거나 눌러서 선택'}
        </FileDropZone>
        {checking && (
          <Inline as="p" gap="condensed" variant="body" tone="muted">
            <Spinner /> 파일을 검사하는 중…
          </Inline>
        )}
        {result && 'parseError' in result && <Text as="p" variant="body" tone="danger">JSON을 읽지 못했습니다: {result.parseError}</Text>}
        {result && 'issues' in result && !result.ok && (
          <Box maxHeight="scroll" overflow="auto" radius="md" border="all" background="sunken" padding="normal" variant="body">
            <Text as="p" marginBottom="condensed" weight="semibold" tone="danger">형식 오류 {result.issues.length}개 — 아무것도 저장하지 않았습니다.</Text>
            <Box as="ul" spaceY="tight" mono>
              {result.issues.map((issue, index) => (
                <li key={index}>
                  <Text tone="muted">{issue.path || '(root)'}</Text> {issue.message}
                </li>
              ))}
            </Box>
          </Box>
        )}
        {result && 'summary' in result && result.ok && (
          <KeyValue align="start" framed>
            <KeyValueRow label="프로젝트">{result.summary.name}</KeyValueRow>
            {(
              [
                ['장면·그룹', result.summary.groups],
                ['대사', result.summary.units],
                ['그래프 노드', result.summary.graphNodes],
                ['그래프 연결', result.summary.graphEdges],
                ['인물', result.summary.characters],
                ['노트', result.summary.documents],
                ['용어', result.summary.terms],
                ['번역 제외로 보이는 원문', result.summary.excluded],
              ] as const
            ).map(([label, value]) => (
              <KeyValueRow key={label} label={label}>
                <Text tabular>{value.toLocaleString()}</Text>
              </KeyValueRow>
            ))}
          </KeyValue>
        )}
        {result && 'warnings' in result && result.ok && result.warnings.length > 0 && (
          <Box as="ul" maxHeight="scroll-sm" spaceY="tight" overflow="auto" radius="md" border="all" padding="normal" variant="body">
            {result.warnings.map((warning) => (
              <li key={warning.message}>
                <Text tone="warning">{warning.message}</Text>
                {warning.examples.length > 0 && <Text display="block" truncate mono variant="caption" tone="muted">예: {warning.examples.join(', ')}</Text>}
              </li>
            ))}
          </Box>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button disabled={!file || !result || !('summary' in result) || create.isPending} onClick={() => file && create.mutate(file.data)}>
            {create.isPending && <Spinner />} 프로젝트 만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
