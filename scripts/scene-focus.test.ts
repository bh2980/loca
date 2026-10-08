import test from 'node:test';
import assert from 'node:assert/strict';
import {findSceneGroupNode} from '../apps/web/src/scene-focus.ts';

test('scene search locates shared content using the requested group actual units',()=>{
 const nodes=[{id:'control',groupIds:['intro'],unitIds:[],projection:{kind:'control'}},{id:'other',groupIds:['other'],unitIds:['other-unit'],projection:{kind:'scene',groupId:'other'}},{id:'shared',groupIds:['intro','other'],unitIds:['intro-1','intro-2','other-unit'],projection:{kind:'shared-content'}}];
 assert.equal(findSceneGroupNode(nodes,'intro',new Set(['intro-1','intro-2']))?.id,'shared');
 assert.equal(findSceneGroupNode(nodes,'other',new Set(['other-unit']))?.id,'other');
 assert.equal(findSceneGroupNode(nodes,'missing',new Set()),undefined);
});
test('unprojected content can be focused but control associations and another group cannot substitute',()=>{
 const nodes=[{id:'association',groupIds:['intro'],unitIds:['intro-unit'],projection:{kind:'control'}},{id:'wrong-projection',groupIds:['intro'],unitIds:['intro-unit'],projection:{kind:'scene',groupId:'other'}},{id:'content',groupIds:['intro'],unitIds:['intro-unit']}];
 assert.equal(findSceneGroupNode(nodes,'intro',new Set(['intro-unit']))?.id,'content');
 assert.equal(findSceneGroupNode(nodes.slice(0,2),'intro',new Set(['intro-unit'])),undefined);
});
