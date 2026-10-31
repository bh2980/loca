import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { optimistic } from './optimistic';

type Rows = { rows: { id: string; translation: string }[] };
const set = (id: string, translation: string) => ({ key: ['settings', 'list'], update: (data: Rows) => ({ rows: data.rows.map((row) => (row.id === id ? { ...row, translation } : row)) }) });

it('refetches a failed edit without overwriting another one saved during that request', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['settings', 'list'];
  const initial: Rows = { rows: [{ id: 'a', translation: 'A' }, { id: 'b', translation: 'B' }] };
  let server = initial;
  client.setQueryData(key, initial);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => server, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const undoA = await optimistic(client, [set('a', 'A failed')]);
    await optimistic(client, [set('b', 'B saved')]);
    server = { rows: [initial.rows[0], { id: 'b', translation: 'B saved' }] };
    undoA();
    expect(client.getQueryData<Rows>(key)?.rows[1].translation).toBe('B saved');
    await vi.waitFor(() => expect(client.getQueryData(key)).toEqual(server));
  } finally { unsubscribe(); client.clear(); }
});
