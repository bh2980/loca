import { HTTPException } from 'hono/http-exception';

export const notFound: (what?: string) => never = (what = '항목') => {
  throw new HTTPException(404, { message: `${what}을(를) 찾을 수 없습니다.` });
};

/** Throws a 400; typed so the code after a call to it is known unreachable. */
export const badRequest: (message: string) => never = (message) => {
  throw new HTTPException(400, { message });
};

export const found = <T>(value: T | undefined, what?: string): T => (value === undefined ? notFound(what) : value);
