import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AIProfile } from '@workbench/contracts';
import { exportAIProfile, importAIProfile, profileConnectionsResolved, savedProfileDraft } from '../apps/web/src/ai-profile-transfer.ts';

const profile: AIProfile = { id: 'original', name: '문맥 검토', version: 4, createdAt: 'old', updatedAt: 'new', connectionId: 'primary', model: 'model-a', effort: 'high', timeoutMs: 120000, maxOutputTokens: 6000, maxAttempts: 1, prompt: '지시문\n상세', promptVersion: 2, contextPolicy: { terms: true, knowledge: false, previous: true }, legacyStage: 'review', outputFormat: 'json', toolPolicy: { web: false, allowedTools: ['read_script', 'list_terms'] }, fallbacks: [{ connectionId: 'secondary', model: 'model-b', effort: '', timeoutMs: 60000, maxOutputTokens: 4000, maxAttempts: 2 }] };
const connections = [{ id: 'primary' }, { id: 'secondary' }];
function alter(change: (row: Record<string, any>) => void) { const row = JSON.parse(exportAIProfile(profile)); change(row); return JSON.stringify(row); }

test('portable profile roundtrip preserves route order, task/output/context/tool policy without IDs or connection secrets', () => {
 const unsafe = { ...profile, credential: 'secret', apiKey: 'secret2', connections: [{ id: 'primary', baseUrl: 'private', envKey: 'PRIVATE_KEY' }], unitIds: ['foreign-unit'], history: ['old-run'] } as AIProfile;
 const json = exportAIProfile(unsafe), parsed = JSON.parse(json);
 assert.equal(parsed.version, 1); assert.equal(parsed.format, 'workbench.ai-profile');
 for (const word of ['secret', 'private', 'PRIVATE_KEY', 'original', 'foreign-unit', 'old-run', 'createdAt', 'updatedAt']) assert.equal(json.includes(word), false, word);
 const result = importAIProfile(json, connections); assert.deepEqual(result.profile, savedProfileDraft(profile)); assert.deepEqual(result.unresolved, []); assert.equal(profileConnectionsResolved(result.profile, connections), true);
});
test('missing primary/fallback connections remain unbound and require user mapping, never choose first available', () => {
 const result = importAIProfile(exportAIProfile(profile), [{ id: 'different' }]);
 assert.equal(result.profile.connectionId, ''); assert.equal(result.profile.fallbacks![0].connectionId, ''); assert.deepEqual(result.unresolved, ['기본 AI', '대체 AI 1']); assert.equal(profileConnectionsResolved(result.profile, [{ id: 'different' }]), false);
 result.profile.connectionId = 'different'; assert.equal(profileConnectionsResolved(result.profile, [{ id: 'different' }]), false);
 result.profile.fallbacks![0].connectionId = 'different'; assert.equal(profileConnectionsResolved(result.profile, [{ id: 'different' }]), true); assert.equal(result.profile.model, 'model-a');
});
test('saved profile clone has independent mutable policies and no task scope/run identity', () => {
 const value = savedProfileDraft(profile); value.name = '복사'; value.contextPolicy!.terms = false; value.fallbacks![0].model = 'changed'; value.toolPolicy!.allowedTools.push('project_overview');
 assert.equal(profile.name, '문맥 검토'); assert.equal(profile.contextPolicy!.terms, true); assert.equal(profile.fallbacks![0].model, 'model-b'); assert.deepEqual(profile.toolPolicy!.allowedTools, ['read_script', 'list_terms']); assert.equal('id' in value, false); assert.equal('version' in value, false);
});
test('unknown credential/prototype keys at every schema level and actual custom prototypes are refused', () => {
 for (const edit of [(row: any) => row.credential = 'secret', (row: any) => row.profile.apiKey = 'secret', (row: any) => row.profile.fallbacks[0].baseUrl = 'http://private', (row: any) => row.profile.contextPolicy.constructor = {}, (row: any) => row.profile.toolPolicy.envKey = 'KEY']) {
  assert.throws(() => importAIProfile(alter(edit), connections), /프로필 파일/);
 }
 const json = exportAIProfile(profile).replace('"name":', '"__proto__":{"polluted":true},"name":'); assert.throws(() => importAIProfile(json, connections), /허용하지 않는 필드/); assert.equal(({} as { polluted?: boolean }).polluted, undefined);
 assert.throws(() => savedProfileDraft({ ...profile, contextPolicy: Object.assign(Object.create({ unsafe: true }), { terms: true }) }), /JSON 객체/);
});
test('unsupported versions, excess size, malformed routes and unknown policies are refused before draft creation', () => {
 for (const edit of [(row: any) => row.version = 2, (row: any) => row.profile.maxAttempts = 4, (row: any) => row.profile.timeoutMs = -1, (row: any) => row.profile.model = 'bad\nmodel', (row: any) => row.profile.toolPolicy.allowedTools = ['execute_http'], (row: any) => row.profile.contextPolicy.terms = 'true', (row: any) => row.profile.legacyStage = 'unknown', (row: any) => row.profile.fallbacks = Array(4).fill(profile.fallbacks![0]), (row: any) => row.profile.unitIds = ['foreign']]) assert.throws(() => importAIProfile(alter(edit), connections), /프로필 파일/);
 assert.throws(() => importAIProfile('{broken', connections), /JSON/); assert.throws(() => importAIProfile('x'.repeat(128 * 1024 + 1), connections), /128 KiB/);
});
