import assert from 'node:assert/strict';
const api = 'http://127.0.0.1:4517/api';
const projectId = 'ef813a21-2155-4572-914c-e8afea67a817';
const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const created = await fetch(`${api}/projects/${projectId}/chat`, { method: 'POST', ...json({ model: { connectionId: 'b0910e0b-d4da-4d56-9198-4fed998cebe8', model: 'mock-slow' } }) });
assert(created.ok);
const chat = await created.json() as { id: string };
try {
  const stream = await fetch(`${api}/chat/${chat.id}/stream`, { method: 'POST', ...json({ message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: '삭제 검증용 프로젝트 현황' }] } }) });
  assert(stream.ok); const drained = stream.text();
  const before = await (await fetch(`${api}/chat/${chat.id}`)).json() as { turn: { startedAt: number | null } };
  assert.notEqual(before.turn.startedAt, null);
  const response = await fetch(`${api}/chat/${chat.id}`, { method: 'DELETE' });
  assert(response.ok); await drained;
  const [record, running] = await Promise.all([fetch(`${api}/chat/${chat.id}`), fetch(`${api}/chat/${chat.id}/stream`)]);
  assert.equal(record.status, 404); assert.equal(running.status, 204);
  console.log(JSON.stringify({ chatId: chat.id, runningBeforeDelete: true, deletion: response.status, recordAfter: record.status, streamAfter: running.status }));
} finally { await fetch(`${api}/chat/${chat.id}`, { method: 'DELETE' }); }
