import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ProjectInput,ProjectBackup,WorkspaceState,ProjectSummary} from '../packages/contracts/src/index.ts';
import {Engine,validateProject} from '../packages/core/src/engine.ts';

// Explicit English locale only. Unlabelled asset text is kept for separate review,
// never silently relabelled English or discarded from the source extraction.
const apply=process.argv.includes('--apply');
const base='http://127.0.0.1:4317/api';
const request=async<T>(route:string,body?:unknown):Promise<T>=>{
 const response=await fetch(base+route,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!response.ok)throw new Error(`${route}: ${response.status} ${await response.text()}`);
 return response.json() as Promise<T>;
};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const countLanguages=(units:WorkspaceState['units'])=>units.reduce<Record<string,number>>((result,unit)=>{const key=unit.sourceLanguage??'unknown';result[key]=(result[key]??0)+1;return result;},{});
const original=await request<WorkspaceState>('/state');
assert.equal(original.project.id,'orwell2-extracted','Open Orwell 2 before preparing its English catalog.');
assert.ok(!original.runs.some(run=>['queued','running','paused'].includes(run.status)),'Finish active runs first.');
assert.ok(!(original.taskTests??[]).some(test=>['queued','running'].includes(test.status)),'Finish active tests first.');
assert.equal(original.knowledge.length,0,'This initial setup migration requires reviewing existing knowledge before reimport.');
assert.equal(original.terms.length,0,'This initial setup migration requires reviewing existing terms before reimport.');
const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../artifacts',`orwell2-en-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(directory,{recursive:true});
const save=async(name:string,value:unknown)=>writeFile(join(directory,name),JSON.stringify(value)+'\n');
const backup=await request<ProjectBackup>('/project/backup');
assert.equal(digest(backup.data.units),digest(original.units));
await save('before-project-backup.json',backup);
await save('profiles-before.json',original.profiles);
const previousProjects=await request<ProjectSummary[]>('/projects');
const units=structuredClone(original.units.filter(unit=>unit.sourceLanguage==='en'));
const excluded=original.units.filter(unit=>unit.sourceLanguage!=='en');
const unitIds=new Set(units.map(unit=>unit.id)),groupIds=new Set(units.map(unit=>unit.groupId));
assert.ok(units.length>0);
const groups=original.groups.filter(group=>groupIds.has(group.id)).map(group=>({...structuredClone(group),nextIds:group.nextIds.filter(id=>groupIds.has(id))}));
const graph=structuredClone(original.graph);
if(graph){
 for(const node of graph.nodes){node.unitIds=node.unitIds.filter(id=>unitIds.has(id));node.groupIds=node.groupIds.filter(id=>groupIds.has(id));}
 graph.metadata={...graph.metadata,languagePolicy:'Translation catalog includes explicit en records only. Unlabelled and other locales are archived separately; original graph topology and provenance remain unchanged.',translationScope:{sourceLanguage:'en',included:units.length,excluded:countLanguages(excluded)}};
}
const input:ProjectInput={schemaVersion:original.schemaVersion,project:{...original.project,sourceLanguage:'en',description:'영어(en) 원문 번역 프로젝트. 언어 미표기 자료는 별도 검토 파일에 보관. 원본 그래프의 상태·조건·연결을 보존하며 순서는 실행 경로를 확정하지 않음.'},groups,units,graph,terms:[],knowledge:[]};
validateProject(input);
assert.deepEqual(graph?.nodes.map(({unitIds,groupIds,...node})=>node),original.graph?.nodes.map(({unitIds,groupIds,...node})=>node));
assert.deepEqual(graph?.edges,original.graph?.edges);
assert.deepEqual(graph?.flows,original.graph?.flows);
const firstGroupId='conversation:Ignorance_Data/resources.assets::resources.assets::1362';
assert.deepEqual(units.filter(unit=>unit.groupId===firstGroupId),original.units.filter(unit=>unit.groupId===firstGroupId));
const check=(state:WorkspaceState)=>{
 assert.equal(state.units.length,units.length);
 assert.ok(state.units.every(unit=>unit.sourceLanguage==='en'));
 assert.deepEqual(state.units,units);
 assert.deepEqual(state.graph,graph);
 for(const unit of units){assert.equal(state.translations[unit.id].text,original.translations[unit.id].text);assert.deepEqual(state.translations[unit.id].history,original.translations[unit.id].history);}
};
const memory=new Engine('english-catalog-check',{memory:true,autoStart:false});
try{memory.restoreProject(backup);memory.importProject(input);check(memory.state());}finally{memory.close();}
await save('workbench-input-orwell2-en.json',input);
await save('excluded-records.json',{reason:'Not explicitly labelled en',languages:countLanguages(excluded),units:excluded,groups:original.groups.filter(group=>!groupIds.has(group.id))});
const report={projectId:input.project.id,before:countLanguages(original.units),after:countLanguages(units),excluded:countLanguages(excluded),groups:groups.length,removedGroups:original.groups.length-groups.length,nodes:graph?.nodes.length,edges:graph?.edges.length,flows:graph?.flows.length,firstSceneUnits:units.filter(unit=>unit.groupId===firstGroupId).length,topologyPreserved:true,formatValidated:true,memoryImportValidated:true,modelCalls:0,applied:false};
if(apply){
 const fresh=await request<WorkspaceState>('/state');
 for(const key of ['project','units','groups','graph','translations','terms','knowledge','runs','taskTests'] as const)assert.equal(digest(fresh[key]),digest(original[key]),`Project changed during preparation: ${key}`);
 const updated=await request<WorkspaceState>('/project/import',input);check(updated);
 assert.deepEqual(updated.profiles,fresh.profiles);assert.deepEqual(updated.connections,fresh.connections);
 const projects=await request<ProjectSummary[]>('/projects');
 assert.deepEqual(projects.filter(project=>!project.current),previousProjects.filter(project=>!project.current));
 report.applied=true;
}
await save('report.json',report);
console.log(JSON.stringify({directory,...report},null,2));
