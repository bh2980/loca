import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CONNECTION_KIND_INFO,
  CONNECTION_KINDS,
  connectionInputSchema,
  isFreeModel,
  type Capability,
  type ConnectionKind,
} from '@tw/shared';
import {
  Badge,
  Button,
  type ColumnDef,
  DangerZone,
  DataTable,
  DirtyBar,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Inspector,
  InspectorHeader,
  InspectorBlock,
  InspectorSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsContent,
  SettingsSection,
  Spinner,
  SplitPane,
  Textarea,
} from '@loca/ui';
import { Page } from '@/components/page';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { DeleteButton } from '@/components/settings/delete-button';
import { PiOptionsPanel } from '@/components/settings/pi-options';
import { KeyPane, type KeyRow } from '@/components/settings/key-pane';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { cn } from '@/lib/utils';
import { keyStoreLabel } from '@/lib/keys';
import { dateTime } from '@/lib/datetime';

export const Route = createFileRoute('/p/$projectId/settings/connections')({
  validateSearch: (raw: Record<string, unknown>): { conn?: string; key?: string } => ({
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : undefined,
    key: typeof raw.key === 'string' && raw.key ? raw.key : undefined,
  }),
  component: ConnectionsSettingsPage,
});

const CAPABILITY_LABEL: Record<Capability, string> = { generate: '생성', judge: '판정', chat: '채팅', tool: '도구' };
const LOGIN_LABEL: Record<string, string> = {
  logged_in: '로그인됨',
  logged_out: '로그아웃됨',
  unknown: '확인 안 됨',
};
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type ConnectionRow = InferResponseType<typeof client.connections.$get>[number];

function ConnectionsSettingsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const connections = useQuery(q.connections());

  const openConn = (conn?: string) => void navigate({ search: (prev) => ({ ...prev, conn, key: undefined }), replace: true });
  const openKey = (key?: string) => void navigate({ search: (prev) => ({ ...prev, key, conn: undefined }), replace: true });
  const close = () => void navigate({ search: () => ({}), replace: true });

  const aiRows = connections.data?.filter((c) => c.kind !== 'http');
  const keyRows = connections.data?.filter((c) => c.kind === 'http') as KeyRow[] | undefined;

  const selectedConn = search.conn && search.conn !== 'new' ? connections.data?.find((c) => c.id === search.conn) : undefined;
  const selectedKey = search.key && search.key !== 'new' ? keyRows?.find((k) => k.id === search.key) : undefined;

  useReportView('settings-connections', [
    selectedConn && { kind: 'AI 연결', id: selectedConn.id, label: selectedConn.name },
    selectedKey && { kind: 'API 키', id: selectedKey.id, label: selectedKey.name },
  ]);

  const aiColumns: ColumnDef<ConnectionRow, unknown>[] = [
    { id: 'name', header: '이름', meta: { hideable: false }, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: 'kind', header: '종류', meta: { width: 200, className: 'text-muted-foreground' }, cell: ({ row }) => CONNECTION_KIND_INFO[row.original.kind].label },
    { id: 'model', header: '기본 모델', meta: { width: 240, className: 'font-mono text-xs text-muted-foreground' }, cell: ({ row }) => [row.original.defaultModel, row.original.defaultEffort].filter(Boolean).join(' · ') },
    {
      id: 'state',
      header: '상태',
      meta: { width: 120 },
      cell: ({ row: { original: connection } }) => (CONNECTION_KIND_INFO[connection.kind].transport === 'http' && !connection.hasKey ? <span className="text-warning">키 없음</span> : null),
    },
  ];

  const keyColumns: ColumnDef<KeyRow, unknown>[] = [
    { id: 'name', header: '이름', meta: { className: 'font-medium', hideable: false }, cell: ({ row }) => row.original.name },
    { id: 'header', header: '헤더', meta: { className: 'font-mono text-xs text-muted-foreground' }, cell: ({ row }) => row.original.headerTemplate || '–' },
    { id: 'key', header: '키', meta: { width: 96 }, cell: ({ row }) => <Badge variant={row.original.hasKey ? 'default' : 'outline'}>{row.original.hasKey ? '저장됨' : '없음'}</Badge> },
  ];

  const pane = search.conn === 'new' ? (
    <NewConnection onClose={close} onCreated={(id) => openConn(id)} />
  ) : selectedConn ? (
    <ConnectionPane key={selectedConn.id} connection={selectedConn} onClose={close} />
  ) : search.key === 'new' || selectedKey ? (
    <KeyPane key={selectedKey?.id ?? 'new'} row={selectedKey} onClose={close} onCreated={(id) => openKey(id)} />
  ) : null;

  return (
    <Page title="연결" flush>
      <SplitPane id="settings-connections" selectionKey={search.conn ?? search.key} defaultWidth="448px" className="h-full" pane={pane}>
        <SettingsContent width="wide">
          <div className="space-y-8">
            <SettingsSection
              title="AI 연결"
              actions={
                <Button onClick={() => openConn('new')}>
                  <Plus /> 연결 추가
                </Button>
              }
            >
              <div className="overflow-hidden rounded-md border border-border">
                <DataTable
                  id="connections"
                  columns={aiColumns}
                  rows={aiRows}
                  rowId={(row) => row.id}
                  selected={selectedConn?.id}
                  empty={<EmptyState noun="AI 연결" />}
                  onRowClick={(row) => openConn(row.id === search.conn ? undefined : row.id)}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              title="API 키"
              actions={
                <Button onClick={() => openKey('new')}>
                  <Plus /> API 키 추가
                </Button>
              }
            >
              <div className="overflow-hidden rounded-md border border-border">
                <DataTable
                  id="keys"
                  columns={keyColumns}
                  rows={connections.data ? keyRows : undefined}
                  rowId={(row) => row.id}
                  selected={search.key}
                  empty={<EmptyState noun="API 키" />}
                  onRowClick={(row) => openKey(row.id === search.key ? undefined : row.id)}
                />
              </div>
            </SettingsSection>
          </div>
        </SettingsContent>
      </SplitPane>
    </Page>
  );
}

