import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Layer rules for the server (#49), checked on every `pnpm test` so they do not drift back. A module imports
 * only from its own layer or a layer below it:
 *
 *   main.ts → app.ts → routes/ → http.ts, feed.ts → services/ → engine/ → domain/ → db/, schemas/, events.ts, refusal.ts, config.ts
 *
 *   routes/    the HTTP API: reads a request, asks a service, answers.
 *   services/  everything a route or a tool asks for: the tools and the change gate, chat, proposals, previews,
 *              starting and continuing runs, the script's queries, graph views and layouts.
 *   engine/    running workflows and building the model requests they send (a preview's request is built here too).
 *   domain/    the project's rows and their rules, as a run and a person's request both need them: the one
 *              writer of lines, candidates, knowledge, terms and tags, the reads they share (speech rules, the
 *              knowledge cache, the line filter), connections with their keys, and the AI log.
 *   db/        the schema, the migrations and what the database says itself (triggers, row changes).
 *
 * Also: no import cycles (type-only imports count, as they do for madge), and services, the engine, the domain
 * and the database layer never import the web framework (a refusal is a Refusal, refusal.ts).
 */
const LAYERS: readonly (readonly string[])[] = [['main.ts'], ['app.ts'], ['routes/'], ['http.ts', 'feed.ts'], ['services/'], ['engine/'], ['domain/'], ['db/', 'schemas/', 'events.ts', 'refusal.ts', 'config.ts']];

/** The layer a file (relative to src) is in: 0 is the top. Undefined for a file no layer names. */
const layerOf = (file: string) => {
  const at = LAYERS.findIndex((members) => members.some((member) => (member.endsWith('/') ? file.startsWith(member) : file === member)));
  return at < 0 ? undefined : at;
};

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

  it('puts every module in a layer', () => {
    expect([...edges.keys()].map((file) => path.relative(root, file)).filter((file) => layerOf(file) === undefined)).toEqual([]);
  });

  it('lets a module import only its own layer and the layers below it', () => {
    const offenders = [...edges].flatMap(([file, targets]) => {
      const from = path.relative(root, file);
      return targets.map((target) => path.relative(root, target)).filter((to) => layerOf(to)! < layerOf(from)!).map((to) => `${from} → ${to}`);
    });
    expect(offenders).toEqual([]);
  });

  // A service says no with a Refusal (refusal.ts) and knows nothing of HTTP; only app.ts, http.ts, feed.ts and routes/ speak Hono.
  it('keeps the web framework out of services, the engine, the domain and the database layer', () => {
    const HONO = /^\s*(?:import|export)\b[^'"]*?['"](hono(?:\/[^'"]*)?|@hono\/[^'"]+)['"]/gm;
    const offenders = sourceFiles(root).flatMap((file) => {
      const from = path.relative(root, file);
      if (!/^(services|engine|domain|db|schemas)\//.test(from) && !['refusal.ts', 'events.ts', 'config.ts'].includes(from)) return [];
      return [...fs.readFileSync(file, 'utf8').matchAll(HONO)].map((match) => `${from} → ${match[1]}`);
    });
    expect(offenders).toEqual([]);
  });

  it('translates a refusal to an HTTP status in one place', () => {
    const translators = sourceFiles(root).filter((file) => /REFUSAL_STATUS|HTTPException/.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(root, file));
    expect(translators).toEqual(['http.ts']);
  });

  it('names the layer of a file, so an import upwards is seen (the check itself works)', () => {
    expect(layerOf('engine/runner.ts')! < layerOf('domain/line-save.ts')!).toBe(true);
    expect(layerOf('services/tool-run.ts')! < layerOf('engine/runner.ts')!).toBe(true);
    expect(layerOf('domain/line-save.ts')! < layerOf('db/schema.ts')!).toBe(true);
    expect(layerOf('db/index.ts')).toBe(layerOf('events.ts'));
    expect(layerOf('elsewhere.ts')).toBeUndefined();
  });

  it('finds a cycle when there is one (the check itself works)', () => {
    const a = path.join(root, 'a.ts');
    const b = path.join(root, 'b.ts');
    expect(cycles(new Map([[a, [b]], [b, [a]]]))).toEqual([['a.ts', 'b.ts']]);
  });
});
