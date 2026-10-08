import { Entry } from '@napi-rs/keyring';

/**
 * API keys live in the OS credential store (Windows Credential Manager, macOS Keychain),
 * never in the database, logs or exports. Tests use an in-memory store.
 */
export interface SecretStore {
  get(connectionId: string): string | null;
  set(connectionId: string, secret: string): void;
  delete(connectionId: string): void;
}

const SERVICE = 'translation-workbench';

export const keyringStore: SecretStore = {
  get: (id) => new Entry(SERVICE, id).getPassword(),
  set: (id, secret) => new Entry(SERVICE, id).setPassword(secret),
  delete: (id) => void new Entry(SERVICE, id).deletePassword(),
};

export function memoryStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: (id) => values.get(id) ?? null,
    set: (id, secret) => void values.set(id, secret),
    delete: (id) => void values.delete(id),
  };
}
