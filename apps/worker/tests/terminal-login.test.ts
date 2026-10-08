import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createTerminalLoginRunner, TERMINAL_LOGIN_SCRIPT, TERMINAL_CANCEL_SCRIPT } from '../src/terminal-login.js';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  input = '';
  constructor(readonly pid: number) {
    super();
    this.stdin.on('data', (chunk) => { this.input += chunk.toString(); });
  }
  opened(pid = 8123) { this.stdout.write(JSON.stringify({ pid, ownerTicks: '638999123456789000' }) + '\n'); }
  close(code = 0) { this.emit('close', code); }
}
async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'workbench-login-test-'));
  const executable = path.join(cwd, "agy'; Write-Output injected.exe");
  await writeFile(executable, 'fake executable; never run');
  const calls: { executable: string; args: string[]; options: unknown; child: FakeChild }[] = [];
  const lifecycle = new EventEmitter();
  const run = createTerminalLoginRunner({
    platform: 'win32', systemRoot: 'C:\\Windows',
    spawn(executable, args, options) {
      const child = new FakeChild(7000 + calls.length);
      calls.push({ executable, args, options, child });
      lifecycle.emit('spawn');
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });
  // The runner awaits real filesystem stat calls before spawning. An arbitrary
  // number of setImmediate turns can expire before that I/O under parallel load.
  const waitForCalls = (count: number) => new Promise<void>((resolve, reject) => {
    if (calls.length >= count) { resolve(); return; }
    const finish = () => {
      if (calls.length < count) return;
      clearTimeout(timer); lifecycle.off('spawn', finish); resolve();
    };
    const timer = setTimeout(() => {
      lifecycle.off('spawn', finish);
      reject(new Error(`Expected ${count} launcher calls, received ${calls.length}.`));
    }, 5000);
    lifecycle.on('spawn', finish);
  });
  return { cwd, executable, calls, run, waitForCalls, cleanup: () => rm(cwd, { recursive: true, force: true }) };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('opens a visible native window via static PowerShell and JSON stdin, waits for its closure', async () => {
  const f = await fixture();
  try {
    const opened: number[] = [];
    let settled = false;
    const result = f.run({ executable: f.executable, cwd: f.cwd, onOpened: (pid) => opened.push(pid) }).then(() => { settled = true; });
    await f.waitForCalls(1);
    const call = f.calls[0];
    assert.equal(call.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(call.args, ['-NoProfile', '-NonInteractive', '-Command', TERMINAL_LOGIN_SCRIPT]);
    assert.deepEqual(call.options, { stdio: 'pipe', windowsHide: true });
    assert.deepEqual(JSON.parse(call.child.input), { executable: f.executable, cwd: f.cwd });
    assert.ok(!call.args.join(' ').includes(f.executable));
    assert.match(TERMINAL_LOGIN_SCRIPT, /-WindowStyle Normal -PassThru/);
    assert.match(TERMINAL_LOGIN_SCRIPT, /WaitForExit\(\)/);
    call.child.opened();
    await tick();
    assert.deepEqual(opened, [8123]);
    assert.equal(settled, false, 'PID notification does not complete login or imply authentication');
    call.child.close();
    await result;
  } finally { await f.cleanup(); }
});

test('abort closes only the owned wrapper tree with start-time identity validation', async () => {
  const f = await fixture();
  try {
    const signal = new AbortController();
    const result = f.run({ executable: f.executable, cwd: f.cwd, signal: signal.signal, onOpened: () => {} });
    const rejected = assert.rejects(result, { name: 'AbortError' });
    await f.waitForCalls(1);
    signal.abort();
    assert.equal(f.calls.length, 1, 'wait for launcher identity before killing');
    f.calls[0].child.opened();
    assert.equal(f.calls.length, 2);
    const cancel = f.calls[1];
    assert.equal(cancel.args[3], TERMINAL_CANCEL_SCRIPT);
    assert.deepEqual(JSON.parse(cancel.child.input), { pid: 7000, ownerTicks: '638999123456789000' });
    assert.match(TERMINAL_CANCEL_SCRIPT, /StartTime.*-eq \$config.ownerTicks/);
    assert.match(TERMINAL_CANCEL_SCRIPT, /taskkill\.exe.*\/PID \$config.pid \/T \/F/);
    cancel.child.close();
    f.calls[0].child.close(1);
    await rejected;
    signal.abort();
    assert.equal(f.calls.length, 2);
  } finally { await f.cleanup(); }
});

test('closed windows are removed from cancellation ownership', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const result = f.run({ executable: f.executable, cwd: f.cwd, signal: controller.signal, onOpened: () => {} });
    await f.waitForCalls(1);
    f.calls[0].child.opened();
    f.calls[0].child.close();
    await result;
    controller.abort();
    assert.equal(f.calls.length, 1, 'never kill a PID after owner exit');
  } finally { await f.cleanup(); }
});

test('rejects unsafe or absent launch inputs before starting a process', async () => {
  const f = await fixture();
  try {
    const onOpened = () => {};
    await assert.rejects(f.run({ executable: 'agy.exe', cwd: f.cwd, onOpened }), /absolute paths/);
    await assert.rejects(f.run({ executable: f.executable + '\n', cwd: f.cwd, onOpened }), /absolute paths/);
    await assert.rejects(f.run({ executable: f.cwd, cwd: f.cwd, onOpened }), /native executable/);
    await assert.rejects(f.run({ executable: path.join(f.cwd, 'absent.exe'), cwd: f.cwd, onOpened }));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.run({ executable: f.executable, cwd: f.cwd, onOpened, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

test('launcher failure and owned-tree cancellation failure remain failures', async () => {
  const f = await fixture();
  try {
    const result = f.run({ executable: f.executable, cwd: f.cwd, onOpened: () => {} });
    const rejected = assert.rejects(result, /launch failed/);
    await f.waitForCalls(1);
    f.calls[0].child.stderr.write('launch failed'); f.calls[0].child.close(1);
    await rejected;
    const controller = new AbortController();
    const cancelled = f.run({ executable: f.executable, cwd: f.cwd, onOpened: () => {}, signal: controller.signal });
    const cancellationRejected = assert.rejects(cancelled, /Could not close/);
    await f.waitForCalls(2);
    f.calls[1].child.opened(); controller.abort();
    f.calls[2].child.close(1);
    await cancellationRejected;
    f.calls[1].child.close();
  } finally { await f.cleanup(); }
});
