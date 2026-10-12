import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { CONNECTION_KIND_INFO, CONNECTION_KINDS, connectionInputSchema, type Capability, type ConnectionKind } from '@tw/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { Page } from '@/components/page';
import { DeleteButton } from '@/components/settings/delete-button';
import { PiOptionsPanel } from '@/components/settings/pi-options';
import { SplitPane } from '@/components/split-pane';
import { Toolbar } from '@/components/toolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/p/$projectId/settings/ai')({
  validateSearch: (raw: Record<string, unknown>): { conn?: string } => ({
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : undefined,
  }),
  component: ConnectionSettings,
});

const CAPABILITY_LABEL: Record<Capability, string> = { generate: '생성', judge: '판정', chat: '채팅', tool: '도구' };
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type ConnectionRow = InferResponseType<typeof client.connections.$get>[number];

/**
 * How AI is called: API, CLI or pi connections. The model profiles under them have their own tab.
 * The pane on the right edits the selected connection ("conn" in the URL).
 */
function ConnectionSettings() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const connections = useQuery(q.connections());
  const profiles = useQuery(q.profiles());
  const open = (conn?: string) => void navigate({ search: (previous) => ({ ...previous, conn }), replace: true });
  const close = () => open(undefined);
  const selected = search.conn && search.conn !== 'new' ? connections.data?.find((connection) => connection.id === search.conn) : undefined;
  const rows = connections.data?.filter((connection) => connection.kind !== 'http');

  const columns: ColumnDef<ConnectionRow, unknown>[] = [
    { id: 'name', header: '이름', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: 'kind', header: '종류', meta: { width: 200, className: 'text-muted-foreground' }, cell: ({ row }) => CONNECTION_KIND_INFO[row.original.kind].label },
    {
      id: 'profiles',
      header: '프로필 수',
      meta: { width: 96, align: 'end', className: 'tabular-nums' },
      cell: ({ row }) => (profiles.data ? profiles.data.filter((profile) => profile.connectionId === row.original.id).length : ''),
    },
    {
      id: 'state',
      header: '상태',
      meta: { width: 120 },
      cell: ({ row: { original: connection } }) => (CONNECTION_KIND_INFO[connection.kind].transport === 'http' && !connection.hasKey ? <span className="text-warning">키 없음</span> : null),
    },
  ];

  const pane =
    search.conn === 'new' ? <NewConnection onClose={close} /> : selected ? <ConnectionPane key={selected.id} connection={selected} onClose={close} /> : null;

  return (
    <Page title="AI 연결" flush>
      <SplitPane id="settings-ai" defaultWidth="448px" className="h-full" pane={pane}>
        <div className="min-h-0 flex-1 overflow-auto">
          <Toolbar
            count={rows ? `연결 ${rows.length}` : undefined}
            actions={
              <Button onClick={() => open('new')}>
                <Plus /> 연결 추가
              </Button>
            }
          />
          <DataTable
            className="flex-none"
            columns={columns}
            rows={rows}
            rowId={(row) => row.id}
            selected={selected?.id}
            empty="연결이 없습니다. “연결 추가”로 시작하세요."
            onRowClick={(row) => open(row.id)}
          />
        </div>
      </SplitPane>
    </Page>
  );
}

/** The note shown for pi connections, in the add form and the edit pane alike. */
function PiNote() {
  return (
    <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      pi는 작업실 서버 안에서 돌고, 로그인은 pi가 관리합니다. 터미널에서 <code>pi</code>를 실행해 <code>/login</code>으로 구독(OAuth)이나 API 키를 연결하면, 여기서 그 모델들을 고를 수 있습니다. 모델 이름은 “공급자/모델” 형식입니다.
    </p>
  );
}

/* ----------------------------------------------------------------- connections */

const connectionFormSchema = connectionInputSchema.extend({ apiKey: z.string().optional() });
type ConnectionFormInput = z.input<typeof connectionFormSchema>;
type ConnectionFormOutput = z.output<typeof connectionFormSchema>;

