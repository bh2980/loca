import { useFormFrom, changedFields } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CONNECTION_KIND_INFO,
  CONNECTION_KINDS,
  connectionInputSchema,
  type Capability,
  type ConnectionKind,
} from '@tw/shared';
import {
  Chip,
  Box,
  Button,
  type ColumnDef,
  DataTable,
  DirtyBar,
  EmptyState,
  Input,
  Inspector,
  InspectorHeader,
  InspectorActionRow,
  InspectorResult,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
  Spinner,
  Stack,
  Text,
  Textarea,
  SelectTrigger,
  Section,
  Field,
  PageBody,
  SplitPane,
} from '@loca/ui';
import { Page } from '@/components/page';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { DeleteButton } from '@/components/settings/delete-button';
import { KeyPane, type KeyRow } from '@/components/settings/key-pane';
import { ExecutableField } from '@/components/settings/executable-field';
import { unwrap } from '@/lib/api';
import { client } from '@/lib/api';
import { connectionsApi, type ConnectionRow, type SettingsTarget } from '@/lib/settings-target';
import { useReportView } from '@/lib/view-context';
import { dateTime } from '@/lib/datetime';
import { changeConnection, useConnections } from '@/lib/app-data';
import { useConnectionTests } from '@/lib/logs';

const CAPABILITY_LABEL: Record<Capability, string> = { generate: '생성', judge: '판정', chat: '채팅', tool: '도구' };
const LOGIN_LABEL: Record<string, string> = {
  'signed-in': '로그인됨',
  'signed-out': '로그인 필요',
};
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type ConnectionsSearch = { conn?: string; key?: string };

/**
 * The AI connections and API keys of one settings target (a project, or the home's defaults).
 * The selection lives in the route's URL: the route passes it in `search` and applies what `onSearch` asks for.
 */
export function ConnectionsSettings({ target, search, onSearch, description }: { target: SettingsTarget; search: ConnectionsSearch; onSearch: (next: ConnectionsSearch) => void; description?: string }) {
  const connections = useConnections(target);

  const openConn = (conn?: string) => onSearch({ conn });
  const openKey = (key?: string) => onSearch({ key });
  const close = () => onSearch({});

  const aiRows = connections.data?.filter((c) => c.kind !== 'http');
  const keyRows = connections.data?.filter((c) => c.kind === 'http') as KeyRow[] | undefined;

  const selectedConn = search.conn && search.conn !== 'new' ? connections.data?.find((c) => c.id === search.conn) : undefined;
  const selectedKey = search.key && search.key !== 'new' ? keyRows?.find((k) => k.id === search.key) : undefined;

  useReportView('settings-connections', [
    selectedConn && { kind: 'AI 연결', id: selectedConn.id, label: selectedConn.name },
    selectedKey && { kind: 'API 키', id: selectedKey.id, label: selectedKey.name },
  ]);

  const aiColumns: ColumnDef<ConnectionRow, unknown>[] = [
    { id: 'name', header: '이름', meta: { hideable: false }, cell: ({ row }) => <Text weight="medium">{row.original.name}</Text> },
    { id: 'kind', header: '종류', meta: { width: 200, tone: 'muted' }, cell: ({ row }) => CONNECTION_KIND_INFO[row.original.kind].label },
    {
      id: 'state',
      header: '상태',
      meta: { width: 120 },
      cell: ({ row: { original: connection } }) => (CONNECTION_KIND_INFO[connection.kind].transport === 'http' && !connection.hasKey ? <Text tone="warning">키 없음</Text> : null),
    },
  ];

  const keyColumns: ColumnDef<KeyRow, unknown>[] = [
    { id: 'name', header: '이름', meta: { weight: 'medium', hideable: false }, cell: ({ row }) => row.original.name },
    { id: 'header', header: '헤더', meta: { mono: true, variant: 'caption', tone: 'muted' }, cell: ({ row }) => row.original.headerTemplate || '–' },
    { id: 'key', header: '키', meta: { width: 96 }, cell: ({ row }) => <Chip variant={row.original.hasKey ? 'solid' : 'outline'}>{row.original.hasKey ? '저장됨' : '없음'}</Chip> },
  ];

  const pane = search.conn === 'new' ? (
    <NewConnection target={target} onClose={close} onCreated={(id) => openConn(id)} />
  ) : selectedConn ? (
    <ConnectionPane key={selectedConn.id} target={target} connection={selectedConn} onClose={close} />
  ) : search.key === 'new' || selectedKey ? (
    <KeyPane target={target} key={selectedKey?.id ?? 'new'} row={selectedKey} onClose={close} onCreated={(id) => openKey(id)} />
  ) : null;

  return (
    <Page title="연결" flush>
      <SplitPane fill="height" id="settings-connections" selectionKey={search.conn ?? search.key} defaultWidth="448px" pane={pane}>
        <PageBody width="wide">
          <Box spaceY="wide">
            {description && <Text as="p" tone="muted">{description}</Text>}
            <Section variant="page"
              title="AI 연결"
              footer={
                <Button onClick={() => openConn('new')}>
                  <Plus /> 연결 추가
                </Button>
              }
            >
              <Box overflow="hidden" radius="md" border="all" borderColor="default">
                <DataTable
                  id="connections"
                  columns={aiColumns}
                  rows={aiRows}
                  rowId={(row) => row.id}
                  selected={selectedConn?.id}
                  empty={<EmptyState noun="AI 연결" />}
                  onRowClick={(row) => openConn(row.id === search.conn ? undefined : row.id)}
                />
              </Box>
            </Section>

            <Section variant="page"
              title="API 키"
              footer={
                <Button onClick={() => openKey('new')}>
                  <Plus /> API 키 추가
                </Button>
              }
            >
              <Box overflow="hidden" radius="md" border="all" borderColor="default">
                <DataTable
                  id="keys"
                  columns={keyColumns}
                  rows={connections.data ? keyRows : undefined}
                  rowId={(row) => row.id}
                  selected={search.key}
                  empty={<EmptyState noun="API 키" />}
                  onRowClick={(row) => openKey(row.id === search.key ? undefined : row.id)}
                />
              </Box>
            </Section>
          </Box>
        </PageBody>
      </SplitPane>
    </Page>
  );
}

