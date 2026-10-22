import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { numberOrNull, numberOrUndefined } from '@/lib/form-values';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CONNECTION_KIND_INFO,
  CONNECTION_KINDS,
  connectionInputSchema,
  isFreeModel,
  UNKNOWN_MAX_OUTPUT,
  type Capability,
  type ConnectionKind,
} from '@tw/shared';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  DirtyBar,
  EmptyState,
  Input,
  Inspector,
  InspectorHeader,
  InspectorActionRow,
  InspectorField,
  InspectorFields,
  InspectorResult,
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
import { KeyPane, type KeyRow } from '@/components/settings/key-pane';
import { ExecutableField } from '@/components/settings/executable-field';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { cn } from '@/lib/utils';
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
  'signed-in': '로그인됨',
  'signed-out': '로그아웃됨',
  unknown: '확인하지 못했습니다',
  unsupported: '확인할 수 없음: 이 CLI는 로그인 상태를 알려 주지 않습니다',
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
    { id: 'model', header: '모델', meta: { width: 240, className: 'font-mono text-xs text-muted-foreground' }, cell: ({ row }) => [row.original.defaultModel, row.original.defaultEffort].filter(Boolean).join(' · ') },
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
      <form id="new-connection-form" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <InspectorSection title="설정">
          <InspectorFields>
            <InspectorField label="종류" description={<CapabilityBadges kind={kind} />}>
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
            </InspectorField>
            <InspectorField label="이름" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} aria-invalid={!!form.formState.errors.name} placeholder="예: 회사 OpenAI" />
            </InspectorField>
            {info.transport === 'http' ? (
              <>
                <InspectorField label="주소" error={form.formState.errors.baseUrl?.message}>
                  <Input {...form.register('baseUrl', { setValueAs: (value: string) => (value ? value : undefined) })} aria-invalid={!!form.formState.errors.baseUrl} />
                </InspectorField>
                <InspectorField label="API 키">
                  <Input type="password" autoComplete="off" {...form.register('apiKey')} />
                </InspectorField>
              </>
            ) : (
              <Controller control={form.control} name="executable" render={({ field }) => <ExecutableField key={kind} kind={kind} value={field.value ?? ''} onChange={field.onChange} />} />
            )}
          </InspectorFields>
        </InspectorSection>
      </form>
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
    defaultModel: connection.defaultModel,
    defaultEffort: connection.defaultEffort,
    maxAttempts: connection.maxAttempts,
    inputTokens: connection.inputTokens,
    outputTokens: connection.outputTokens,
    fallback: connection.fallback,
  };
  const form = useForm<z.input<typeof editSchema>, unknown, z.output<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: saved,
    resetOptions: { keepDirtyValues: true },
  });
  const dirtyFields: Record<string, unknown> = form.formState.dirtyFields;
  const onlyDirty = <T extends object>(json: T) => Object.fromEntries(Object.entries(json).filter(([key]) => dirtyFields[key])) as T;
  const number = { setValueAs: numberOrUndefined };
  // Empty token fields mean the model's own limit: null, so clearing a number is saved too.
  const optionalNumber = { setValueAs: numberOrNull };
  // A token field's number in effect: the one typed, else what the model list said about this connection's model (shown as the placeholder), else the default.
  const limitOf = (field: 'contextWindow' | 'maxOutput', typed: unknown) => {
    const listed = connection.modelLimits?.[form.watch('defaultModel') ?? '']?.[field];
    return { tag: typed ? '직접 입력' : listed ? '모델 정보' : '기본값', placeholder: (listed ?? (field === 'maxOutput' ? UNKNOWN_MAX_OUTPUT : undefined))?.toLocaleString() };
  };
  const inputLimit = limitOf('contextWindow', form.watch('inputTokens'));
  const outputLimit = limitOf('maxOutput', form.watch('outputTokens'));
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
              defaultModel: values.defaultModel ?? null,
              defaultEffort: values.defaultEffort ?? null,
              maxAttempts: values.maxAttempts,
              inputTokens: values.inputTokens,
              outputTokens: values.outputTokens,
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
    onSuccess: (result) => (result.ok ? toast.success(`${connection.kind === 'antigravity' ? 'agy를 열었습니다' : '로그인 창을 열었습니다'}: ${result.command}`) : toast.error(result.detail)),
    onError: (error) => toast.error(errorMessage(error)),
  });

  // A new API key is part of the draft: saved with the rest by 저장, not by a button of its own.
  const dirtyCount = Object.keys(dirtyFields).length + (apiKey.trim() ? 1 : 0);
  const saveAll = () => {
    if (Object.keys(dirtyFields).length) void form.handleSubmit((values) => save.mutate(values))();
    if (apiKey.trim()) saveKey.mutate();
  };

  return (
    <Inspector footerStart={<><DeleteButton
          label={`연결 '${connection.name}'`}
          description="워크플로 노드·대화·다른 연결의 대체 모델이 이 연결을 쓰고 있으면 삭제되지 않습니다. 저장된 API 키도 함께 삭제됩니다."
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        /></>}
      header={<InspectorHeader kind={isTool ? '도구' : 'AI 연결'} name={connection.name} status={info.label} onClose={onClose} />}
      footer={
        dirtyCount > 0 ? (
          // reset() applies the form's resetOptions too: without keepDirtyValues false the edited fields would stay.
          <DirtyBar dirtyCount={dirtyCount} onRevert={() => { form.reset(saved, { keepDirtyValues: false }); setApiKey(''); }} onSave={saveAll} saving={save.isPending || saveKey.isPending} />
        ) : (
          <Button disabled>저장</Button>
        )
      }
    >
      <InspectorSection title="설정">
        <InspectorFields>
          <InspectorField label="이름" error={errors.name?.message}>
            <Input {...form.register('name')} aria-invalid={!!errors.name} />
          </InspectorField>
          {isHttp && (
            <InspectorField label="주소" error={errors.baseUrl?.message}>
              <Input {...form.register('baseUrl')} aria-invalid={!!errors.baseUrl} />
            </InspectorField>
          )}
          {info.transport === 'cli' && (
            <Controller control={form.control} name="executable" render={({ field }) => <ExecutableField kind={connection.kind} value={field.value ?? ''} onChange={field.onChange} />} />
          )}
          {!isTool && (
            <Controller
              control={form.control}
              name="defaultModel"
              render={({ field }) => (
                // Not what the connection always calls: the model filled in when this connection is picked (node, chat, run).
                <InspectorField
                  label="모델"
                  help="이 연결을 고르면 먼저 채워지는 모델입니다."
                  action={field.value && (
                    <Button variant="ghost" size="inline" onClick={() => { field.onChange(null); form.setValue('defaultEffort', null, { shouldDirty: true }); }}>
                      지우기
                    </Button>
                  )}
                >
                  <ModelPicker
                    lockConnection
                    need={need}
                    value={{ connectionId: connection.id, model: field.value ?? '', effort: form.getValues('defaultEffort') ?? undefined }}
                    onChange={(next) => {
                      field.onChange(next.model || null);
                      form.setValue('defaultEffort', next.effort ?? null, { shouldDirty: true });
                    }}
                  />
                </InspectorField>
              )}
            />
          )}
          {isHttp && (
            <InspectorField
              label={connection.hasKey ? 'API 키 · 저장됨' : 'API 키 · 없음'}
              action={connection.hasKey && (
                <Button variant="ghost" size="inline" className="text-destructive" disabled={deleteKey.isPending} onClick={() => deleteKey.mutate()}>
                  키 삭제
                </Button>
              )}
            >
              <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connection.hasKey ? '바꿀 때만 입력' : '키 입력'} />
            </InspectorField>
          )}
        </InspectorFields>
      </InspectorSection>

      {!isTool && (
        <InspectorSection title="고급" defaultOpen={false}>
          <InspectorFields>
            <InspectorField label="입력 토큰" description={inputLimit.tag} help="한 번에 넣을 수 있는 양입니다. 클수록 호출은 줄지만 놓치는 내용이 늘 수 있습니다." error={errors.inputTokens?.message}>
              <Input type="number" min={1000} placeholder={inputLimit.placeholder} {...form.register('inputTokens', optionalNumber)} aria-invalid={!!errors.inputTokens} />
            </InspectorField>
            {info.capabilities.includes('generate') && (
              <InspectorField
                label="출력 토큰"
                description={outputLimit.tag}
                help={info.capsOutput ? '한 번에 받을 수 있는 양입니다. 적은 값은 요청마다 상한으로도 보냅니다.' : '한 번에 받을 수 있는 양입니다. 이 연결에는 전달되지 않고, 한 번에 얼마나 보낼지 정하는 데만 쓰입니다.'}
                error={errors.outputTokens?.message}
              >
                <Input type="number" min={256} placeholder={outputLimit.placeholder} {...form.register('outputTokens', optionalNumber)} aria-invalid={!!errors.outputTokens} />
              </InspectorField>
            )}
            {!isTool && (
            <Controller
              control={form.control}
              name="fallback"
              render={({ field }) => (
                <InspectorField
                  label="대체 모델"
                  help="이 연결이 막히면 대신 부를 모델입니다. 같은 연결의 다른 모델도 됩니다. 채팅에는 쓰지 않습니다."
                  error={(errors.fallback?.model ?? errors.fallback)?.message}
                  action={field.value && (
                    <Button variant="ghost" size="inline" onClick={() => field.onChange(null)}>
                      지우기
                    </Button>
                  )}
                >
                  <ModelPicker value={field.value} onChange={(next: ModelValue) => field.onChange(next.model ? next : { ...next, model: '' })} />
                </InspectorField>
              )}
            />
            )}
            <InspectorField label="최대 시도 횟수" error={errors.maxAttempts?.message}>
              <Input type="number" {...form.register('maxAttempts', number)} aria-invalid={!!errors.maxAttempts} />
            </InspectorField>
          </InspectorFields>
        </InspectorSection>
      )}


      <InspectorSection title="확인">
        <div>
          <InspectorActionRow
            label="연결 확인"
            action={<Button variant="outline" disabled={probe.isPending} onClick={() => probe.mutate()}>{probe.isPending && <Spinner />}확인</Button>}
            result={probeResult && <InspectorResult tone={probeResult.ok ? 'ok' : 'error'}>{probeResult.detail}</InspectorResult>}
          />
          {info.transport === 'cli' && (
            <InspectorActionRow
              label="로그인"
              description={connection.kind === 'antigravity' ? 'agy를 인자 없이 엽니다. 이미 로그인했다면 로그인 창은 나오지 않습니다.' : undefined}
              action={
                <>
                  <Button variant="ghost" disabled={openLogin.isPending} onClick={() => openLogin.mutate()}>{connection.kind === 'antigravity' ? 'agy 열기' : '창 열기'}</Button>
                  <Button variant="outline" disabled={loginStatus.isPending} onClick={() => loginStatus.mutate()}>{loginStatus.isPending && <Spinner />}상태 보기</Button>
                </>
              }
              result={login && <InspectorResult tone={login === 'signed-in' ? 'ok' : login === 'signed-out' ? 'error' : 'info'}>{LOGIN_LABEL[login] ?? login}</InspectorResult>}
            />
          )}
          {!isTool && (
            <InspectorActionRow
              label="모델 목록"
              action={<Button variant="outline" disabled={loadModels.isPending} onClick={() => loadModels.mutate()}>{loadModels.isPending && <Spinner />}불러오기</Button>}
              result={
                models &&
                (models.list ? (
                  <InspectorResult
                    tone="ok"
                    detail={
                      <ul className="max-h-40 space-y-0.5 overflow-auto font-mono">
                        {models.list.map((model) => (
                          <li key={model} className="flex items-center gap-2">
                            <span className="truncate">{model}</span>
                            {isFreeModel(connection.kind, model) && <span className="shrink-0 font-sans text-success">무료</span>}
                          </li>
                        ))}
                      </ul>
                    }
                  >
                    모델 {models.list.length}개
                  </InspectorResult>
                ) : models.detail ? (
                  <InspectorResult tone="error">{models.detail}</InspectorResult>
                ) : (
                  <InspectorResult tone="info">이 연결은 모델 목록을 제공하지 않습니다</InspectorResult>
                ))
              }
            />
          )}
          {!isTool && <ModelTest connectionId={connection.id} need={need} defaultModel={connection.defaultModel} defaultEffort={connection.defaultEffort} />}
        </div>
      </InspectorSection>

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
    <InspectorActionRow
      label="모델 시험"
      description="실제 모델을 부릅니다"
      action={
        <Button variant="outline" disabled={!source.trim() || !choice.model || test.isPending} onClick={() => test.mutate()}>
          {test.isPending && <Spinner />}
          시험
        </Button>
      }
      result={
        result &&
        (result.ok ? (
          <InspectorResult tone="ok" detail={<span className="font-mono">{result.model}{result.fellBack && ' (대체 모델)'} · {result.ms.toLocaleString()}ms · {result.attempts.length}회 시도</span>}>
            <span className="whitespace-pre-wrap text-foreground">{result.text}</span>
          </InspectorResult>
        ) : (
          <InspectorResult tone="error" detail={<span className="font-mono">{result.ms.toLocaleString()}ms</span>}>{result.detail}</InspectorResult>
        ))
      }
    >
      <ModelPicker lockConnection need={need} value={choice} onChange={setChoice} />
      <Textarea rows={2} value={source} onChange={(event) => setSource(event.target.value)} placeholder="번역해 볼 원문" />
      {!!tests.data?.length && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {tests.data.slice(0, 3).map((call) => (
            <li key={call.id} className="flex items-baseline justify-between gap-3">
              <span className="tabular-nums">{dateTime(call.startedAt)} · {call.model}</span>
              <span className={cn('min-w-0 truncate', call.status === 'failed' && 'text-destructive')}>
                {call.status === 'running' ? '진행 중' : call.status === 'failed' ? `실패${call.error ? `: ${call.error}` : ''}` : `${((new Date(call.finishedAt!).getTime() - new Date(call.startedAt).getTime()) / 1000).toFixed(1)}초`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </InspectorActionRow>
  );
}
