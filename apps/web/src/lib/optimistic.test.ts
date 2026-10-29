import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { optimistic, unitChanges, patchedLine } from './optimistic';

it('refetches a failed edit without overwriting another line saved during that request', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['units', 'list', 'project'];
  const initial = { rows: [{ id: 'a', translation: 'A' }, { id: 'b', translation: 'B' }] };
  let server = initial;
  client.setQueryData(key, initial);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => server, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const undoA = await optimistic(client, unitChanges(['a'], patchedLine({ translation: 'A failed' })));
    await optimistic(client, unitChanges(['b'], patchedLine({ translation: 'B saved' })));
    server = { rows: [initial.rows[0], { id: 'b', translation: 'B saved' }] };
    undoA();
    expect(client.getQueryData<typeof initial>(key)?.rows[1].translation).toBe('B saved');
    await vi.waitFor(() => expect(client.getQueryData(key)).toEqual(server));
  } finally { unsubscribe(); client.clear(); }
});
