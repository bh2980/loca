import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import { z } from 'zod';

/**
 * User scripts run in QuickJS compiled to WebAssembly: no Node APIs, no network, no file system,
 * with a deadline and a memory cap. The script gets plain JSON in and must return plain JSON.
 */
export const scriptResultSchema = z.object({
  port: z.string().optional(),
  candidate: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  issues: z.array(z.string()).optional(),
});
export type ScriptResult = z.infer<typeof scriptResultSchema>;

const TIMEOUT_MS = 2000;
const MEMORY_BYTES = 32 * 1024 * 1024;

export async function runScript(code: string, input: unknown): Promise<ScriptResult> {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_BYTES);
  runtime.setMaxStackSize(1024 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIMEOUT_MS));
  const context = runtime.newContext();
  try {
    // Accept both "export default function run" and a plain "function run".
    const body = code.replace(/export\s+default\s+(async\s+)?function/, 'function');
    const source = `${body}\n;JSON.stringify(run(${JSON.stringify(input)}) ?? {})`;
    const result = context.evalCode(source, 'script.js');
    if (result.error) {
      const failure = context.dump(result.error) as { message?: string; name?: string } | string;
      result.error.dispose();
      const message = typeof failure === 'string' ? failure : `${failure.name ?? 'Error'}: ${failure.message ?? ''}`;
      throw new Error(/interrupted/i.test(message) ? `스크립트가 ${TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.` : `스크립트 오류 — ${message}`);
    }
    const json = context.getString(result.value);
    result.value.dispose();
    const parsed = scriptResultSchema.safeParse(JSON.parse(json));
    if (!parsed.success) throw new Error(`스크립트 반환값 형식이 맞지 않습니다: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