function CapabilityBadges({ kind }: { kind: ConnectionKind }) {
  return (
    <Stack direction="row" wrap gap="tight">
      {CONNECTION_KIND_INFO[kind].capabilities.map((capability) => (
        <Chip key={capability} variant="quiet">
          {CAPABILITY_LABEL[capability]}
        </Chip>
      ))}
    </Stack>
  );
}

const connectionFormSchema = connectionInputSchema.extend({ apiKey: z.string().optional() });
type ConnectionFormInput = z.input<typeof connectionFormSchema>;
type ConnectionFormOutput = z.output<typeof connectionFormSchema>;

function NewConnection({ target, onClose, onCreated }: { target: SettingsTarget; onClose: () => void; onCreated?: (id: string) => void }) {
  const form = useForm<ConnectionFormInput, unknown, ConnectionFormOutput>({
    resolver: zodResolver(connectionFormSchema),
    defaultValues: { kind: 'openai', name: '', baseUrl: CONNECTION_KIND_INFO.openai.defaultBaseUrl, executable: '', apiKey: '' },
  });
  const kind = useWatch({ control: form.control, name: 'kind' });
  const info = CONNECTION_KIND_INFO[kind];

  const create = useMutation({
    // Done once the feed has brought the new row, so the list and the pane it opens have it.
    mutationFn: (values: ConnectionFormOutput) =>
      changeConnection(
        target,
        connectionsApi(target).create({
          kind: values.kind,
          name: values.name,
          baseUrl: info.transport === 'http' ? values.baseUrl : undefined,
          executable: info.transport === 'cli' ? values.executable || undefined : undefined,
          apiKey: info.transport === 'http' && values.apiKey ? values.apiKey : undefined,
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
        <Section title="설정">
          <Box spaceY="normal">
            <Field label="종류" description={<CapabilityBadges kind={kind} />}>
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
                    <SelectTrigger width="full">
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
            </Field>
            <Field label="이름" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} aria-invalid={!!form.formState.errors.name} placeholder="예: 회사 OpenAI" />
            </Field>
            {info.transport === 'http' ? (
              <>
                <Field label="주소" error={form.formState.errors.baseUrl?.message}>
                  <Input {...form.register('baseUrl', { setValueAs: (value: string) => (value ? value : undefined) })} aria-invalid={!!form.formState.errors.baseUrl} />
                </Field>
                <Field label="API 키">
                  <Input type="password" autoComplete="off" {...form.register('apiKey')} />
                </Field>
              </>
            ) : (
              <Controller control={form.control} name="executable" render={({ field }) => <ExecutableField target={target} key={kind} kind={kind} value={field.value ?? ''} onChange={field.onChange} />} />
            )}
          </Box>
        </Section>
      </form>
    </Inspector>
  );
}

function ConnectionPane({ target, connection, onClose }: { target: SettingsTarget; connection: ConnectionRow; onClose: () => void }) {
  const api = connectionsApi(target);
  const info = CONNECTION_KIND_INFO[connection.kind];
  const isHttp = info.transport === 'http';
  const isTool = connection.kind === 'http';
  const [apiKey, setApiKey] = useState('');
  const [probeResult, setProbeResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [login, setLogin] = useState<string | null>(null);

  const editSchema = connectionInputSchema.omit({ kind: true });
  const saved = {
    name: connection.name,
    baseUrl: connection.baseUrl ?? undefined,
    executable: connection.executable ?? '',
    headerTemplate: connection.headerTemplate ?? '',
  };
  const edit = useFormFrom(saved, `connection.${connection.id}`);
  const dirtyFields = changedFields(edit.draft, saved);
  const [errors, setErrors] = useState<Record<string, { message: string }>>({});
  const onlyDirty = <T extends object>(json: T) => changedFields(json, saved as T);
  const need: Capability[] = info.capabilities.includes('judge') ? ['judge'] : ['generate'];

  const save = useMutation({
    mutationFn: (values: z.output<typeof editSchema>) =>
      changeConnection(
        target,
        api.patch(
          connection.id,
          onlyDirty({
            name: values.name,
            baseUrl: isHttp ? values.baseUrl : undefined,
            executable: isHttp ? undefined : (values.executable ?? ''),
            headerTemplate: connection.kind === 'http' ? (values.headerTemplate ?? '') : undefined,
          }),
        ),
      ),
    onSuccess: () => {
      toast.success('저장했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveKey = useMutation({
    mutationFn: () => changeConnection(target, api.putKey(connection.id, apiKey)),
    onSuccess: () => {
      setApiKey('');
      toast.success('키를 저장했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const deleteKey = useMutation({
    mutationFn: () => changeConnection(target, api.deleteKey(connection.id)),
    onSuccess: () => {
      toast.success('키를 삭제했습니다.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => changeConnection(target, api.remove(connection.id)),
    onSuccess: onClose,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const probe = useMutation({
    mutationFn: () => unwrap(api.probe(connection.id)),
    onSuccess: setProbeResult,
    onError: (error) => setProbeResult({ ok: false, detail: errorMessage(error) }),
  });
  const loginStatus = useMutation({
    mutationFn: () => unwrap(api.loginStatus(connection.id)),
    onSuccess: (result) => setLogin(result.status === 'error' ? result.detail : result.status),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const openLogin = useMutation({
    mutationFn: () => unwrap(api.openLogin(connection.id)),
    onSuccess: (result) => (result.ok ? toast.success(`${connection.kind === 'antigravity' ? 'agy를 열었습니다' : '로그인 창을 열었습니다'}: ${result.command}`) : toast.error(result.detail)),
    onError: (error) => toast.error(errorMessage(error)),
  });

  // A new API key is part of the draft: saved with the rest by 저장, not by a button of its own.
  const dirtyCount = Object.keys(dirtyFields).length + (apiKey.trim() ? 1 : 0);
  const saveAll = () => {
    if (edit.conflicts.length) return;
    if (Object.keys(dirtyFields).length) {
      const parsed = editSchema.safeParse(edit.draft);
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), { message: issue.message }])));
        return;
      }
      setErrors({});
      save.mutate(parsed.data);
    }
    if (apiKey.trim()) saveKey.mutate();
  };

  return (
    <Inspector footerStart={<><DeleteButton
          label={`연결 '${connection.name}'`}
          description="워크플로 노드(재요청 노드의 다른 모델 포함)·대화가 이 연결을 쓰고 있으면 삭제되지 않습니다. 저장된 API 키도 함께 삭제됩니다."
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        /></>}
      header={<InspectorHeader kind={isTool ? '도구' : 'AI 연결'} name={connection.name} status={info.label} onClose={onClose} />}
      footer={
        dirtyCount > 0 ? (
          <DirtyBar dirtyCount={dirtyCount} onRevert={() => { edit.reset(); setErrors({}); setApiKey(''); }} onSave={saveAll} saving={save.isPending || saveKey.isPending} />
        ) : (
          <Button disabled>저장</Button>
        )
      }
    >
      {connection.keyCopyPending && <Section><Text tone="warning">키 복사가 끝나지 않아 사용할 수 없습니다. 기본값을 다시 가져오거나 API 키를 저장하세요.</Text></Section>}
      {edit.conflicts.length > 0 && <Section><ChangedElsewhere fields={edit.conflicts.map((field) => ({ name: '이름', baseUrl: '주소', executable: '실행 파일', headerTemplate: '헤더' } as Record<string, string>)[field] ?? field)} onTakeSaved={edit.takeSaved} onKeepMine={edit.keepMine} /></Section>}
      <Section title="설정">
        <Box spaceY="normal">
          {info.transport === 'cli' && <Text as="p" variant="caption" tone="muted">로그인은 이 컴퓨터에 하나라, 여기서 로그인·로그아웃하면 같은 CLI를 쓰는 모든 프로젝트에 적용됩니다.</Text>}
          <Field label="이름" error={errors.name?.message}>
            <Input value={edit.draft.name} onChange={(e) => edit.setDraft({ ...edit.draft, name: e.target.value })} aria-invalid={!!errors.name} />
          </Field>
          {isHttp && (
            <Field label="주소" error={errors.baseUrl?.message}>
              <Input value={edit.draft.baseUrl ?? ''} onChange={(e) => edit.setDraft({ ...edit.draft, baseUrl: e.target.value })} aria-invalid={!!errors.baseUrl} />
            </Field>
          )}
          {info.transport === 'cli' && (
            <ExecutableField target={target} kind={connection.kind} value={edit.draft.executable} onChange={(executable) => edit.setDraft({ ...edit.draft, executable })} />
          )}
          {isHttp && (
            <Field
              label={connection.hasKey ? 'API 키 · 저장됨' : 'API 키 · 없음'}
              action={connection.hasKey && (
                <Button variant="ghost" size="inline" tone="danger" disabled={deleteKey.isPending} onClick={() => deleteKey.mutate()}>
                  키 삭제
                </Button>
              )}
            >
              <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connection.hasKey ? '바꿀 때만 입력' : '키 입력'} />
            </Field>
          )}
        </Box>
      </Section>

      <Section title="확인">
        <div>
          {/* A CLI's 연결 확인 would only run --version, which the 실행 파일 field already shows. */}
          {info.transport !== 'cli' && (
            <InspectorActionRow
              label="연결 확인"
              action={<Button variant="outline" disabled={probe.isPending} onClick={() => probe.mutate()}>{probe.isPending && <Spinner />}확인</Button>}
              result={probeResult && <InspectorResult tone={probeResult.ok ? 'ok' : 'error'}>{probeResult.detail}</InspectorResult>}
            />
          )}
          {info.transport === 'cli' && (
            <InspectorActionRow
              label="로그인"
              action={
                <>
                  <Button variant="ghost" disabled={openLogin.isPending} onClick={() => openLogin.mutate()}>로그인 창 열기</Button>
                  <Button variant="outline" disabled={loginStatus.isPending} onClick={() => loginStatus.mutate()}>{loginStatus.isPending && <Spinner />}상태 보기</Button>
                </>
              }
              result={login && <InspectorResult tone={login === 'signed-in' ? 'ok' : 'error'}>{LOGIN_LABEL[login] ?? login}</InspectorResult>}
            />
          )}
          {!isTool && <ModelTest target={target} connectionId={connection.id} need={need} />}
        </div>
      </Section>

    </Inspector>
  );
}

function ModelTest({ target, connectionId, need }: { target: SettingsTarget; connectionId: string; need: Capability[] }) {
  const [picked, setChoice] = useState<ModelValue | null>(null);
  const choice = picked ?? { connectionId, model: '' };
  const [source, setSource] = useState('');
  const test = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].test.$post({ param: { id: connectionId }, json: { model: choice.model, effort: choice.effort, source, targetLanguage: 'ko' } })),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const tests = useConnectionTests(connectionId);
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
          <InspectorResult tone="ok" detail={<Text mono>{result.model} · {result.ms.toLocaleString()}ms</Text>}>
            <Text preserveLines tone="default">{result.text}</Text>
          </InspectorResult>
        ) : (
          <InspectorResult tone="error" detail={<Text mono>{result.ms.toLocaleString()}ms</Text>}>{result.detail}</InspectorResult>
        ))
      }
    >
      <ModelPicker target={target} lockConnection need={need} value={choice} onChange={setChoice} />
      <Textarea rows={2} value={source} onChange={(event) => setSource(event.target.value)} placeholder="번역해 볼 원문" />
      {!!tests.data?.length && (
        <Box as="ul" spaceY="hair" variant="caption" tone="muted">
          {tests.data.slice(0, 3).map((call) => (
            <Stack as="li" key={call.id} direction="row" align="baseline" justify="between" gap="normal">
              <Text tabular>{dateTime(call.startedAt)} · {call.model}</Text>
              <Text minWidth={0} truncate tone={call.status === 'failed' ? 'danger' : undefined}>
                {call.status === 'running' ? '진행 중' : call.status === 'failed' ? `실패${call.error ? `: ${call.error}` : ''}` : `${((new Date(call.finishedAt!).getTime() - new Date(call.startedAt).getTime()) / 1000).toFixed(1)}초`}
              </Text>
            </Stack>
          ))}
        </Box>
      )}
    </InspectorActionRow>
  );
}
