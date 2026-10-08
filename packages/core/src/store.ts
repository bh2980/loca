import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {WorkspaceState} from '@workbench/contracts';

export class Store {
  private db: DatabaseSync;
  private currentRevision:number;
  constructor(path:string, initial:()=>WorkspaceState) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL)');
    if(!this.db.prepare('SELECT id FROM workspace WHERE id=1').get()) this.db.prepare('INSERT INTO workspace VALUES (1,?)').run(JSON.stringify(initial()));
    this.currentRevision=this.read().revision;
  }
  read():WorkspaceState {return JSON.parse((this.db.prepare('SELECT body FROM workspace WHERE id=1').get() as {body:string}).body);}
  revision():number {return this.currentRevision;}
  archive(state:WorkspaceState){this.db.prepare('INSERT INTO projects VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at,body=excluded.body').run(state.project.id,state.project.title,new Date().toISOString(),JSON.stringify(state));}
  projects(){return (this.db.prepare('SELECT id,title,updated_at,body FROM projects ORDER BY updated_at DESC').all() as {id:string;title:string;updated_at:string;body:string}[]).map(row=>({id:row.id,title:row.title,updatedAt:row.updated_at,unitCount:(JSON.parse(row.body) as WorkspaceState).units.length}));}
  project(id:string):WorkspaceState|undefined{const row=this.db.prepare('SELECT body FROM projects WHERE id=?').get(id) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;}
  update<T>(fn:(state:WorkspaceState)=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try {const state=this.read(); const result=fn(state); state.revision++; this.db.prepare('UPDATE workspace SET body=? WHERE id=1').run(JSON.stringify(state)); this.db.exec('COMMIT'); this.currentRevision=state.revision; return result;}
    catch(error){this.db.exec('ROLLBACK'); throw error;}
  }
  close(){this.db.close();}
}
