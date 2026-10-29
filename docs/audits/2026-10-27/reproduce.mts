import { openDatabase } from '../../../apps/server/src/db/index.ts';
import * as s from '../../../apps/server/src/db/schema.ts';
import { importProject } from '../../../apps/server/src/services/importer.ts';
import { importFileSchema } from '../../../packages/shared/src/import-format.ts';
import { deleteItemsKept, restoreItems } from '../../../apps/server/src/services/item-delete.ts';
import { splitConnections } from '../../../apps/server/src/services/connection-split.ts';
import { copyConnections, copyKeys, stepDone } from '../../../apps/server/src/services/app-defaults.ts';
import { memoryStore } from '../../../apps/server/src/services/secrets.ts';
import { fillTermUsage, termUsage } from '../../../apps/server/src/services/term-usage.ts';
import { updateUnit } from '../../../apps/server/src/services/source-mutations.ts';
import { pickNodes } from '../../../apps/server/src/services/graph-views.ts';
import { realistic } from '../../../scripts/realistic-sample.ts';
const results:any[]=[];
function fixture(){ const db=openDatabase(':memory:'); const {projectId}=importProject(db,importFileSchema.parse({format:'loca/v1',project:{name:'audit'},groups:[{key:'g',title:'G'}],units:[{key:'u',group:'g',source:'The tower is quiet.'}],terms:[{source:'tower',target:'탑'}]}));return {db,projectId}; }
{
 const {db,projectId}=fixture();const person=db.insert(s.characters).values({projectId,name:'Audit Person'}).returning().get(); const tag=db.insert(s.tags).values({projectId,name:'audit tag',color:'accent',scope:['people']}).returning().get();db.insert(s.knowledgeTags).values({kind:'characters',itemId:person.id,tagId:tag.id,note:'retain me'}).run();
 const before=db.select().from(s.knowledgeTags).all().length;const {token}=deleteItemsKept(db,projectId,[{kind:'characters',ids:[person.id]}]); const restored=restoreItems(db,projectId,token);results.push({case:'undo_loses_tags',before,restored,people:db.select().from(s.characters).all().length,tagsAfter:db.select().from(s.knowledgeTags).all().length});db.$client.close();
}
{
 const {db,projectId}=fixture(); const from=db.insert(s.connections).values({name:'Provider',kind:'openai',baseUrl:'https://example.invalid/v1'}).returning().get();const keys=memoryStore();keys.set(from.id,'audit-only-key'); let thrown='';try {splitConnections(db,{...keys,set(){throw new Error('simulated credential store unavailable')}});}catch(e){thrown=String(e)} const done=stepDone(db,'connections-per-project');const retry=splitConnections(db,keys);const target=db.select().from(s.connections).all().find(r=>r.projectId===projectId)!;results.push({case:'migration_not_retryable_after_key_failure',thrown,done,retry,targetHasKey:keys.get(target.id)!==null});db.$client.close();
}
{
 const {db,projectId}=fixture(); db.insert(s.connections).values({name:'Same',kind:'openai',baseUrl:'https://new.invalid/v1'}).run();const target=db.insert(s.connections).values({projectId,name:'Same',kind:'openai',baseUrl:'https://old.invalid/v1'}).returning().get();const keys=memoryStore();keys.set(target.id,'audit-old-key');const copies=db.transaction(tx=>copyConnections(tx,null,projectId));copyKeys(keys,copies.keys);results.push({case:'connection_copy_retains_old_key',newUrl:db.select().from(s.connections).all().find(r=>r.id===target.id)?.baseUrl,retainsOldKey:keys.get(target.id)==='audit-old-key'});db.$client.close();
}
{
 const {db,projectId}=fixture();fillTermUsage(db,projectId);const unit=db.select().from(s.units).get()!;const before=db.select().from(s.terms).get()!.lines;updateUnit(db,projectId,unit.id,{source:'Nothing remains here.'});fillTermUsage(db,projectId);const term=db.select().from(s.terms).get()!;results.push({case:'term_usage_stale_after_source_edit',before,cachedAfter:term.lines,actualAfter:termUsage(db,projectId,term).length});
}
{
 const db=openDatabase(':memory:');const {file}=realistic(9000);const {projectId}=importProject(db,importFileSchema.parse(file));const nodes=db.select({key:s.graphNodes.key}).from(s.graphNodes).all();const prepare=db.$client.prepare.bind(db.$client);let queries=0;(db.$client as any).prepare=(sql:string)=>{queries++;return prepare(sql)};
 for(const size of [1,100,500,2000]){queries=0;const start=performance.now();const picked=pickNodes(db,projectId,{keep:nodes.slice(0,size).map(n=>({ref:n.key}))});results.push({case:'graph_keep_scale',requested:size,kept:picked.nodeIds.length,queries,ms:Math.round(performance.now()-start)});}db.$client.close();
}
console.log(JSON.stringify(results,null,2));
