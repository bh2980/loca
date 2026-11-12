import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { convert } from 'html-to-text';

/**
 * Web access for the project agent. Search goes to Exa's hosted MCP server, which needs no key
 * (rate limited); pages are fetched directly and turned into text. Private and local addresses
 * are refused so a page or a prompt cannot make the agent reach into this machine or the LAN.
 */
const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const PAGE_LIMIT = 20_000;

export async function webSearch(query: string, numResults: number, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${EXA_MCP_URL}?tools=web_search_exa`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'web_search_exa', arguments: { query, numResults } } }),
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  if (response.status === 429) throw new Error('무료 검색 한도에 걸렸습니다. 잠시 후 다시 시도하세요.');
  if (!response.ok) throw new Error(`검색이 실패했습니다 (HTTP ${response.status}).`);
  const body = await response.text();
  // The server answers with SSE ("data: {...}") or plain JSON-RPC.
  const payloads = [...body.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()), body];
  for (const payload of payloads) {
    try {
      const parsed = JSON.parse(payload) as { result?: { content?: { type: string; text?: string }[] }; error?: { message?: string } };
      if (parsed.error) throw new Error(`검색 오류: ${parsed.error.message ?? ''}`);
      if (parsed.result) return (parsed.result.content ?? []).flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('\n\n') || '결과가 없습니다.';
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('검색 오류')) throw error;
    }
  }
  throw new Error('검색 응답을 읽지 못했습니다.');
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
const isPrivate = (address: string) =>
  isIP(address) === 6 ? /^(::1|::|f[cd]|fe80)/i.test(address) || address.startsWith('::ffff:127.') : PRIVATE_V4.some((pattern) => pattern.test(address));

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http(s) 주소만 읽을 수 있습니다.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) throw new Error('이 컴퓨터나 내부망 주소는 읽을 수 없습니다.');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.some(isPrivate)) throw new Error('이 컴퓨터나 내부망 주소는 읽을 수 없습니다.');
}

export async function readWebPage(raw: string, offset: number, signal?: AbortSignal): Promise<{ url: string; title: string | null; total: number; offset: number; text: string }> {
  let url = new URL(raw);
  let response: Response | null = null;
  // Follow redirects by hand so every hop is checked against private addresses.
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    response = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'TranslationWorkbench/1.0 (+local agent)', accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
      signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    break;
  }
  if (!response || !response.ok) throw new Error(`페이지를 읽지 못했습니다 (HTTP ${response?.status ?? '?'}).`);
  const type = response.headers.get('content-type') ?? '';
  if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new Error(`글 페이지가 아닙니다 (${type || '알 수 없는 형식'}).`);
  const body = (await response.text()).slice(0, 3_000_000);
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? null;
  const text = type.includes('html')
    ? convert(body, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }, { selector: 'nav', format: 'skip' }, { selector: 'footer', format: 'skip' }] })
    : body;
  return { url: url.toString(), title, total: text.length, offset, text: text.slice(offset, offset + PAGE_LIMIT) };
}
