import { PALETTE, type TagScope } from '@tw/shared';
import { client, unwrap } from './api';

/** Creation and attachment share one policy; attachment errors must not claim creation failed. */
export async function createAndAttachTag(projectId: string, name: string, count: number, scope: TagScope[], attach: (id: string) => Promise<unknown>) {
  const tag = await unwrap(client.projects[':projectId'].tags.$post({
    param: { projectId }, json: { name, color: PALETTE[count % PALETTE.length].hex, scope },
  }));
  try {
    await attach(tag.id);
  } catch (error) {
    throw new Error(`'${name}' 태그는 만들었지만 붙이지 못했습니다. 태그 목록에서 다시 선택하세요. ${error instanceof Error ? error.message : ''}`);
  }
}