/** The note shown for pi connections, in the add form and the edit pane alike. */
function PiNote() {
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      로그인은 pi가 관리합니다. 터미널에서 <code>pi</code>를 실행해 <code>/login</code>으로 연결하세요.
    </p>
  );
}

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

const connectionFormSchema = connectionInputSchema.extend({ apiKey: z.string().optional() });
type ConnectionFormInput = z.input<typeof connectionFormSchema>;
type ConnectionFormOutput = z.output<typeof connectionFormSchema>;

function NewConnection({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: string) => void }) {
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
      toast.success('연결을 추가했습니다.');
      onCreated?.(row.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Inspector header={<InspectorHeader kind="연결" name="연결 추가" onClose={onClose} />} footer={
        <Button type="submit" form="new-connection-form" disabled={create.isPending}>
          {create.isPending && <Spinner />}
          추가
        </Button>
      }>
      <InspectorBlock>
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
                <FieldLabel htmlFor="conn-key">API 키</FieldLabel>
                <Input id="conn-key" type="password" autoComplete="off" {...form.register('apiKey')} />
                <FieldDescription>API 키는 {keyStoreLabel}에 저장되며 DB·내보내기에 포함되지 않습니다.</FieldDescription>
              </Field>
            </>
          ) : info.transport === 'sdk' ? (
            <PiNote />
          ) : (
            <Field>
              <FieldLabel htmlFor="conn-exe">실행 파일</FieldLabel>
              <Input id="conn-exe" {...form.register('executable')} placeholder="PATH에서 찾기" />
            </Field>
          )}
        </FieldGroup>
      </form>
      </InspectorBlock>
    </Inspector>
  );
}

