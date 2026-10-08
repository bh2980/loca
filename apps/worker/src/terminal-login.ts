import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

// All variable data crosses stdin as JSON; none is interpolated into PowerShell.
export const TERMINAL_LOGIN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $config = [Console]::In.ReadLine() | ConvertFrom-Json
  $owner = Get-Process -Id $PID
  $launched = Start-Process -FilePath $config.executable -WorkingDirectory $config.cwd -WindowStyle Normal -PassThru
  [Console]::Out.WriteLine((@{ pid = $launched.Id; ownerTicks = $owner.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  $launched.WaitForExit()
  exit 0
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

export const TERMINAL_CANCEL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $config = [Console]::In.ReadLine() | ConvertFrom-Json
  $owner = Get-Process -Id $config.pid -ErrorAction SilentlyContinue
  if ($null -ne $owner -and $owner.StartTime.ToUniversalTime().Ticks.ToString() -eq $config.ownerTicks) {
    & (Join-Path ([Environment]::SystemDirectory) 'taskkill.exe') /PID $config.pid /T /F | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $config.pid -ErrorAction SilentlyContinue)) { exit 1 }
  }
  exit 0
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

export interface TerminalLoginRequest {
  executable: string;
  cwd: string;
  signal?: AbortSignal;
  onOpened: (pid: number) => void;
}
interface Dependencies {
  platform: NodeJS.Platform;
  systemRoot: string;
  spawn: (executable: string, args: string[], options: { stdio: 'pipe'; windowsHide: boolean }) => ChildProcessWithoutNullStreams;
}
const cancelled = () => Object.assign(new Error('Terminal login cancelled.'), { name: 'AbortError' });

/** Completion means the login window closed, never that authentication succeeded. */
export function createTerminalLoginRunner(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    platform: process.platform,
    systemRoot: process.env.SystemRoot ?? 'C:\\Windows',
    spawn: (executable, args, options) => spawn(executable, args, options),
    ...overrides,
  };
  return async function run(request: TerminalLoginRequest): Promise<void> {
    if (request.signal?.aborted) throw cancelled();
    if (deps.platform !== 'win32') throw new Error('Terminal login is currently supported on Windows only.');
    for (const value of [request.executable, request.cwd, deps.systemRoot]) {
      if (!path.win32.isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error('Terminal login requires absolute paths without control characters.');
    }
    if (!/\.exe$/i.test(request.executable) || !(await stat(request.executable)).isFile()) throw new Error('Terminal login requires a native executable file.');
    if (!(await stat(request.cwd)).isDirectory()) throw new Error('Terminal login requires an existing working directory.');
    if (request.signal?.aborted) throw cancelled();
    const powershell = path.win32.join(deps.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const launch = (script: string) => deps.spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'pipe', windowsHide: true });
    await new Promise<void>((resolve, reject) => {
      const child = launch(TERMINAL_LOGIN_SCRIPT);
      let opened = false;
      let ownerTicks: string | undefined;
      let output = '';
      let stderr = '';
      let finished = false;
      let cancellationStarted = false;
      let cancellationFailure: Error | undefined;
      const cancel = () => {
        if (finished || cancellationStarted || !ownerTicks || !child.pid) return;
        cancellationStarted = true;
        let killer: ChildProcessWithoutNullStreams;
        try { killer = launch(TERMINAL_CANCEL_SCRIPT); }
        catch (error) { finish(error instanceof Error ? error : new Error('Could not start login cancellation.')); return; }
        killer.on('error', (error) => { cancellationFailure = error; finish(error); });
        killer.stdin.on('error', (error) => { cancellationFailure = error; finish(error); });
        killer.on('close', (code) => {
          if (code !== 0) {
            cancellationFailure ??= new Error('Could not close the owned login process tree.');
            // Report failure immediately; never fall back to an unverified child PID.
            finish(cancellationFailure);
          }
        });
        killer.stdin.end(JSON.stringify({ pid: child.pid, ownerTicks }) + '\n');
      };
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        request.signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve();
      };
      child.on('error', (error) => finish(error));
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
      child.stdout.on('data', (chunk) => {
        if (opened || finished) return;
        output += chunk.toString();
        if (output.length > 4000) { finish(new Error('Invalid login launcher response.')); return; }
        const newline = output.indexOf('\n');
        if (newline < 0) return;
        try {
          const record = JSON.parse(output.slice(0, newline));
          if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || !/^\d+$/.test(record.ownerTicks)) throw new Error('Invalid login launcher identity.');
          opened = true;
          ownerTicks = record.ownerTicks;
          request.onOpened(record.pid);
          if (request.signal?.aborted) cancel();
        } catch (error) { finish(error instanceof Error ? error : new Error('Invalid login launcher response.')); }
      });
      child.on('close', (code) => {
        if (request.signal?.aborted) finish(cancellationFailure ?? cancelled());
        else if (!opened || code !== 0) finish(new Error(stderr || `Login launcher exited with code ${code}.`));
        else finish();
      });
      request.signal?.addEventListener('abort', cancel, { once: true });
      child.stdin.on('error', (error) => finish(error));
      child.stdin.end(JSON.stringify({ executable: request.executable, cwd: request.cwd }) + '\n');
    });
  };
}

export const runTerminalLogin = createTerminalLoginRunner();
