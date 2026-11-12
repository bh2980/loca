import type { Db } from './index.ts';

/**
 * The tables a piece of code reads, for tests: every statement it runs is explained with the values it was run with,
 * and each table or index the plan opens counts as a read of that table (a subquery's and a join's too).
 */
export function tablesRead(db: Db, run: () => unknown): Set<string> {
  const client = db.$client;
  const prepare = client.prepare.bind(client);
  const tableAt = new Map((prepare("select rootpage, tbl_name from sqlite_master where rootpage > 0").all() as { rootpage: number; tbl_name: string }[]).map((row) => [row.rootpage, row.tbl_name]));
  const seen = new Set<string>();
  const explain = (sql: string, params: unknown[]) => {
    for (const step of prepare(`explain ${sql}`).all(...params) as { opcode: string; p2: number }[]) {
      const table = step.opcode === 'OpenRead' ? tableAt.get(step.p2) : undefined;
      if (table) seen.add(table);
    }
  };
  const spied = (sql: string) => {
    const statement = prepare(sql);
    const proxy: typeof statement = new Proxy(statement, {
      get(target, key) {
        const value = Reflect.get(target, key, target) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (key === 'all' || key === 'get' || key === 'iterate') explain(sql, args);
          const out = (value as (...all: unknown[]) => unknown).apply(target, args);
          // raw(), pluck() and the like return the statement itself: keep spying on it.
          return out === target ? proxy : out;
        };
      },
    });
    return proxy;
  };
  client.prepare = spied as typeof client.prepare;
  try {
    run();
  } finally {
    client.prepare = prepare as typeof client.prepare;
  }
  return seen;
}
