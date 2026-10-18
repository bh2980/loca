import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { changedFields, nextEdit, resolveForm } from '../../lib/use-form-from';

// This is a callback-wiring regression: both actions are valid form methods, but only reset
// discards every edit. Check the real pane without adding a browser renderer to node-only tests.
const source = ts.createSourceFile('term-pane.tsx', readFileSync(new URL('./term-pane.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function callback(component: string, prop: string): string | undefined {
  let result: string | undefined;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === component) {
      const attribute = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === prop);
      if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) result = attribute.initializer.expression?.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

const saved = { source: 'Guild', target: '길드', note: '원래 메모' };

describe('glossary term revert', () => {
  it('discards the whole form draft, rather than taking only conflicted fields', () => {
    expect(callback('DirtyBar', 'onRevert')).toBe('reset');
    const edit = nextEdit(saved, null, { source: 'Guild Hall', target: '길드 회관', note: '수정한 메모' });
    expect(resolveForm(saved, edit).conflicts).toEqual([]);
    expect(Object.keys(changedFields(resolveForm(saved, edit).draft, saved))).toHaveLength(3);
    expect(resolveForm(saved, null)).toEqual({ draft: saved, mine: [], conflicts: [] });
  });

  it('returns to the latest saved values, including changes received while editing', () => {
    const edit = nextEdit(saved, null, { ...saved, target: '내 번역', note: '내 메모' });
    const latest = { ...saved, source: 'The Guild', target: '다른 번역' };
    expect(resolveForm(latest, edit).conflicts).toEqual(['target']);
    expect(resolveForm(latest, null)).toEqual({ draft: latest, mine: [], conflicts: [] });
  });

  it('keeps the conflict notice actions field-scoped', () => {
    expect(callback('ChangedElsewhere', 'onTakeSaved')).toBe('takeSaved');
    expect(callback('ChangedElsewhere', 'onKeepMine')).toBe('keepMine');
  });
});
