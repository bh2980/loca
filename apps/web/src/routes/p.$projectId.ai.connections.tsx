import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { CONNECTION_CALL_DEFAULTS, CONNECTION_KIND_INFO, CONNECTION_KINDS, connectionInputSchema, isFreeModel, type Capability, type ConnectionKind } from '@tw/shared';
import { EmptyState, DataTable, type ColumnDef, DetailPane, PaneSection, SplitPane, Badge, Button, Field, FieldDescription, FieldError, FieldGroup, FieldLabel, Input, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner } from '@loca/ui';
import { HeaderActions, Page } from '@/components/page';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { DeleteButton } from '@/components/settings/delete-button';
import { PiOptionsPanel } from '@/components/settings/pi-options';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { cn } from '@/lib/utils';
import { keyStoreLabel } from '@/lib/keys';
import { dateTime } from '@/lib/datetime';

export const Route = createFileRoute('/p/$projectId/ai/connections')({
  validateSearch: (raw: Record<string, unknown>): { conn?: string } => ({
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : undefined,
  }),
  component: ConnectionSettings,
});

const CAPABILITY_LABEL: Record<Capability, string> = { generate: '생성', judge: '판정', chat: '채팅', tool: '도구' };
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type ConnectionRow = InferResponseType<typeof client.connections.$get>[number];

/**
 * How AI is called: API, CLI or pi connections, each with its default model, call settings and
 * fallback. Places that use AI pick a connection + model + effort (ModelPicker). The pane on the
 * right edits the selected connection ("conn" in the URL).
 */
