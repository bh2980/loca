import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { expect, it } from 'vitest';
import { AGENT_TOOLS } from '@tw/shared';
import { program } from './main.ts';

const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../skills');
const markdown = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? markdown(full) : name.endsWith('.md') ? [full] : [];
  });

/** Every `loca …` written in code (backticks or fenced blocks) in skills/: what an agent will type. */
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

it('skills only call agent tools that exist', () => {
  const problems: string[] = [];
  for (const { file, text } of invocations()) {
    const match = /^(?:call|tools)\s+([a-z_]+)/.exec(text);
    if (match && !Object.hasOwn(AGENT_TOOLS, match[1]!)) problems.push(`${file}: loca ${text} — 없는 도구 "${match[1]}"`);
  }
  expect(problems).toEqual([]);
});
