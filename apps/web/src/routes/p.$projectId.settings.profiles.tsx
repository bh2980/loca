import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Check, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CONNECTION_KIND_INFO, profileInputSchema, type ConnectionKind } from '@tw/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { Page } from '@/components/page';
import { DeleteButton } from '@/components/settings/delete-button';
import { SplitPane } from '@/components/split-pane';
import { Toolbar } from '@/components/toolbar';
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

export const Route = createFileRoute('/p/$projectId/settings/profiles')({
  validateSearch: (raw: Record<string, unknown>): { profile?: string } => ({
    profile: typeof raw.profile === 'string' && raw.profile ? raw.profile : undefined,
  }),
  component: ProfileSettings,
});

const NONE = '__none';
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type ProfileRow = InferResponseType<typeof client.profiles.$get>[number];

/**
 * Model profiles: a model plus its conditions under a connection. Workflow AI nodes and the work
 * analysis pick one. The pane on the right edits the selected profile ("profile" in the URL;
 * "new" starts a blank one).
 */
function ProfileSettings() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const profiles = useQuery(q.profiles());
  const connections = useQuery(q.connections());
  const open = (profile?: string) => void navigate({ search: (previous) => ({ ...previous, profile }), replace: true });
  const close = () => open(undefined);
  const isNew = search.profile === 'new';
  const selected = search.profile && !isNew ? profiles.data?.find((profile) => profile.id === search.profile) : undefined;
  const connectionName = (id: string) => connections.data?.find((connection) => connection.id === id)?.name ?? '';

  const columns: ColumnDef<ProfileRow, unknown>[] = [
    { id: 'name', header: '이름', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: 'model', header: '모델', meta: { width: 240, className: 'font-mono text-xs text-muted-foreground' }, cell: ({ row }) => row.original.model },
    { id: 'connection', header: '연결', meta: { width: 180, className: 'text-muted-foreground' }, cell: ({ row }) => connectionName(row.original.connectionId) },
    { id: 'max', header: '출력 한도', meta: { width: 104, align: 'end', className: 'tabular-nums' }, cell: ({ row }) => row.original.maxOutputTokens.toLocaleString() },
  ];

  const pane = isNew ? <ProfileForm key="new" onClose={close} /> : selected ? <ProfileForm key={selected.id} profile={selected} onClose={close} /> : null;

  return (
    <Page title="모델 프로필" flush>
      <SplitPane id="settings-profiles" defaultWidth="448px" className="h-full" pane={pane}>
        <div className="min-h-0 flex-1 overflow-auto">
          <Toolbar
            count={profiles.data ? `프로필 ${profiles.data.length}` : undefined}
            actions={
              <Button onClick={() => open('new')}>
                <Plus /> 프로필 추가
              </Button>
            }
          />
          <DataTable
            className="flex-none"
            columns={columns}
            rows={profiles.data}
            rowId={(row) => row.id}
            selected={selected?.id}
            empty="모델 프로필이 없습니다. “프로필 추가”로 시작하세요."
            onRowClick={(row) => open(row.id)}
          />
        </div>
      </SplitPane>
    </Page>
  );
}

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
      {profile && <RecentTests profileId={profile.id} />}
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

/** The latest tests of this profile: they run outside any project, so this is where their requests are logged. */
function RecentTests({ profileId }: { profileId: string }) {
  const tests = useQuery(q.profileTests());
  const own = tests.data?.filter((call) => call.profileId === profileId).slice(0, 5);
  if (!own?.length) return null;
  return (
    <PaneSection title="최근 시험">
      <ul className="flex flex-col gap-1 text-sm">
        {own.map((call) => (
          <li key={call.id} className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">{new Date(call.startedAt).toLocaleString()}</span>
            <span className={cn('min-w-0 truncate', call.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
              {call.status === 'running' ? '진행 중' : call.status === 'failed' ? `실패${call.error ? `: ${call.error}` : ''}` : `${((new Date(call.finishedAt!).getTime() - new Date(call.startedAt).getTime()) / 1000).toFixed(1)}초`}
            </span>
          </li>
        ))}
      </ul>
    </PaneSection>
  );
}
