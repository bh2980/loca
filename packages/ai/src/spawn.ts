import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crossSpawn from 'cross-spawn';

/**
 * How to start a CLI on this machine: the file to run and its arguments.
 *
 * Elsewhere the command runs as given. On Windows a CLI installed with npm (codex, claude) is a
 * `.cmd` shim, which Node cannot start without a shell; through cmd.exe, long arguments (a system
 * prompt, a JSON schema) hit its 8191-character line and quoting rules. So the shim is read and
 * its Node script run directly with this Node; a shim that is not npm's goes through cross-spawn's
 * cmd.exe escaping.
 */
export function cliSpawn(command: string, args: string[], platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): { file: string; args: string[]; windowsVerbatimArguments?: boolean } {
  const found = resolveCli(command, platform, env);
  if (platform !== 'win32') return { file: found ?? command, args };
  if (!found || /\.(?:exe|com)$/i.test(found)) return { file: found ?? command, args };
  const script = /\.(?:cmd|bat)$/i.test(found) ? shimTarget(found) : null;
  if (script) return { file: process.execPath, args: [script, ...args] };
  const parsed = (crossSpawn as unknown as { _parse: CrossSpawnParse })._parse(found, args, {});
  return { file: parsed.command, args: parsed.args, windowsVerbatimArguments: Boolean(parsed.options.windowsVerbatimArguments) };
}

/** cross-spawn's argument parser (exported as `_parse`, not in its types): the cmd.exe line, escaped. */
type CrossSpawnParse = (command: string, args: string[], options: object) => { command: string; args: string[]; options: { windowsVerbatimArguments?: boolean } };

// Where CLIs land when a package manager or installer does not put them on the system PATH but the
// user's shell rc adds them (opencode, grok, claude, volta, bun, cargo, homebrew, pnpm global).
const POSIX_INSTALL_DIRS = ['~/.opencode/bin', '~/.local/bin', '~/.npm-global/bin', '~/.volta/bin', '~/.bun/bin', '~/.grok/bin', '~/.claude/local', '~/.local/share/pnpm', '~/Library/pnpm', '~/.cargo/bin', '/opt/homebrew/bin', '/usr/local/bin'];
const WIN32_INSTALL_DIRS = ['%APPDATA%\\npm', '%LOCALAPPDATA%\\pnpm', '%USERPROFILE%\\.opencode\\bin', '%USERPROFILE%\\.bun\\bin', '%LOCALAPPDATA%\\Volta\\bin'];

/** `~` and `%VAR%` (Windows) expanded for the target platform, not the host building the string. */
function expandDir(dir: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const withHome = dir === '~' ? home : /^~[\\/]/.test(dir) ? join(home, dir.slice(2)) : dir;
  // A dir under a variable that is not set is skipped (empty), not searched relative to the cwd.
  let missing = false;
  const expanded = withHome.replace(/%([^%]+)%/g, (_, name: string) => env[name] ?? ((missing = true), ''));
  return missing ? '' : expanded;
}

/** A regular file with the executable bit: what `exec` accepts on POSIX. */
function isExecutableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The candidate names for a bare command on Windows: itself when typed with a known extension, else PATHEXT variants. */
function win32Names(command: string, env: NodeJS.ProcessEnv): string[] {
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const lower = command.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension.toLowerCase())) ? [command] : extensions.map((extension) => command + extension.toLowerCase());
}

/**
 * The executable to run for a command, so a CLI installed in a user-only directory (on PATH only
 * for an interactive shell) is found when the server's environment is not that shell.
 *
 * A command with a separator is used as a path (a leading `~` expanded); otherwise PATH is searched
 * with the target platform's delimiter and then the usual per-user install dirs. Returns null when
 * nothing matches, so the caller can fall back to the bare command and report what it tried.
 */
export function resolveCli(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  isExecutable: (file: string) => boolean = platform === 'win32' ? existsSync : isExecutableFile,
): string | null {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  if (/[\\/]/.test(command)) {
    const file = expandDir(command, platform, env, home);
    return isExecutable(file) ? file : null;
  }
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter;
  const pathValue = platform === 'win32' ? (env.PATH ?? env.Path ?? '') : (env.PATH ?? '');
  const installDirs = platform === 'win32' ? WIN32_INSTALL_DIRS : POSIX_INSTALL_DIRS;
  const names = platform === 'win32' ? win32Names(command, env) : [command];
  const seen = new Set<string>();
  for (const raw of [...pathValue.split(delimiter), ...installDirs]) {
    if (!raw) continue;
    const dir = expandDir(raw, platform, env, home);
    if (!dir) continue;
    const key = platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The script an npm/pnpm cmd-shim runs with node: `"%dp0%\node_modules\@openai\codex\bin\codex.js" %*`
 * (npm) or `"%~dp0\..\pkg\cli.js" %*` (pnpm). Null when the shim does not run a JS file that exists.
 */
export function shimTarget(shim: string, read: (file: string) => string = (file) => readFileSync(file, 'utf8'), exists: (file: string) => boolean = existsSync): string | null {
  let text: string;
  try {
    text = read(shim);
  } catch {
    return null;
  }
  const match = /"%~?dp0%?\\?([^"%]+?\.(?:c|m)?js)"/i.exec(text);
  if (!match) return null;
  const script = path.win32.resolve(path.win32.dirname(shim), match[1]);
  return exists(script) ? script : null;
}
