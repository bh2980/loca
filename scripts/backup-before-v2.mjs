import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,copyFileSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

// Offline, local release backup. Never print source text or credentials.
const source=resolve('.workbench');
const destination=resolve('artifacts',`pre-v2-${new Date().toISOString().replace(/[:.]/g,'-')}`);
mkdirSync(destination,{recursive:true});
const db=new DatabaseSync(join(source,'workbench.sqlite'),{readOnly:true});
const state=JSON.parse(db.prepare('SELECT body FROM workspace WHERE id=1').get().body);
const active=(state.runs??[]).filter(run=>['running','queued'].includes(run.status));
if(active.length)throw new Error('Active work requires a coordinated checkpoint.');
await backup(db,join(destination,'workbench.sqlite'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields=['project','units','groups','translations','terms','knowledge','history','runs','connections','profiles','graph'];
const manifest={createdAt:new Date().toISOString(),projectId:state.project.id,revision:state.revision,unitCount:state.units.length,hashes:Object.fromEntries(fields.map(field=>[field,hash(state[field]??null)])),archived:db.prepare('SELECT id,body FROM projects ORDER BY id').all().map(row=>({id:row.id,hash:hash(JSON.parse(row.body))}))};
db.close();
if(existsSync(join(source,'credentials.dpapi.json')))copyFileSync(join(source,'credentials.dpapi.json'),join(destination,'credentials.dpapi.json'));
writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({destination,projectId:manifest.projectId,unitCount:manifest.unitCount,archivedProjects:manifest.archived.length}));
