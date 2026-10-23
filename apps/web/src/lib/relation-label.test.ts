import { describe, expect, it } from 'vitest';
import { relationLabel, relationRow } from './relation-label';

describe('relationship edge label', () => {
  it('names the kind and then each kind it changes to', () => {
    expect(relationLabel('협력자')).toBe('협력자');
    expect(relationLabel('협력자', [{ kind: '배신자' }, { kind: '적' }])).toBe('협력자 ▸ 배신자 ▸ 적');
  });
  it('gives every row its arrow, a one-direction line too', () => {
    expect(relationRow('forward', '부하')).toBe('→ 부하');
    expect(relationRow('back', '두목', [{ kind: '적' }])).toBe('← 두목 ▸ 적');
    expect(relationRow('both', '협력자')).toBe('↔ 협력자');
  });
});
