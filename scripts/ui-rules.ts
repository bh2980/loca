/**
 * UI consistency check: screens are built from the shared parts, so these
 * patterns must not appear in apps/web. Run with `pnpm ui-rules`; part of `pnpm verify`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTiers } from './ui-tiers';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'apps/web/src');
const ui = path.join(repo, 'packages/ui/src');
const tokens = path.join(ui, 'tokens');
const LEGACY_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'raw <button> (use Button)', pattern: /<button\b/ },
  { name: 'arbitrary text size (use the type roles: text-2xs … text-xl)', pattern: /text-\[\d+(\.\d+)?(px|rem)\]/ },
  { name: 'Button size="sm"/"xs" (sm is the default; one size)', pattern: /<(Button|AiButton)\b[^>]*\bsize="(sm|xs)"/ },
  { name: 'Button height/size override in className', pattern: /<(Button|AiButton)\b[^>]*className="[^"]*\b(h-\d+|size-\d+)\b/ },
  { name: 'styled heading (use SectionHeading / GroupHeading, or FieldRow labels)', pattern: /<(h[1-6]|legend)\b[^>]*className=/ },
  // A folding part starts open and remembers what the person folded (Section collapsible + persistKey); nothing starts folded.
  { name: 'defaultOpen={false} (a folding part starts open: Section collapsible persistKey="…")', pattern: /defaultOpen=\{false\}/ },
  // Two folding patterns, one look: parts of a pane (Section / Group collapsible) and rows that open (ExpandableRow).
  { name: 'Collapsible in a screen (use Section / Group collapsible, or ExpandableRow)', pattern: /\bCollapsible(?:Trigger|Content)?\b/ },

];
/**
 * Screens say layout with Box/Stack/Inline/Grid/Text/Heading/Icon (props by token name) or a @loca/ui
 * part, and never write a class: anything the primitives cannot say becomes a part in packages/ui.
 */
const CLASS_RULE = { name: 'className in a screen (use Box/Stack/Inline/Grid/Text or a @loca/ui part)', pattern: /\bclassName=/ };
const TOKEN_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'border opacity (use border-default)', pattern: /border-default\/\d+/ },
  { name: 'muted text opacity (use text-subtle)', pattern: /text-muted\/\d+/ },
  { name: 'large radius (use rounded-lg)', pattern: /rounded-(?:xl|2xl|3xl)/ },
  { name: 'hex color literal (use a role from tokens/theme.css)', pattern: /([\'"`])#[0-9a-fA-F]{3,8}\b/ },
  // Base tier (tokens/palette.css): only the token files name a family step, as a class or as var(--slate-3).
  { name: 'base palette step outside packages/ui/src/tokens (use a role from tokens/theme.css)', pattern: /(?<![\w])(?:slate|night|cobalt|teal|red|orange|amber|green|violet|gray|zinc|neutral|stone|yellow|lime|emerald|cyan|sky|blue|indigo|purple|fuchsia|pink|rose)-\d{1,4}(?:-a\d+)?(?![\w-])/ },
];

/**
 * Every colour class names a token defined in tokens/theme.css. Tailwind reads the class's colour from a namespace per
 * painted property (bg -> --background-color-*, text -> --text-color-*, ...); the palette is off, so a name outside
 * those makes no CSS, and a typo would silently paint nothing (text-info did).
 */
const NAMESPACE: Record<string, string> = {
  bg: 'background-color', text: 'text-color', border: 'border-color', ring: 'ring-color', outline: 'outline-color',
  divide: 'divide-color', fill: 'fill', stroke: 'stroke', decoration: 'text-decoration-color',
};
// What follows a prefix without being a colour (bg-cover, text-center, ring-inset, border-dashed ...).
const NOT_A_COLOR: Record<string, RegExp> = {
  bg: /^(?:fixed|local|scroll|clip|origin|bottom|center|left|right|top|repeat|no|auto|cover|contain|none|linear|radial|conic|gradient|blend|size)(?:-|$)/,
  text: /^(?:xs|sm|section|base|lg|xl|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|top|bottom|middle|baseline|sub|super|anchor)$/,
  border: /^(?:solid|dashed|dotted|double|hidden|none|collapse|separate|spacing)(?:-|$)/,
  ring: /^(?:inset|offset)(?:-|$)/,
  outline: /^(?:none|hidden|dashed|dotted|double|solid|offset|style)(?:-|$)/,
  divide: /^(?:x|y|solid|dashed|dotted|double|none)(?:-|$)/,
  fill: /^(?:none|opacity|rule)$/,
  stroke: /^(?:none|width|opacity|linecap|linejoin|dasharray|dashoffset)$/,
  decoration: /^(?:solid|double|dotted|dashed|wavy|auto|from-font|clone|slice)(?:-|$)/,
};
const COLOR_CLASS = /(?<![\w\-./])(bg|text|border(?:-[trblxyse])?|ring|outline|divide|fill|stroke|decoration)-([a-z][a-z0-9-]*?)(?:\/[\w.\[\]%]+)?(?![\w\-\[(:])/g;
const definedTokens = (() => {
  const names = new Set<string>(['transparent', 'current', 'inherit']);
  for (const m of readFileSync(path.join(tokens, 'theme.css'), 'utf8').matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)) names.add(m[1]);
  return names;
})();
const colorClassProblems = (line: string): string[] => {
  const problems: string[] = [];
  for (const m of line.matchAll(COLOR_CLASS)) {
    const prefix = m[1].startsWith('border') ? 'border' : m[1];
    const name = m[2];
    if (name.startsWith('color-')) continue; // a CSS variable name (--text-color-default), not a class
    if (NOT_A_COLOR[prefix]?.test(name)) continue;
    if (prefix === 'border' && /^[trblxyse](?:-\d+)?$/.test(name)) continue; // a side or its width, not a colour
    if (name === 'transparent' || name === 'current' || name === 'inherit') continue;
    if (!definedTokens.has(`${NAMESPACE[prefix]}-${name}`)) problems.push(`${m[1]}-${name} is no colour token (tokens/theme.css defines --${NAMESPACE[prefix]}-${name}?)`);
  }
  return problems;
};

const files = (dir: string, extension = /\.tsx?$/): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full, extension);
    return extension.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });
