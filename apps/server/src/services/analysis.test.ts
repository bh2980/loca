import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import { importProject } from './importer.ts';
import { scriptText } from './script-text.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Harbor', section: 'Ch 1' }],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." },
      { key: 'a2', group: 'g1', speaker: 'Bob', source: 'Sorry, boss.' },
      { key: 'a3', group: 'g1', speaker: 'Alice', source: 'Never again.' },
    ],
    graph: { nodes: [{ key: 'n1', units: ['a1'] }, { key: 'n2', units: ['a2', 'a3'] }], edges: [{ from: 'n1', to: 'n2', label: 'Apologize' }] },
  });
  const { projectId } = importProject(db, file);
  return { db, projectId };
}

describe('work analysis', () => {
  it('renders the script with short ids and choice labels', () => {
    const { db, projectId } = setup();
    const { blocks, keyOf } = scriptText(db, projectId);
    expect(blocks[0].text).toBe("## Ch 1 — Harbor [g1]\n  L1 Alice: You're late.\n  ▶ Apologize\n  L2 Bob: Sorry, boss.\n  L3 Alice: Never again.");
    expect(keyOf.get('L3')).toBe('a3');
  });
});
