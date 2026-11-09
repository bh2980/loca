// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable } from './data-table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has neither; the table only needs them to exist.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

function mount(element: () => React.ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  return { root, container, render: () => act(async () => root.render(element())) };
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

describe('DataTable', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('settles while it has no rows yet, however often its page draws it', async () => {
    let headers = 0;
    const columns = [{ id: 'a', header: () => { headers += 1; return 'A'; }, cell: () => 'x' }];
    const { render } = mount(() => createElement(DataTable<{ id: string }>, { columns, rows: undefined, rowId: (row) => row.id, loading: true }));
    await render();
    await render();
    await render();
    await settle();
    const drawn = headers;
    await settle();
    // Each of the three draws draws the header; a table that resets itself after each would go on (it froze the page).
    expect(drawn).toBeLessThan(10);
    expect(headers).toBe(drawn);
  });

  it('settles when its page hands it a new row array on every draw', async () => {
    let headers = 0;
    const columns = [{ id: 'a', header: () => { headers += 1; return 'A'; }, cell: () => 'x' }];
    const { render } = mount(() => createElement(DataTable<{ id: string }>, { columns, rows: [{ id: '1' }], rowId: (row) => row.id }));
    await render();
    await render();
    await settle();
    const drawn = headers;
    await settle();
    expect(headers).toBe(drawn);
  });
});
