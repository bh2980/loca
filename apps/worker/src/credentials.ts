import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {isLocalApiHost,type Connection} from '@workbench/contracts';

export interface SecretCodec {protect(value:string):Promise<string>;unprotect(value:string):Promise<string>}
/** Windows owns the encryption key; no key or secret is passed on a command line. */
export const windowsCodec:SecretCodec={protect:value=>dpapi(value,false),unprotect:value=>dpapi(value,true)};
function dpapi(value:string,decrypt:boolean):Promise<string>{
 if(process.platform!=='win32')return Promise.reject(new Error('API 키 저장은 현재 Windows에서 지원됩니다. 고급 설정의 환경 변수 연결을 사용할 수 있습니다.'));
 const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
 return new Promise((resolve,reject)=>{
  const executable=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const child=spawn(executable,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  let output='';let failed=false;
  const timer=setTimeout(()=>{failed=true;child.kill();},10000);
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>64000){failed=true;child.kill();}});
  child.stderr.on('data',()=>{});
  child.stdin.on('error',()=>{failed=true;});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('Windows 보안 저장소를 열지 못했습니다.'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0||failed||!output.trim()||!/^[A-Za-z0-9+/=\r\n]+$/.test(output))reject(new Error('API 키를 Windows 계정으로 암호화하거나 복원하지 못했습니다.'));else resolve(decrypt?Buffer.from(output.trim(),'base64').toString('utf8'):output.trim());});
  child.stdin.end(decrypt?value:Buffer.from(value,'utf8').toString('base64'));
 });
}
type Entry={endpoint:string;encrypted:string};
export function credentialEndpoint(connection:Connection):string{
 if(!['openai','systemone'].includes(connection.kind)||!connection.baseUrl)throw new Error('API 연결 주소가 필요합니다.');
 const url=new URL(connection.baseUrl);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||(url.protocol==='http:'&&!isLocalApiHost(url.hostname)))throw new Error('API는 HTTPS 또는 로컬·사설망 HTTP 주소를 사용해야 합니다.');
 return url.href.replace(/\/$/,'');
}
/** Plaintext lives only in worker memory, never workspace state/export/logs. */
export class CredentialStore {
 private entries=new Map<string,Entry>();private secrets=new Map<string,string>();private writes:Promise<void>=Promise.resolve();
 constructor(private file:string,private codec:SecretCodec=windowsCodec){}
 async load(){
  let parsed:unknown;try{parsed=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw new Error('암호화된 API 키 저장 파일을 읽지 못했습니다.');}
  if(!Array.isArray(parsed))throw new Error('API 키 저장 형식이 잘못되었습니다.');
  for(const item of parsed){if(!Array.isArray(item)||typeof item[0]!=='string'||typeof item[1]?.endpoint!=='string'||typeof item[1]?.encrypted!=='string')continue;const [id,entry]=item as [string,Entry];this.entries.set(id,entry);try{this.secrets.set(id,await this.codec.unprotect(entry.encrypted));}catch{/* Individual unavailable credentials do not stop the workbench. */}}
 }
 get(connection:Connection){const entry=this.entries.get(connection.id);return entry&&entry.endpoint===credentialEndpoint(connection)?this.secrets.get(connection.id):undefined;}
 has(connection:Connection){return Boolean(this.get(connection));}
 async save(connection:Connection,value:unknown){
  if(typeof value!=='string'||!value.trim()||value.length>16000||/[\r\n\0]/.test(value))throw new Error('올바른 API 키를 입력하세요.');
  const endpoint=credentialEndpoint(connection),key=value.trim();
  const operation=this.writes.then(async()=>{const encrypted=await this.codec.protect(key);const entries=new Map(this.entries);entries.set(connection.id,{endpoint,encrypted});await this.persist(entries);this.entries=entries;this.secrets.set(connection.id,key);});this.writes=operation.catch(()=>{});await operation;
 }
 async remove(connectionId:string){const operation=this.writes.then(async()=>{const entries=new Map(this.entries);entries.delete(connectionId);await this.persist(entries);this.entries=entries;this.secrets.delete(connectionId);});this.writes=operation.catch(()=>{});await operation;}
 private async persist(entries:Map<string,Entry>){await mkdir(dirname(this.file),{recursive:true});await writeFile(this.file+'.tmp',JSON.stringify([...entries]),{mode:0o600});await rename(this.file+'.tmp',this.file);}
}
