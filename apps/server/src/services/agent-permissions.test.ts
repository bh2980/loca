import { describe, expect, it } from 'vitest';
import { agentToolPermissionOptions, effectiveAgentPermissions, requiredAgentPermissions } from '@tw/shared';

describe('agent resource permissions', () => {
  it('maps source CRUD and translation proposals to their actual actions', () => {
    expect(requiredAgentPermissions('create_unit', {})).toEqual([{ resource: 'script', action: 'create' }]);
    expect(requiredAgentPermissions('update_unit', {})).toEqual([{ resource: 'script', action: 'update' }]);
    expect(requiredAgentPermissions('delete_units', {})).toEqual([{ resource: 'script', action: 'delete' }]);
    expect(requiredAgentPermissions('create_group', {})).toEqual([{ resource: 'scenes', action: 'create' }]);
    expect(requiredAgentPermissions('update_group', {})).toEqual([{ resource: 'scenes', action: 'update' }]);
    expect(requiredAgentPermissions('delete_group', {})).toEqual([{ resource: 'scenes', action: 'delete' }]);
    expect(requiredAgentPermissions('propose_translation', {})).toEqual([{ resource: 'script', action: 'update' }]);
  });

  it('keeps legacy save_status creation permission tied to its payload', () => {
    expect(requiredAgentPermissions('save_status', { type: 'status' })).toEqual([{ resource: 'statuses', action: 'create' }]);
    expect(requiredAgentPermissions('save_status', { type: 'tag' })).toEqual([{ resource: 'tags', action: 'create' }]);
    expect(requiredAgentPermissions('save_status', {})).toBeNull();
  });

  it('maps status, tag and workflow CRUD tools to their individual resource actions', () => {
    expect(requiredAgentPermissions('update_status', {})).toEqual([{ resource: 'statuses', action: 'update' }]);
    expect(requiredAgentPermissions('delete_status', {})).toEqual([{ resource: 'statuses', action: 'delete' }]);
    expect(requiredAgentPermissions('update_tag', {})).toEqual([{ resource: 'tags', action: 'update' }]);
    expect(requiredAgentPermissions('delete_tag', {})).toEqual([{ resource: 'tags', action: 'delete' }]);
    expect(requiredAgentPermissions('delete_workflow', {})).toEqual([{ resource: 'workflows', action: 'delete' }]);
  });

  it('checks workflow creation and updates by whether the payload has an id', () => {
    expect(requiredAgentPermissions('save_workflow', { name: 'New' })).toEqual([{ resource: 'workflows', action: 'create' }]);
    expect(requiredAgentPermissions('save_workflow', { id: 'workflow-1', name: 'Changed' })).toEqual([{ resource: 'workflows', action: 'update' }]);
    expect(agentToolPermissionOptions('save_workflow')).toEqual([
      [{ resource: 'workflows', action: 'create' }],
      [{ resource: 'workflows', action: 'update' }],
    ]);
  });

  it('treats old candidate-only tool switches as script update restrictions', () => {
    const permissions = effectiveAgentPermissions({ disabledTools: ['propose_translation'] });
    expect(permissions.script).toMatchObject({ create: true, read: true, update: false, delete: true });
  });
});
