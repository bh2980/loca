import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/engine.ts';
import {queryProject} from '../src/project-query.ts';

test('script queries page the whole matching scope and retain stable IDs without writes',()=>{
 const state=initialState(),before=structuredClone(state);
 const first=queryProject(state,'search_script',{query:'the',limit:2}) as {total:number;items:{id:string}[];nextOffset:number|null};
 assert.ok(first.total>2);assert.equal(first.items.length,2);assert.equal(first.nextOffset,2);
 const ids=[...first.items.map(item=>item.id)];let offset:number|null=first.nextOffset;
 while(offset!==null){const next=queryProject(state,'search_script',{query:'the',limit:2,offset}) as typeof first;ids.push(...next.items.map(item=>item.id));offset=next.nextOffset;}
 assert.equal(new Set(ids).size,first.total);assert.deepEqual(state,before);
});
test('read queries do not widen requested IDs or mix projects and reject invalid offsets',()=>{
 const state=initialState();
 const result=queryProject(state,'read_script',{unitIds:['S0-01']}) as {items:{id:string}[];total:number};
 assert.deepEqual(result.items.map(item=>item.id),['S0-01']);assert.equal(result.total,1);
 assert.throws(()=>queryProject(state,'read_script',{unitIds:['missing']}),/원문 ID/);
 assert.throws(()=>queryProject(state,'read_script',{}),/지정/);
 assert.throws(()=>queryProject(state,'project_overview',{},'other'),/프로젝트가 변경/);
 assert.throws(()=>queryProject(state,'search_script',{query:'x',offset:-1}),/조회 위치/);
 assert.throws(()=>queryProject(state,'search_script',{query:'x',instruction:'write'}),/지원하지 않는 조회 필드/);
});
test('materials exclude archived content and run progress comes from saved execution state',()=>{
 const state=initialState();state.knowledge=[{id:'live',kind:'fact',title:'Live',content:'Evidence',branch:'unknown',visibility:'translator',evidenceIds:['S0-01']},{id:'old',kind:'fact',title:'Old',content:'Archived',branch:'common',visibility:'translator',evidenceIds:[],archived:true}];
 const materials=queryProject(state,'search_materials',{}) as {total:number;items:{id:string}[]};assert.equal(materials.total,1);assert.equal(materials.items[0].id,'live');
 assert.throws(()=>queryProject(state,'read_material',{id:'old'}),/찾을 수 없습니다/);
 assert.throws(()=>queryProject(state,'run_progress',{runId:'imaginary'}),/실행을 찾을 수 없습니다/);
 const progress=queryProject(state,'run_progress',{}) as {total:number};assert.equal(progress.total,0);
});
