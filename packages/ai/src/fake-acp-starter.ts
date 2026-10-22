import { EventEmitter } from 'node:events';
import type * as acp from '@agentclientprotocol/sdk';
import { AcpAgent, type AcpKind } from './acp.ts';
import { fakeAgent } from './fake-acp.ts';

/** Starts fake agents in this process (two message pipes instead of stdio), for setAgentStarter in tests. */
export function inProcessStarter(env: Record<string, string | undefined> = {}) {
  return async (kind: AcpKind, _executable?: string) => {
    const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    fakeAgent({ writable: toClient.writable, readable: toAgent.readable }, env);
    const child = Object.assign(new EventEmitter(), { stderr: null, kill: () => child.emit('exit', 0) });
    return AcpAgent.over(kind, child as never, { writable: toAgent.writable, readable: toClient.readable }, undefined);
  };
}
