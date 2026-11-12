import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CAPABILITIES, CLI_KINDS, CONNECTION_KIND_INFO, CONNECTION_KINDS, type Capability } from '@tw/shared';
import { ask, chatModel, complete, generate, ModelError, PROVIDERS, type Provider } from './index.ts';

/** The member of a provider that does each capability. `tool` is an API key for the HTTP function: no model call, so no member. */
const DOES: Record<Capability, (provider: Provider) => boolean> = {
  generate: (provider) => Boolean(provider.generate),
  judge: (provider) => Boolean(provider.ask),
  chat: (provider) => Boolean(provider.chat),
  complete: (provider) => Boolean(provider.complete),
  tool: (provider) => !provider.generate && !provider.ask && !provider.chat && !provider.complete,
};

describe('providers', () => {
  it('has one provider per connection kind, and no others', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...CONNECTION_KINDS].sort());
  });

  it.each(CONNECTION_KINDS)('%s can do exactly what CONNECTION_KIND_INFO says it can', (kind) => {
    const said = CONNECTION_KIND_INFO[kind].capabilities;
    expect(CAPABILITIES.filter((capability) => DOES[capability](PROVIDERS[kind])).sort()).toEqual([...said].sort());
  });

  it.each(CONNECTION_KINDS)('%s is an agent CLI exactly when its transport is cli', (kind) => {
    const isCli = (CLI_KINDS as readonly string[]).includes(kind);
    expect(CONNECTION_KIND_INFO[kind].transport === 'cli').toBe(isCli);
    expect(Boolean(PROVIDERS[kind].cli)).toBe(isCli);
    expect(PROVIDERS[kind].chat?.via === 'agent').toBe(isCli);
  });

  it('refuses a call the kind cannot do with a config error, before anything is sent', () => {
    const request = { system: '', prompt: '', schema: z.object({}), timeoutMs: 1 };
    const refused = (call: () => unknown) => {
      try {
        call();
      } catch (error) {
        return error instanceof ModelError ? error.code : String(error);
      }
      return 'sent';
    };
    expect(refused(() => generate({ kind: 'systemone', model: 'm' }, request))).toBe('config');
    expect(refused(() => generate({ kind: 'http', model: 'm' }, request))).toBe('config');
    expect(refused(() => complete({ kind: 'claude', model: 'm' }, request))).toBe('config');
    expect(refused(() => ask({ kind: 'openai', model: 'm' }, { state: {}, questions: {}, timeoutMs: 1 }))).toBe('config');
    // An agent CLI chats, but through its own agent: it has no AI SDK model.
    expect(refused(() => chatModel({ kind: 'codex', model: 'm' }))).toBe('config');
    expect(refused(() => chatModel({ kind: 'systemone', model: 'm' }))).toBe('config');
  });
});