const sources = /\.(?:tsx?|css)$/;

let failures = 0;
const report = (where: string, line: number, what: string) => { failures++; console.log(`${where}:${line}  ${what}`); };
const BASE_STEP = TOKEN_RULES[TOKEN_RULES.length - 1];
for (const file of files(root, sources))
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const where = `apps/web/src/${path.relative(root, file)}`;
    for (const rule of [...(file.endsWith('.css') ? [] : LEGACY_RULES), ...TOKEN_RULES, ...(file.endsWith('.css') ? [] : [CLASS_RULE])]) if (rule.pattern.test(line)) report(where, i + 1, rule.name);
    for (const problem of colorClassProblems(line)) report(where, i + 1, problem);
  });
for (const file of [...files(ui, sources), ...files(path.join(ui, '../.storybook'), sources)]) {
  const inTokens = file.startsWith(tokens + path.sep);
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const where = `packages/ui/${path.relative(path.join(ui, '..'), file)}`;
    for (const rule of TOKEN_RULES) if (!(inTokens && rule === BASE_STEP) && rule.pattern.test(line)) report(where, i + 1, rule.name);
    if (!inTokens) for (const problem of colorClassProblems(line)) report(where, i + 1, problem);
  });
}
/**
 * The size options of primitives/style.ts take only the names of tokens/system.css: no raw Tailwind number (`w-28`, `size-2`), no CSS
 * length (`w-[200px]`), and every size name used must be defined there (`w-field` needs `--width-field`).
 */
{
  const styleFile = path.join(ui, 'primitives/style.ts');
  const system = readFileSync(path.join(tokens, 'system.css'), 'utf8');
  const NAMESPACE_OF: Record<string, string[]> = { w: ['width'], h: ['height'], 'max-w': ['max-width'], 'max-h': ['max-height'], 'min-h': ['min-height', 'height'] };
  const KEYWORD = new Set(['full', 'auto', 'fit', 'screen', 'min', 'max', 'px', '0']);
  readFileSync(styleFile, 'utf8').split('\n').forEach((line, i) => {
    const where = 'packages/ui/src/primitives/style.ts';
    if (/^\s*(?:\/?\*|\/\/)/.test(line)) return;
    if (/\b(?:w|h|min-w|max-w|min-h|max-h|size)-(?!0(?![\d.]))\d+(?:\.\d+)?(?![\d./])/.test(line)) report(where, i + 1, 'raw number as a size (name a token in tokens/system.css)');
    if (/\b(?:w|h|min-w|max-w|min-h|max-h|size)-\[/.test(line) || /\[\d/.test(line)) report(where, i + 1, 'CSS length as a size (name a token in tokens/system.css)');
    for (const m of line.matchAll(/"(?:[a-z-]+:)*(w|h|max-w|max-h|min-h)-([a-z][a-z0-9-]*)"/g)) {
      if (KEYWORD.has(m[2])) continue;
      if (!NAMESPACE_OF[m[1]].some((ns) => new RegExp(`--${ns}-${m[2]}\\s*:`).test(system))) report(where, i + 1, `${m[1]}-${m[2]} has no --${NAMESPACE_OF[m[1]][0]}-${m[2]} in tokens/system.css`);
    }
  });
}
checkTiers(ui, report);
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