function ConnectionPane({ connection, onClose }: { connection: ConnectionRow; onClose: () => void }) {
  const info = CONNECTION_KIND_INFO[connection.kind];
  const isHttp = info.transport === 'http';
  const isTool = connection.kind === 'http';
  const [apiKey, setApiKey] = useState('');
  const [probeResult, setProbeResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [models, setModels] = useState<{ list: string[] | null; detail?: string } | null>(null);
  const [login, setLogin] = useState<string | null>(null);

  const editSchema = connectionInputSchema.omit({ kind: true });
  const saved = {
    name: connection.name,
    baseUrl: connection.baseUrl ?? undefined,
    executable: connection.executable ?? '',
    headerTemplate: connection.headerTemplate ?? '',
    concurrency: isTool ? undefined : (connection.concurrency ?? 2),
    defaultModel: connection.defaultModel,
    defaultEffort: connection.defaultEffort,
    timeoutSeconds: connection.timeoutSeconds,
    maxAttempts: connection.maxAttempts,
    maxOutputTokens: connection.maxOutputTokens,
    fallback: connection.fallback,
  };
  const form = useForm<z.input<typeof editSchema>, unknown, z.output<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: saved,
    resetOptions: { keepDirtyValues: true },
  });
  const dirtyFields: Record<string, unknown> = form.formState.dirtyFields;
  const onlyDirty = <T extends object>(json: T) => Object.fromEntries(Object.entries(json).filter(([key]) => dirtyFields[key])) as T;
  const number = { setValueAs: (value: string) => (value === '' ? undefined : Number(value)) };
  const errors = form.formState.errors;
  const need: Capability[] = info.capabilities.includes('judge') ? ['judge'] : ['generate'];

  const save = useMutation({
    mutationFn: (values: z.output<typeof editSchema>) =>
      unwrap(
        client.connections[':id'].$patch({
          param: { id: connection.id },
          json: onlyDirty({
            name: values.name,
            baseUrl: isHttp ? values.baseUrl : undefined,
            executable: isHttp ? undefined : (values.executable ?? ''),
            headerTemplate: connection.kind === 'http' ? (values.headerTemplate ?? '') : undefined,
            ...(!isTool && {
              concurrency: values.concurrency,
              defaultModel: values.defaultModel ?? null,
              defaultEffort: values.defaultEffort ?? null,
              timeoutSeconds: values.timeoutSeconds,
              maxAttempts: values.maxAttempts,
              maxOutputTokens: values.maxOutputTokens,
              fallback: values.fallback ?? null,
            }),
          }),
        }),
      ),
    onSuccess: () => {
      form.reset(form.getValues(), { keepDirtyValues: false });
      toast.success('저장했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveKey = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].key.$put({ param: { id: connection.id }, json: { apiKey } })),
    onSuccess: () => {
      setApiKey('');
      toast.success('키를 저장했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const deleteKey = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].key.$delete({ param: { id: connection.id } })),
    onSuccess: () => {
      toast.success('키를 삭제했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].$delete({ param: { id: connection.id } })),
    onSuccess: onClose,
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

  const dirtyCount = Object.keys(dirtyFields).length;

  return (
    <Inspector
      header={<InspectorHeader kind={isTool ? '도구' : 'AI 연결'} name={connection.name} onClose={onClose} />}
      footer={
        dirtyCount > 0 ? (
          <DirtyBar dirtyCount={dirtyCount} onRevert={() => form.reset(saved)} onSave={form.handleSubmit((values) => save.mutate(values))} saving={save.isPending} />
        ) : (
          <Button disabled>저장</Button>
        )
      }
    >
      <div>
        <InspectorSection title="기본 정보">
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="edit-name">이름</FieldLabel>
              <Input id="edit-name" {...form.register('name')} aria-invalid={!!errors.name} />
              <FieldError errors={[errors.name]} />
            </Field>
            {isHttp && (
              <Field data-invalid={!!errors.baseUrl}>
                <FieldLabel htmlFor="edit-url">주소</FieldLabel>
                <Input id="edit-url" {...form.register('baseUrl')} aria-invalid={!!errors.baseUrl} />
                <FieldError errors={[errors.baseUrl]} />
              </Field>
            )}
            {!isHttp && connection.kind !== 'pi' && (
              <Field>
                <FieldLabel htmlFor="edit-exe">실행 파일</FieldLabel>
                <Input id="edit-exe" {...form.register('executable')} placeholder="PATH에서 찾기" />
              </Field>
            )}
            {connection.kind === 'pi' && <PiNote />}
          </FieldGroup>
        </InspectorSection>

        {!isTool && (
          <>
            <InspectorSection title="기본 모델">
              <Controller
                control={form.control}
                name="defaultModel"
                render={({ field }) => (
                  <ModelPicker
                    lockConnection
                    need={need}
                    value={{ connectionId: connection.id, model: field.value ?? '', effort: form.getValues('defaultEffort') ?? undefined }}
                    onChange={(next) => {
                      field.onChange(next.model || null);
                      form.setValue('defaultEffort', next.effort ?? null, { shouldDirty: true });
                    }}
                  />
                )}
              />
            </InspectorSection>

            <InspectorSection title="호출 조건">
              <div className="grid grid-cols-2 gap-4">
                <Field data-invalid={!!errors.concurrency}>
                  <FieldLabel htmlFor="edit-concurrency">동시 실행 수</FieldLabel>
                  <Input id="edit-concurrency" type="number" min={1} max={32} step={1} {...form.register('concurrency', number)} aria-invalid={!!errors.concurrency} />
                  <FieldError errors={[errors.concurrency]} />
                </Field>
                <Field data-invalid={!!errors.timeoutSeconds}>
                  <FieldLabel htmlFor="edit-timeout">제한 시간 (초)</FieldLabel>
                  <Input id="edit-timeout" type="number" min={5} max={600} {...form.register('timeoutSeconds', number)} aria-invalid={!!errors.timeoutSeconds} />
                  <FieldError errors={[errors.timeoutSeconds]} />
                </Field>
                <Field data-invalid={!!errors.maxAttempts}>
                  <FieldLabel htmlFor="edit-attempts">최대 시도 횟수</FieldLabel>
                  <Input id="edit-attempts" type="number" {...form.register('maxAttempts', number)} aria-invalid={!!errors.maxAttempts} />
                  <FieldError errors={[errors.maxAttempts]} />
                </Field>
                <Field data-invalid={!!errors.maxOutputTokens}>
                  <FieldLabel htmlFor="edit-output">최대 출력 토큰</FieldLabel>
                  <Input id="edit-output" type="number" {...form.register('maxOutputTokens', number)} aria-invalid={!!errors.maxOutputTokens} />
                  <FieldError errors={[errors.maxOutputTokens]} />
                </Field>
              </div>
            </InspectorSection>

            <InspectorSection title="대체 모델">
              <p className="mb-2 text-xs text-muted-foreground">채팅에는 쓰지 않습니다.</p>
              <Controller
                control={form.control}
                name="fallback"
                render={({ field }) => <ModelPicker exclude={connection.id} value={field.value} onChange={(next: ModelValue) => field.onChange(next.model ? next : { ...next, model: '' })} />}
              />
              <FieldError errors={[errors.fallback?.model ?? errors.fallback]} />
            </InspectorSection>
          </>
        )}

        {isHttp && (
          <InspectorSection title="API 키">
            <Field>
              <FieldLabel htmlFor="edit-key">{connection.hasKey ? '저장됨' : '저장된 키 없음'}</FieldLabel>
              <div className="flex gap-2">
                <Input id="edit-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="새 키 입력" />
                <Button variant="outline" disabled={!apiKey.trim() || saveKey.isPending} onClick={() => saveKey.mutate()}>키 저장</Button>
                <Button variant="outline" disabled={!connection.hasKey || deleteKey.isPending} onClick={() => deleteKey.mutate()}>키 삭제</Button>
              </div>
              <FieldDescription>API 키는 {keyStoreLabel}에 저장되며 DB·내보내기에 포함되지 않습니다.</FieldDescription>
            </Field>
          </InspectorSection>
        )}

        {connection.kind === 'pi' && (
          <InspectorSection title="pi 옵션">
            <PiOptionsPanel connectionId={connection.id} options={connection.options} />
          </InspectorSection>
        )}

        {!isTool && <ModelTest connectionId={connection.id} need={need} defaultModel={connection.defaultModel} defaultEffort={connection.defaultEffort} />}

        <InspectorSection title="연결 시험">
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
                <Button variant="outline" disabled={loginStatus.isPending} onClick={() => loginStatus.mutate()}>로그인 상태</Button>
                <Button variant="outline" disabled={openLogin.isPending} onClick={() => openLogin.mutate()}>로그인 창 열기</Button>
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
                    <li key={model} className="flex items-center gap-2">
                      <span className="truncate">{model}</span>
                      {isFreeModel(connection.kind, model) && <Badge variant="secondary" className="shrink-0 text-xs">무료</Badge>}
                    </li>
                  ))}
                </ul>
              ) : models.detail ? (
                <p className="text-destructive">{models.detail}</p>
              ) : (
                <p className="text-muted-foreground">이 연결은 모델 목록을 제공하지 않습니다.</p>
              )}
            </div>
          )}
        </InspectorSection>

        <DangerZone title="연결 삭제">
          <DeleteButton
            label={`연결 '${connection.name}'`}
            description="워크플로 노드·대화·다른 연결의 ‘막히면’이 이 연결을 쓰고 있으면 삭제되지 않습니다. 저장된 API 키도 함께 삭제됩니다."
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
        </DangerZone>
      </div>
    </Inspector>
  );
}

