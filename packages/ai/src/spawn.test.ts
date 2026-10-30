import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterExecutable, cliSpawn, resolveCli, shimTarget } from './spawn.ts';

// What npm and pnpm write next to a globally installed CLI on Windows.
const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
)
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;
const PNPM_SHIM = `@SETLOCAL
@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\..\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
) ELSE (
  node  "%~dp0\\..\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
)
`;

describe('starting a CLI', () => {
  it('resolves a POSIX executable from PATH, in PATH order', () => {
    const exists = (file: string) => file === '/opt/tw/bin/opencode' || file === '/home/me/bin/opencode';
    expect(cliSpawn('opencode', ['run'], 'linux', { PATH: '/usr/local/bin:/opt/tw/bin:/home/me/bin' }, { exists })).toEqual({ file: '/opt/tw/bin/opencode', args: ['run'] });
  });

  // The executable bit and POSIX paths of a real file: only a POSIX machine has them.
  it.skipIf(process.platform === 'win32')('takes a real file on PATH only when it is executable', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-cli-'));
    const file = path.join(dir, 'opencode');
    writeFileSync(file, '#!/bin/sh\nexit 0\n');
    chmodSync(file, 0o755);
    try {
      expect(cliSpawn('opencode', ['run'], 'linux', { PATH: dir })).toEqual({ file, args: ['run'] });
      chmodSync(file, 0o644);
      expect(cliSpawn('opencode', ['run'], 'linux', { PATH: dir })).toEqual({ file: 'opencode', args: ['run'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs the command as given outside Windows when nothing is found', () => {
    expect(cliSpawn('tw-no-such-cli-xyz', ['exec', '-'], 'darwin')).toEqual({ file: 'tw-no-such-cli-xyz', args: ['exec', '-'] });
  });

  it('finds the Node script an npm or pnpm shim runs, so no cmd.exe line limit applies', () => {
    const exists = () => true;
    expect(shimTarget('C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd', () => NPM_SHIM, exists)).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js');
    expect(shimTarget('C:\\Users\\me\\AppData\\Local\\pnpm\\claude.cmd', () => PNPM_SHIM, exists)).toBe('C:\\Users\\me\\AppData\\Local\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\cli.js');
    // A batch file that runs no script, or a script that is not there: cmd.exe after all.
    expect(shimTarget('C:\\tools\\x.cmd', () => '@echo off\r\nx.exe %*', exists)).toBeNull();
    expect(shimTarget('C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd', () => NPM_SHIM, () => false)).toBeNull();
  });
});

// opencode's npm shim runs a node script without an extension; a native CLI's shim runs its .exe.
const OPENCODE_SHIM = `@ECHO off\r\nSETLOCAL\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode" %*\r\n`;
const EXE_SHIM = `@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`;
const NPM = 'C:\\Users\\me\\AppData\\Roaming\\npm';

describe('npm shims that do not run a .js file', () => {
  it('runs a target without an extension as a node script when it starts with a node shebang', () => {
    const exists = () => true;
    const target = `${NPM}\\node_modules\\opencode-ai\\bin\\opencode`;
    expect(shimTarget(`${NPM}\\opencode.cmd`, () => OPENCODE_SHIM, exists, () => '#!/usr/bin/env node\nconsole.log(1)')).toBe(target);
    expect(shimTarget(`${NPM}\\opencode.cmd`, () => OPENCODE_SHIM, exists, () => 'MZ\u0090\u0000')).toBeNull();
    expect(cliSpawn('opencode', ['acp'], 'win32', { PATH: NPM, PATHEXT: '.CMD' }, { home: 'C:\\Users\\me', exists: (file) => file === `${NPM}\\opencode.cmd` || file === target, read: () => OPENCODE_SHIM, head: () => '#!/usr/bin/env node' })).toEqual({
      file: process.execPath,
      args: [target, 'acp'],
    });
  });

  it('resolves a shim that points at an .exe to that .exe, so cmd.exe is not involved', () => {
    const exe = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    expect(shimTarget(`${NPM}\\claude.cmd`, () => EXE_SHIM, () => true)).toBe(exe);
    expect(cliSpawn('claude', ['x'], 'win32', { PATH: NPM, PATHEXT: '.CMD' }, { home: 'C:\\Users\\me', exists: (file) => file === `${NPM}\\claude.cmd` || file === exe, read: () => EXE_SHIM })).toEqual({ file: exe, args: ['x'] });
  });
});

describe('the executable handed to an adapter', () => {
  const env = { PATH: NPM, PATHEXT: '.EXE;.CMD', USERPROFILE: 'C:\\Users\\me' };
  const deps = (files: string[], shim = PNPM_SHIM) => ({ home: 'C:\\Users\\me', exists: (file: string) => files.includes(file), read: () => shim });

  it('is never a .cmd: a real .exe next to the shim, on PATH, or the one the shim runs', () => {
    expect(adapterExecutable(`${NPM}\\claude.cmd`, 'win32', env, deps([`${NPM}\\claude.cmd`, `${NPM}\\claude.exe`]))).toEqual({ file: `${NPM}\\claude.exe`, js: false });
    expect(adapterExecutable(`${NPM}\\claude.cmd`, 'win32', env, deps([`${NPM}\\claude.cmd`, 'C:\\Users\\me\\.local\\bin\\claude.exe']))).toEqual({ file: 'C:\\Users\\me\\.local\\bin\\claude.exe', js: false });
    const exe = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    expect(adapterExecutable(`${NPM}\\claude.cmd`, 'win32', env, deps([`${NPM}\\claude.cmd`, exe], EXE_SHIM))).toEqual({ file: exe, js: false });
  });

  it('falls back to the shim\'s node script, and to null when only the .cmd is left', () => {
    const script = 'C:\\Users\\me\\AppData\\Roaming\\npm\\..\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
    const resolved = 'C:\\Users\\me\\AppData\\Roaming\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
    expect(adapterExecutable(`${NPM}\\claude.cmd`, 'win32', env, deps([`${NPM}\\claude.cmd`, resolved, script]))).toEqual({ file: resolved, js: true });
    expect(adapterExecutable(`${NPM}\\claude.cmd`, 'win32', env, deps([`${NPM}\\claude.cmd`], '@echo off\r\nclaude-real %*'))).toBeNull();
  });

  it('keeps an .exe and anything on other platforms as found', () => {
    expect(adapterExecutable('C:\\x\\claude.exe', 'win32', env)).toEqual({ file: 'C:\\x\\claude.exe', js: false });
    expect(adapterExecutable('/usr/local/bin/claude', 'darwin', env)).toEqual({ file: '/usr/local/bin/claude', js: false });
  });
});

describe('resolving a CLI executable', () => {
  const HOME = '/home/me';
  const none = () => false;

  it('searches a colon-separated POSIX PATH', () => {
    const env = { PATH: '/usr/bin:/opt/tools:/home/me/.local/bin' };
    expect(resolveCli('opencode', 'linux', env, HOME, (file) => file === '/opt/tools/opencode')).toBe('/opt/tools/opencode');
  });

  it('skips a non-executable file and keeps looking', () => {
    const env = { PATH: '/first:/second' };
    expect(resolveCli('codex', 'darwin', env, HOME, (file) => file === '/second/codex')).toBe('/second/codex');
  });

  it('falls back to the usual per-user install dirs when the command is not on PATH', () => {
    const env = { PATH: '/usr/bin' };
    expect(resolveCli('opencode', 'linux', env, HOME, (file) => file === `${HOME}/.opencode/bin/opencode`)).toBe(`${HOME}/.opencode/bin/opencode`);
    expect(resolveCli('claude', 'darwin', env, HOME, (file) => file === '/opt/homebrew/bin/claude')).toBe('/opt/homebrew/bin/claude');
  });

  it('expands a leading ~ in a command that has a path separator', () => {
    const env = {};
    expect(resolveCli('~/x/opencode', 'linux', env, HOME, (file) => file === '/home/me/x/opencode')).toBe('/home/me/x/opencode');
    expect(resolveCli('~/x/missing', 'linux', env, HOME, none)).toBeNull();
  });

  it('uses PATHEXT and the ; delimiter on win32', () => {
    const env = { PATH: 'C:\\Tools', PATHEXT: '.COM;.EXE;.CMD' };
    expect(resolveCli('codex', 'win32', env, 'C:\\Users\\me', (file) => file === 'C:\\Tools\\codex.cmd')).toBe('C:\\Tools\\codex.cmd');
  });

  it('returns null when nothing is found anywhere', () => {
    expect(resolveCli('nope', 'linux', { PATH: '/usr/bin' }, HOME, none)).toBeNull();
    expect(resolveCli('nope', 'win32', { PATH: 'C:\\Tools', PATHEXT: '.EXE' }, 'C:\\Users\\me', none)).toBeNull();
  });

  it('searches the Windows per-user install dirs', () => {
    expect(resolveCli('claude', 'win32', { PATH: 'C:\\x', PATHEXT: '.EXE', USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me', (file) => file === 'C:\\Users\\me\\.local\\bin\\claude.exe')).toBe('C:\\Users\\me\\.local\\bin\\claude.exe');
    expect(resolveCli('claude', 'win32', { PATH: 'C:\\x', PATHEXT: '.EXE', USERPROFILE: 'C:\\Users\\me' }, 'C:\\Users\\me', (file) => file === 'C:\\Users\\me\\.claude\\local\\claude.exe')).toBe('C:\\Users\\me\\.claude\\local\\claude.exe');
  });
});
