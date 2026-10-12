import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Check, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { CONNECTION_KIND_INFO, CONNECTION_KINDS, connectionInputSchema, profileInputSchema, type Capability, type ConnectionKind } from '@tw/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { Page } from '@/components/page';
import { AgentTab } from '@/components/settings/agent-tab';
import { PiOptionsPanel } from '@/components/settings/pi-options';
import { SplitPane } from '@/components/split-pane';
import { Toolbar } from '@/components/toolbar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/p/$projectId/settings/ai')({
  validateSearch: (raw: Record<string, unknown>): { conn?: string; profile?: string } => ({
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : undefined,
    profile: typeof raw.profile === 'string' && raw.profile ? raw.profile : undefined,
  }),
  component: AiSettings,
});

const CAPABILITY_LABEL: Record<Capability, string> = { generate: '생성', judge: '판정', chat: '채팅', tool: '도구' };
const NONE = '__none';
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type ConnectionRow = InferResponseType<typeof client.connections.$get>[number];
type ProfileRow = InferResponseType<typeof client.profiles.$get>[number];

/** One line of the list: a connection, a profile under it, or a note that a connection has none. */
type AiRow =
  | { type: 'connection'; id: string; connection: ConnectionRow }
  | { type: 'profile'; id: string; profile: ProfileRow; indent: boolean }
  | { type: 'note'; id: string; text: string };

/**
 * Everything about AI on one page: connections with the model profiles under each (what nodes and
 * the work analysis pick), and which tools the chat agent may use. API keys for HTTP nodes have their own page.
 * The pane on the right edits the selected connection or profile ("conn" / "profile" in the URL).
 */
