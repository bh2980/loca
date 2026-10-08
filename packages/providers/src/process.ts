import { spawn, execFile } from 'node:child_process';
import { ProviderError } from './types.js';

export interface ProcessRequest {
  executable: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  /** For documented status commands only (e.g. Claude auth status exits 1 when signed out). */
  acceptedExitCodes?: number[];
}

/** No command shell: prompts, paths and JSON remain individual arguments or stdin bytes. */
export function runProcess(request: ProcessRequest): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (request.signal?.aborted) return Promise.reject(new ProviderError('cancelled', '작업이 취소되었습니다.'));
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, request.args, {
      cwd: request.cwd, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    let finished = false;
    const terminate = (error: Error) => {
      if (finished || failure) return;
      failure = error;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {
          if (!finished) child.kill();
        });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    };
    const onAbort = () => terminate(new ProviderError('cancelled', '작업이 취소되었습니다.'));
    const timer = setTimeout(() => terminate(new ProviderError('timeout', '모델 연결 제한 시간을 초과했습니다.')), request.timeoutMs ?? 180_000);
    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    const collect = (target: Buffer[], chunk: Buffer) => {
      size += chunk.length;
      if (size > (request.maxOutputBytes ?? 8 * 1024 * 1024)) {
        terminate(new ProviderError('output-limit', 'CLI 출력 크기 제한을 초과했습니다.'));
      } else target.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(new ProviderError('spawn-failed', `CLI를 시작하지 못했습니다 (${error.code ?? 'unknown'}). 실행 파일 경로를 확인하세요.`));
    });
    child.on('close', (code) => {
      cleanup();
      if (failure) reject(failure);
      // CLI output may contain authentication material, prompts, or user data. Do not include it in errors.
      else if (code === null || !(request.acceptedExitCodes ?? [0]).includes(code)) reject(new ProviderError('cli-failed', `CLI가 종료 코드 ${String(code)}로 실패했습니다. CLI의 로그인 상태·모델·옵션을 확인하세요.`));
      else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code });
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') terminate(new ProviderError('stdin-failed', 'CLI 입력을 전달하지 못했습니다.'));
    });
    child.stdin.end(request.stdin ?? '');
  });
}
