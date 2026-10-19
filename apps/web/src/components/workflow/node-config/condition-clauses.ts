/**
 * A condition node's JSON Logic as rows people can read and edit: one clause per row, joined by
 * "all" or "any". Expressions these rows cannot say stay JSON (parseCondition returns null).
 */
import type { JsonField, WorkflowNode } from '@tw/shared';

export type FieldOperator = '>=' | '<=' | '==' | '!=' | 'filled';
/** `not` turns a line property around: 상태가 … 아님, 태그 … 없음, 청자 없음. */
export type Clause =
  | { kind: 'status'; statusId: string; not?: boolean }
  | { kind: 'lineKind'; value: string; not?: boolean }
  | { kind: 'tag'; tagId: string; not?: boolean }
  | { kind: 'mark'; mark: string; not?: boolean }
  | { kind: 'listener'; not?: boolean }
  | { kind: 'candidate'; not?: boolean }
  | { kind: 'visits'; nodeId: string; limit: number }
  | { kind: 'field'; nodeId: string; field: string; op: FieldOperator; value: string | number | boolean };
export type Join = 'and' | 'or';
export type Condition = { join: Join; clauses: Clause[] };

type Rule = Record<string, unknown>;
const isRule = (value: unknown): value is Rule => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1;
const op = (rule: Rule) => Object.keys(rule)[0]!;
/** A {"var": "path"} reference's path. */
const varOf = (value: unknown): string | null => (isRule(value) && op(value) === 'var' && typeof value.var === 'string' ? value.var : null);
const args = (rule: Rule): unknown[] => {
  const value = rule[op(rule)];
  return Array.isArray(value) ? value : [value];
};
const COMPARE = new Set(['>=', '<=', '==', '!=']);

function parseClause(rule: unknown): Clause | null {
  if (!isRule(rule)) return null;
  const name = op(rule);
  const [left, right] = args(rule);
  if (name === '!') {
    // Only a line property can be turned around ({"!": …}); results and visits have their own operators.
    const inner = parseClause(left);
    return inner && inner.kind !== 'field' && inner.kind !== 'visits' && !inner.not ? { ...inner, not: true } : null;
  }
  if (name === '!!') {
    const target = varOf(left);
    if (target === 'candidate') return { kind: 'candidate' };
    if (target === 'unit.listener') return { kind: 'listener' };
    const output = target?.match(/^outputs\.([^.]+)\.(.+)$/);
    return output ? { kind: 'field', nodeId: output[1]!, field: output[2]!, op: 'filled', value: '' } : null;
  }
  if (name === 'in') {
    const list = varOf(right);
    if (typeof left !== 'string') return null;
    if (list === 'unit.tagIds') return { kind: 'tag', tagId: left };
    if (list === 'unit.marks') return { kind: 'mark', mark: left };
    return null;
  }
  const target = varOf(left);
  if (!target) return null;
  if (name === '<') {
    const visits = target.match(/^visits\.(.+)$/);
    return visits && typeof right === 'number' ? { kind: 'visits', nodeId: visits[1]!, limit: right } : null;
  }
  if (!COMPARE.has(name)) return null;
  if (name === '==' && target === 'unit.statusId' && typeof right === 'string') return { kind: 'status', statusId: right };
  if (name === '==' && target === 'unit.kind' && typeof right === 'string') return { kind: 'lineKind', value: right };
  const output = target.match(/^outputs\.([^.]+)\.(.+)$/);
  if (output && (typeof right === 'string' || typeof right === 'number' || typeof right === 'boolean')) {
    return { kind: 'field', nodeId: output[1]!, field: output[2]!, op: name as FieldOperator, value: right };
  }
  return null;
}

/** The rows of an expression, or null when it says something rows cannot (then it stays JSON). */
export function parseCondition(expression: unknown): Condition | null {
  if (expression === null || expression === undefined) return { join: 'and', clauses: [] };
  if (isRule(expression) && (op(expression) === 'and' || op(expression) === 'or') && Array.isArray(expression[op(expression)])) {
    const clauses = (expression[op(expression)] as unknown[]).map(parseClause);
    return clauses.every(Boolean) ? { join: op(expression) as Join, clauses: clauses as Clause[] } : null;
  }
  const clause = parseClause(expression);
  return clause ? { join: 'and', clauses: [clause] } : null;
}

function clauseRule(clause: Clause): unknown {
  const rule = baseRule(clause);
  return 'not' in clause && clause.not ? { '!': [rule] } : rule;
}

function baseRule(clause: Clause): unknown {
  switch (clause.kind) {
    case 'status':
      return { '==': [{ var: 'unit.statusId' }, clause.statusId] };
    case 'lineKind':
      return { '==': [{ var: 'unit.kind' }, clause.value] };
    case 'tag':
      return { in: [clause.tagId, { var: 'unit.tagIds' }] };
    case 'mark':
      return { in: [clause.mark, { var: 'unit.marks' }] };
    case 'visits':
      return { '<': [{ var: `visits.${clause.nodeId}` }, clause.limit] };
    case 'field': {
      const reference = { var: `outputs.${clause.nodeId}.${clause.field}` };
      return clause.op === 'filled' ? { '!!': [reference] } : { [clause.op]: [reference, clause.value] };
    }
    case 'listener':
      return { '!!': [{ var: 'unit.listener' }] };
    case 'candidate':
      return { '!!': [{ var: 'candidate' }] };
  }
}

/** The JSON Logic of rows: null with none (the workflow check asks for one), the rule itself with one. */
export function conditionExpression({ join, clauses }: Condition): unknown {
  if (!clauses.length) return null;
  if (clauses.length === 1) return clauseRule(clauses[0]!);
  return { [join]: clauses.map(clauseRule) };
}

/** Node outputs a field row can compare: a verdict's `passed`, a choice's value and confidence, a text, declared JSON or script fields. */
export function comparableFields(node: WorkflowNode, hasVerdict: boolean): JsonField[] {
  const field = (name: string, type: JsonField['type']): JsonField => ({ name, type, description: '' });
  const fields: JsonField[] = [];
  if (hasVerdict) fields.push(field('passed', 'boolean'));
  if (node.type === 'ai' && node.config.output === 'choice') fields.push(field('value', 'string'), field('confidence', 'number'));
  if (node.type === 'ai' && node.config.output === 'text') fields.push(field('text', 'string'));
  const declared = node.type === 'ai' && node.config.output === 'json' ? node.config.fields : node.type === 'function' && node.config.fn === 'script' ? ((node.config.params as { fields?: JsonField[] }).fields ?? []) : [];
  // Only top-level scalars compare in a row; lists and evidence go through JSON.
  fields.push(...declared.filter((item) => item.name && (item.type === 'string' || item.type === 'number' || item.type === 'boolean')));
  return fields;
}
