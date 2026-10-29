/**
 * A condition node's JSON Logic as rows people can read and edit: one clause per row, joined by
 * "all" or "any". Expressions these rows cannot say stay JSON (parseCondition returns null).
 */
import { nodeOutputFields, type ItemErrorKind, type JsonField, type WorkflowNode } from '@tw/shared';

export type FieldOperator = '>=' | '<=' | '==' | '!=' | 'filled';
/** `not` turns a line property around: 상태가 … 아님, 태그 … 없음, 청자 없음. */
export type Clause =
  | { kind: 'status'; statusId: string; not?: boolean }
  | { kind: 'lineKind'; value: string; not?: boolean }
  | { kind: 'tag'; tagId: string; not?: boolean }
  | { kind: 'mark'; mark: string; not?: boolean }
  | { kind: 'listener'; not?: boolean }
  /** Whether the line's speaker → listener pair has a confirmed speech rule (unit.speechLevel). */
  | { kind: 'speechRule'; not?: boolean }
  /** Whether an AI node's choice (말투 등급) is the rule's speech level. */
  | { kind: 'speechMatch'; nodeId: string; not?: boolean }
  | { kind: 'candidate'; not?: boolean }
  /** A term's status (terms input). */
  | { kind: 'termStatus'; status: string; not?: boolean }
  /** Whether a term has a Korean form (terms input). */
  | { kind: 'hasTarget'; not?: boolean }
  /** How many script lines use a term (terms input). */
  | { kind: 'uses'; op: '>=' | '<='; value: number }
  /** Why the line came out of an "error" exit (ConditionData.error.kind). */
  | { kind: 'error'; errorKind: ItemErrorKind; not?: boolean }
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
    return inner && inner.kind !== 'field' && inner.kind !== 'visits' && inner.kind !== 'uses' && !inner.not ? { ...inner, not: true } : null;
  }
  if (name === '!!') {
    const target = varOf(left);
    if (target === 'candidate') return { kind: 'candidate' };
    if (target === 'unit.listener') return { kind: 'listener' };
    if (target === 'unit.speechLevel') return { kind: 'speechRule' };
    if (target === 'term.hasTarget') return { kind: 'hasTarget' };
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
  const chosen = target.match(/^outputs\.([^.]+)\.value$/);
  if (name === '==' && chosen && varOf(right) === 'unit.speechLevel') return { kind: 'speechMatch', nodeId: chosen[1]! };
  if (name === '==' && target === 'unit.statusId' && typeof right === 'string') return { kind: 'status', statusId: right };
  if (name === '==' && target === 'unit.kind' && typeof right === 'string') return { kind: 'lineKind', value: right };
  if (name === '==' && target === 'error.kind' && typeof right === 'string') return { kind: 'error', errorKind: right as ItemErrorKind };
  if (name === '==' && target === 'term.status' && typeof right === 'string') return { kind: 'termStatus', status: right };
  if ((name === '>=' || name === '<=') && target === 'term.lines' && typeof right === 'number') return { kind: 'uses', op: name, value: right };
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
    case 'error':
      return { '==': [{ var: 'error.kind' }, clause.errorKind] };
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
    case 'speechRule':
      return { '!!': [{ var: 'unit.speechLevel' }] };
    case 'speechMatch':
      return { '==': [{ var: `outputs.${clause.nodeId}.value` }, { var: 'unit.speechLevel' }] };
    case 'candidate':
      return { '!!': [{ var: 'candidate' }] };
    case 'termStatus':
      return { '==': [{ var: 'term.status' }, clause.status] };
    case 'hasTarget':
      return { '!!': [{ var: 'term.hasTarget' }] };
    case 'uses':
      return { [clause.op]: [{ var: 'term.lines' }, clause.value] };
  }
}

/** The JSON Logic of rows: null with none (the workflow check asks for one), the rule itself with one. */
export function conditionExpression({ join, clauses }: Condition): unknown {
  if (!clauses.length) return null;
  if (clauses.length === 1) return clauseRule(clauses[0]!);
  return { [join]: clauses.map(clauseRule) };
}

/** Node outputs a field row can compare: the top-level text, number and true/false fields the node declares (nodeOutputFields). Lists and evidence go through JSON. */
export function comparableFields(node: WorkflowNode): JsonField[] {
  return (nodeOutputFields(node) ?? []).filter((item) => item.name && (item.type === 'string' || item.type === 'number' || item.type === 'boolean'));
}
