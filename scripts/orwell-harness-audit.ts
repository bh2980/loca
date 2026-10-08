import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Engine,validateProject} from '../packages/core/src/engine.ts';

// Offline inspection only. This runner never invokes a provider or opens a game DB.
const workbench=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.dirname(workbench);
const output=path.join(workbench,'artifacts','harness-audit-2026-10-08');
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const sources:{relativePath:string;bytes:number;sha256:string;copyPath?:string}[]=[];
async function source(relativePath:string){const data=await readFile(path.join(workspace,relativePath));sources.push({relativePath,bytes:data.length,sha256:sha(data)});return data;}
await mkdir(path.join(output,'source-graphs'),{recursive:true});

function components(ids:string[],edges:[string,string][]){
 const adjacent=new Map(ids.map(id=>[id,[] as string[]])),reverse=new Map(ids.map(id=>[id,[] as string[]]));
 for(const [from,to] of edges)if(adjacent.has(from)&&adjacent.has(to)){adjacent.get(from)!.push(to);reverse.get(to)!.push(from);}
 const visited=new Set<string>(),finish:string[]=[];
 for(const id of ids)if(!visited.has(id)){
  visited.add(id);const stack:{id:string;index:number}[]=[{id,index:0}];
  while(stack.length){const top=stack.at(-1)!,next=adjacent.get(top.id)!;if(top.index<next.length){const target=next[top.index++];if(!visited.has(target)){visited.add(target);stack.push({id:target,index:0});}}else{finish.push(top.id);stack.pop();}}
 }
 visited.clear();const result:string[][]=[];
 for(const id of finish.reverse())if(!visited.has(id)){const members:string[]=[],stack=[id];visited.add(id);while(stack.length){const current=stack.pop()!;members.push(current);for(const previous of reverse.get(current)!)if(!visited.has(previous)){visited.add(previous);stack.push(previous);}}result.push(members);}
 return result;
}

