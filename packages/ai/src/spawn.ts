import { existsSync, readFileSync } from 'node:fs';
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
  if (platform !== 'win32') return { file: command, args };
  const found = findOnPath(command, env);
  if (!found || /\.(?:exe|com)$/i.test(found)) return { file: found ?? command, args };
  const script = /\.(?:cmd|bat)$/i.test(found) ? shimTarget(found) : null;
  if (script) return { file: process.execPath, args: [script, ...args] };
  const parsed = (crossSpawn as unknown as { _parse: CrossSpawnParse })._parse(found, args, {});
  return { file: parsed.command, args: parsed.args, windowsVerbatimArguments: Boolean(parsed.options.windowsVerbatimArguments) };
}

/** cross-spawn's argument parser (exported as `_parse`, not in its types): the cmd.exe line, escaped. */
type CrossSpawnParse = (command: string, args: string[], options: object) => { command: string; args: string[]; options: { windowsVerbatimArguments?: boolean } };

/** The command's file: as given when it has a directory or an extension, else the first PATH match by PATHEXT. */
function findOnPath(command: string, env: NodeJS.ProcessEnv) {
  if (/[\\/]/.test(command) || path.win32.extname(command)) return existsSync(command) ? command : null;
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.win32.join(dir, command + extension.toLowerCase());
      if (existsSync(candidate)) return candidate;
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
