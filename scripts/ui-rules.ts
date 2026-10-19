/**
 * UI consistency check: screens are built from the shared parts, so these
 * patterns must not appear outside components/ui. Run with `pnpm ui-rules`; part of `pnpm verify`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'apps/web/src');
const ui = path.join(repo, 'packages/ui/src');
const palette = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{3,}';
const LEGACY_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'raw <button> (use Button)', pattern: /<button\b/ },
  { name: 'arbitrary text size (use the type roles: text-2xs … text-xl)', pattern: /text-\[\d+(\.\d+)?(px|rem)\]/ },
  { name: 'Button size="sm"/"xs" (sm is the default; one size)', pattern: /<(Button|AiButton)\b[^>]*\bsize="(sm|xs)"/ },
  { name: 'Button height/size override in className', pattern: /<(Button|AiButton)\b[^>]*className="[^"]*\b(h-\d+|size-\d+)\b/ },
  { name: 'styled heading (use SectionHeading / GroupHeading, or FieldRow labels)', pattern: /<(h[1-6]|legend)\b[^>]*className=/ },

];
const TOKEN_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'legacy accent token (use primary)', pattern: /accent-indigo/ },
  { name: 'legacy surface token (use a semantic surface)', pattern: /surface-(?:1|2|elevated)/ },
  { name: 'border opacity (use border-border)', pattern: /border-border(?:-subtle)?\/\d+/ },
  { name: 'muted text opacity (use text-subtle-foreground)', pattern: /text-muted-foreground\/\d+/ },
  { name: 'large radius (use rounded-lg)', pattern: /rounded-(?:xl|2xl|3xl)/ },
  { name: 'Tailwind palette color (use a semantic token)', pattern: new RegExp('(?:^|[\\s\"\x27\x60])(?:[\\w-]+:)*(?:bg|text|border|ring|fill|stroke|from|to|decoration|outline)-' + palette + '(?=$|[\\s\"\x27\x60])') },
  { name: 'hex color literal (use a semantic token)', pattern: /(['"`])#[0-9a-fA-F]{3,8}\b/ },
];


const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });

let failures = 0;
for (const file of files(root))
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const rule of [...LEGACY_RULES, ...TOKEN_RULES]) if (rule.pattern.test(line)) {
      failures++; console.log(`apps/web/src/${path.relative(root, file)}:${i + 1}  ${rule.name}`);
    }
  });
for (const file of files(ui))
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const rule of TOKEN_RULES) if (rule.pattern.test(line)) {
      failures++; console.log(`packages/ui/src/${path.relative(ui, file)}:${i + 1}  ${rule.name}`);
    }
  });
// Tailwind only generates classes it finds under the CSS file's @source folders: a path that does
// not exist silently drops every class used only in @loca/ui (dialogs off-screen, switches blank).
const css = path.join(root, 'index.css');
for (const [, source] of readFileSync(css, 'utf8').matchAll(/^@source\s+"([^"]+)"/gm))
  if (!existsSync(path.resolve(path.dirname(css), source))) {
    failures++;
    console.log(`index.css  @source "${source}" does not exist`);
  }
if (failures) {
  console.log(`\n${failures} UI rule violation(s).`);
  process.exit(1);
}
console.log('UI rules: ok');