async function dataset(name:string,directory:string){
 const flows:any[]=[];const uniqueObjects=new Set<string>(),numericIds=new Map<string,Set<string>>();
 const totals={flowFiles:0,nonemptyFlows:0,nodeMemberships:0,edgeMemberships:0,uniqueObjects:0,roots:0,unreachableMemberships:0,fanoutNodes:0,mergeNodes:0,selfEdges:0,cyclicComponents:0,cyclicNodes:0,conditionalNodes:0,otherReferences:0,conditionalReferenceLeaves:0,conditionalStateIdReferences:0,externalFlowTargets:0,conversations:0,localizedEntries:0};
 const classes:Record<string,number>={},edgeKinds:Record<string,number>={},directions:Record<string,number>={},conditionKeys:Record<string,number>={};
 for(const file of (await readdir(path.join(workspace,directory))).filter(file=>file.endsWith('.json')).sort()){
  const relativePath=path.posix.join(directory.replaceAll('\\','/'),file);
  const bytes=await readFile(path.join(workspace,relativePath));let scene:any;try{scene=JSON.parse(bytes.toString('utf8'));}catch{continue;}
  if(!Array.isArray(scene.graph))continue;
  sources.push({relativePath,bytes:bytes.length,sha256:sha(bytes),copyPath:`source-graphs/${name}-${file}`});
  await writeFile(path.join(output,'source-graphs',`${name}-${file}`),bytes);
  const key=(node:any)=>String(node.object_key??node.id);
  const ids=scene.graph.map(key),idSet=new Set(ids),edges:[string,string][]=[];
  const incoming=new Map(ids.map((id:string)=>[id,0]));
  let conditionalNodes=0,conditionReferences=0,stateIdReferences=0,fanoutNodes=0,externalTargets=0;
  for(const node of scene.graph){
   const nodeKey=key(node),objectKey=node.object_key??`${node.source_object?.file??name}::${node.source_object?.path_id??node.id}`;
   uniqueObjects.add(objectKey);const numeric=String(node.state_id??node.id);const objects=numericIds.get(numeric)??new Set<string>();objects.add(objectKey);numericIds.set(numeric,objects);
   const klass=node.class??node.owner_type??'unknown';classes[klass]=(classes[klass]??0)+1;
   const outgoing=node.outgoing??[];if(outgoing.length>1)fanoutNodes++;
   for(const edge of outgoing){const target=String(edge.target);edges.push([nodeKey,target]);if(idSet.has(target))incoming.set(target,(incoming.get(target) as number)+1);else externalTargets++;edgeKinds[edge.kind??'unknown']=(edgeKinds[edge.kind??'unknown']??0)+1;if(edge.direction!==undefined)directions[String(edge.direction)]=(directions[String(edge.direction)]??0)+1;}
   const conditions=node.conditions??{};const structural=new Set(['_priority','_ignoreSaveGameLoadingOrder']);
   if(Object.entries(conditions).some(([k,v])=>!structural.has(k)&&(Array.isArray(v)?v.length>0:typeof v==='number'?v!==0&&v!==-1:Boolean(v)))||/IfElse|AtLeast|AtClock|Timer|Delay|Wait/i.test(klass))conditionalNodes++;
   const references=(value:any):number=>Array.isArray(value)?value.reduce((sum,item)=>sum+references(item),0):value&&typeof value==='object'?('m_PathID' in value?1:Object.values(value).reduce<number>((sum,item)=>sum+references(item),0)):0;
   conditionReferences+=references(conditions);
   for(const [field,value] of Object.entries(conditions))if(/StateReferences$/.test(field)&&Array.isArray(value))stateIdReferences+=value.length;
   for(const conditionKey of Object.keys(conditions))conditionKeys[conditionKey]=(conditionKeys[conditionKey]??0)+1;
  }
  const scc=components(ids,edges),cyclic=scc.filter(group=>group.length>1||(scene.graph.find((node:any)=>key(node)===group[0])?.outgoing??[]).some((edge:any)=>String(edge.target)===group[0]));
  const item={file:relativePath,sceneId:scene.scene_id,nodeMemberships:ids.length,edges:edges.length,roots:(scene.roots??[]).length,unreachable:(scene.unreachable_from_roots??[]).length,fanoutNodes,mergeNodes:[...incoming.values()].filter((count:any)=>count>1).length,selfEdges:edges.filter(([from,to])=>from===to).length,cyclicComponents:cyclic.length,cyclicNodes:cyclic.reduce((sum,group)=>sum+group.length,0),conditionalNodes,conditionalReferenceLeaves:conditionReferences,conditionalStateIdReferences:stateIdReferences,otherReferences:scene.graph.reduce((sum:number,node:any)=>sum+(node.other_references??[]).length,0),externalFlowTargets:externalTargets,conversations:(scene.conversations??[]).length,localizedEntries:(scene.entries??[]).length,largestCycleNodes:Math.max(0,...cyclic.map(group=>group.length)),cycleExamples:cyclic.slice(0,3).map(group=>group.slice(0,8)),fanoutExamples:scene.graph.filter((node:any)=>(node.outgoing??[]).length>2).slice(0,3).map((node:any)=>({node:key(node),class:node.class??node.owner_type,outgoing:node.outgoing,conditions:node.conditions}))};
  flows.push(item);totals.flowFiles++;if(ids.length)totals.nonemptyFlows++;for(const field of ['nodeMemberships','roots','fanoutNodes','mergeNodes','selfEdges','cyclicComponents','cyclicNodes','conditionalNodes','conditionalReferenceLeaves','conditionalStateIdReferences','otherReferences','externalFlowTargets','conversations','localizedEntries'] as const)totals[field]+=item[field];totals.edgeMemberships+=edges.length;totals.unreachableMemberships+=item.unreachable;
 }
 totals.uniqueObjects=uniqueObjects.size;
 return {name,totals,classes,edgeKinds,directions,conditionKeys,duplicateNumericStateIds:[...numericIds].filter(([,objects])=>objects.size>1).map(([id,objects])=>({id,distinctObjects:objects.size})),flows,countSemantics:'Membership counts retain repeated membership across flows. Numeric state IDs are not globally unique. Fan-out includes activation/parallel edges and does not establish exclusive branches. Conditional-node count is a documented structural heuristic, not a runtime interpreter.'};
}

