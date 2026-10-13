import { spawn } from 'node:child_process';

// Exclude dependencies that produced spurious restarts in Windows verification. Watch
// source directories on Windows/macOS; Node's watch-path is unavailable on Linux.
const paths = ['win32', 'darwin'].includes(process.platform)
  ? ['--watch-path=src', '--watch-path=../../packages']
  : [];
const child = spawn(process.execPath, ['--watch', ...paths, '--import', 'tsx', 'src/main.ts'], {
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code) => { process.exitCode = code ?? 1; });
