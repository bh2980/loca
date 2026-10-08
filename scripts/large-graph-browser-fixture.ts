/** Read-only real-source browser fixture. Reproduce:
 * node --import tsx scripts/large-graph-browser-fixture.ts --serve --port 4332
 * Omitting --serve only seeds a fresh OS temporary DB and writes the audit report.
 * Never opens .workbench or changes source artifacts. No model jobs are seeded. */
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ProjectInput} from '@workbench/contracts';
import {Engine} from '../packages/core/src/engine.ts';
import {projectGraphView} from '../packages/core/src/graph.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),serve=args.includes('--serve');
const portIndex=args.indexOf('--port'),port=portIndex<0?4332:Number(args[portIndex+1]);if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('Use a port from 1024 to 65535.');
const sourceIndex=args.indexOf('--source'),sourcePath=resolve(root,sourceIndex<0?'artifacts/orwell1-import-2026-10-08/workbench-input-orwell1.json':args[sourceIndex+1]);
const sourceBefore=await readFile(sourcePath),sourceHashBefore=createHash('sha256').update(sourceBefore).digest('hex'),input=JSON.parse(sourceBefore.toString('utf8')) as ProjectInput;
const dataDir=await mkdtemp(join(tmpdir(),'workbench-large-graph-')),output=join(root,'artifacts',`large-graph-browser-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(output,{recursive:true});
const engine=new Engine(dataDir,{autoStart:false});let displayNodes=0,displayEdges=0;
try{engine.importProject(input);const state=engine.state(),view=projectGraphView(state,{complete:true});displayNodes=view.nodes.length;displayEdges=view.edges.length;if(state.runs.length||state.workflow?.runs.length)throw new Error('Fixture must not contain executable runs.');if(view.omittedNodes||view.omittedEdges)throw new Error('Fixture full graph omitted records.');}finally{engine.close();}
const sourceHashAfter=createHash('sha256').update(await readFile(sourcePath)).digest('hex');if(sourceHashBefore!==sourceHashAfter)throw new Error('Source artifact changed during read-only import.');
process.env.WORKBENCH_DATA_DIR=dataDir;process.env.WORKBENCH_PORT=String(port);
const url=`http://127.0.0.1:${port}/?project=${encodeURIComponent(input.project.id)}&view=graph&graphMode=all-dialogue&dataset=scenes`,report={fixtureUrl:url,healthUrl:`http://127.0.0.1:${port}/api/health`,projectId:input.project.id,pid:process.pid,port,dataDir,sourcePath,sourceBytes:sourceBefore.length,sourceHashBefore,sourceHashAfter,sourceUnchanged:true,counts:{groups:input.groups.length,units:input.units.length,sourceNodes:input.graph?.nodes.length??0,sourceEdges:input.graph?.edges.length??0,fullDisplayNodes:displayNodes,fullDisplayEdges:displayEdges},reportPath:join(output,'report.json'),serveRequested:serve};
await writeFile(report.reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(serve)await import('../apps/worker/src/server.ts');
