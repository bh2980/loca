/**
 * Tier checks of packages/ui (docs/DESIGN-SYSTEM.md section 2 and 3), called from ui-rules.ts:
 *  - dependency direction: primitives < controls < patterns < domains; a tier imports only the tiers below it;
 *  - no domain word in the file or export names of primitives/controls/patterns;
 *  - a public part does not accept `className` (checked on the exported component's props type).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const TIERS = ['tokens', 'primitives', 'controls', 'patterns', 'domains'] as const;
const rank = (tier: string): number => (tier === 'lib' ? -1 : TIERS.indexOf(tier as (typeof TIERS)[number]));

/** Words that name a screen or a feature: only domains/ may carry them. Matched as whole CamelCase/kebab words. */
const DOMAIN_WORDS = ['Script', 'Knowledge', 'Workflow', 'Graph', 'Chat', 'Rules', 'Editor', 'Settings', 'Run', 'Node', 'Speaker', 'Scene', 'Canvas', 'Project', 'Glossary', 'Translation'];

/**
 * Controls that wrap a Radix/shadcn element and forward `className` to its slot. They are the third-party slot
 * components: apps/web cannot pass a class (ui-rules forbids className there), so only other parts of packages/ui can.
 * Anything not listed here must not take `className`.
 */
const CLASSNAME_SLOT_FILES = new Map<string, string>([
  ['controls/alert-dialog.tsx', 'Radix AlertDialog slots (Overlay, Content, ...) forward className'],
  ['controls/button.tsx', 'shadcn Button: cva variants merged with className; domain parts compose it'],
  ['controls/collapsible.tsx', 'Radix Collapsible slots; a parent Box asChild hands its class to CollapsibleContent'],
  ['controls/checkbox.tsx', 'Radix Checkbox root slot'],
  ['controls/command.tsx', 'cmdk slots (Input, List, Item, ...) forward className'],
  ['controls/context-menu.tsx', 'Radix ContextMenu slots'],
  ['controls/dialog.tsx', 'Radix Dialog slots'],
  ['controls/dropdown-menu.tsx', 'Radix DropdownMenu slots'],
  ['controls/hover-card.tsx', 'Radix HoverCard slots'],
  ['controls/input-group.tsx', 'shadcn InputGroup slots'],
  ['controls/input.tsx', 'native input element'],
  ['controls/kbd.tsx', 'native kbd element'],
  ['controls/label.tsx', 'Radix Label root'],
  ['controls/popover.tsx', 'Radix Popover slots'],
  ['controls/radio-group.tsx', 'Radix RadioGroup slots'],
  ['controls/resizable.tsx', 'react-resizable-panels slots'],
  ['controls/sonner.tsx', 'sonner Toaster options forward className'],
  ['controls/scroll-area.tsx', 'Radix ScrollArea slots'],
  ['controls/select.tsx', 'Radix Select slots'],
  ['controls/separator.tsx', 'Radix Separator root'],
  ['controls/sheet.tsx', 'Radix Dialog (Sheet) slots'],
  ['controls/switch.tsx', 'Radix Switch root'],
  ['controls/tabs.tsx', 'Radix Tabs slots'],
  ['controls/text-link.tsx', 'renders the router link/anchor via asChild'],
  ['controls/textarea.tsx', 'native textarea element'],
  ['controls/toggle-group.tsx', 'Radix ToggleGroup slots'],
  ['controls/toggle.tsx', 'Radix Toggle root'],
  ['controls/tooltip.tsx', 'Radix Tooltip slots'],
  ['patterns/count.tsx', 'a parent Box asChild hands its class to the pill (Slot)'],
  ['patterns/card.tsx', 'shadcn Card slots'],
  ['primitives/box.tsx', 'layout primitives are the only way a screen sets a class; Slot/asChild merges the className of the child'],
  ['primitives/grid.tsx', 'layout primitive, see box.tsx'],
  ['primitives/icon.tsx', 'lucide icon element'],
  ['primitives/overlay.tsx', 'layout primitive, see box.tsx'],
  ['primitives/stack.tsx', 'layout primitive, see box.tsx'],
  ['primitives/text.tsx', 'layout primitive, see box.tsx'],
]);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

