import { HTTPException } from 'hono/http-exception';
import type { Db } from './db/index.ts';
import type { Runner } from './engine/runner.ts';
import type { SecretStore } from './services/secrets.ts';

export interface Deps {
  db: Db;
  secrets: SecretStore;
  runner: Runner;
}

export type Env = { Variables: { deps: Deps } };

export const notFound = (what = '항목'): never => {
  throw new HTTPException(404, { message: `${what}을(를) 찾을 수 없습니다.` });
};

export const badRequest = (message: string): never => {
  throw new HTTPException(400, { message });
};

export const found = <T>(value: T | undefined, what?: string): T => (value === undefined ? notFound(what) : value);
