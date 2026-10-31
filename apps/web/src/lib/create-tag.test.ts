import { beforeEach, expect, it, vi } from 'vitest';
import { PALETTE } from '@tw/shared';
import { createAndAttachTag } from './create-tag';
const post = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ client: { projects: { ':projectId': { tags: { $post: post } } } } }));
vi.mock('./collections', () => ({ sent: (_projectId: string, value: unknown) => value }));
beforeEach(() => { post.mockReset().mockResolvedValue({ id: 'tag' }); });
it('creates a scoped tag with the shared colour, then attaches the returned id', async () => {
  const attach = vi.fn().mockResolvedValue({});
  await createAndAttachTag('p', 'Name', PALETTE.length + 1, ['terms'], attach);
  expect(post).toHaveBeenCalledWith({ param: { projectId: 'p' }, json: { name: 'Name', color: PALETTE[1].hex, scope: ['terms'] } });
  expect(attach).toHaveBeenCalledWith('tag');
});
it('distinguishes a failed attachment from a failed creation', async () => {
  await expect(createAndAttachTag('p', 'Name', 0, ['lines'], async () => { throw new Error('offline'); })).rejects.toThrow('태그는 만들었지만 붙이지 못했습니다');
  const attach = vi.fn(); post.mockRejectedValueOnce(new Error('creation failed'));
  await expect(createAndAttachTag('p', 'Name', 0, ['lines'], attach)).rejects.toThrow('creation failed');
  expect(attach).not.toHaveBeenCalled();
});
