import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { CONNECTION_KIND_INFO, isFreeModel, type Capability, type ConnectionKind } from '@tw/shared';
import { Badge, Box, Button, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Field, FieldLabel, Icon, Inline, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Stack, Text } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

/** Which AI a place of use calls. Empty strings: nothing picked yet. */
export interface ModelValue {
  connectionId: string;
  model: string;
  effort?: string;
}

const DEFAULT_EFFORT = '__default';

/** A connection's models, as it lists them (APIs can list hundreds; CLIs may list none). */
function useModels(connectionId: string | undefined) {
  return useQuery({
    queryKey: ['connections', connectionId, 'models'],
    queryFn: () => unwrap(client.connections[':id'].models.$get({ param: { id: connectionId! } })),
    enabled: !!connectionId,
    staleTime: 60_000,
    retry: false,
  });
}

/** "connection · model · effort" for a value, or null when nothing (or a deleted connection) is picked. */
function useModelLabel(value: ModelValue | null | undefined) {
  const connections = useQuery(q.connections());
  const connection = value?.connectionId ? connections.data?.find((item) => item.id === value.connectionId) : undefined;
  if (!value?.connectionId || !value.model) return null;
  // Until the connections arrive the name is unknown, not deleted.
  return [connection?.name ?? (connections.data ? '삭제된 연결' : undefined), value.model, value.effort].filter(Boolean).join(' · ');
}

/**
 * The one way to choose AI wherever it is used: a connection, one of its models
 * and a reasoning effort, in one popover. Connections that cannot do what the place needs are left
 * out; picking a connection leaves the model to be picked next. `compact` is the chat composer's ghost button.
 */