export function checkTiers(ui: string, report: (where: string, line: number, what: string) => void): void {
  const files = walk(ui).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.stories.tsx') && !f.endsWith('.test.ts') && !f.endsWith('src/index.ts'));
  const rel = (f: string) => path.relative(ui, f).split(path.sep).join('/');
  const tierOf = (r: string) => r.split('/')[0];

  // 1. dependency direction
  for (const file of walk(ui).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.stories.tsx'))) {
    const r = rel(file);
    const own = rank(tierOf(r));
    if (own < 0 || r === 'index.ts') continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/from\s+['"](\.[^'"]*)['"]/);
      if (!m) return;
      const target = rel(path.resolve(path.dirname(file), m[1]));
      const t = rank(tierOf(target));
      if (t > own) report(`packages/ui/src/${r}`, i + 1, `${tierOf(r)} imports from ${tierOf(target)} (a tier imports only the tiers below it)`);
      if (tierOf(r) === 'domains' && tierOf(target) === 'domains' && r.split('/')[1] !== target.split('/')[1]) report(`packages/ui/src/${r}`, i + 1, 'a domain imports another domain (go through a lower tier)');
    });
  }

  // 2. domain words in names of the shared tiers
  const wordRe = new RegExp(`(?:^|[A-Z]|[-_])(${DOMAIN_WORDS.join('|')})(?![a-z])`);
  const hasWord = (name: string) => wordRe.test(name.replace(/^([a-z])/, (c) => c.toUpperCase()).replace(/-([a-z])/g, (_, c: string) => '-' + c.toUpperCase()));
  const program = ts.createProgram(files, { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, noEmit: true, strict: true, allowImportingTsExtensions: true });
  const checker = program.getTypeChecker();
  for (const file of files) {
    const r = rel(file);
    const tier = tierOf(r);
    if (!['primitives', 'controls', 'patterns'].includes(tier)) continue;
    const base = path.basename(r).replace(/\.tsx?$/, '');
    if (hasWord(base)) report(`packages/ui/src/${r}`, 1, `domain word in the file name (${tier}/ carries no Script/Knowledge/Workflow/Graph/Chat/Rules/Editor/Settings/Run/Node ... names)`);
    const source = program.getSourceFile(file);
    if (!source) continue;
    const symbol = checker.getSymbolAtLocation(source);
    if (!symbol) continue;
    for (const exp of checker.getExportsOfModule(symbol)) {
      const line = source.getLineAndCharacterOfPosition(exp.declarations?.[0]?.getStart() ?? 0).line + 1;
      if (hasWord(exp.name)) report(`packages/ui/src/${r}`, line, `domain word in the export name ${exp.name}`);
    }
  }

  // 3. className in the props of a public component
  for (const file of files) {
    const r = rel(file);
    if (!/\.tsx$/.test(r) || CLASSNAME_SLOT_FILES.has(r)) continue;
    const source = program.getSourceFile(file);
    const symbol = source && checker.getSymbolAtLocation(source);
    if (!source || !symbol) continue;
    for (const exp of checker.getExportsOfModule(symbol)) {
      const decl = exp.declarations?.[0];
      if (!decl) continue;
      const type = checker.getTypeOfSymbolAtLocation(exp, decl);
      for (const signature of type.getCallSignatures()) {
        const param = signature.getParameters()[0];
        if (!param) continue;
        const props = checker.getTypeOfSymbolAtLocation(param, decl);
        if (props.getProperty('className')) report(`packages/ui/src/${r}`, source.getLineAndCharacterOfPosition(decl.getStart()).line + 1, `${exp.name} accepts className (public parts take role-named props; slot wrappers are listed in scripts/ui-tiers.ts)`);
      }
    }
  }
}
