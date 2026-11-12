import { describe, expect, it } from 'vitest';
import { staticStyles } from './ui-style';

const found = (jsx: string) => staticStyles(`const a = ${jsx};`).map((problem) => problem.properties);

describe('the style= rule', () => {
  it('refuses a value that is written out, alone or beside computed ones', () => {
    expect(found(`<Box style={{ zIndex: 1000 }} />`)).toEqual([['zIndex']]);
    expect(found(`<div style={{ width, pointerEvents: 'all', top: -4 }} />`)).toEqual([['pointerEvents', 'top']]);
    expect(found('<div style={{ animation: `spin 1s` }} />')).toEqual([['animation']]);
    expect(found(`<Row style={arrived ? { animation: 'line-arrived 2s ease-out' } : undefined} />`)).toEqual([['animation']]);
    expect(found(`<span style={{ background, ...(vertical ? { width: 1.75, height } : { height: 1.75, width }) }} />`)).toEqual([['width', 'height']]);
    expect(found(`<div style={{ '--gap': '4px' } as React.CSSProperties} />`)).toEqual([["'--gap'"]]);
  });

  it('a choice between written-out values is a variant, so it is refused too', () => {
    expect(found(`<div style={{ opacity: dim ? 0.2 : 1 }} />`)).toEqual([['opacity']]);
    expect(found(`<div style={{ zIndex: dragging ? 1 : undefined }} />`)).toEqual([['zIndex']]);
  });

  it('takes identifiers, calls and templates with a hole as computed', () => {
    expect(found(`<div style={{ width, height: size.height, left: x + 16 }} />`)).toEqual([]);
    expect(found('<div style={{ transform: `translateY(${start}px)` }} />')).toEqual([]);
    expect(found(`<span style={personStyle(color)} />`)).toEqual([]);
    expect(found(`<div style={CARD} />`)).toEqual([]);
    expect(found(`<div style={{ background: color ? paletteColor(color) : 'var(--background-color-node-state)' }} />`)).toEqual([]);
    expect(found(`<div style={vertical ? { left: \`\${at * 100}%\` } : { top: \`\${at * 100}%\` }} />`)).toEqual([]);
  });

  it('leaves the elements that take a value only as a style', () => {
    expect(found(`<BaseEdge style={{ ...style, strokeLinejoin: 'round' }} />`)).toEqual([]);
    expect(found(`<NodeToolbar style={{ zIndex: 1000 }} />`)).toEqual([]);
  });

  it('says where', () => {
    expect(staticStyles(`const a = (\n  <div>\n    <i style={{ top: 0 }} />\n  </div>\n);`)).toEqual([{ line: 3, element: 'i', properties: ['top'] }]);
  });
});
