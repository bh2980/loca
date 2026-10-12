import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Page } from '@/components/page';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { PaneHeader } from '@/components/pane-header';
import { SplitPane } from '@/components/split-pane';

export const Route = createFileRoute('/p/$projectId/settings/keys')({
  validateSearch: (raw: Record<string, unknown>): { key?: string } => ({ key: typeof raw.key === 'string' && raw.key ? raw.key : undefined }),
  component: ApiKeys,
});

const DEFAULT_HEADER = 'Authorization: Bearer {key}';
const fail = (error: Error) => toast.error(error.message);

/**
 * Keys for outside APIs that workflow "HTTP 호출" nodes call (spell checkers, dictionaries…).
 * The address lives in the node; a key lives here, in the OS keychain, never in workflows,
 * exports or run records. App-wide, like AI connections.
 */
function ApiKeys() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const connections = useQuery(q.connections());
  const keys = connections.data?.filter((connection) => connection.kind === 'http') ?? [];
  const selected = keys.find((row) => row.id === search.key);
  const open = (key?: string) => void navigate({ search: { key }, replace: true });

  return (
    <Page title="API 키">
      <SplitPane
        id="settings-keys"
        defaultWidth="384px"
        className="items-start"
        pane={
          (search.key === 'new' || selected) && (
            <aside className="sticky top-0 ml-4 rounded-lg border bg-background">
              <KeyPane key={selected?.id ?? 'new'} row={selected} onClose={() => open(undefined)} onCreated={(id) => open(id)} />
            </aside>
          )
        }
      >
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">워크플로의 ‘HTTP 호출’ 노드가 키가 필요한 API를 부를 때 고릅니다. 주소는 노드에 적고, 키는 여기(OS 키체인)에만 둡니다. 공개 API는 키가 필요 없습니다.</p>
            <Button size="sm" className="shrink-0" onClick={() => open('new')}>
              <Plus /> API 키 추가
            </Button>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>키를 보내는 헤더</TableHead>
                  <TableHead className="w-24">키</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" data-state={row.id === search.key ? 'selected' : undefined} onClick={() => open(row.id === search.key ? undefined : row.id)}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.headerTemplate || '–'}</TableCell>
                    <TableCell>
                      <Badge variant={row.hasKey ? 'default' : 'outline'}>{row.hasKey ? '저장됨' : '없음'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {connections.data && keys.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-12 text-center text-muted-foreground">
                      API 키가 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </SplitPane>
    </Page>
  );
}

function KeyPane({ row, onClose, onCreated }: { row?: { id: string; name: string; headerTemplate: string | null; hasKey: boolean }; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(row?.name ?? '');
  const [header, setHeader] = useState(row?.headerTemplate ?? DEFAULT_HEADER);
  const [secret, setSecret] = useState('');
  const create = useMutation({
    mutationFn: () => unwrap(client.connections.$post({ json: { kind: 'http', name: name.trim(), headerTemplate: header.trim() || undefined, apiKey: secret.trim() || undefined } })),
    onSuccess: (created) => {
      toast.success('API 키를 추가했습니다.');
      onCreated(created.id);
    },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: async () => {
      await unwrap(client.connections[':id'].$patch({ param: { id: row!.id }, json: { name: name.trim(), headerTemplate: header.trim() } }));
      if (secret.trim()) await unwrap(client.connections[':id'].key.$put({ param: { id: row!.id }, json: { apiKey: secret.trim() } }));
    },
    onSuccess: () => {
      setSecret('');
      toast.success('저장했습니다.');
    },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: () => unwrap(client.connections[':id'].$delete({ param: { id: row!.id } })), onSuccess: onClose, onError: fail });
  const dirty = !row || name !== row.name || header !== (row.headerTemplate ?? '') || Boolean(secret.trim());

  return (
    <div>
      <PaneHeader kicker="API 키" title={row ? row.name : 'API 키 추가'} onClose={onClose} />
      <div className="space-y-4 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="key-name">이름</Label>
        <Input id="key-name" value={name} placeholder="예: 맞춤법 검사기 키" onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="key-header">키를 보내는 헤더</Label>
        <Input id="key-header" className="font-mono text-xs" value={header} onChange={(event) => setHeader(event.target.value)} />
        <p className="text-[11px] text-muted-foreground">{'{key}'} 자리에 저장한 키가 들어갑니다. 예: X-API-Key: {'{key}'}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="key-secret">키 {row?.hasKey && <span className="font-normal text-muted-foreground">(저장됨 — 바꿀 때만 입력)</span>}</Label>
        <Input id="key-secret" type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} />
        <p className="text-[11px] text-muted-foreground">OS 키체인에 저장되며 DB·워크플로·내보내기에 들어가지 않습니다.</p>
      </div>
      <div className="flex items-center justify-between">
        {row ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive">
                <Trash2 /> 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>API 키를 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>“{row.name}”을(를) 고른 HTTP 노드는 키 없이 호출하게 되어 검증 오류가 납니다.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span />
        )}
        <Button size="sm" disabled={!name.trim() || !dirty || create.isPending || save.isPending} onClick={() => (row ? save.mutate() : create.mutate())}>
          {row ? '저장' : '추가'}
        </Button>
      </div>
      </div>
    </div>
  );
}