function ModelTest({ connectionId, need, defaultModel, defaultEffort }: { connectionId: string; need: Capability[]; defaultModel: string | null; defaultEffort: string | null }) {
  const [picked, setChoice] = useState<ModelValue | null>(null);
  const choice = picked ?? { connectionId, model: defaultModel ?? '', ...(defaultEffort && { effort: defaultEffort }) };
  const [source, setSource] = useState('');
  const test = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].test.$post({ param: { id: connectionId }, json: { model: choice.model, effort: choice.effort, source, targetLanguage: 'ko' } })),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const tests = useQuery(q.connectionTests(connectionId));
  const result = test.data;
  return (
    <InspectorSection title="모델 시험">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">실제 모델을 호출합니다.</p>
        <ModelPicker lockConnection need={need} value={choice} onChange={setChoice} />
        <Textarea rows={3} value={source} onChange={(event) => setSource(event.target.value)} placeholder="번역해 볼 원문 문장" />
        <Button type="button" variant="outline" className="self-start" disabled={!source.trim() || !choice.model || test.isPending} onClick={() => test.mutate()}>
          {test.isPending && <Spinner />}
          시험 실행
        </Button>
        {result &&
          (result.ok ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="whitespace-pre-wrap">{result.text}</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {result.model}
                {result.fellBack && ' (막혀서 넘김)'} · {result.ms.toLocaleString()}ms · {result.attempts.length}회 시도
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-destructive/40 p-3 text-sm break-words text-destructive">
              {result.detail} <span className="font-mono text-xs">({result.ms.toLocaleString()}ms)</span>
            </p>
          ))}
        {!!tests.data?.length && (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {tests.data.map((call) => (
              <li key={call.id} className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {dateTime(call.startedAt)} · {call.model}
                </span>
                <span className={cn('min-w-0 truncate text-xs', call.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                  {call.status === 'running' ? '진행 중' : call.status === 'failed' ? `실패${call.error ? `: ${call.error}` : ''}` : `${((new Date(call.finishedAt!).getTime() - new Date(call.startedAt).getTime()) / 1000).toFixed(1)}초`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </InspectorSection>
  );
}
