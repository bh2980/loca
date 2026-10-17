import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Layer rules for the server (#49), checked on every `pnpm test` so they do not drift back:
 * no import cycles (type-only imports count, as they do for madge), and services/engine never
 * import routes (request schemas live in schemas/, shared helpers in services/).
 */
const root = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const IMPORT = /^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gm;

function graph() {
  const files = sourceFiles(root);
  const known = new Set(files);
  return new Map(
    files.map((file) => {
      const text = fs.readFileSync(file, 'utf8');
      const targets = [...text.matchAll(IMPORT)].map((match) => path.resolve(path.dirname(file), match[1]!)).filter((target) => known.has(target));
      return [file, [...new Set(targets)]] as const;
    }),
  );
}

/** Strongly connected components with more than one file (or a file importing itself): the cycles. */
function cycles(edges: Map<string, readonly string[]>) {
  let index = 0;
  const stack: string[] = [];
  const on = new Set<string>();
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const found: string[][] = [];
  const visit = (node: string) => {
    indices.set(node, index);
    low.set(node, index++);
    stack.push(node);
    on.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (on.has(next)) low.set(node, Math.min(low.get(node)!, indices.get(next)!));
    }
    if (low.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        on.delete(member);
        component.push(path.relative(root, member));
      } while (member !== node);
      if (component.length > 1 || edges.get(node)?.includes(node)) found.push(component.sort());
    }
  };
  for (const node of edges.keys()) if (!indices.has(node)) visit(node);
  return found;
}

describe('server architecture', () => {
  const edges = graph();

  it('has no import cycles', () => {
    expect(cycles(edges)).toEqual([]);
  });

  it('keeps services and engine from importing routes', () => {
    const offenders = [...edges].flatMap(([file, targets]) => {
      const from = path.relative(root, file);
      if (!/^(services|engine)\//.test(from)) return [];
      return targets.filter((target) => path.relative(root, target).startsWith('routes/')).map((target) => `${from} → ${path.relative(root, target)}`);
    });
    expect(offenders).toEqual([]);
  });

  it('finds a cycle when there is one (the check itself works)', () => {
    const a = path.join(root, 'a.ts');
    const b = path.join(root, 'b.ts');
    expect(cycles(new Map([[a, [b]], [b, [a]]]))).toEqual([['a.ts', 'b.ts']]);
  });
});
