import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { CONNECTION_KIND_INFO, type Capability } from '@tw/shared';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Field, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Which AI a place of use calls. Empty strings: nothing picked yet. */
export interface ModelValue {
  connectionId: string;
  model: string;
  effort?: string;
}

const DEFAULT_EFFORT = '__default';

/** A connection's models, as it lists them (APIs can list hundreds; CLIs may list none). */
export function useModels(connectionId: string | undefined) {
  return useQuery({
    queryKey: ['connections', connectionId, 'models'],
    queryFn: () => unwrap(client.connections[':id'].models.$get({ param: { id: connectionId! } })),
    enabled: !!connectionId,
    staleTime: 60_000,
    retry: false,
  });
}

/** "connection · model · effort" for a value, or null when nothing (or a deleted connection) is picked. */
export function useModelLabel(value: ModelValue | null | undefined) {
  const connections = useQuery(q.connections());
  const connection = value?.connectionId ? connections.data?.find((item) => item.id === value.connectionId) : undefined;
  if (!value?.connectionId || !value.model) return null;
  return [connection?.name ?? '삭제된 연결', value.model, value.effort].filter(Boolean).join(' · ');
}

/**
 * What a picker starts with: the choice used here last time if its connection still exists,
 * else the first connection (by name) that can do the job and has a default model.
 */
export function useInitialModel(need: Capability[], last?: { connectionId: string | null; model: string | null; effort?: string | null } | null): ModelValue | null {
  const connections = useQuery(q.connections());
  const usable = (connections.data ?? []).filter((item) => CONNECTION_KIND_INFO[item.kind].capabilities.some((capability) => need.includes(capability)));
  if (last?.connectionId && last.model && usable.some((item) => item.id === last.connectionId)) return { connectionId: last.connectionId, model: last.model, ...(last.effort && { effort: last.effort }) };
  const connection = usable.find((item) => item.defaultModel);
  return connection ? { connectionId: connection.id, model: connection.defaultModel!, ...(connection.defaultEffort && { effort: connection.defaultEffort }) } : null;
}

/**
 * The one way to choose AI wherever it is used (docs/DESIGN.md 4.1): a connection, one of its models
 * and a reasoning effort, in one popover. Connections that cannot do what the place needs are left
 * out; picking a connection fills in its default model. `compact` is the chat composer's ghost button.
 */
export function ModelPicker({
  value,
  onChange,
  need = ['generate'],
  exclude,
  lockConnection,
  compact,
  id,
  className,
}: {
  value: ModelValue | null | undefined;
  onChange: (value: ModelValue) => void;
  /** The connection must offer one of these. */
  need?: Capability[];
  /** A connection that may not be picked (a connection's own fallback). */
  exclude?: string;
  /** Only the model and effort of `value.connectionId` (a connection's own default model, its test). */
  lockConnection?: boolean;
  compact?: boolean;
  id?: string;
  className?: string;
}) {
  const params = useParams({ strict: false });
  const connections = useQuery(q.connections());
  const usable = (connections.data ?? []).filter((item) => item.id !== exclude && CONNECTION_KIND_INFO[item.kind].capabilities.some((capability) => need.includes(capability)));
  const connection = usable.find((item) => item.id === value?.connectionId);
  const efforts = connection ? CONNECTION_KIND_INFO[connection.kind].efforts : [];
  const fullLabel = useModelLabel(value);
  const label = lockConnection ? [value?.model, value?.effort].filter(Boolean).join(' · ') || null : fullLabel;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Listed once the picker has been opened (a CLI may start a process to list them), and kept while it closes.
  const [opened, setOpened] = useState(false);
  const models = useModels(opened ? value?.connectionId || undefined : undefined);
  const list = models.data?.models ?? [];
  const typed = query.trim();

  const pickConnection = (connectionId: string) => {
    const next = usable.find((item) => item.id === connectionId);
    onChange({ connectionId, model: next?.defaultModel ?? '', ...(next?.defaultEffort && { effort: next.defaultEffort }) });
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
          aria-label="AI 연결·모델"
          className={cn(compact ? 'max-w-full justify-start px-2 text-xs font-normal text-muted-foreground' : 'w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? (lockConnection ? '모델 고르기' : usable.length || !connections.data ? 'AI 연결·모델 고르기' : '쓸 수 있는 AI 연결 없음')}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* No focus jump on open: focusing the search field scrolled the pane under the trigger and closed the popover. */}
      <PopoverContent className="w-80 p-0" align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
        {usable.length ? (
          <div className="flex flex-col gap-3 p-3">
            {!lockConnection && <Field>
              <FieldLabel>연결</FieldLabel>
              <Select value={connection?.id} onValueChange={pickConnection}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="연결 고르기" />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} <span className="text-muted-foreground">· {CONNECTION_KIND_INFO[item.kind].label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>}
            {connection && (
              <Field>
                <FieldLabel>모델</FieldLabel>
                <Command className="rounded-md border">
                  <CommandInput value={query} onValueChange={setQuery} placeholder={list.length ? `모델 ${list.length}개에서 찾기` : '모델 이름 입력'} />
                  <CommandList className="max-h-48">
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
                            <Check className={cn('size-4', model === value?.model ? 'opacity-100' : 'opacity-0')} />
                            {model}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
                {models.data && !models.data.ok && <p className="text-xs text-muted-foreground">모델 목록을 못 불러왔습니다. 모델 이름을 직접 입력하세요.</p>}
                {value?.model && !list.includes(value.model) && <p className="text-xs text-muted-foreground">지금: {value.model}</p>}
              </Field>
            )}
            {connection?.kind === 'antigravity' && <p className="text-xs text-muted-foreground">추론 수준은 모델 이름에 들어 있습니다(…-high / -medium / -low).</p>}
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
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
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
          </div>
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            {connections.isPending ? '연결을 불러오는 중…' : '여기에 쓸 수 있는 AI 연결이 없습니다. '}
            {!connections.isPending && params.projectId && (
              <Link to="/p/$projectId/settings/ai" params={{ projectId: params.projectId }} className="underline" onClick={() => setOpen(false)}>
                AI 연결 추가
              </Link>
            )}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
