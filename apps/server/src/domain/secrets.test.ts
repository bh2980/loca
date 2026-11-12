import { describe, expect, it } from 'vitest';
import { storeFailure } from './secrets';

describe('storeFailure', () => {
  it('tells a Linux user the Secret Service is missing or locked, and where to look', () => {
    const error = storeFailure(new Error('Platform secure storage failure: no secret service'), '저장', 'linux');
    expect(error.message).toContain('API 키 저장에 실패했습니다');
    expect(error.message).toContain('Secret Service');
    expect(error.message).toContain('README');
    expect(error.message).toContain('no secret service');
  });
  it('speaks of the keychain on macOS and the credential manager on Windows', () => {
    expect(storeFailure(new Error('x'), '읽기', 'darwin').message).toContain('키체인');
    expect(storeFailure('x', '삭제', 'win32').message).toContain('자격 증명 관리자');
  });
});
