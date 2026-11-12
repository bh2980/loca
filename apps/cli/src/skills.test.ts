import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../../server/src/db/index.ts';
import { agentCatalog } from '../../server/src/services/agent-catalog.ts';
import { importProject } from '../../server/src/services/importer.ts';
import { program } from './main.ts';

const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.claude/skills');
const markdown = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? markdown(full) : name.endsWith('.md') ? [full] : [];
  });

/** Every `loca …` written in code (backticks or fenced blocks) in .claude/skills/: what an agent will type. */
function invocations() {
  const found: { file: string; text: string }[] = [];
  for (const file of markdown(skillsDir)) {
    const text = readFileSync(file, 'utf8');
    const code = [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((match) => match[0]);
    for (const block of code)
      // A trailing "# comment" in a code block is prose, not a command (it may even name one in passing).
      for (const match of block.replace(/\s#\s.*$/gm, '').matchAll(/(?:^|[\s`$(|])loca\s+([^`\n|;&)]*)/g))
        found.push({ file: path.relative(skillsDir, file), text: match[1]!.trim() });
  }
  return found;
}

const flagsOf = (command: Command) => new Set(command.options.flatMap((option) => [option.long, option.short].filter((flag): flag is string => Boolean(flag))));

it('skills only use loca commands, subcommands and flags that exist', () => {
  const global = flagsOf(program);
  const problems: string[] = [];
  for (const { file, text } of invocations()) {
    const words = text.split(/\s+/).filter(Boolean);
    let command: Command = program;
    let used = 0;
    // Skip global options written before the command (loca -p 이름 lines …).
    while (words[used]?.startsWith('-')) used += global.has(words[used]!.split('=')[0]!) && !words[used]!.includes('=') && words[used] !== '--json' ? 2 : 1;
    for (const word of words.slice(used)) {
      if (word.startsWith('-') || word.startsWith('<') || word.startsWith('[') || /[^a-z-]/.test(word)) break;
      const next = command.commands.find((sub) => sub.name() === word);
      if (!next) {
        if (command === program || (command.commands.length && !command.registeredArguments.length)) {
          problems.push(`${file}: loca ${text} — 없는 명령 "${word}"`);
          command = undefined as never;
        }
        break;
      }
      command = next;
    }
    if (!command) continue;
    const known = new Set([...global, ...flagsOf(command)]);
    for (const flag of text.match(/(?<=^|\s)--?[a-z][\w-]*/g) ?? []) if (!known.has(flag)) problems.push(`${file}: loca ${text} — ${command.name()}에 없는 옵션 ${flag}`);
  }
  expect(problems).toEqual([]);
});

/** The real catalogue, as `loca tools` lists it with every permission on: the tools `loca call` can reach, with their input schemas. */
function catalogue() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Skills' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }] }));
  return new Map(agentCatalog(db, projectId, undefined, { unrestricted: true }).map((tool) => [tool.name as string, tool]));
}

it('skills only call agent tools the CLI can call', () => {
  const tools = catalogue();
  const problems: string[] = [];
  for (const { file, text } of invocations()) {
    const match = /^(?:call|tools)\s+([a-z_]+)/.exec(text);
    if (match && !tools.has(match[1]!)) problems.push(`${file}: loca ${text} — 없는 도구 "${match[1]}"`);
  }
  expect(problems).toEqual([]);
});

it('a tool named in a skill exists', () => {
  const tools = catalogue();
  const problems: string[] = [];
  for (const file of markdown(skillsDir)) {
    // A code span that is one snake_case word is how the skills name a tool in prose.
    for (const match of readFileSync(file, 'utf8').matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
      const name = match[1]!;
      if (!tools.has(name)) problems.push(`${path.relative(skillsDir, file)}: \`${name}\` — 없는 도구`);
    }
  }
  expect([...new Set(problems)]).toEqual([]);
});

it('JSON examples for `loca call` fit the tool\'s input schema', () => {
  const tools = catalogue();
  const problems: string[] = [];
  let checked = 0;
  for (const file of markdown(skillsDir)) {
    const where = path.relative(skillsDir, file);
    // The payload written inline ('{…}'), or shown in the comment after a file argument (@file  # {…}).
    for (const match of readFileSync(file, 'utf8').matchAll(/loca\s+call\s+([a-z_]+)\s+(?:'(\{[^\n]*\})'|@\S+\s+#\s*(\{[^\n`]*\}))/g)) {
      const [, name, inline, commented] = match;
      const tool = tools.get(name!);
      if (!tool) continue;
      let payload: unknown;
      try {
        payload = JSON.parse((inline ?? commented)!);
      } catch {
        problems.push(`${where}: loca call ${name} — 예시가 JSON이 아닙니다: ${inline ?? commented}`);
        continue;
      }
      checked++;
      const parsed = tool.schema.safeParse(payload);
      if (!parsed.success) problems.push(`${where}: loca call ${name} ${JSON.stringify(payload)} — ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
    }
  }
  expect(problems).toEqual([]);
  // The pattern still finds the examples (a rewrite of the skills' style would silently check nothing).
  expect(checked).toBeGreaterThan(10);
});

it('every command that starts or goes on with a run takes the run\'s caps by the same flags', () => {
  const runs = program.commands.find((command) => command.name() === 'runs')!;
  for (const name of ['start', 'resume', 'continue']) {
    const flags = flagsOf(runs.commands.find((command) => command.name() === name)!);
    expect([name, flags.has('--max-calls'), flags.has('--max-input-tokens')]).toEqual([name, true, true]);
  }
});
