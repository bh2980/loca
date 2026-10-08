import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import type { ExecutableCommand } from './cli.js';
import { ProviderError } from './types.js';

/** Auth stdout/stderr are transient protocol input, never application logs. */
export class AuthProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<(line: string, stream: 'stdout' | 'stderr') => void>();
  readonly exited: Promise<{ code: number | null; failedToStart: boolean }>;
  private closed = false;
  constructor(command: ExecutableCommand, args: string[]) {
    this.child = spawn(command.executable, [...command.prefixArgs, ...args], {
      cwd: tmpdir(), shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdin.on('error', () => {});
    let bytes = 0;
    for (const [name, stream] of [['stdout', this.child.stdout], ['stderr', this.child.stderr]] as const) {
      stream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) void this.close(); });
      createInterface({ input: stream }).on('line', (line: string) => {
        if (line.length > 16_384) return;
        for (const listener of this.listeners) listener(line, name);
      });
    }
    this.exited = new Promise((resolve) => {
      this.child.once('error', () => { this.closed = true; resolve({ code: null, failedToStart: true }); });
      this.child.once('close', (code) => { this.closed = true; resolve({ code, failedToStart: false }); });
    });
  }
  onLine(callback: (line: string, stream: 'stdout' | 'stderr') => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  send(message: unknown): void {
    if (this.closed) throw new ProviderError('auth-process-closed', '로그인 연결이 종료되었습니다.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.child.stdin.end();
    if (this.child.pid) {
      if (process.platform === 'win32') {
        const pid = this.child.pid;
        await new Promise<void>((resolve) => execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
        if (!this.closed) this.child.kill();
      } else {
        try { process.kill(-this.child.pid, 'SIGKILL'); } catch { this.child.kill('SIGKILL'); }
      }
    }
    await this.exited;
  }
}

export function untilAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    // The already-created operation may reject after we close its child process.
    void operation.catch(() => undefined);
    return Promise.reject(new ProviderError('auth-cancelled', '로그인을 취소했습니다.'));
  }
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new ProviderError('auth-cancelled', '로그인을 취소했습니다.')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    operation.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
