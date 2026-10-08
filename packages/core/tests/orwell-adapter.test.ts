import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildOrwellProject,buildOrwellSample} from '../../adapters/src/orwell.ts';
import {validateProject,Engine} from '../src/engine.ts';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const converted=buildOrwellProject(workspace);

test('Orwell adapter retains every original catalog ID, source string and raw record without branch flattening',async()=>{
 const {input,report}=await converted;
 const records=(await readFile(path.join(workspace,'extracted/catalog.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const byId=new Map(input.units.map(unit=>[unit.id,unit]));
 assert.equal(input.schemaVersion,2);assert.equal(records.length,9400);assert.equal(byId.size,records.length);
 for(const record of records){const unit=byId.get(record.record_id)!;assert.ok(unit);assert.equal(unit.source,record.source);assert.deepEqual(unit.sourceRef!.rawRecord,record);assert.equal(unit.branch,'unknown');}
 assert.ok(input.groups.every(group=>group.branch==='unknown'));assert.deepEqual(report.sourceIdentityErrors,[]);
});

test('real graph preserves every raw flow, node condition, outgoing edge and orphan snapshot',async()=>{
 const {input}=await converted,graph=input.graph!;
 assert.equal(graph.nodes.length,5146);assert.equal(graph.edges.length,5121);assert.equal(graph.flows.length,8);
 const nodes=new Map(graph.nodes.map(node=>[node.id,node])),edges=new Map(graph.edges.map(edge=>[edge.id,edge]));
 for(const flow of graph.flows){
  const relative=flow.metadata!.sourceFile as string,original=JSON.parse(await readFile(path.join(workspace,relative),'utf8'));
  assert.deepEqual(flow.rootIds,original.roots);assert.deepEqual(flow.nodeIds,original.graph.map((node:any)=>node.object_key));
  const {graph:_rawGraph,...rest}=original;assert.deepEqual(flow.metadata!.rawFlow,rest);
  for(const originalNode of original.graph){
   const node=nodes.get(originalNode.object_key)!;assert.ok(node);
   const source=(node.metadata!.sourceNodes as any[]).find(item=>item.flowId===flow.id);assert.deepEqual(source.rawNode,originalNode);assert.deepEqual(node.conditions,originalNode.conditions);
   for(const [index,outgoing] of originalNode.outgoing.entries()){
    const edge=edges.get(`${node.id}::outgoing:${index}`)!;assert.ok(edge);assert.equal(edge.from,node.id);assert.equal(edge.to??edge.externalTarget,outgoing.target);assert.equal(edge.direction,outgoing.direction);
    assert.deepEqual((edge.metadata!.sourceEdges as any[]).find(item=>item.flowId===flow.id&&item.index===index).rawEdge,outgoing);
   }
  }
 }
 const extraction=JSON.parse(await readFile(path.join(workspace,'analysis/scenes/report.json'),'utf8'));
 assert.equal(extraction.states_without_flow.length,9);for(const id of extraction.states_without_flow){assert.equal((nodes.get(id)!.metadata!.rawObject as any).key,id);assert.ok((nodes.get(id)!.metadata!.rawObject as any).tree);}
});

test('per-record source language and stable speaker IDs are exposed without name inference',async()=>{
 const {input}=await converted,nodes=new Map(input.graph!.nodes.map(node=>[node.id,node]));
 let speakerIdUnits=0,ampleUnits=0;
 for(const unit of input.units){
  const raw=unit.sourceRef!.rawRecord as any;assert.equal(unit.sourceLanguage,raw.language,unit.id);
  const originalContexts=(nodes.get(raw.object_key)?.metadata?.sourceNodes as any[]|undefined)?.map(item=>item.rawNode.context)??[];
  const context=originalContexts.find(context=>typeof(context?._speakerId||context?._speaker)==='string'&&(context._speakerId||context._speaker).length>0);
  if(context){assert.equal(unit.speaker,context._speakerId||context._speaker,unit.id);if(context._speakerId)speakerIdUnits++;if(context._speakerId==='CHAR_AMPLE'){ampleUnits++;assert.equal(unit.speaker,'CHAR_AMPLE');}}
 }
 assert.ok(speakerIdUnits>0,'actual records expose _speakerId');assert.ok(ampleUnits>0,'actual CHAR_AMPLE records retain stable ID');
 assert.deepEqual([...new Set(input.units.map(unit=>unit.sourceLanguage))].sort(),['de','en','unknown']);
});

test('conversation message review order and all bidirectional unit/group/node memberships remain valid',async()=>{
 const {input}=await converted,graph=input.graph!,units=new Map(input.units.map(unit=>[unit.id,unit])),nodes=new Map(graph.nodes.map(node=>[node.id,node])),groups=new Map(input.groups.map(group=>[group.id,group]));
 for(const unit of units.values()){
  assert.ok(groups.has(unit.groupId));assert.ok((unit.sourceRef!.groupMemberships as string[]).includes(unit.groupId));
  for(const id of unit.graphNodeIds??[]){const node=nodes.get(id)!;assert.ok(node);assert.ok(node.unitIds.includes(unit.id));assert.ok(node.groupIds.includes(unit.groupId));}
 }
 for(const node of nodes.values()){for(const id of node.unitIds)assert.ok(units.get(id)?.graphNodeIds?.includes(node.id));for(const id of node.groupIds)assert.ok(groups.get(id)?.graphNodeIds?.includes(node.id));}
 for(const group of groups.values()){assert.ok(group.nextIds.every(id=>groups.has(id)));assert.ok((group.graphFlowIds??[]).every(id=>graph.flows.some(flow=>flow.id===id)));}
 for(const flow of graph.flows)for(const conversation of (flow.metadata!.rawFlow as any).conversations){
  const id=`conversation:${conversation.object_key}`,groupUnits=input.units.filter(unit=>unit.groupId===id).sort((a,b)=>a.order-b.order);
  if(!groupUnits.length)continue;
  const orderedNodeIds=[...new Set(groupUnits.map(unit=>(unit.sourceRef!.rawRecord as any).object_key))];
  const original=[conversation.object_key,...conversation.message_review_order];
  const indices=orderedNodeIds.map(nodeId=>original.indexOf(nodeId)).filter(index=>index>=0);
  assert.ok(indices.every((value,index)=>index===0||value>=indices[index-1]),`message order preserved for ${id}`);
 }
});

test('document references retain associations with original availability/open states',async()=>{
 const {input}=await converted,graph=input.graph!;
 const docUnits=input.units.filter(unit=>(unit.sourceRef!.graphAssociations as any).documentReferenceNodeIds.length);
 assert.ok(docUnits.length>0);
 for(const unit of docUnits){assert.ok((unit.sourceRef!.groupMemberships as string[]).some(id=>id.startsWith('document:')));for(const id of (unit.sourceRef!.graphAssociations as any).documentReferenceNodeIds)assert.ok(graph.nodes.some(node=>node.id===id&&node.unitIds.includes(unit.id)));}
 assert.ok(input.units.some(unit=>(unit.sourceRef!.groupMemberships as string[]).length>1));
});

test('converted real input is accepted and retained by schema2 Engine without source or graph loss',async()=>{
 const {input}=await converted;validateProject(input);
 const engine=new Engine('unused-orwell-adapter-test',{memory:true,autoStart:false});
 try{
  engine.importProject(input);const state=engine.state();assert.equal(state.units.length,9400);
  // Compare the actual JSON interchange representation: persistence omits optional
  // undefined properties. A failed deepEqual of this 33 MiB graph would allocate
  // an enormous assertion diff and obscure the underlying mismatch.
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(digest(state.units),digest(input.units),'all imported unit JSON retained');
  assert.equal(digest(state.graph),digest(input.graph),'all imported graph JSON retained');
  assert.equal(state.schemaVersion,2);
 }finally{engine.close();}
});

test('all extraction source files remain unchanged after conversion',async()=>{
 const {manifest}=await converted;assert.ok(manifest.length>450);
 for(const file of manifest){const bytes=await readFile(path.join(workspace,file.relativePath));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.relativePath);}
});

test('Datachunks six-record sample keeps original order, provenance and bounded graph endpoints',async()=>{
 const {input}=await converted,sample=buildOrwellSample(input);validateProject(sample);
 assert.equal(sample.project.id,'orwell2-sample-datachunks');assert.equal(sample.units.length,6);assert.equal(sample.groups.length,1);
 const originals=input.units.filter(unit=>unit.groupId===sample.groups[0].id).sort((a,b)=>a.order-b.order);
 assert.deepEqual(sample.units,originals);assert.ok(sample.graph!.nodes.length<=60);assert.ok(sample.graph!.nodes.length>6);
 const originalEdges=new Map(input.graph!.edges.map(edge=>[edge.id,edge])),ids=new Set(sample.graph!.nodes.map(node=>node.id));
 for(const edge of sample.graph!.edges){const original=originalEdges.get(edge.id)!;assert.deepEqual(edge.metadata,original.metadata);assert.deepEqual(edge.conditions,original.conditions);assert.equal(edge.direction,original.direction);assert.equal(edge.to??edge.externalTarget,original.to??original.externalTarget);assert.ok(ids.has(edge.from));if(edge.to)assert.ok(ids.has(edge.to));}
 assert.ok(sample.graph!.edges.some(edge=>edge.externalTarget),'out-of-sample original targets remain explicit');
 assert.equal(sample.graph!.metadata!.omittedUnits,9394);assert.ok(sample.units.every(unit=>unit.sourceLanguage==='en'&&unit.branch==='unknown'));
});
