import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildOrwellProject,buildOrwellSample} from '../packages/adapters/src/orwell.ts';
export {buildOrwellProject,buildOrwellSample};

async function main(){
 const workbench=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),workspace=path.dirname(workbench);
 const output=path.join(workbench,'artifacts','orwell-import-2026-10-08');
 const {input,report,manifest}=await buildOrwellProject(workspace);
 await mkdir(output,{recursive:true});
 const serialized=JSON.stringify(input),inputPath=path.join(output,'workbench-input-orwell2.json');
 await writeFile(inputPath,serialized+'\n');
 const sample=buildOrwellSample(input),samplePath=path.join(output,'workbench-input-orwell2-sample.json');
 await writeFile(samplePath,JSON.stringify(sample)+'\n');
 await writeFile(path.join(output,'sample-report.json'),JSON.stringify({output:samplePath,units:sample.units.length,groups:sample.groups.length,nodes:sample.graph!.nodes.length,edges:sample.graph!.edges.length,flows:sample.graph!.flows.length,externalTargets:sample.graph!.edges.filter(edge=>edge.externalTarget).length,...sample.graph!.metadata},null,2)+'\n');
 const sourceDrift:string[]=[];
 for(const file of manifest){const now=createHash('sha256').update(await readFile(path.join(workspace,file.relativePath))).digest('hex');if(now!==file.sha256)sourceDrift.push(file.relativePath);}
 const finalReport={...report,inputUtf8Bytes:Buffer.byteLength(serialized+'\n'),inputSha256:createHash('sha256').update(serialized+'\n').digest('hex'),sourceFilesChecked:manifest.length,sourceDrift,originalWrites:0,modelCalls:0,output:inputPath};
 await writeFile(path.join(output,'conversion-report.json'),JSON.stringify(finalReport,null,2)+'\n');
 await writeFile(path.join(output,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await writeFile(path.join(output,'README.txt'),`Orwell 2 schemaVersion 2 input\nReproduce: npx tsx scripts/import-orwell.ts\nImport workbench-input-orwell2.json through the workbench UI.\n\nAll ${report.records} extracted record IDs and original source strings/metadata are retained.\nGraph: ${report.nodes} nodes, ${report.edges} edges, ${report.flows} flows.\nUnknown scope stays unknown. No conditions are executed or branches guessed.\nPrimary groups use actual conversations/documents/UI/scene membership; all additional memberships remain in sourceRef and graph metadata.\nInput bytes: ${finalReport.inputUtf8Bytes}. Source hash drift: ${sourceDrift.length}.\nNo original/source file writes or model calls.\n`);
 console.log(JSON.stringify(finalReport,null,2));
 if(sourceDrift.length||report.sourceIdentityErrors.length)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
