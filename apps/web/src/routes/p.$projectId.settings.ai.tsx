import { useEffect, useState, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Check, ChevronsUpDown, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { CONNECTION_KIND_INFO, CONNECTION_KINDS, connectionInputSchema, profileInputSchema, type Capability, type ConnectionKind } from '@tw/shared';
import { Page } from '@/components/page';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Tab = 'connections' | 'tools' | 'profiles';

export const Route = createFileRoute('/p/$projectId/settings/ai')({
  validateSearch: (raw: Record<string, unknown>): { tab?: Tab; conn?: string; profile?: string } => ({
    tab: raw.tab === 'profiles' || raw.tab === 'tools' ? raw.tab : undefined,
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : undefined,
    profile: typeof raw.profile === 'string' && raw.profile ? raw.profile : undefined,
  }),
  component: AiSettings,
});

const CAPABILITY_LABEL: Record<Capability, string> = { generate: '생성', judge: '판정', chat: '채팅', tool: '도구' };
const NONE = '__none';
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function AiSettings() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const connections = useQuery(q.connections());
  const selectedConnection = search.conn && search.conn !== 'new' ? connections.data?.find((connection) => connection.id === search.conn) : undefined;
  // A selected connection always opens in the tab that matches its kind.
  const tab: Tab = search.tab === 'profiles' ? 'profiles' : selectedConnection ? (selectedConnection.kind === 'http' ? 'tools' : 'connections') : (search.tab ?? 'connections');

  return (
    <Page title="연결·프로필">
      <Tabs
        value={tab}
        onValueChange={(value) => void navigate({ search: (previous) => ({ ...previous, tab: value === 'tools' || value === 'profiles' ? value : undefined, conn: undefined }) })}
        className="gap-3"
      >
        <TabsList>
          <TabsTrigger value="tools">도구 연결</TabsTrigger>
          <TabsTrigger value="connections">AI 연결</TabsTrigger>
          <TabsTrigger value="profiles">모델 프로필</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'connections' ? <ConnectionsTab /> : tab === 'tools' ? <ToolsTab /> : <ProfilesTab />}
    </Page>
  );
}

/** Table on the left, detail/form pane on the right. */
function Split({ list, pane }: { list: ReactNode; pane: ReactNode | null }) {
  return (
    <div className="mt-3 flex items-start gap-4">
      <div className="min-w-0 flex-1">{list}</div>
      {pane && <aside className="sticky top-0 w-[28rem] shrink-0 rounded-lg border bg-background p-4">{pane}</aside>}
    </div>
  );
}

function PaneHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-semibold">{title}</h2>
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="닫기">
        <X />
      </Button>
    </div>
  );
}

