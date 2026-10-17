import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliSpawn, resolveCli, shimTarget } from './spawn.ts';

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
  it('resolves a POSIX executable from PATH', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-cli-'));
    const file = path.join(dir, 'opencode');
    writeFileSync(file, '#!/bin/sh\nexit 0\n');
    chmodSync(file, 0o755);
    try {
      expect(cliSpawn('opencode', ['run'], 'linux', { PATH: dir })).toEqual({ file, args: ['run'] });
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
});
