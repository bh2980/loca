import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
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

  async function pick(input: HTMLInputElement) {
    const picked = input.files?.[0];
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>새 프로젝트 가져오기</DialogTitle>
          <DialogDescription>
            게임 추출기가 만든 <code className="text-xs">loca/v1</code> 형식의 JSON 파일을 선택하세요.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground hover:bg-muted/50">
          <FileUp className="size-5" />
          {file ? <span className="font-medium text-foreground">{file.name}</span> : '파일 선택'}
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(event) => void pick(event.currentTarget)} />
        </label>
        {checking && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> 파일을 검사하는 중…
          </p>
        )}
        {result && 'parseError' in result && <p className="text-sm text-destructive">JSON을 읽지 못했습니다: {result.parseError}</p>}
        {result && 'issues' in result && !result.ok && (
          <div className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
            <p className="mb-2 font-medium text-destructive">형식 오류 {result.issues.length}개 — 아무것도 저장하지 않았습니다.</p>
            <ul className="space-y-1 font-mono">
              {result.issues.map((issue, index) => (
                <li key={index}>
                  <span className="text-muted-foreground">{issue.path || '(root)'}</span> {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result && 'summary' in result && result.ok && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border p-3 text-sm">
            <dt className="text-muted-foreground">프로젝트</dt>
            <dd className="font-medium">{result.summary.name}</dd>
            {(
              [
                ['장면·그룹', result.summary.groups],
                ['대사', result.summary.units],
                ['그래프 노드', result.summary.graphNodes],
                ['그래프 연결', result.summary.graphEdges],
                ['인물', result.summary.characters],
                ['참조 문서', result.summary.documents],
                ['용어', result.summary.terms],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        )}
        {result && 'warnings' in result && result.ok && result.warnings.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-auto rounded-md border p-3 text-xs">
            {result.warnings.map((warning) => (
              <li key={warning.message}>
                <span className="text-warning">{warning.message}</span>
                {warning.examples.length > 0 && <span className="block truncate font-mono text-muted-foreground">예: {warning.examples.join(', ')}</span>}
              </li>
            ))}
          </ul>
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
