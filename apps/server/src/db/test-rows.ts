import { getTableName } from 'drizzle-orm';
import type { Topic } from '@loca/shared';
import type { Db } from './index.ts';
import * as s from './schema.ts';
import type { TableName } from './topics.ts';

/**
 * For tests that go over the whole schema: one row of every table (two where a row needs a pair), each written with
 * nothing but an INSERT, parents before the rows that hang from them; with the scope and topics its change belongs to.
 */
export function rows(db: Db): { table: TableName; scope: string; topics: Topic[]; insert: () => void }[] {
  const p = 'p1';
  const at = new Date(0);
  const definition = { nodes: [], edges: [] } as never;
  const put = <T extends Parameters<Db['insert']>[0]>(table: T, scope: string, topics: Topic[], values: T['$inferInsert']) => ({ table: getTableName(table) as TableName, scope, topics, insert: () => void db.insert(table).values(values as never).run() });
  return [
    put(s.projects, p, ['projects'], { id: p, name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }),
    put(s.statuses, p, ['statuses'], { id: 'st', projectId: p, name: 'S', color: 'gray', kind: 'initial', sort: 0 }),
    put(s.tags, p, ['statuses'], { id: 'tag', projectId: p, name: 'T', color: 'gray' }),
    put(s.groups, p, ['units'], { id: 'g', projectId: p, key: 'g', kind: 'scene', title: 'G', sort: 0 }),
    put(s.units, p, ['units'], { id: 'u', projectId: p, groupId: 'g', key: 'u', sort: 0, kind: 'dialogue', source: 'Hi', statusId: 'st' }),
    put(s.unitTags, p, ['units'], { unitId: 'u', tagId: 'tag' }),
    put(s.lineEvents, p, ['units'], { unitId: 'u', kind: 'note', at }),
    put(s.eventActor, p, [], { one: 1, runId: null }),
    put(s.candidates, p, ['units'], { id: 'c', unitId: 'u', text: '안녕', origin: 'human' }),
    put(s.graphNodes, p, ['graph'], { id: 'n1', projectId: p, key: 'n1', kind: 'line', unitIds: ['u'] }),
    put(s.graphNodes, p, ['graph'], { id: 'n2', projectId: p, key: 'n2', kind: 'line', unitIds: [] }),
    put(s.graphEdges, p, ['graph'], { id: 'e', projectId: p, fromId: 'n1', toId: 'n2' }),
    put(s.graphLayouts, p, ['graph'], { projectId: p, scope: 'dialogue', status: 'pending' }),
    put(s.graphViews, p, ['graph'], { id: 'v', projectId: p, label: 'V', nodeIds: ['n1'] }),
    put(s.aiCalls, p, ['calls'], { id: 'call', projectId: p, kind: 'run', label: 'L', startedAt: at }),
    put(s.aiCalls, p, ['calls', 'chat'], { id: 'chat-call', projectId: p, kind: 'chat', label: 'L', startedAt: at }),
    put(s.aiCalls, 'app', ['calls'], { id: 'test-call', projectId: null, kind: 'test', label: 'L', startedAt: at }),
    put(s.terms, p, ['terms'], { id: 'term', projectId: p, source: 'Gate' }),
    put(s.documents, p, ['knowledge'], { id: 'doc', projectId: p, kind: 'world', title: 'D' }),
    put(s.characters, p, ['knowledge'], { id: 'ch1', projectId: p, name: 'A' }),
    put(s.characters, p, ['knowledge'], { id: 'ch2', projectId: p, name: 'B' }),
    put(s.relationships, p, ['knowledge'], { id: 'rel', projectId: p, fromId: 'ch1', toId: 'ch2', kind: 'friend' }),
    put(s.storyEvents, p, ['knowledge'], { id: 'ev1', projectId: p, title: 'E1' }),
    put(s.storyEvents, p, ['knowledge'], { id: 'ev2', projectId: p, title: 'E2' }),
    put(s.eventLinks, p, ['knowledge'], { id: 'link', projectId: p, fromId: 'ev1', toId: 'ev2', kind: s.eventLinks.kind.enumValues[0] }),
    put(s.speechRules, p, ['knowledge'], { id: 'rule', projectId: p, fromName: 'A', toName: 'B', level: s.speechRules.level.enumValues[0] }),
    put(s.knowledgeTags, p, ['terms'], { kind: 'terms', itemId: 'term', tagId: 'tag' }),
    put(s.knowledgeTags, p, ['knowledge'], { kind: 'characters', itemId: 'ch1', tagId: 'tag' }),
    put(s.knowledgeTags, p, ['knowledge'], { kind: 'events', itemId: 'ev1', tagId: 'tag' }),
    put(s.connections, 'app', ['connections'], { id: 'home', kind: 'openai', name: 'home' }),
    put(s.connections, p, ['connections'], { id: 'own', projectId: p, kind: 'openai', name: 'own' }),
    put(s.connectionKeyCopies, p, ['connections'], { targetId: 'own', sourceId: 'home' }),
    put(s.connectionKeyCopies, 'app', ['connections'], { targetId: 'home', sourceId: 'own' }),
    put(s.workflows, p, ['workflows'], { id: 'w', projectId: p, name: 'W', definition }),
    put(s.runs, p, ['runs'], { id: 'run', projectId: p, workflowName: 'W', workflowVersion: 1, definition, scope: {} as never, status: 'completed', total: 1 }),
    put(s.runItems, p, ['runs'], { id: 'item', runId: 'run', subjectId: 'u', nodeId: 'n', state: 'done', visits: {}, data: {} as never }),
    put(s.runSteps, p, ['runs'], { id: 'step', runId: 'run', nodeId: 'n', subjectIds: ['u'], ok: true, startedAt: at, finishedAt: at }),
    put(s.proposals, p, ['proposals'], { id: 'prop', projectId: p, source: 'cli', tool: 't', input: {} }),
    put(s.undoRecords, p, [], { id: 'undo', projectId: p, kind: 'script', data: { removed: [], rewritten: [], made: [] } }),
    put(s.chatSessions, p, ['chat'], { id: 'chat', projectId: p, title: 'C' }),
    put(s.appSettings, 'app', ['app'], { id: 'app' }),
  ];
}
