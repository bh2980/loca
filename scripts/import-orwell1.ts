import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {buildOrwell1Project} from '../packages/adapters/src/orwell1.ts';
import {Engine} from '../packages/core/src/engine.ts';
export {buildOrwell1Project};

async function main(){
 const workbench=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),sourceRoot=path.resolve(workbench,'../orwell_1_reorder'),output=path.join(workbench,'artifacts/orwell1-import-2026-10-08');
 const conversion=await buildOrwell1Project(sourceRoot),{input,backup,manifest,report}=conversion;
 const engine=new Engine('unused-orwell1-conversion-validation',{memory:true,autoStart:false});
 const same=(actual:unknown,expected:unknown)=>assert.equal(createHash('sha256').update(JSON.stringify(actual)).digest('hex'),createHash('sha256').update(JSON.stringify(expected)).digest('hex'));
 try{engine.importProject(input);same(engine.state().units,input.units);same(engine.state().graph,input.graph);engine.restoreProject(backup);const restored=engine.state();same(restored.units,input.units);same(restored.graph,input.graph);same(restored.translations,backup.data.translations);const roundtrip=engine.backupProject();engine.restoreProject(roundtrip);same(engine.state().translations,backup.data.translations);}finally{engine.close();}
 const sourceDrift:string[]=[];for(const entry of manifest)if(createHash('sha256').update(await readFile(path.join(sourceRoot,entry.relativePath))).digest('hex')!==entry.sha256)sourceDrift.push(entry.relativePath);
 if(sourceDrift.length)throw new Error(`Source hash drift: ${sourceDrift.join(', ')}`);
 await mkdir(output,{recursive:true});const files={'workbench-input-orwell1.json':JSON.stringify(input)+'\n','workbench-backup-orwell1.json':JSON.stringify(backup)+'\n'};
 for(const [name,text] of Object.entries(files)){if(Buffer.byteLength(text)>64*1024*1024)throw new Error(`${name} exceeds 64 MiB`);await writeFile(path.join(output,name),text);}
 const finalReport={...report,sourceDrift,engineRoundtrip:true,artifacts:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,{bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}]))};
 await writeFile(path.join(output,'conversion-report.json'),JSON.stringify(finalReport,null,2)+'\n');await writeFile(path.join(output,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await writeFile(path.join(output,'README.txt'),'Orwell 1 editable source records and existing Korean translations.\nRestore workbench-backup-orwell1.json to retain translations; importing workbench-input-orwell1.json supplies source only.\nTranslations are manual, protected, draft and unreviewed. Source/provenance/conditions/edges preserved.\nReproduce: npx tsx scripts/import-orwell1.ts\nNo source writes, model calls or live database writes.\n');console.log(JSON.stringify(finalReport,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
