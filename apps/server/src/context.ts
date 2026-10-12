import { HTTPException } from 'hono/http-exception';
import type { ValidationTargets } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { z } from 'zod';
import type { Db } from './db/index.ts';
import type { Runner } from './engine/runner.ts';
import type { AnalysisService } from './services/analysis.ts';
import type { SecretStore } from './services/secrets.ts';
import type { TermService } from './services/terms.ts';

export interface Deps {
  db: Db;
  secrets: SecretStore;
  runner: Runner;
  analysis: AnalysisService;
  terms: TermService;
}

export type Env = { Variables: { deps: Deps } };

export const notFound = (what = '항목'): never => {
  throw new HTTPException(404, { message: `${what}을(를) 찾을 수 없습니다.` });
};

export const badRequest = (message: string): never => {
  throw new HTTPException(400, { message });
};

/**
 * zod validation that fails with a readable 400 instead of returning the raw parse error,
 * which also keeps error shapes out of the typed RPC responses.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(target: Target, schema: Schema) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new HTTPException(400, { message: `입력이 올바르지 않습니다: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim() });
    }
  });

export const found =<T>(value: T | undefined, what?: string): T => (value === undefined ? notFound(what) : value);