export function ModelPicker({
  value,
  onChange,
  need = ['generate'],
  kinds,
  lockConnection,
  compact,
  id,
  grow,
  open: openProp,
  onOpenChange,
}: {
  /** Open from outside (the chat's /model command); left out, the picker opens itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  value: ModelValue | null | undefined;
  onChange: (value: ModelValue) => void;
  /** The connection must offer one of these. */
  need?: Capability[];
  /** Only connections of these kinds (the editor's continuation: API connections). */
  kinds?: ConnectionKind[];
  /** Only the model and effort of `value.connectionId` (a connection's model test). */
  lockConnection?: boolean;
  compact?: boolean;
  id?: string;
  /** Shares the width of a row with what is beside it (instead of filling it). */
  grow?: boolean;
}) {
  const params = useParams({ strict: false });
  const connections = useQuery(q.connections());
  const usable = (connections.data ?? []).filter((item) => (!kinds || kinds.includes(item.kind)) && CONNECTION_KIND_INFO[item.kind].capabilities.some((capability) => need.includes(capability)));
  const connection = usable.find((item) => item.id === value?.connectionId);
  const efforts = connection ? CONNECTION_KIND_INFO[connection.kind].efforts : [];
  const fullLabel = useModelLabel(value);
  const label = lockConnection ? [value?.model, value?.effort].filter(Boolean).join(' · ') || null : fullLabel;
  const free = connection ? isFreeModel(connection.kind, value?.model) : false;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [query, setQuery] = useState('');
  // Listed once the picker has been opened (a CLI may start a process to list them), and kept while it closes.
  const [opened, setOpened] = useState(false);
  const models = useModels(opened || open ? value?.connectionId || undefined : undefined);
  const list = models.data?.models ?? [];
  const typed = query.trim();

  const pickConnection = (connectionId: string) => {
    onChange({ connectionId, model: '' });
  };
  const pickModel = (model: string) => {
    onChange({ connectionId: value!.connectionId, model, ...(value?.effort && efforts.includes(value.effort) && { effort: value.effort }) });
    setQuery('');
    if (!efforts.length) setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setOpened(true);
        else setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant={compact ? 'ghost' : 'outline'}
          role="combobox"
          aria-expanded={open}
          aria-label="모델"
          {...(compact
            ? { maxWidth: 'full', justifyContent: 'start', paddingX: 'condensed', weight: 'normal', tone: 'muted' }
            : { width: 'full', justifyContent: 'between', weight: 'normal' })}
          minWidth={grow ? 0 : undefined}
          grow={grow || undefined}
        >
          <Inline as="span" minWidth={0} gap="snug">
            <Text truncate tone={label ? undefined : 'muted'}>{label ?? (lockConnection ? '모델 고르기' : usable.length || !connections.data ? '모델 고르기' : '쓸 수 있는 AI 연결 없음')}</Text>
            {free && <Box asChild shrink={false} variant="caption"><Badge variant="secondary">무료</Badge></Box>}
          </Inline>
          <Icon icon={ChevronsUpDown} shrink={false} opacity={50} />
        </Button>
      </PopoverTrigger>
      {/* No focus jump on open: focusing the search field scrolled the pane under the trigger and closed the popover. */}
      <Box asChild width={80} padding="none"><PopoverContent align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
        {usable.length ? (
          <Stack gap="normal" padding="normal">
            {!lockConnection && <Field>
              <FieldLabel>연결</FieldLabel>
              <Select value={connection?.id} onValueChange={pickConnection}>
                <Box asChild width="full"><SelectTrigger>
                  <SelectValue placeholder="연결 고르기" />
                </SelectTrigger></Box>
                <SelectContent>
                  {usable.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} <Text tone="muted">· {CONNECTION_KIND_INFO[item.kind].label}</Text>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>}
            {connection && (
              <Field>
                <FieldLabel>모델</FieldLabel>
                <Box asChild radius="md" border="all"><Command>
                  <CommandInput value={query} onValueChange={setQuery} placeholder={list.length ? `모델 ${list.length}개에서 찾기` : '모델 이름 입력'} />
                  <Box asChild maxHeight={48}><CommandList>
                    <CommandEmpty>{models.isPending ? '모델 목록을 불러오는 중…' : '목록에 없는 모델입니다.'}</CommandEmpty>
                    {typed && !list.includes(typed) && (
                      <CommandGroup heading="직접 입력">
                        <CommandItem value={`__typed__${typed}`} onSelect={() => pickModel(typed)}>
                          “{typed}” 사용
                        </CommandItem>
                      </CommandGroup>
                    )}
                    {list.length > 0 && (
                      <CommandGroup>
                        {list.map((model) => (
                          <CommandItem key={model} value={model} onSelect={() => pickModel(model)}>
                            <Icon icon={Check} size="md" opacity={model === value?.model ? 100 : 0} />
                            <Text truncate>{model}</Text>
                            {isFreeModel(connection.kind, model) && <Box asChild marginLeft="auto" shrink={false} variant="caption"><Badge variant="secondary">무료</Badge></Box>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList></Box>
                </Command></Box>
                {models.data && !models.data.ok && <Text as="p" variant="caption" tone="muted">모델 목록을 못 불러왔습니다.</Text>}
                {value?.model && !list.includes(value.model) && <Text as="p" variant="caption" tone="muted">지금: {value.model}</Text>}
              </Field>
            )}
            {connection?.kind === 'antigravity' && <Text as="p" variant="caption" tone="muted">추론 수준은 모델 이름에 포함됩니다(…-high / -medium / -low).</Text>}
            {connection && efforts.length > 0 && (
              <Field>
                <FieldLabel>추론 수준</FieldLabel>
                <Select
                  value={value?.effort && efforts.includes(value.effort) ? value.effort : DEFAULT_EFFORT}
                  onValueChange={(effort) => {
                    onChange({ connectionId: value!.connectionId, model: value!.model, ...(effort !== DEFAULT_EFFORT && { effort }) });
                    // The effort is the last choice: done.
                    setOpen(false);
                  }}
                >
                  <Box asChild width="full"><SelectTrigger>
                    <SelectValue />
                  </SelectTrigger></Box>
                  <SelectContent>
                    <SelectItem value={DEFAULT_EFFORT}>모델 기본값</SelectItem>
                    {efforts.map((effort) => (
                      <SelectItem key={effort} value={effort}>
                        {effort}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </Stack>
        ) : (
          <Text as="p" padding="normal" variant="body" tone="muted">
            {connections.isPending ? '연결을 불러오는 중…' : '여기에 쓸 수 있는 AI 연결이 없습니다. '}
            {!connections.isPending && params.projectId && (
              <Text asChild underline>
                <Link to="/p/$projectId/settings/connections" params={{ projectId: params.projectId }} onClick={() => setOpen(false)}>
                  AI 연결 추가
                </Link>
              </Text>
            )}
          </Text>
        )}
      </PopoverContent></Box>
    </Popover>
  );
}
