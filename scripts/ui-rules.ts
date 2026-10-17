/**
 * UI consistency check (docs/DESIGN.md 4.1): screens are built from the shared parts, so these
 * patterns must not appear outside components/ui. Run with `pnpm ui-rules`; part of `pnpm verify`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/src');
const RULES: { name: string; pattern: RegExp }[] = [
  { name: 'raw <button> (use Button)', pattern: /<button\b/ },
  { name: 'arbitrary text size (use text-base / text-sm / text-xs)', pattern: /text-\[\d+(\.\d+)?px\]/ },
  { name: 'Button size="sm"/"xs" (sm is the default; one size)', pattern: /<(Button|AiButton)\b[^>]*\bsize="(sm|xs)"/ },
  { name: 'Button height/size override in className', pattern: /<(Button|AiButton)\b[^>]*className="[^"]*\b(h-\d+|size-\d+)\b/ },
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'ui' ? [] : files(full);
    return full.endsWith('.tsx') ? [full] : [];
  });

let failures = 0;
for (const file of files(root))
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const rule of RULES)
        if (rule.pattern.test(line)) {
          failures++;
          console.log(`${path.relative(root, file)}:${i + 1}  ${rule.name}`);
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
