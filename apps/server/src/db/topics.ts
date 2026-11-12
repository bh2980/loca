import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { APP_FEED, type Topic } from '@tw/shared';
import * as schema from './schema.ts';

/**
 * Which topic a change to each table belongs to. The database says it: from this table come the triggers that
 * call topic_changed(topic, project) on every insert, update and delete (topicTriggerSql; the migration that
 * holds them is checked against it in topics.test.ts), so no write path names its topics and none can forget.
 * What else reads a table (a question keyed under another topic) is IMPLIES in @tw/shared, not here.
 * A new table is a compile error until it is listed; a changed line needs a migration that makes its triggers again.
 */

type Schema = typeof schema;
/** The schema's tables by their SQL names. */
export type TableName = { [K in keyof Schema]: Schema[K] extends { _: { name: infer N extends string } } ? N : never }[keyof Schema];

/** A topic said only for some rows: `when` is SQL over the row (ROW = NEW or OLD). */
interface TopicRule {
  topic: Topic;
  when: string;
}

export type TableTopics =
  /** No topic, and why. */
  | { none: string }
  | {
      topics: readonly (Topic | TopicRule)[];
      /**
       * SQL over the row (ROW = NEW or OLD) for the project it belongs to: a project id, APP_FEED for the app's own
       * rows, or NULL when the row it hangs from is already gone (that row's own delete said the topic).
       * Left out: the row's own project_id.
       */
      project?: string;
    };

/** The project of the row this one hangs from. */
const through = (parent: TableName, column: string) => `(SELECT \`project_id\` FROM \`${parent}\` WHERE \`id\` = ROW.\`${column}\`)`;
/** A row with no project is the app's own (a connection of the home, a model test's call). */
const OR_APP = `coalesce(ROW.\`project_id\`, '${APP_FEED}')`;

/** A tagged knowledge item's table, by the tag row's kind. */
const TAGGED: Record<(typeof schema.knowledgeTags.kind.enumValues)[number], TableName> = {
  terms: 'terms',
  documents: 'documents',
  characters: 'characters',
  relationships: 'relationships',
  events: 'story_events',
  speechRules: 'speech_rules',
};

export const TABLE_TOPICS: Record<TableName, TableTopics> = {
  projects: { topics: ['projects'], project: 'ROW.`id`' },
  statuses: { topics: ['statuses'] },
  tags: { topics: ['statuses'] },
  groups: { topics: ['units'] },
  units: { topics: ['units'] },
  unit_tags: { topics: ['units'], project: through('units', 'unit_id') },
  line_events: { topics: ['units'], project: through('units', 'unit_id') },
  event_actor: { none: 'One scratch row the line_events triggers read (the run writing now); no query reads it.' },
  knowledge_tags: {
    topics: [
      { topic: 'terms', when: "ROW.`kind` = 'terms'" },
      { topic: 'knowledge', when: "ROW.`kind` <> 'terms'" },
    ],
    // Through its item, not its tag: when a tag is deleted its rows go after it, and the items they were on are still there.
    project: `(CASE ROW.\`kind\` ${Object.entries(TAGGED).map(([kind, table]) => `WHEN '${kind}' THEN ${through(table, 'item_id')}`).join(' ')} END)`,
  },
  candidates: { topics: ['units'], project: through('units', 'unit_id') },
  graph_nodes: { topics: ['graph'] },
  graph_edges: { topics: ['graph'] },
  graph_layouts: { topics: ['graph'] },
  graph_views: { topics: ['graph'] },
  // A chat's own calls are part of what its panel shows (the turn's current step, its usage).
  ai_calls: { topics: ['calls', { topic: 'chat', when: "ROW.`kind` = 'chat'" }], project: OR_APP },
  terms: { topics: ['terms'] },
  documents: { topics: ['knowledge'] },
  characters: { topics: ['knowledge'] },
  relationships: { topics: ['knowledge'] },
  story_events: { topics: ['knowledge'] },
  event_links: { topics: ['knowledge'] },
  speech_rules: { topics: ['knowledge'] },
  connections: { topics: ['connections'], project: OR_APP },
  connection_key_copies: { topics: ['connections'], project: `(SELECT coalesce(\`project_id\`, '${APP_FEED}') FROM \`connections\` WHERE \`id\` = ROW.\`target_id\`)` },
  workflows: { topics: ['workflows'] },
  runs: { topics: ['runs'] },
  run_items: { topics: ['runs'], project: through('runs', 'run_id') },
  run_steps: { topics: ['runs'], project: through('runs', 'run_id') },
  proposals: { topics: ['proposals'] },
  undo_records: { none: 'What a change removed, kept to put it back; no screen lists it (the change that made it answers with its id).' },
  chat_sessions: { topics: ['chat'] },
  app_settings: { topics: ['app'], project: `'${APP_FEED}'` },
};

/** The SQL names of every table in the schema. */
export const schemaTables = () => Object.values(schema).flatMap((value) => (is(value, SQLiteTable) ? [getTableName(value) as TableName] : []));

const OPS = [
  ['insert', 'INSERT', 'NEW'],
  ['update', 'UPDATE', 'NEW'],
  ['delete', 'DELETE', 'OLD'],
] as const;

export const topicTriggerName = (table: string, op: (typeof OPS)[number][0]) => `topic_${table}_${op}`;

/** The CREATE TRIGGER statements TABLE_TOPICS stands for, by trigger name. */
export function topicTriggerSql(): Map<string, string> {
  const statements = new Map<string, string>();
  for (const [table, entry] of Object.entries(TABLE_TOPICS)) {
    if ('none' in entry) continue;
    for (const [op, event, row] of OPS) {
      const project = (entry.project ?? 'ROW.`project_id`').replaceAll('ROW.', `${row}.`);
      const body = entry.topics.map((rule) => {
        const { topic, when } = typeof rule === 'string' ? { topic: rule, when: undefined } : rule;
        return `SELECT topic_changed('${topic}', ${project})${when ? ` WHERE ${when.replaceAll('ROW.', `${row}.`)}` : ''};`;
      });
      const name = topicTriggerName(table, op);
      statements.set(name, `CREATE TRIGGER \`${name}\` AFTER ${event} ON \`${table}\` BEGIN ${body.join(' ')} END`);
    }
  }
  return statements;
}
