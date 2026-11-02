import { Entry } from '@napi-rs/keyring';

/**
 * API keys live in the OS credential store (Windows Credential Manager, macOS Keychain, the Secret Service on Linux:
 * GNOME Keyring, KWallet, KeePassXC), never in the database, logs or exports. Tests use an in-memory store.
 */
export interface SecretStore {
  get(connectionId: string): string | null;
  set(connectionId: string, secret: string): void;
  delete(connectionId: string): void;
}

const SERVICE = 'translation-workbench';

/**
 * A credential store that cannot be reached says why and what to do (on Linux: no Secret Service, or a locked one, is
 * the usual cause; a headless server has none). The store's own message stays at the end.
 */
export function storeFailure(error: unknown, action: '저장' | '읽기' | '삭제', platform: NodeJS.Platform = process.platform): Error {
  const reason = error instanceof Error ? error.message : String(error);
  const help = platform === 'linux'
    ? '이 시스템에 키 저장소(Secret Service)가 없거나 잠겨 있습니다. GNOME Keyring·KWallet·KeePassXC 같은 Secret Service를 켜고 잠금을 푼 뒤 다시 하세요. 키 저장소가 없는 서버라면 README의 "Linux에서" 항목을 보세요.'
    : platform === 'darwin'
      ? '키체인에 접근하지 못했습니다. 키체인 접근 허용 창이 떴다면 허용한 뒤 다시 하세요.'
      : 'Windows 자격 증명 관리자에 접근하지 못했습니다.';
  return new Error(`API 키 ${action}에 실패했습니다. ${help} (${reason})`);
}

const guarded = <T>(action: '저장' | '읽기' | '삭제', run: () => T): T => {
  try {
    return run();
  } catch (error) {
    throw storeFailure(error, action);
  }
};

export const keyringStore: SecretStore = {
  get: (id) => guarded('읽기', () => new Entry(SERVICE, id).getPassword()),
  set: (id, secret) => guarded('저장', () => new Entry(SERVICE, id).setPassword(secret)),
  delete: (id) => guarded('삭제', () => void new Entry(SERVICE, id).deletePassword()),
};

export function memoryStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: (id) => values.get(id) ?? null,
    set: (id, secret) => void values.set(id, secret),
    delete: (id) => void values.delete(id),
  };
}
