import { describe, expect, it } from 'vitest';
import { cliSpawn, shimTarget } from './spawn.ts';

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
  it('runs the command as given outside Windows', () => {
    expect(cliSpawn('codex', ['exec', '-'], 'darwin')).toEqual({ file: 'codex', args: ['exec', '-'] });
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
