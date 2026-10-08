import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {demoFixture} from '../../../packages/core/src/fixture.ts';

test('project APIs retain work across imports, distinguish backup from catalog, and isolate demo namespace',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workbench-project-api-'));const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=(reserve.address() as net.AddressInfo).port;await new Promise<void>(resolveClose=>reserve.close(()=>resolveClose()));
 const child=spawn(process.execPath,['--import','tsx',resolve('apps/worker/src/server.ts')],{cwd:resolve('.'),env:{...process.env,WORKBENCH_PORT:String(port),WORKBENCH_DATA_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
 const request=async(path:string,data?:unknown,method=data===undefined?'GET':'POST')=>{const response=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,data:await response.json() as any};};
 try{
  const deadline=Date.now()+10000;while(!logs.includes('SQLite persisted locally')){if(Date.now()>deadline||child.exitCode!==null)throw new Error(`Fixture server did not start: ${logs}`);await new Promise(resolveWait=>setTimeout(resolveWait,25));}
  const initial=(await request('/state')).data;assert.equal((await request('/units/S0-01',{text:'API에서 보존할 번역',expectedVersion:0},'PATCH')).status,200);
  const backup=(await request('/project/backup')).data;assert.equal(backup.format,'translation-workbench-backup');assert.equal('connections' in backup.data,false);assert.equal((await request('/export')).data.format,undefined);
  const other=structuredClone(demoFixture);other.project.id='api-other';other.project.title='API Other';assert.equal((await request('/project/import',other)).status,200);
  const projects=(await request('/projects')).data;assert.ok(projects.some((p:any)=>p.id===initial.project.id&&!p.current));assert.equal((await request(`/projects/${initial.project.id}/open`,{})).status,200);assert.equal((await request('/state')).data.translations['S0-01'].text,'API에서 보존할 번역');
  assert.equal((await request('/project/import',other)).status,409);assert.equal((await request(`/projects/${other.project.id}/open`,{})).status,200);assert.equal((await request('/project/restore',backup)).status,200);assert.equal((await request('/state')).data.translations['S0-01'].locked,true);
  const mainBefore=(await request('/state')).data;const demo=(await request('/demo/state')).data;assert.equal(demo.units.length,24);assert.equal((await request('/demo/project/restore',backup)).status,200);assert.deepEqual((await request('/state')).data,mainBefore);
  const profile={...mainBefore.profiles.review,prompt:'Independent saved stage'};assert.equal((await request('/profiles/review',{profile},'PATCH')).status,200);const after=(await request('/state')).data;assert.equal(after.profiles.review.prompt,profile.prompt);assert.deepEqual(after.profiles.translate,mainBefore.profiles.translate);
  assert.equal((await request('/runs',{kind:'translate',stage:'review',unitIds:['missing']})).status,400);assert.equal((await request('/runs/not-found/retry-current',{})).status,404);
 }finally{if(child.exitCode===null){child.kill();await once(child,'exit');}await rm(dir,{recursive:true,force:true});}
});