function AiSettings() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const connections = useQuery(q.connections());
  const profiles = useQuery(q.profiles());
  const open = (next: { conn?: string; profile?: string }) => void navigate({ search: (previous) => ({ ...previous, conn: next.conn, profile: next.profile }) });
  const close = () => open({});
  const selectedConnection = search.conn && !search.conn.startsWith('new') ? connections.data?.find((connection) => connection.id === search.conn) : undefined;
  const selectedProfile = search.profile && !search.profile.startsWith('new') ? profiles.data?.find((profile) => profile.id === search.profile) : undefined;
  const newProfileFor = search.profile?.startsWith('new') ? search.profile.slice(4) || undefined : undefined;

  const rows = useMemo<AiRow[] | undefined>(() => {
    if (!connections.data || !profiles.data) return undefined;
    const aiConnections = connections.data.filter((connection) => connection.kind !== 'http');
    const byConnection = Map.groupBy(profiles.data, (profile) => profile.connectionId);
    const orphans = profiles.data.filter((profile) => !connections.data.some((connection) => connection.id === profile.connectionId));
    return [
      ...aiConnections.flatMap<AiRow>((connection) => {
        const own = byConnection.get(connection.id) ?? [];
        return [
          { type: 'connection', id: `c:${connection.id}`, connection },
          ...own.map<AiRow>((profile) => ({ type: 'profile', id: `p:${profile.id}`, profile, indent: true })),
          ...(own.length ? [] : [{ type: 'note' as const, id: `n:${connection.id}`, text: '이 연결로 만든 프로필이 없습니다.' }]),
        ];
      }),
      ...orphans.map<AiRow>((profile) => ({ type: 'profile', id: `p:${profile.id}`, profile, indent: false })),
    ];
  }, [connections.data, profiles.data]);

  const selectedId = selectedConnection ? `c:${selectedConnection.id}` : selectedProfile ? `p:${selectedProfile.id}` : undefined;

  const columns: ColumnDef<AiRow, unknown>[] = [
    {
      id: 'name',
      header: '이름',
      cell: ({ row: { original: row } }) =>
        row.type === 'connection' ? (
          <span className="font-semibold">{row.connection.name}</span>
        ) : row.type === 'profile' ? (
          <span className={cn('font-medium', row.indent && 'pl-5')}>{row.profile.name}</span>
        ) : (
          <span className="pl-5 text-muted-foreground">{row.text}</span>
        ),
    },
    {
      id: 'model',
      header: '종류 / 모델',
      meta: { width: 200 },
      cell: ({ row: { original: row } }) =>
        row.type === 'connection' ? (
          <span className="text-muted-foreground">{CONNECTION_KIND_INFO[row.connection.kind].label}</span>
        ) : row.type === 'profile' ? (
          <span className="font-mono text-xs">{row.profile.model}</span>
        ) : null,
    },
    {
      id: 'settings',
      header: '설정',
      cell: ({ row: { original: row } }) => {
        if (row.type === 'profile') {
          const { profile } = row;
          return <span className="text-muted-foreground">{[profile.effort, `출력 ${profile.maxOutputTokens.toLocaleString()}`, profile.fallbacks.length ? `대체 ${profile.fallbacks.length}` : null].filter(Boolean).join(' · ')}</span>;
        }
        if (row.type !== 'connection') return null;
        const { connection } = row;
        const info = CONNECTION_KIND_INFO[connection.kind];
        return (
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs text-muted-foreground">{info.transport === 'http' ? connection.baseUrl : info.transport === 'cli' ? (connection.executable ?? 'PATH') : ''}</span>
            {info.transport === 'http' && <Badge variant={connection.hasKey ? 'default' : 'outline'}>{connection.hasKey ? '키 저장됨' : '키 없음'}</Badge>}
            <CapabilityBadges kind={connection.kind} />
            <Badge variant="outline">동시 {connection.concurrency ?? 2}</Badge>
          </div>
        );
      },
    },
    {
      id: 'actions',
      meta: { width: 112, align: 'end' },
      cell: ({ row: { original: row } }) =>
        row.type === 'connection' ? (
          <Button variant="ghost" title="이 연결로 모델 프로필 추가" onClick={(event) => (event.stopPropagation(), open({ profile: `new:${row.connection.id}` }))}>
            <Plus /> 프로필
          </Button>
        ) : null,
    },
  ];

  const pane =
    search.conn === 'new' ? (
      <NewConnection onClose={close} />
    ) : selectedConnection ? (
      <ConnectionPane key={selectedConnection.id} connection={selectedConnection} onClose={close} />
    ) : search.profile?.startsWith('new') ? (
      <ProfileForm key={search.profile} connectionId={newProfileFor} onClose={close} />
    ) : selectedProfile ? (
      <ProfileForm key={selectedProfile.id} profile={selectedProfile} onClose={close} />
    ) : null;

  const connectionCount = rows?.filter((row) => row.type === 'connection').length ?? 0;
  const profileCount = rows?.filter((row) => row.type === 'profile').length ?? 0;

  return (
    <Page title="AI" flush>
      <SplitPane id="settings-ai" defaultWidth="448px" className="h-full" pane={pane}>
        <div className="min-h-0 flex-1 overflow-auto">
          <Toolbar
            count={rows ? `연결 ${connectionCount} · 프로필 ${profileCount}` : undefined}
            actions={
              <Button onClick={() => open({ conn: 'new' })}>
                <Plus /> 연결 추가
              </Button>
            }
          >
            <p className="max-w-2xl text-xs text-muted-foreground">연결은 AI를 부르는 통로(API·CLI·pi), 프로필은 그 아래에서 모델과 조건(출력 한도·제한 시간·대체 모델·공통 지시문)을 묶은 것입니다. 워크플로의 AI 노드와 작품 분석은 프로필을 고릅니다.</p>
          </Toolbar>
          <DataTable
            className="flex-none"
            columns={columns}
            rows={rows}
            rowId={(row) => row.id}
            selected={selectedId}
            empty="연결이 없습니다. “연결 추가”로 시작하세요."
            rowClassName={(row) => (row.type === 'connection' && row.id !== selectedId ? 'bg-muted/40' : undefined)}
            onRowClick={(row) => {
              if (row.type === 'connection') open({ conn: row.connection.id });
              else if (row.type === 'profile') open({ profile: row.profile.id });
            }}
          />
          <ProfileTests />
          <section className="space-y-3 border-t px-4 py-6">
            <div>
              <h2 className="text-sm font-semibold">채팅 도구</h2>
              <p className="text-xs text-muted-foreground">오른쪽 채팅 패널의 AI와 터미널의 loca CLI가 쓸 수 있는 도구를 켜고 끕니다. 끈 도구는 AI에게 아예 보이지 않습니다. 변경 도구는 켜 두어도 항상 수락 카드를 거칩니다.</p>
            </div>
            <AgentTab />
          </section>
        </div>
      </SplitPane>
    </Page>
  );
}

