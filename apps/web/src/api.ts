export type Workspace = 'main' | 'demo';
let workspace: Workspace = 'main';
export function setApiWorkspace(next: Workspace) { workspace = next; }
export function apiPath(path: string) { return `/api${workspace === 'demo' ? '/demo' : ''}${path}`; }
export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(apiPath(path), body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.error === 'string' ? data.error : `요청을 처리하지 못했습니다 (${response.status})`);
  }
  return response.json() as Promise<T>;
}
