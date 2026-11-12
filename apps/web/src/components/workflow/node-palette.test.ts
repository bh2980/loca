import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL_CHOICE, translationTemplate, workflowNodeSchema, type WorkflowDefinition } from '@loca/shared';
import { EXIT_ACTION_ITEMS, exitActionItem, librarySeed, nodePalette } from './node-palette';

const template = translationTemplate({ model: EMPTY_MODEL_CHOICE, untranslated: 'u', translated: 't', needsReview: 'needs-review', confirmed: 'c', issueTags: { format: 'format-tag', term: 'term-tag', speech: 'speech-tag', meaning: 'meaning-tag', style: 'style-tag', other: 'other-tag', aiFailed: 'ai-failed' } });
const items = nodePalette(template).flatMap((group) => group.items);

describe('the node library', () => {
  it('lists AI presets and free form, 반영, exit actions, functions and flow nodes, in that order', () => {
    expect(nodePalette(template).map((group) => group.id)).toEqual(['ai', 'apply', 'exit', 'function', 'flow']);
    expect(items.map((item) => item.id)).toContain('ai');
    expect(nodePalette(template).find((group) => group.id === 'exit')!.items.map((item) => item.id)).toEqual(EXIT_ACTION_ITEMS.map((item) => item.id));
  });

  it('every entry that is not an exit action starts as a node the schema takes', () => {
    for (const item of items) {
      const seed = librarySeed(item.id, template);
      if (exitActionItem(item.id)) {
        expect(seed).toBeNull();
        continue;
      }
      expect(seed, item.id).not.toBeNull();
      expect(workflowNodeSchema.safeParse({ id: 'new', position: { x: 0, y: 0 }, config: {}, ...seed }).success, item.id).toBe(true);
    }
  });

  it('a new AI node starts with the model the workflow already uses, else none', () => {
    const model = { connectionId: 'c1', model: 'grok-4.7' };
    const used: WorkflowDefinition = { ...template, nodes: template.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, model } } : node)) };
    expect((librarySeed('ai', used)!.config as { model: unknown }).model).toEqual(model);
    const none: WorkflowDefinition = { ...template, nodes: template.nodes.filter((node) => node.type !== 'ai') };
    expect((librarySeed('ai', none)!.config as { model: unknown }).model).toEqual({ connectionId: '', model: '' });
  });

  it('an unknown entry is no node', () => {
    expect(librarySeed('no-such-entry', template)).toBeNull();
  });

  it('each exit action starts empty, to be filled in its pane', () => {
    expect(exitActionItem('exit:status')!.make()).toEqual({ type: 'status', statusId: '' });
    expect(exitActionItem('exit:tag-add')!.make()).toMatchObject({ type: 'tag', action: 'add', tagIds: [] });
  });
});