const graphs=[await dataset('orwell1','orwell_1_reorder/translations/scenes'),await dataset('orwell2','analysis/scenes')];
const extractionReport=JSON.parse((await source('analysis/scenes/report.json')).toString('utf8'));
await writeFile(path.join(output,'orwell2-extraction-report.json'),JSON.stringify(extractionReport,null,2)+'\n');
const rawCatalog=await source('extracted/catalog.jsonl');
const records=rawCatalog.toString('utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
await writeFile(path.join(output,'catalog.jsonl'),rawCatalog);
const ids=new Set(records.map(record=>record.record_id)),languages:Record<string,number>={};for(const record of records)languages[record.language??'unknown']=(languages[record.language??'unknown']??0)+1;
const serializedSourceIdEnum=JSON.stringify({enum:records.map(record=>record.record_id)});
const schemaBudgetRisk={sourceIdCount:records.length,measurement:'JSON.stringify({enum: originalCatalogRecordIds}) only; excludes the rest of the schema, prompt and argv.',enumJsonCharacters:serializedSourceIdEnum.length,enumJsonUtf8Bytes:Buffer.byteLength(serializedSourceIdEnum,'utf8'),currentBehavior:'Engine analyze/characters evidenceIds and glossary unitIds schema embed every source ID. Grok serializes the full schema into a single --json-schema argument.',risk:'The measured enum is a lower bound on schema/request size and on Grok single-argument size. No OS limit is asserted and no CLI or OS-limit experiment was run.',recommendedNextStep:'Budget schema/prompt sizes per adapter and partition extraction tasks or use a schema-file transport where the CLI officially supports it; keep exact ID validation at result ingestion.'};

// Unknown branches are honest: the current format must reject, never flatten them to common.
const candidate={schemaVersion:1,project:{id:'orwell2-audit',title:'Orwell 2 full catalog admission audit',description:'Offline source inventory; narrative graph NOT adapted.',sourceLanguage:'en',targetLanguage:'ko'},groups:[{id:'unscoped-catalog',title:'Unscoped source inventory',description:'Not a playable scene; source membership and conditions retained in graph sidecars.',order:0,branch:'unknown',kind:'document',nextIds:[]}],units:records.map((record,index)=>({id:record.record_id,groupId:'unscoped-catalog',order:index,source:record.source,kind:'document',branch:'unknown',termIds:[],contextNotes:[JSON.stringify({object_key:record.object_key,owner_id:record.owner_id,field:record.field,language:record.language})]})),terms:[],knowledge:[]};
let admissionError='';const engine=new Engine(path.join(output,'unused-engine'),{memory:true,autoStart:false});
const before=engine.state().project.id;
try{validateProject(candidate);engine.importProject(candidate);}catch(error){admissionError=(error as Error).message;}
const admission={status:admissionError?'UNSUPPORTED':'UNEXPECTED_ACCEPTANCE',records:records.length,duplicateRecordIds:records.length-ids.size,error:admissionError,atomicRejection:engine.state().project.id===before,queueStatus:'NOT_TESTABLE: full-source import is blocked by honest unknown branch; no common/A/B labels fabricated.'};engine.close();

const storageFile=path.join(output,'source-roundtrip.sqlite');const db=new DatabaseSync(storageFile);
db.exec('CREATE TABLE IF NOT EXISTS source_records (record_id TEXT PRIMARY KEY, source TEXT NOT NULL, payload TEXT NOT NULL)');
db.exec('BEGIN');db.exec('DELETE FROM source_records');const insert=db.prepare('INSERT INTO source_records VALUES (?,?,?)');const started=performance.now();
for(const record of records)insert.run(record.record_id,record.source,JSON.stringify(record));db.exec('COMMIT');const writeMs=performance.now()-started;
const readStarted=performance.now();const loaded=db.prepare('SELECT record_id,source,payload FROM source_records ORDER BY record_id').all() as {record_id:string;source:string;payload:string}[];const byId=new Map(records.map(record=>[record.record_id,record]));const mismatches=loaded.filter(row=>row.source!==byId.get(row.record_id)?.source||row.payload!==JSON.stringify(byId.get(row.record_id))).map(row=>row.record_id);const readMs=performance.now()-readStarted;db.close();
const storage={status:loaded.length===records.length&&!mismatches.length?'PASS':'FAIL',scope:'Audit evidence preservation only: independent raw SQLite roundtrip. NOT Engine.import, Engine storage, queue scalability, or production performance verification.',performanceClaim:false,records:records.length,loaded:loaded.length,mismatches,languages,sourceUtf8Bytes:records.reduce((sum,record)=>sum+Buffer.byteLength(record.source),0),auditWriteMs:Math.round(writeMs*100)/100,auditReadCompareMs:Math.round(readMs*100)/100};

const report={schemaVersion:1,generatedAt:new Date().toISOString(),status:'UNSUPPORTED_FOR_FULL_ORWELL_GRAPH',runtimeSimulationScope:'A complete game runtime simulator is excluded from the initial plan. This audit requires lossless graph/scope preservation and bounded translation context, not full condition execution.',networkCalls:0,originalWrites:0,graphs,orwell2ExtractionCoverage:{allExtractedStates:extractionReport.states,statesInFlows:extractionReport.states_in_flows,statesWithoutFlow:extractionReport.states_without_flow,extractedConnections:extractionReport.connections,declaredFlows:extractionReport.flows},admission,storage,schemaBudgetRisk,limits:[
 'Branch enum common/A/B cannot losslessly represent arbitrary conditional or nested game paths; unknown branches are rejected.',
 'Group.nextIds only retains target IDs, not pin/direction/edge kind/connection ID or conditional predicates.',
 'Group has no roots, priority, simultaneous activation, SCC loop semantics or solved/unsolved state references.',
 'SourceUnit retains source identity/text but lacks typed Unity object/field/provenance and graph-node membership; originals remain in sidecars.',
 'Knowledge branch/visibility lacks character-specific observers and structured reveal predicates; description text is only model instruction.',
 'Engine queue sorts groups/units by review order and does not execute game conditions or traverse a playable path.',
 'Whole-corpus analysis includes all source units. Large prompt/provider/schema budgets and large graph ancestor traversal have not been validated for production.',
],minimumChanges:[
 'Add versioned adapter input retaining stable object keys, unit-to-state membership, original source fields/provenance and explicit unknown scope.',
 'Add a generic graph sidecar contract preserving arbitrary nodes, roots, typed edges including pins/directions, opaque predicates/other references and SCC/review-order metadata. Do not implement a complete game runtime simulator.',
 'Represent path/reveal scope by predicates or graph references rather than forced A/B labels; keep translator reference separate from character/player knowledge.',
 'Permit source inventory import before narrative scope is resolved, with an explicit unsupported/unknown badge and no claim of branch validation.',
 'Constrain translation context by selected graph path/scope without pretending unknown conditions have executed; use indexed lookups and chunk whole-corpus analysis. Measure actual Engine import/queue scale only after lossless admission exists.',
],recommendation:'Do not import Orwell as a flattened common-branch narrative project. Raw storage passes; graph representation and full Engine import/queue remain unsupported.'};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(output,'source-manifest.json'),JSON.stringify(sources,null,2)+'\n');
const sourceDrift=[];for(const entry of sources)if(sha(await readFile(path.join(workspace,entry.relativePath)))!==entry.sha256)sourceDrift.push(entry.relativePath);
const copyDrift=[];for(const entry of sources)if(entry.copyPath&&sha(await readFile(path.join(output,entry.copyPath)))!==entry.sha256)copyDrift.push(entry.copyPath);
await writeFile(path.join(output,'verification.json'),JSON.stringify({sourceFilesChecked:sources.length,sourceDrift,copiedGraphsChecked:sources.filter(entry=>entry.copyPath).length,copyDrift,originalWrites:0,storagePass:storage.status==='PASS',unsupportedGraphAccuratelyReported:Boolean(admissionError)},null,2)+'\n');
await writeFile(path.join(output,'README.txt'),`Offline Orwell harness audit\nReproduce: npx tsx scripts/orwell-harness-audit.ts\nNo provider/model calls. Original files are read only.\n\nOverall: UNSUPPORTED_FOR_FULL_ORWELL_GRAPH\nRaw catalog storage: ${storage.status}, ${records.length} records, ${loaded.length} loaded, ${mismatches.length} mismatches.\nEngine admission: ${admission.status}; full import/queue NOT TESTABLE with current branch contract.\n\n${graphs.map(graph=>`${graph.name}: ${graph.totals.flowFiles} actual flow files, ${graph.totals.uniqueObjects} unique objects, ${graph.totals.nodeMemberships} node memberships, ${graph.totals.edgeMemberships} edges, ${graph.totals.roots} roots, ${graph.totals.cyclicComponents} cyclic SCCs, ${graph.totals.cyclicNodes} cyclic node memberships.\n`).join('')}\nFull graph bytes and original catalog are preserved beside this report, with SHA-256 manifest. Fan-out is not proof of mutually exclusive branches. Conditional counts are heuristic. Source hash drift: ${sourceDrift.length}.\n`);
console.log(JSON.stringify({status:report.status,output,graphs:graphs.map(graph=>({name:graph.name,...graph.totals})),admission,storage,sourceDrift},null,2));
if(sourceDrift.length||copyDrift.length||storage.status!=='PASS'||!admissionError)process.exitCode=1;