function DeleteButton({ label, description, pending, onConfirm }: { label: string; description: string; pending: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive" disabled={pending}>
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

function UsageBadge({ kind }: { kind: ConnectionKind }) {
  const capabilities = CONNECTION_KIND_INFO[kind].capabilities;
  if (capabilities.includes('chat')) return <Badge>채팅·생성</Badge>;
  if (capabilities.includes('generate')) return <Badge variant="secondary">생성</Badge>;
  return <Badge variant="outline">검토 전용</Badge>;
}

function ProfileForm({ profile, connectionId: initialConnection, onClose }: { profile?: ProfileRow; connectionId?: string; onClose: () => void }) {
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
      : { name: '', description: '', connectionId: initialConnection ?? '', model: '', instructions: '', maxOutputTokens: 8000, timeoutSeconds: 300, maxAttempts: 2, fallbacks: [] },
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
    <DetailPane
      kicker="모델 프로필"
      title={profile ? profile.name : '새 모델 프로필'}
      subtitle={
        connection ? (
          <>
            <UsageBadge kind={connection.kind} />{' '}
            {CONNECTION_KIND_INFO[connection.kind].capabilities.includes('chat') ? '프로젝트 채팅에 사용할 수 있습니다.' : CONNECTION_KIND_INFO[connection.kind].capabilities.includes('generate') ? '채팅에는 쓸 수 없고 생성에만 사용합니다.' : '검토(판정) 전용이며 번역 생성에는 쓸 수 없습니다.'}
          </>
        ) : undefined
      }
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form="profile-form" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            {profile ? '저장' : '만들기'}
          </Button>
          {profile && <DeleteButton label={`프로필 '${profile.name}'`} description="이 프로필을 쓰는 워크플로의 노드는 프로필을 다시 지정해야 할 수 있습니다." pending={remove.isPending} onConfirm={() => remove.mutate()} />}
        </>
      }
    >
      <form id="profile-form" className="space-y-6" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <PaneSection title="모델">
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
          </FieldGroup>
        </PaneSection>

        <PaneSection title="호출 조건">
          <div className="grid grid-cols-2 gap-4">
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
        </PaneSection>

        <PaneSection
          title="대체 경로"
          actions={
            <Button type="button" variant="ghost" disabled={fallbacks.fields.length >= 3 || !connectionList.length} onClick={() => fallbacks.append({ connectionId: connectionList[0]!.id, model: '' })}>
              <Plus />
              추가
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground">기본 경로가 일시적 오류(요청 한도·네트워크·시간 초과)로 실패하면 순서대로 사용</p>
          <div className="mt-3 flex flex-col gap-3">
            {fallbacks.fields.map((row, index) => {
              const rowConnection = connectionList.find((item) => item.id === watchedFallbacks?.[index]?.connectionId);
              const rowEfforts = rowConnection ? CONNECTION_KIND_INFO[rowConnection.kind].efforts : [];
              const rowErrors = errors.fallbacks?.[index];
              return (
                <div key={row.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{index + 1}번째 대체</span>
                    <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => fallbacks.remove(index)} aria-label="대체 경로 삭제">
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
        </PaneSection>
      </form>
      {profile && <ProfileTest profileId={profile.id} />}
    </DetailPane>
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
    <PaneSection title="시험">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">시험 결과는 프로젝트에 저장되지 않습니다. 저장된 프로필 설정으로 실행됩니다.</p>
        <Textarea rows={3} value={source} onChange={(event) => setSource(event.target.value)} placeholder="번역해 볼 원문 문장" />
        <Button type="button" variant="outline" className="self-start" disabled={!source.trim() || test.isPending} onClick={() => test.mutate()}>
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
    </PaneSection>
  );
}

/** Recent profile tests: they run outside any project, so this is where their requests are logged. */
function ProfileTests() {
  const tests = useQuery(q.profileTests());
  if (!tests.data?.length) return null;
  const columns: ColumnDef<(typeof tests.data)[number], unknown>[] = [
    { id: 'at', header: '시각', meta: { width: 176, className: 'text-muted-foreground tabular-nums' }, cell: ({ row }) => new Date(row.original.startedAt).toLocaleString() },
    { id: 'label', header: '프로필', meta: { width: 200, className: 'font-medium' }, cell: ({ row }) => row.original.label },
    { id: 'model', header: '모델', meta: { width: 220, className: 'text-muted-foreground' }, cell: ({ row }) => row.original.model },
    {
      id: 'result',
      header: '결과',
      cell: ({ row: { original: call } }) => (
        <span className={call.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
          {call.status === 'running' ? '진행 중' : call.status === 'failed' ? `실패${call.error ? `: ${call.error}` : ''}` : `${((new Date(call.finishedAt!).getTime() - new Date(call.startedAt).getTime()) / 1000).toFixed(1)}초`}
        </span>
      ),
    },
  ];
  return (
    <section className="border-t pt-4">
      <h2 className="px-4 pb-2 text-sm font-semibold">최근 프로필 시험 {tests.data.length}건</h2>
      <DataTable className="flex-none" columns={columns} rows={tests.data} rowId={(call) => call.id} />
    </section>
  );
}