function DeleteButton({ label, description, pending, onConfirm }: { label: string; description: string; pending: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive" disabled={pending}>
          <Trash2 />
          삭제
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}을(를) 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

function ConnectionsTab() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const connections = useQuery(q.connections());
  const aiConnections = connections.data?.filter((connection) => connection.kind !== 'http');
  const selected = search.conn && search.conn !== 'new' ? aiConnections?.find((connection) => connection.id === search.conn) : undefined;
  const close = () => void navigate({ search: (previous) => ({ ...previous, conn: undefined }) });

  return (
    <Split
      list={
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground tabular-nums">{aiConnections?.length ?? '–'}개</span>
            <Button size="sm" onClick={() => void navigate({ search: (previous) => ({ ...previous, conn: 'new' }) })}>
              <Plus />
              연결 추가
            </Button>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>종류</TableHead>
                  <TableHead>주소 / 실행 파일</TableHead>
                  <TableHead>키</TableHead>
                  <TableHead>기능</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aiConnections?.map((connection) => {
                  const info = CONNECTION_KIND_INFO[connection.kind];
                  return (
                    <TableRow key={connection.id} className="cursor-pointer" data-state={search.conn === connection.id ? 'selected' : undefined} onClick={() => void navigate({ search: (previous) => ({ ...previous, conn: connection.id }) })}>
                      <TableCell className="font-medium">{connection.name}</TableCell>
                      <TableCell className="text-muted-foreground">{info.label}</TableCell>
                      <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">{info.transport === 'http' ? connection.baseUrl : (connection.executable ?? 'PATH')}</TableCell>
                      <TableCell>{info.transport === 'http' ? <Badge variant={connection.hasKey ? 'default' : 'outline'}>{connection.hasKey ? '저장됨' : '없음'}</Badge> : <span className="text-muted-foreground">–</span>}</TableCell>
                      <TableCell>
                        <CapabilityBadges kind={connection.kind} />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {aiConnections?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      연결이 없습니다. 연결 추가로 시작하세요.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      }
      pane={search.conn === 'new' ? <NewConnection onClose={close} /> : selected ? <ConnectionPane key={selected.id} connection={selected} onClose={close} /> : null}
    />
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
    <form onSubmit={form.handleSubmit((values) => create.mutate(values))}>
      <PaneHeader title="연결 추가" onClose={onClose} />
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
        ) : (
          <Field>
            <FieldLabel htmlFor="conn-exe">실행 파일 경로 (선택)</FieldLabel>
            <Input id="conn-exe" {...form.register('executable')} placeholder="비워 두면 PATH에서 찾습니다" />
          </Field>
        )}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Spinner />}
          추가
        </Button>
      </FieldGroup>
    </form>
  );
}

type ConnectionRow = InferResponseType<typeof client.connections.$get>[number];

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
    defaultValues: { name: connection.name, baseUrl: connection.baseUrl ?? undefined, executable: connection.executable ?? '', headerTemplate: connection.headerTemplate ?? '' },
  });

  const save = useMutation({
    mutationFn: (values: z.output<typeof editSchema>) =>
      unwrap(client.connections[':id'].$patch({ param: { id: connection.id }, json: { name: values.name, baseUrl: isHttp ? values.baseUrl : undefined, executable: isHttp ? undefined : (values.executable ?? ''), headerTemplate: connection.kind === 'http' ? (values.headerTemplate ?? '') : undefined } })),
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
    <div>
      <PaneHeader title={connection.name} onClose={onClose} />
      <p className="mb-4 text-sm text-muted-foreground">{isTool ? '워크플로의 ‘HTTP 호출’ 함수가 이 연결로 외부 API(맞춤법·사전 등)를 부릅니다.' : info.label}</p>
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <FieldGroup className="gap-4">
          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor="edit-name">이름</FieldLabel>
            <Input id="edit-name" {...form.register('name')} aria-invalid={!!form.formState.errors.name} />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          {isHttp ? (
            <Field data-invalid={!!form.formState.errors.baseUrl}>
              <FieldLabel htmlFor="edit-url">주소</FieldLabel>
              <Input id="edit-url" {...form.register('baseUrl', { setValueAs: (value: string) => (value ? value : undefined) })} aria-invalid={!!form.formState.errors.baseUrl} />
              <FieldError errors={[form.formState.errors.baseUrl]} />
            </Field>
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
          <Button type="submit" variant="secondary" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending && <Spinner />}
            저장
          </Button>
        </FieldGroup>
      </form>

      {isHttp && (
        <>
          <Separator className="my-4" />
          <Field>
            <FieldLabel htmlFor="edit-key">API 키 {connection.hasKey ? '(저장됨 — 값은 표시되지 않습니다)' : '(없음)'}</FieldLabel>
            <div className="flex gap-2">
              <Input id="edit-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="새 키 입력" />
              <Button variant="secondary" disabled={!apiKey.trim() || saveKey.isPending} onClick={() => saveKey.mutate()}>
                키 저장
              </Button>
              <Button variant="outline" disabled={!connection.hasKey || deleteKey.isPending} onClick={() => deleteKey.mutate()}>
                키 삭제
              </Button>
            </div>
            <FieldDescription>API 키는 Windows 자격 증명 관리자(OS 키체인)에 저장되며 DB·내보내기에 포함되지 않습니다.</FieldDescription>
          </Field>
        </>
      )}

      <Separator className="my-4" />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={probe.isPending} onClick={() => probe.mutate()}>
          {probe.isPending && <Spinner />}
          연결 확인
        </Button>
        {!isTool && (
          <Button variant="outline" size="sm" disabled={loadModels.isPending} onClick={() => loadModels.mutate()}>
            {loadModels.isPending && <Spinner />}
            모델 목록
          </Button>
        )}
        {!isHttp && (
          <>
            <Button variant="outline" size="sm" disabled={loginStatus.isPending} onClick={() => loginStatus.mutate()}>
              로그인 상태
            </Button>
            <Button variant="outline" size="sm" disabled={openLogin.isPending} onClick={() => openLogin.mutate()}>
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

      <Separator className="my-4" />
      <DeleteButton label={`연결 '${connection.name}'`} description="이 연결을 쓰는 프로필이 있으면 삭제되지 않습니다. 저장된 API 키도 함께 삭제됩니다." pending={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}

/* ----------------------------------------------------------------- tool connections */

const toolFormSchema = connectionFormSchema.extend({ baseUrl: z.string().trim().url() });
type ToolFormInput = z.input<typeof toolFormSchema>;
type ToolFormOutput = z.output<typeof toolFormSchema>;
const DEFAULT_HEADER = 'Authorization: Bearer {key}';

function ToolsTab() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const connections = useQuery(q.connections());
  const tools = connections.data?.filter((connection) => connection.kind === 'http');
  const selected = search.conn && search.conn !== 'new' ? tools?.find((connection) => connection.id === search.conn) : undefined;
  const close = () => void navigate({ search: (previous) => ({ ...previous, conn: undefined }) });

  return (
    <Split
      list={
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              <span className="tabular-nums">{tools?.length ?? '–'}개</span> · 워크플로의 ‘HTTP 호출’ 함수가 이 연결로 외부 API(맞춤법·사전 등)를 부릅니다.
            </span>
            <Button size="sm" onClick={() => void navigate({ search: (previous) => ({ ...previous, conn: 'new' }) })}>
              <Plus />
              도구 연결 추가
            </Button>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>주소</TableHead>
                  <TableHead>키를 보내는 헤더</TableHead>
                  <TableHead>키</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools?.map((connection) => (
                  <TableRow key={connection.id} className="cursor-pointer" data-state={search.conn === connection.id ? 'selected' : undefined} onClick={() => void navigate({ search: (previous) => ({ ...previous, conn: connection.id }) })}>
                    <TableCell className="font-medium">{connection.name}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">{connection.baseUrl}</TableCell>
                    <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">{connection.headerTemplate || '–'}</TableCell>
                    <TableCell>
                      <Badge variant={connection.hasKey ? 'default' : 'outline'}>{connection.hasKey ? '저장됨' : '없음'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {tools?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      도구 연결이 없습니다. 도구 연결 추가로 시작하세요.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      }
      pane={search.conn === 'new' ? <NewTool onClose={close} /> : selected ? <ConnectionPane key={selected.id} connection={selected} onClose={close} /> : null}
    />
  );
}

function NewTool({ onClose }: { onClose: () => void }) {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<ToolFormInput, unknown, ToolFormOutput>({
    resolver: zodResolver(toolFormSchema),
    defaultValues: { kind: 'http', name: '', baseUrl: '', headerTemplate: DEFAULT_HEADER, apiKey: '' },
  });
  const errors = form.formState.errors;

  const create = useMutation({
    mutationFn: (values: ToolFormOutput) =>
      unwrap(
        client.connections.$post({
          json: { kind: 'http', name: values.name, baseUrl: values.baseUrl, headerTemplate: values.headerTemplate || undefined, apiKey: values.apiKey || undefined },
        }),
      ),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
      toast.success('도구 연결을 추가했습니다.');
      void navigate({ search: (previous) => ({ ...previous, conn: row.id }) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => create.mutate(values))}>
      <PaneHeader title="도구 연결 추가" onClose={onClose} />
      <FieldGroup className="gap-5">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="tool-name">이름</FieldLabel>
          <Input id="tool-name" {...form.register('name')} aria-invalid={!!errors.name} placeholder="예: 맞춤법 검사기" />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={!!errors.baseUrl}>
          <FieldLabel htmlFor="tool-url">주소</FieldLabel>
          <Input id="tool-url" {...form.register('baseUrl')} aria-invalid={!!errors.baseUrl} placeholder="https://api.example.com" />
          <FieldError errors={[errors.baseUrl]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tool-header">키를 보내는 헤더</FieldLabel>
          <Input id="tool-header" className="font-mono text-xs" {...form.register('headerTemplate')} placeholder={DEFAULT_HEADER} />
          <FieldDescription>{'{key}'} 자리에 저장한 키가 들어갑니다. 예: X-API-Key: {'{key}'}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="tool-key">API 키 (선택)</FieldLabel>
          <Input id="tool-key" type="password" autoComplete="off" {...form.register('apiKey')} />
          <FieldDescription>API 키는 Windows 자격 증명 관리자(OS 키체인)에 저장되며 DB·내보내기에 포함되지 않습니다.</FieldDescription>
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Spinner />}
          추가
        </Button>
      </FieldGroup>
    </form>
  );
}

/* ------------------------------------------------------------------- profiles */

type ProfileFormInput = z.input<typeof profileInputSchema>;
type ProfileFormOutput = z.output<typeof profileInputSchema>;

const numberOrUndefined = (value: string) => (value === '' ? undefined : Number(value));
const numberField = (value: string) => (value === '' ? undefined : Number(value));

function useModels(connectionId: string | undefined) {
  return useQuery({
    queryKey: ['connections', connectionId, 'models'],
    queryFn: () => unwrap(client.connections[':id'].models.$get({ param: { id: connectionId! } })),
    enabled: !!connectionId,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Model name with search over the connection's model list (APIs can list hundreds). A name that
 * is not in the list can still be used: the typed text is offered as its own option.
 */
function ModelPicker({ connectionId, value, onChange, id }: { connectionId: string | undefined; value: string; onChange: (value: string) => void; id?: string }) {
  const models = useModels(connectionId);
  const list = models.data?.models ?? [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const typed = query.trim();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || '모델 선택 또는 입력'}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput value={query} onValueChange={setQuery} placeholder={list.length ? `모델 ${list.length}개에서 찾기` : '모델 이름 입력'} />
          <CommandList>
            <CommandEmpty>{models.isPending && connectionId ? '모델 목록을 불러오는 중…' : '목록에 없는 모델입니다.'}</CommandEmpty>
            {typed && !list.includes(typed) && (
              <CommandGroup heading="직접 입력">
                <CommandItem
                  value={`__typed__${typed}`}
                  onSelect={() => {
                    onChange(typed);
                    setOpen(false);
                  }}
                >
                  “{typed}” 사용
                </CommandItem>
              </CommandGroup>
            )}
            {list.length > 0 && (
              <CommandGroup heading={models.data && 'detail' in models.data && models.data.detail ? undefined : '이 연결의 모델'}>
                {list.map((model) => (
                  <CommandItem
                    key={model}
                    value={model}
                    onSelect={() => {
                      onChange(model);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('size-4', model === value ? 'opacity-100' : 'opacity-0')} />
                    {model}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          {models.data && !models.data.ok && <p className="border-t px-3 py-2 text-xs text-muted-foreground">모델 목록을 못 불러왔습니다: {models.data.detail}</p>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ProfilesTab() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const profiles = useQuery(q.profiles());
  const connections = useQuery(q.connections());
  const connectionById = new Map(connections.data?.map((connection) => [connection.id, connection]));
  const selected = search.profile && search.profile !== 'new' ? profiles.data?.find((profile) => profile.id === search.profile) : undefined;
  const close = () => void navigate({ search: (previous) => ({ ...previous, profile: undefined }) });

  return (
    <Split
      list={
        <>
          <p className="mb-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            모델 프로필은 <b className="text-foreground">어떤 모델을 어떻게 부를지</b>(AI 연결·모델·추론 수준·한도·대체 경로·공통 지시문)를 묶어 둔 것입니다. 워크플로의 AI 노드와 에이전트 채팅이 이름으로 골라
            씁니다. <b className="text-foreground">무엇을 시킬지</b>(번역·검수 지시, 출력 형태, 문맥)는 각 AI 노드에서 정합니다.
          </p>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground tabular-nums">{profiles.data?.length ?? '–'}개</span>
            <Button size="sm" disabled={!connections.data?.length} onClick={() => void navigate({ search: (previous) => ({ ...previous, profile: 'new' }) })}>
              <Plus />
              새 모델 프로필
            </Button>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>연결</TableHead>
                  <TableHead>모델</TableHead>
                  <TableHead>추론 수준</TableHead>
                  <TableHead className="text-right">대체 경로</TableHead>
                  <TableHead>용도</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.data?.map((profile) => {
                  const connection = connectionById.get(profile.connectionId);
                  const info = connection ? CONNECTION_KIND_INFO[connection.kind] : undefined;
                  return (
                    <TableRow key={profile.id} className="cursor-pointer" data-state={search.profile === profile.id ? 'selected' : undefined} onClick={() => void navigate({ search: (previous) => ({ ...previous, profile: profile.id }) })}>
                      <TableCell className="font-medium">{profile.name}</TableCell>
                      <TableCell className="text-muted-foreground">{connection?.name ?? '(삭제됨)'}</TableCell>
                      <TableCell className="font-mono text-xs">{profile.model}</TableCell>
                      <TableCell className="text-muted-foreground">{profile.effort ?? '–'}</TableCell>
                      <TableCell className="text-right tabular-nums">{profile.fallbacks.length}</TableCell>
                      <TableCell>{info && <UsageBadge kind={connection!.kind} />}</TableCell>
                    </TableRow>
                  );
                })}
                {profiles.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {connections.data?.length ? '프로필이 없습니다.' : '먼저 연결을 추가하세요.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      }
      pane={search.profile === 'new' ? <ProfileForm key="new" onClose={close} /> : selected ? <ProfileForm key={selected.id} profile={selected} onClose={close} /> : null}
    />
  );
}

function UsageBadge({ kind }: { kind: ConnectionKind }) {
  const capabilities = CONNECTION_KIND_INFO[kind].capabilities;
  if (capabilities.includes('chat')) return <Badge>채팅·생성</Badge>;
  if (capabilities.includes('generate')) return <Badge variant="secondary">생성</Badge>;
  return <Badge variant="outline">검토 전용</Badge>;
}

type ProfileRow = InferResponseType<typeof client.profiles.$get>[number];

function ProfileForm({ profile, onClose }: { profile?: ProfileRow; onClose: () => void }) {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const connections = useQuery(q.connections());
  // HTTP tool connections are for the workflow HTTP function, not for AI profiles.
  const connectionList = (connections.data ?? []).filter((connection) => connection.kind !== 'http');
  const form = useForm<ProfileFormInput, unknown, ProfileFormOutput>({
    resolver: zodResolver(profileInputSchema),
    defaultValues: profile
      ? {
          name: profile.name,
          description: profile.description,
          connectionId: profile.connectionId,
          model: profile.model,
          effort: profile.effort ?? undefined,
          instructions: profile.instructions,
          temperature: profile.temperature ?? undefined,
          maxOutputTokens: profile.maxOutputTokens,
          timeoutSeconds: profile.timeoutSeconds,
          maxAttempts: profile.maxAttempts,
          fallbacks: profile.fallbacks.map((route) => ({ connectionId: route.connectionId, model: route.model, effort: route.effort })),
        }
      : { name: '', description: '', connectionId: '', model: '', instructions: '', maxOutputTokens: 8000, timeoutSeconds: 300, maxAttempts: 2, fallbacks: [] },
  });
  const fallbacks = useFieldArray({ control: form.control, name: 'fallbacks' });
  const connectionId = useWatch({ control: form.control, name: 'connectionId' });
  const watchedFallbacks = useWatch({ control: form.control, name: 'fallbacks' });
  const connection = connectionList.find((item) => item.id === connectionId);
  const efforts = connection ? CONNECTION_KIND_INFO[connection.kind].efforts : [];
  const errors = form.formState.errors;

  // Preselect the first connection for a new profile once connections load.
  useEffect(() => {
    if (!profile && !form.getValues('connectionId') && connectionList[0]) form.setValue('connectionId', connectionList[0].id);
  }, [profile, connectionList, form]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['profiles'] });
    void queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };
  const save = useMutation({
    mutationFn: async (values: ProfileFormOutput) => {
      if (profile) {
        await unwrap(client.profiles[':id'].$put({ param: { id: profile.id }, json: values }));
        return profile.id;
      }
      return (await unwrap(client.profiles.$post({ json: values }))).id;
    },
    onSuccess: (id) => {
      invalidate();
      toast.success('프로필을 저장했습니다.');
      void navigate({ search: (previous) => ({ ...previous, profile: id }) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(client.profiles[':id'].$delete({ param: { id: profile!.id } })),
    onSuccess: () => {
      invalidate();
      toast.success('프로필을 삭제했습니다.');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div>
      <PaneHeader title={profile ? profile.name : '새 모델 프로필'} onClose={onClose} />
      {connection && (
        <p className="mb-4 text-sm text-muted-foreground">
          <UsageBadge kind={connection.kind} />{' '}
          {CONNECTION_KIND_INFO[connection.kind].capabilities.includes('chat') ? '프로젝트 채팅에 사용할 수 있습니다.' : CONNECTION_KIND_INFO[connection.kind].capabilities.includes('generate') ? '채팅에는 쓸 수 없고 생성에만 사용합니다.' : '검토(판정) 전용이며 번역 생성에는 쓸 수 없습니다.'}
        </p>
      )}
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <FieldGroup className="gap-4">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="p-name">이름</FieldLabel>
            <Input id="p-name" {...form.register('name')} aria-invalid={!!errors.name} />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-desc">설명</FieldLabel>
            <Input id="p-desc" {...form.register('description')} />
          </Field>
          <Field data-invalid={!!errors.connectionId}>
            <FieldLabel>연결</FieldLabel>
            <Controller
              control={form.control}
              name="connectionId"
              render={({ field }) => (
                <Select
                  value={field.value || undefined}
                  onValueChange={(value) => {
                    field.onChange(value);
                    form.setValue('model', '');
                    form.setValue('effort', undefined);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="연결 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {connectionList.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} · {CONNECTION_KIND_INFO[item.kind].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.connectionId]} />
          </Field>
          <Field data-invalid={!!errors.model}>
            <FieldLabel htmlFor="p-model">모델</FieldLabel>
            <Controller control={form.control} name="model" render={({ field }) => <ModelPicker id="p-model" connectionId={connectionId} value={field.value} onChange={field.onChange} />} />
            <FieldError errors={[errors.model]} />
          </Field>
          {efforts.length > 0 && (
            <Field>
              <FieldLabel>추론 수준</FieldLabel>
              <Controller
                control={form.control}
                name="effort"
                render={({ field }) => (
                  <Select value={field.value ?? NONE} onValueChange={(value) => field.onChange(value === NONE ? undefined : value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>기본값</SelectItem>
                      {efforts.map((effort) => (
                        <SelectItem key={effort} value={effort}>
                          {effort}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="p-instr">공통 지시문 (선택)</FieldLabel>
            <Textarea id="p-instr" rows={5} {...form.register('instructions')} placeholder="예: 반말 위주의 게임입니다. 고유명사는 용어집을 따르세요." />
            <FieldDescription>이 프로필로 하는 모든 호출에 덧붙습니다. 단계별 지시는 AI 노드에 씁니다.</FieldDescription>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field data-invalid={!!errors.temperature}>
              <FieldLabel htmlFor="p-temp">온도 (선택)</FieldLabel>
              <Input id="p-temp" type="number" step="0.1" {...form.register('temperature', { setValueAs: numberOrUndefined })} aria-invalid={!!errors.temperature} />
              <FieldError errors={[errors.temperature]} />
            </Field>
            <Field data-invalid={!!errors.maxAttempts}>
              <FieldLabel htmlFor="p-att">최대 시도 횟수</FieldLabel>
              <Input id="p-att" type="number" {...form.register('maxAttempts', { setValueAs: numberField })} aria-invalid={!!errors.maxAttempts} />
              <FieldError errors={[errors.maxAttempts]} />
            </Field>
            <Field data-invalid={!!errors.maxOutputTokens}>
              <FieldLabel htmlFor="p-tok">최대 출력 토큰</FieldLabel>
              <Input id="p-tok" type="number" {...form.register('maxOutputTokens', { setValueAs: numberField })} aria-invalid={!!errors.maxOutputTokens} />
              <FieldError errors={[errors.maxOutputTokens]} />
            </Field>
            <Field data-invalid={!!errors.timeoutSeconds}>
              <FieldLabel htmlFor="p-to">시간 제한(초)</FieldLabel>
              <Input id="p-to" type="number" {...form.register('timeoutSeconds', { setValueAs: numberField })} aria-invalid={!!errors.timeoutSeconds} />
              <FieldError errors={[errors.timeoutSeconds]} />
            </Field>
          </div>

          <Separator />
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">대체 경로</span>
              <Button type="button" variant="outline" size="sm" disabled={fallbacks.fields.length >= 3 || !connectionList.length} onClick={() => fallbacks.append({ connectionId: connectionList[0]!.id, model: '' })}>
                <Plus />
                추가
              </Button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">기본 경로가 일시적 오류(요청 한도·네트워크·시간 초과)로 실패하면 순서대로 사용</p>
            <div className="mt-3 flex flex-col gap-3">
              {fallbacks.fields.map((row, index) => {
                const rowConnection = connectionList.find((item) => item.id === watchedFallbacks?.[index]?.connectionId);
                const rowEfforts = rowConnection ? CONNECTION_KIND_INFO[rowConnection.kind].efforts : [];
                const rowErrors = errors.fallbacks?.[index];
                return (
                  <div key={row.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{index + 1}번째 대체</span>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => fallbacks.remove(index)} aria-label="대체 경로 삭제">
                        <Trash2 />
                      </Button>
                    </div>
                    <FieldGroup className="mt-2 gap-3">
                      <Controller
                        control={form.control}
                        name={`fallbacks.${index}.connectionId`}
                        render={({ field }) => (
                          <Select
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              form.setValue(`fallbacks.${index}.model`, '');
                              form.setValue(`fallbacks.${index}.effort`, undefined);
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {connectionList.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <Field data-invalid={!!rowErrors?.model}>
                        <Controller control={form.control} name={`fallbacks.${index}.model`} render={({ field }) => <ModelPicker connectionId={watchedFallbacks?.[index]?.connectionId} value={field.value ?? ''} onChange={field.onChange} />} />
                        <FieldError errors={[rowErrors?.model]} />
                      </Field>
                      {rowEfforts.length > 0 && (
                        <Controller
                          control={form.control}
                          name={`fallbacks.${index}.effort`}
                          render={({ field }) => (
                            <Select value={field.value ?? NONE} onValueChange={(value) => field.onChange(value === NONE ? undefined : value)}>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>추론 수준: 기본값</SelectItem>
                                {rowEfforts.map((effort) => (
                                  <SelectItem key={effort} value={effort}>
                                    {effort}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      )}
                    </FieldGroup>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {profile ? '저장' : '만들기'}
            </Button>
            {profile && <DeleteButton label={`프로필 '${profile.name}'`} description="이 프로필을 쓰는 워크플로의 노드는 프로필을 다시 지정해야 할 수 있습니다." pending={remove.isPending} onConfirm={() => remove.mutate()} />}
          </div>
        </FieldGroup>
      </form>
      {profile && <ProfileTest profileId={profile.id} />}
    </div>
  );
}

function ProfileTest({ profileId }: { profileId: string }) {
  const [source, setSource] = useState('');
  const test = useMutation({
    mutationFn: () => unwrap(client.profiles[':id'].test.$post({ param: { id: profileId }, json: { source, targetLanguage: 'ko' } })),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const result = test.data;
  return (
    <>
      <Separator className="my-4" />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">시험</span>
        <p className="text-sm text-muted-foreground">시험 결과는 프로젝트에 저장되지 않습니다. 저장된 프로필 설정으로 실행됩니다.</p>
        <Textarea rows={3} value={source} onChange={(event) => setSource(event.target.value)} placeholder="번역해 볼 원문 문장" />
        <Button type="button" variant="secondary" className="self-start" disabled={!source.trim() || test.isPending} onClick={() => test.mutate()}>
          {test.isPending && <Spinner />}
          시험 실행
        </Button>
        {result &&
          (result.ok ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="whitespace-pre-wrap">{result.text}</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {result.model} · {result.ms.toLocaleString()}ms · {result.attempts.length}회 시도
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-destructive/40 p-3 text-sm break-words text-destructive">
              {result.detail} <span className="font-mono text-xs">({result.ms.toLocaleString()}ms)</span>
            </p>
          ))}
      </div>
    </>
  );
}