function ConnectionSettings() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const connections = useQuery(q.connections());
  const open = (conn?: string) => void navigate({ search: (previous) => ({ ...previous, conn }), replace: true });
  const close = () => open(undefined);
  const selected = search.conn && search.conn !== 'new' ? connections.data?.find((connection) => connection.id === search.conn) : undefined;
  const rows = connections.data?.filter((connection) => connection.kind !== 'http');
  useReportView('ai-connection', [selected && { kind: 'AI 연결', id: selected.id, label: selected.name }]);

  const columns: ColumnDef<ConnectionRow, unknown>[] = [
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

  const pane =
    search.conn === 'new' ? <NewConnection onClose={close} /> : selected ? <ConnectionPane key={selected.id} connection={selected} onClose={close} /> : null;

  return (
    <Page title="연결" flush>
      <SplitPane id="settings-ai" defaultWidth="448px" className="h-full" pane={pane}>
        <div className="min-h-0 flex-1 overflow-auto">
          <HeaderActions>
            <Button onClick={() => open('new')}>
              <Plus /> 연결 추가
            </Button>
          </HeaderActions>
          <DataTable id="connections"
            className="flex-none"
            columns={columns}
            rows={rows}
            rowId={(row) => row.id}
            selected={selected?.id}
            empty={<EmptyState noun="연결" hint="“연결 추가”로 시작하세요." />}
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
    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
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
                <FieldDescription>API 키는 {keyStoreLabel}에 저장되며 DB·내보내기에 포함되지 않습니다.</FieldDescription>
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
  // `values` follows the saved connection (changed from chat or another window); fields being edited keep the person's input.
  const form = useForm<z.input<typeof editSchema>, unknown, z.output<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: saved,
    resetOptions: { keepDirtyValues: true },
  });
  const dirtyFields: Record<string, unknown> = form.formState.dirtyFields;
  // Only the fields the person changed are sent, so a value changed elsewhere meanwhile is not overwritten.
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
      // What was saved is the new baseline: 저장 stays off until something changes again.
      form.reset(form.getValues());
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
          <DeleteButton label={`연결 '${connection.name}'`} description="워크플로 노드·대화·다른 연결의 ‘막히면’이 이 연결을 쓰고 있으면 삭제되지 않습니다. 저장된 API 키도 함께 삭제됩니다." pending={remove.isPending} onConfirm={() => remove.mutate()} />
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

      {!isTool && (
        <>
          <PaneSection title="기본 모델">
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
            <p className="mt-2 text-sm text-muted-foreground">이 연결을 고르면 먼저 채워지는 모델입니다. 템플릿·가져온 프로젝트의 AI 노드도 이 모델로 시작합니다.</p>
          </PaneSection>

          <PaneSection title="호출 조건">
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={!!errors.timeoutSeconds}>
                <FieldLabel htmlFor="edit-timeout">시간 제한(초)</FieldLabel>
                <Input id="edit-timeout" form="edit-connection-form" type="number" {...form.register('timeoutSeconds', number)} aria-invalid={!!errors.timeoutSeconds} />
                <FieldError errors={[errors.timeoutSeconds]} />
              </Field>
              <Field data-invalid={!!errors.maxAttempts}>
                <FieldLabel htmlFor="edit-attempts">최대 시도 횟수</FieldLabel>
                <Input id="edit-attempts" form="edit-connection-form" type="number" {...form.register('maxAttempts', number)} aria-invalid={!!errors.maxAttempts} />
                <FieldError errors={[errors.maxAttempts]} />
              </Field>
              <Field data-invalid={!!errors.maxOutputTokens}>
                <FieldLabel htmlFor="edit-output">최대 출력 토큰</FieldLabel>
                <Input id="edit-output" form="edit-connection-form" type="number" {...form.register('maxOutputTokens', number)} aria-invalid={!!errors.maxOutputTokens} />
                <FieldError errors={[errors.maxOutputTokens]} />
              </Field>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              이 연결로 가는 모든 요청(워크플로·작품 분석·용어 채우기·채팅)에 적용됩니다. 기본값: {CONNECTION_CALL_DEFAULTS.timeoutSeconds}초, {CONNECTION_CALL_DEFAULTS.maxAttempts}번, {CONNECTION_CALL_DEFAULTS.maxOutputTokens.toLocaleString()} 토큰.
            </p>
          </PaneSection>

          <PaneSection
            title="막히면"
            actions={
              <Controller
                control={form.control}
                name="fallback"
                render={({ field }) =>
                  field.value ? (
                    <Button type="button" variant="ghost" onClick={() => field.onChange(null)}>
                      빼기
                    </Button>
                  ) : (
                    <></>
                  )
                }
              />
            }
          >
            <p className="mb-2 text-sm text-muted-foreground">요청 한도·네트워크·시간 초과로 시도를 다 써도 실패하면 이 연결·모델로 넘깁니다. 그 연결의 ‘막히면’도 이어서 따릅니다. 채팅에는 쓰지 않습니다.</p>
            <Controller
              control={form.control}
              name="fallback"
              render={({ field }) => <ModelPicker exclude={connection.id} value={field.value} onChange={(next: ModelValue) => field.onChange(next.model ? next : { ...next, model: '' })} />}
            />
            <FieldError errors={[errors.fallback?.model ?? errors.fallback]} />
          </PaneSection>
        </>
      )}

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
            <FieldDescription>API 키는 {keyStoreLabel}에 저장되며 DB·내보내기에 포함되지 않습니다.</FieldDescription>
          </Field>
        </PaneSection>
      )}

      {connection.kind === 'pi' && (
        <PaneSection title="pi 옵션">
          <PiOptionsPanel connectionId={connection.id} options={connection.options} />
        </PaneSection>
      )}

      {!isTool && <ModelTest connectionId={connection.id} need={need} defaultModel={connection.defaultModel} defaultEffort={connection.defaultEffort} />}

      <PaneSection title="연결 시험">
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
                  <li key={model} className="flex items-center gap-2">
                    <span className="truncate">{model}</span>
                    {isFreeModel(connection.kind, model) && <Badge variant="secondary" className="shrink-0 text-xs">무료</Badge>}
                  </li>
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

/** A one-off translation through this connection with a model of it; nothing is written to any project. */
function ModelTest({ connectionId, need, defaultModel, defaultEffort }: { connectionId: string; need: Capability[]; defaultModel: string | null; defaultEffort: string | null }) {
  const [picked, setChoice] = useState<ModelValue | null>(null);
  // The connection's default model until another is picked (it may be set after this pane opened).
  const choice = picked ?? { connectionId, model: defaultModel ?? '', ...(defaultEffort && { effort: defaultEffort }) };
  const [source, setSource] = useState('');
  const test = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].test.$post({ param: { id: connectionId }, json: { model: choice.model, effort: choice.effort, source, targetLanguage: 'ko' } })),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const tests = useQuery(q.connectionTests(connectionId));
  const result = test.data;
  return (
    <PaneSection title="모델 시험">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">한 문장을 번역해 봅니다. 저장된 호출 조건과 ‘막히면’으로 실행되고, 결과는 프로젝트에 저장되지 않습니다.</p>
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
    </PaneSection>
  );
}
