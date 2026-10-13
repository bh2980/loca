import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { DetailPane } from '@/components/detail-pane';
import { Page } from '@/components/page';
import { SplitPane } from '@/components/split-pane';
import { Toolbar } from '@/components/toolbar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

export const Route = createFileRoute('/p/$projectId/ai/keys')({
  validateSearch: (raw: Record<string, unknown>): { key?: string } => ({ key: typeof raw.key === 'string' && raw.key ? raw.key : undefined }),
  component: ApiKeys,
});

type KeyRow = { id: string; name: string; headerTemplate: string | null; hasKey: boolean };
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

  const columns: ColumnDef<KeyRow, unknown>[] = [
    { id: 'name', header: '이름', meta: { className: 'font-medium' }, cell: ({ row }) => row.original.name },
    { id: 'header', header: '키를 보내는 헤더', meta: { className: 'font-mono text-xs text-muted-foreground' }, cell: ({ row }) => row.original.headerTemplate || '–' },
    { id: 'key', header: '키', meta: { width: 96 }, cell: ({ row }) => <Badge variant={row.original.hasKey ? 'default' : 'outline'}>{row.original.hasKey ? '저장됨' : '없음'}</Badge> },
  ];

  return (
    <Page title="API 키" flush>
      <SplitPane
        id="settings-keys"
        defaultWidth="384px"
        className="h-full"
        pane={(search.key === 'new' || selected) && <KeyPane key={selected?.id ?? 'new'} row={selected} onClose={() => open(undefined)} onCreated={(id) => open(id)} />}
      >
        <Toolbar
          count={connections.data ? `${keys.length}개` : undefined}
          actions={
            <Button onClick={() => open('new')}>
              <Plus /> API 키 추가
            </Button>
          }
        >
          <p className="max-w-2xl text-xs text-muted-foreground">워크플로의 ‘HTTP 호출’ 노드가 키가 필요한 API를 부를 때 고릅니다. 주소는 노드에 적고, 키는 여기(OS 키체인)에만 둡니다. 공개 API는 키가 필요 없습니다.</p>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={connections.data ? keys : undefined}
          rowId={(row) => row.id}
          selected={search.key}
          empty="API 키가 없습니다."
          onRowClick={(row) => open(row.id === search.key ? undefined : row.id)}
        />
      </SplitPane>
    </Page>
  );
}

function KeyPane({ row, onClose, onCreated }: { row?: KeyRow; onClose: () => void; onCreated: (id: string) => void }) {
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
    <DetailPane
      kicker="API 키"
      title={row ? row.name : 'API 키 추가'}
      onClose={onClose}
      footer={
        <>
          <Button disabled={!name.trim() || !dirty || create.isPending || save.isPending} onClick={() => (row ? save.mutate() : create.mutate())}>
            {row ? '저장' : '추가'}
          </Button>
          {row && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">
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
          )}
        </>
      }
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="key-name">이름</FieldLabel>
          <Input id="key-name" value={name} placeholder="예: 맞춤법 검사기 키" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="key-header">키를 보내는 헤더</FieldLabel>
          <Input id="key-header" className="font-mono text-xs" value={header} onChange={(event) => setHeader(event.target.value)} />
          <FieldDescription>
            {'{key}'} 자리에 저장한 키가 들어갑니다. 예: X-API-Key: {'{key}'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="key-secret">키 {row?.hasKey && <span className="font-normal text-muted-foreground">(저장됨 — 바꿀 때만 입력)</span>}</FieldLabel>
          <Input id="key-secret" type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} />
          <FieldDescription>OS 키체인에 저장되며 DB·워크플로·내보내기에 들어가지 않습니다.</FieldDescription>
        </Field>
      </FieldGroup>
    </DetailPane>
  );
}
