import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { onError } from './http.ts';
import { badRequest, conflict, notFound, refuse, Refusal, valid } from './refusal.ts';
import { catalogOf } from './services/agent-catalog.ts';

describe('a refusal is said one way and worded once per surface', () => {
  it('gets its HTTP status and `{ error }` body from the app\'s error handler; a fault stays a 500', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = new Hono()
      .onError(onError)
      .get('/invalid', () => badRequest('안 됩니다'))
      .get('/missing', () => notFound('대사'))
      .get('/conflict', () => conflict('그사이 바뀜'))
      .get('/forbidden', () => refuse('forbidden', '여기서는 안 됩니다'))
      .get('/limited', () => refuse('limited', '한도', { retryAfterSeconds: 60 }))
      .get('/fault', () => {
        throw new Error('고장');
      });
    const said = async (path: string) => {
      const response = await app.request(path);
      return [response.status, await response.json()];
    };
    expect(await said('/invalid')).toEqual([400, { error: '안 됩니다' }]);
    expect(await said('/missing')).toEqual([404, { error: '대사을(를) 찾을 수 없습니다.' }]);
    expect(await said('/conflict')).toEqual([409, { error: '그사이 바뀜' }]);
    expect(await said('/forbidden')).toEqual([403, { error: '여기서는 안 됩니다' }]);
    expect(await said('/limited')).toEqual([429, { error: '한도', retryAfterSeconds: 60 }]);
    expect(await said('/fault')).toEqual([500, { error: '고장' }]);
    expect(quiet).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it('is a tool\'s `{ ok: false, error }` answer, from its run and from its check; a fault is thrown on', async () => {
    const [refusing, faulty] = catalogOf({
      create_group: { description: '', inputSchema: z.object({}), execute: () => badRequest('이미 사용 중인 키입니다'), check: () => notFound('장면') },
      update_group: { description: '', inputSchema: z.object({}), execute: () => { throw new Error('고장'); } },
    } as never);
    expect(await refusing!.run({})).toEqual({ ok: false, error: '이미 사용 중인 키입니다' });
    expect(await refusing!.check({})).toEqual({ ok: false, error: '장면을(를) 찾을 수 없습니다.' });
    await expect(faulty!.run({})).rejects.toThrow('고장');
  });

  it('refuses a value a schema does not take, naming the first problem', () => {
    expect(valid(z.object({ name: z.string().min(1) }), { name: '가' })).toEqual({ name: '가' });
    const refused = (() => {
      try {
        return valid(z.object({ name: z.string().min(1) }), { name: '' }, '태그 이름이나 설정');
      } catch (error) {
        return error;
      }
    })();
    expect(refused).toBeInstanceOf(Refusal);
    expect(refused).toMatchObject({ kind: 'invalid', message: expect.stringContaining('태그 이름이나 설정이(가) 올바르지 않습니다: name') });
  });
});