function CapabilityBadges({ kind }: { kind: ConnectionKind }) {
  return (
    <div className="flex flex-wrap gap-1">
      {CONNECTION_KIND_INFO[kind].capabilities.map((capability) => (
        <Badge key={capability} variant="secondary">
          {CAPABILITY_LABEL[capability]}
        </Badge>
      ))}
    </div>
  );
}

function NewConnection({ onClose }: { onClose: () => void }) {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<ConnectionFormInput, unknown, ConnectionFormOutput>({
    resolver: zodResolver(connectionFormSchema),
    defaultValues: { kind: 'openai', name: '', baseUrl: CONNECTION_KIND_INFO.openai.defaultBaseUrl, executable: '', apiKey: '' },
  });
  const kind = useWatch({ control: form.control, name: 'kind' });
  const info = CONNECTION_KIND_INFO[kind];

  const create = useMutation({
    mutationFn: (values: ConnectionFormOutput) =>
      unwrap(
        client.connections.$post({
          json: {
            kind: values.kind,
            name: values.name,
            baseUrl: info.transport === 'http' ? values.baseUrl : undefined,
            executable: info.transport === 'cli' ? values.executable || undefined : undefined,
            apiKey: info.transport === 'http' && values.apiKey ? values.apiKey : undefined,
          },
        }),
      ),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
      toast.success('연결을 추가했습니다.');
      void navigate({ search: (previous) => ({ ...previous, conn: row.id }) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <DetailPane
      kicker="연결"
      title="연결 추가"
      onClose={onClose}
      footer={
        <Button type="submit" form="new-connection-form" disabled={create.isPending}>
          {create.isPending && <Spinner />}
          추가
        </Button>
      }
    >
      <form id="new-connection-form" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel>종류</FieldLabel>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    const next = value as ConnectionKind;
                    field.onChange(next);
                    form.setValue('baseUrl', CONNECTION_KIND_INFO[next].defaultBaseUrl);
                    form.clearErrors();
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONNECTION_KINDS.filter((value) => value !== 'http').map((value) => (
                      <SelectItem key={value} value={value}>
                        {CONNECTION_KIND_INFO[value].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <CapabilityBadges kind={kind} />
          </Field>
          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor="conn-name">이름</FieldLabel>
            <Input id="conn-name" {...form.register('name')} aria-invalid={!!form.formState.errors.name} placeholder="예: 회사 OpenAI" />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          {info.transport === 'http' ? (
            <>
              <Field data-invalid={!!form.formState.errors.baseUrl}>
                <FieldLabel htmlFor="conn-url">주소</FieldLabel>
                <Input id="conn-url" {...form.register('baseUrl', { setValueAs: (value: string) => (value ? value : undefined) })} aria-invalid={!!form.formState.errors.baseUrl} />
                <FieldError errors={[form.formState.errors.baseUrl]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="conn-key">API 키 (선택)</FieldLabel>
                <Input id="conn-key" type="password" autoComplete="off" {...form.register('apiKey')} />
                <FieldDescription>API 키는 Windows 자격 증명 관리자(OS 키체인)에 저장되며 DB·내보내기에 포함되지 않습니다.</FieldDescription>
              </Field>
            </>
          ) : info.transport === 'sdk' ? (
            <PiNote />
          ) : (
            <Field>
              <FieldLabel htmlFor="conn-exe">실행 파일 경로 (선택)</FieldLabel>
              <Input id="conn-exe" {...form.register('executable')} placeholder="비워 두면 PATH에서 찾습니다" />
            </Field>
          )}
        </FieldGroup>
      </form>
    </DetailPane>
  );
}

function ConnectionPane({ connection, onClose }: { connection: ConnectionRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const info = CONNECTION_KIND_INFO[connection.kind];
  const isHttp = info.transport === 'http';
  const isTool = connection.kind === 'http';
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['connections'] });
  const [apiKey, setApiKey] = useState('');
  const [probeResult, setProbeResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [models, setModels] = useState<{ list: string[] | null; detail?: string } | null>(null);
  const [login, setLogin] = useState<string | null>(null);

  const editSchema = connectionInputSchema.omit({ kind: true });
  const form = useForm<z.input<typeof editSchema>, unknown, z.output<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: connection.name, baseUrl: connection.baseUrl ?? undefined, executable: connection.executable ?? '', headerTemplate: connection.headerTemplate ?? '', concurrency: isTool ? undefined : (connection.concurrency ?? 2) },
  });

  const save = useMutation({
    mutationFn: (values: z.output<typeof editSchema>) =>
      unwrap(client.connections[':id'].$patch({ param: { id: connection.id }, json: { name: values.name, baseUrl: isHttp ? values.baseUrl : undefined, executable: isHttp ? undefined : (values.executable ?? ''), headerTemplate: connection.kind === 'http' ? (values.headerTemplate ?? '') : undefined, concurrency: isTool ? undefined : values.concurrency } })),
    onSuccess: () => {
      invalidate();
      toast.success('저장했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveKey = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].key.$put({ param: { id: connection.id }, json: { apiKey } })),
    onSuccess: () => {
      setApiKey('');
      invalidate();
      toast.success('키를 저장했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const deleteKey = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].key.$delete({ param: { id: connection.id } })),
    onSuccess: () => {
      invalidate();
      toast.success('키를 삭제했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const probe = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].probe.$post({ param: { id: connection.id } })),
    onSuccess: setProbeResult,
    onError: (error) => setProbeResult({ ok: false, detail: errorMessage(error) }),
  });
  const loadModels = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].models.$get({ param: { id: connection.id } })),
    onSuccess: (result) => setModels({ list: result.models, detail: 'detail' in result ? result.detail : undefined }),
    onError: (error) => setModels({ list: null, detail: errorMessage(error) }),
  });
  const loginStatus = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].login.$get({ param: { id: connection.id } })),
    onSuccess: (result) => setLogin(result.status),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const openLogin = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].login.$post({ param: { id: connection.id } })),
    onSuccess: (result) => (result.ok ? toast.success(`로그인 창을 열었습니다: ${result.command}`) : toast.error(result.detail)),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].$delete({ param: { id: connection.id } })),
    onSuccess: () => {
      invalidate();
      toast.success('연결을 삭제했습니다.');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const LOGIN_LABEL: Record<string, string> = { 'signed-in': '로그인됨', 'signed-out': '로그인 안 됨', unknown: '확인할 수 없음' };

  return (
    <DetailPane
      kicker="연결"
      title={connection.name}
      subtitle={isTool ? '워크플로의 ‘HTTP 호출’ 함수가 이 연결로 외부 API(맞춤법·사전 등)를 부릅니다.' : info.label}
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form="edit-connection-form" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending && <Spinner />}
            저장
          </Button>
          <DeleteButton label={`연결 '${connection.name}'`} description="이 연결을 쓰는 프로필이 있으면 삭제되지 않습니다. 저장된 API 키도 함께 삭제됩니다." pending={remove.isPending} onConfirm={() => remove.mutate()} />
        </>
      }
    >
      <PaneSection title="설정">
        <form id="edit-connection-form" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="edit-name">이름</FieldLabel>
              <Input id="edit-name" {...form.register('name')} aria-invalid={!!form.formState.errors.name} />
              <FieldError errors={[form.formState.errors.name]} />
            </Field>
            {isTool ? null : isHttp ? (
              <Field data-invalid={!!form.formState.errors.baseUrl}>
                <FieldLabel htmlFor="edit-url">주소</FieldLabel>
                <Input id="edit-url" {...form.register('baseUrl', { setValueAs: (value: string) => (value ? value : undefined) })} aria-invalid={!!form.formState.errors.baseUrl} />
                <FieldError errors={[form.formState.errors.baseUrl]} />
              </Field>
            ) : info.transport === 'sdk' ? (
              <PiNote />
            ) : (
              <Field>
                <FieldLabel htmlFor="edit-exe">실행 파일 경로</FieldLabel>
                <Input id="edit-exe" {...form.register('executable')} placeholder="비워 두면 PATH에서 찾습니다" />
              </Field>
            )}
            {isTool && (
              <Field>
                <FieldLabel htmlFor="edit-header">키를 보내는 헤더</FieldLabel>
                <Input id="edit-header" className="font-mono text-xs" {...form.register('headerTemplate')} placeholder="Authorization: Bearer {key}" />
                <FieldDescription>{'{key}'} 자리에 저장한 키가 들어갑니다.</FieldDescription>
              </Field>
            )}
            {!isTool && (
              <Field data-invalid={!!form.formState.errors.concurrency}>
                <FieldLabel htmlFor="edit-concurrency">동시 실행 수</FieldLabel>
                <Input id="edit-concurrency" type="number" min={1} max={32} step={1} {...form.register('concurrency', { setValueAs: (value: string) => (value === '' ? undefined : Number(value)) })} aria-invalid={!!form.formState.errors.concurrency} />
                <FieldDescription>이 계정으로 동시에 보내는 AI 호출 수입니다. 모든 실행이 함께 씁니다. 구독 한도가 빡빡하면 줄이세요.</FieldDescription>
                <FieldError errors={[form.formState.errors.concurrency]} />
              </Field>
            )}
          </FieldGroup>
        </form>
      </PaneSection>

      {isHttp && (
        <PaneSection title="API 키">
          <Field>
            <FieldLabel htmlFor="edit-key">{connection.hasKey ? '저장됨 — 값은 표시되지 않습니다' : '저장된 키 없음'}</FieldLabel>
            <div className="flex gap-2">
              <Input id="edit-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="새 키 입력" />
              <Button variant="outline" disabled={!apiKey.trim() || saveKey.isPending} onClick={() => saveKey.mutate()}>
                키 저장
              </Button>
              <Button variant="outline" disabled={!connection.hasKey || deleteKey.isPending} onClick={() => deleteKey.mutate()}>
                키 삭제
              </Button>
            </div>
            <FieldDescription>API 키는 Windows 자격 증명 관리자(OS 키체인)에 저장되며 DB·내보내기에 포함되지 않습니다.</FieldDescription>
          </Field>
        </PaneSection>
      )}

      {connection.kind === 'pi' && (
        <PaneSection title="pi 옵션">
          <PiOptionsPanel connectionId={connection.id} options={connection.options} />
        </PaneSection>
      )}

      <PaneSection title="시험">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={probe.isPending} onClick={() => probe.mutate()}>
            {probe.isPending && <Spinner />}
            연결 확인
          </Button>
          {!isTool && (
            <Button variant="outline" disabled={loadModels.isPending} onClick={() => loadModels.mutate()}>
              {loadModels.isPending && <Spinner />}
              모델 목록
            </Button>
          )}
          {info.transport === 'cli' && (
            <>
              <Button variant="outline" disabled={loginStatus.isPending} onClick={() => loginStatus.mutate()}>
                로그인 상태
              </Button>
              <Button variant="outline" disabled={openLogin.isPending} onClick={() => openLogin.mutate()}>
                로그인 창 열기
              </Button>
            </>
          )}
        </div>
        {probeResult && (
          <p className={cn('mt-3 rounded-md border p-2 text-sm break-words', probeResult.ok ? 'text-foreground' : 'border-destructive/40 text-destructive')}>
            <Badge variant={probeResult.ok ? 'default' : 'destructive'} className="mr-2">
              {probeResult.ok ? '성공' : '실패'}
            </Badge>
            {probeResult.detail}
          </p>
        )}
        {login && <p className="mt-3 text-sm">로그인 상태: {LOGIN_LABEL[login] ?? login}</p>}
        {!isTool && models && (
          <div className="mt-3 text-sm">
            {models.list ? (
              <ul className="max-h-48 overflow-auto rounded-md border p-2 font-mono text-xs">
                {models.list.map((model) => (
                  <li key={model}>{model}</li>
                ))}
              </ul>
            ) : models.detail ? (
              <p className="text-destructive">{models.detail}</p>
            ) : (
              <p className="text-muted-foreground">이 연결은 모델 목록을 제공하지 않습니다. 모델 이름을 직접 입력하세요.</p>
            )}
          </div>
        )}
      </PaneSection>
    </DetailPane>
  );
}
