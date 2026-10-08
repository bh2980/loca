import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildOrwell1Project} from '../../adapters/src/orwell1.ts';
import {Engine} from '../src/engine.ts';

async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'workbench-orwell1-test-'));
 const write=async(file:string,data:any)=>{await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),JSON.stringify(data));};
 const entry=(id:string,source:string,translation:string)=>({kind:'localized',owner_type:'NewCommentaryLineState',owner_id:id,id_field:'_objectId',field:'_text',source,translation,context:{_speakerId:'CHAR_SYMES'},provenance:{file:'original.assets',path_id:id}});
 const entries=[entry('m1','Hello {name}.','안녕 {name}.'),entry('m2','Bye.','안녕히.')];
 const graph=[{id:'c1',owner_type:'NewCommentaryState',context:{},conditions:{priority:1},outgoing:[{target:'m1',kind:'activate_first_state'}]},{id:'m1',owner_type:'NewCommentaryLineState',context:{},conditions:{flag:'a'},outgoing:[{target:'control',kind:'flow_connection',pin:3,direction:0,connection_path_id:'edge-a'}]},{id:'control',owner_type:'ControlState',context:{},conditions:{expression:'untouched'},outgoing:[{target:'c2',kind:'flow_connection',pin:2,direction:0,connection_path_id:'edge-b'}]},{id:'c2',owner_type:'NewCommentaryState',context:{},conditions:{},outgoing:[{target:'m2',kind:'activate_first_state'}]},{id:'m2',owner_type:'NewCommentaryLineState',context:{},conditions:{},outgoing:[]}];
 await write('translations/scenes/gameflow-day-1.json',{scene_id:'Gameflow Day 1',flow_index:0,roots:['c1'],entries,direct:[],ui:[],graph});
 await write('translations/documents/doc.json',{document_id:'doc',entries:[],ui:[],direct:[{kind:'direct',owner_type:'document_prefab',owner_id:'doc',id_field:'_id',field:'m_text',asset_path:'Assets/doc.prefab',part_index:0,component_index:0,hierarchy:[],source:'中文',source_en:'English document\r\n',translation:'한국어 문서\r\n',provenance:{file:'doc.bundle',path_id:'100'}}]});
 await write('translations/ui.json',{ui:[{key:'HELLO',source:'中文',source_en:'English UI',translation:'한국어 UI'}]});
 const index=[];
 for(const [i,id] of ['c1','c2'].entries()){
  const file=`conversations/gameflow-day-1/${id}.txt`;index.push({scene_id:'Gameflow Day 1',id,file});
  await write(`reading/${file.replace('.txt','.json')}`,{scene_id:'Gameflow Day 1',id,title:`Conversation ${i+1}`,review_rank:i+1,conversation:{id},traversal_nodes:[entries[i].owner_id],membership:[{id:entries[i].owner_id,evidence:'graph inference'}],records:[{source_group:'entries',source_array_index:i,entry_key:`entry-${i}`,entry:entries[i]}]});
 }
 await write('reading/conversations/index.json',index);
 const clean=async()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('workbench-orwell1-test-'));await rm(root,{recursive:true,force:true});};
 return {root,write,clean,entries,graph};
}

test('Orwell1 import preserves editable bilingual records, raw graph and true conversation reachability',async()=>{
 const f=await fixture();try{
  const result=await buildOrwell1Project(f.root),{input,backup}=result;
  assert.equal(input.units.length,4);assert.equal(result.report.conversations,2);assert.equal(result.report.readingDifferences.length,0);
  assert.equal(input.units.find(unit=>unit.source==='English document\r\n')!.sourceRef!.sourceSelection,'source_en');
  const first=input.groups.find(group=>group.id==='conversation:Gameflow Day 1:c1')!,second=input.groups.find(group=>group.id==='conversation:Gameflow Day 1:c2')!;
  assert.deepEqual(first.nextIds,[second.id]);assert.deepEqual(second.nextIds,[]);
  const control=input.graph!.nodes.find(node=>node.id==='control')!;assert.deepEqual(control.groupIds,[]);assert.deepEqual(control.conditions,{expression:'untouched'});
  assert.equal(input.graph!.edges.find(edge=>edge.from==='m1')!.metadata!.pin,3);
  const message=input.units.find(unit=>unit.source==='Hello {name}.')!;assert.equal(message.speaker,'CHAR_SYMES');assert.equal(message.groupId,first.id);assert.equal(message.sourceRef!.index,0);
  for(const translation of Object.values(backup.data.translations)){assert.equal(translation.status,'draft');assert.equal(translation.locked,true);assert.equal(translation.origin,'manual');assert.equal(translation.history[0].text,translation.text);}
  const engine=new Engine('unused-orwell1-fixture',{memory:true,autoStart:false});try{engine.importProject(input);engine.restoreProject(backup);assert.deepEqual(engine.state().units,JSON.parse(JSON.stringify(input.units)));assert.deepEqual(engine.state().graph,JSON.parse(JSON.stringify(input.graph)));assert.deepEqual(engine.state().translations,backup.data.translations);}finally{engine.close();}
  for(const file of result.manifest)assert.equal(createHash('sha256').update(await readFile(path.join(f.root,file.relativePath))).digest('hex'),file.sha256);
 }finally{await f.clean();}
});

test('editable translation changes keep stable IDs and stale reading text never overrides them',async()=>{
 const f=await fixture();try{
  const before=await buildOrwell1Project(f.root);f.entries[0].translation='수정한 번역 {name}.';
  await f.write('translations/scenes/gameflow-day-1.json',{scene_id:'Gameflow Day 1',roots:['c1'],entries:f.entries,graph:f.graph});
  const after=await buildOrwell1Project(f.root);assert.deepEqual(after.input.units.map(unit=>unit.id),before.input.units.map(unit=>unit.id));assert.equal(after.report.readingDifferences.length,1);
  const unit=after.input.units.find(unit=>unit.source==='Hello {name}.')!;assert.equal(after.backup.data.translations[unit.id].text,'수정한 번역 {name}.');
 }finally{await f.clean();}
});

test('conflicting duplicate canonical identities fail rather than discard edits',async()=>{
 const f=await fixture();try{
  await f.write('translations/documents/duplicate.json',{entries:[{...f.entries[0],translation:'충돌 번역'}]});
  await assert.rejects(buildOrwell1Project(f.root),/Conflicting canonical identity/);
 }finally{await f.clean();}
});
