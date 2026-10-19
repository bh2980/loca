import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import { agentTools } from './agent-tools.ts';
import { importProject } from './importer.ts';
import { TOOL_RESULT_CHARS } from './tool-output.ts';

describe('harness_reference', () => {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }] }));
  const reference = (input: Record<string, unknown>) => (agentTools(db, projectId).harness_reference as unknown as { execute: (input: unknown, options: unknown) => Record<string, unknown> }).execute(input, {});

  it('fits one tool result whole, so the condition model, rules and connections are not cut off', () => {
    const whole = reference({});
    expect(JSON.stringify(whole).length).toBeLessThan(TOOL_RESULT_CHARS);
    expect(Object.keys(whole)).toEqual(expect.arrayContaining(['conditionData', 'rules', 'connections', 'statuses', 'tags']));
  });

  it('gives one preset in full on request', () => {
    expect(reference({ preset: 'listener' })).toMatchObject({ preset: 'listener', output: 'json', instructions: expect.any(String) });
  });
});
