import { describe, expect, it } from 'vitest';
import { endpointLabel } from './endpoint-label';

const node = {
  key: 'ch1.n42',
  label: '대사',
  units: [
    { source: '어디로\n  가는 거야?', speaker: ' 미라 ' },
    { source: '등대로.', speaker: null },
  ],
};

describe('a reading route end in the endpoint bar', () => {
  it('a start reads as the node\'s first line, an end as its last', () => {
    expect(endpointLabel(node, 'start')).toBe('미라: 어디로 가는 거야? · ch1.n42 · 2줄');
    expect(endpointLabel(node, 'end')).toBe('등대로. · ch1.n42 · 2줄');
  });

  it('a node of one line does not count its lines', () => {
    expect(endpointLabel({ ...node, units: [node.units[1]!] }, 'start')).toBe('등대로. · ch1.n42');
  });

  it('a node without lines is its label, or its key', () => {
    expect(endpointLabel({ key: 'ch1.if3', label: '조건', units: [] }, 'start')).toBe('조건');
    expect(endpointLabel({ key: 'ch1.if3', label: null, units: [] }, 'end')).toBe('ch1.if3');
  });
});
