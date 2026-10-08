import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectAuth,startLogin,resolveCli,type AuthState,type AuthAttempt} from '@workbench/providers';
import type {Connection} from '@workbench/contracts';
import {WorkbenchError} from '@workbench/core';
import {CredentialStore} from './credentials.ts';
import {runTerminalLogin} from './terminal-login.ts';

export type AccountState=Omit<AuthState,'state'>&{state:AuthState['state']|'configured'};
export type LoginAttempt=Omit<AuthAttempt,'state'>&{state:AuthAttempt['state']|'finished'};
type Session={connection:Connection;attempt:LoginAttempt;controller:AbortController;account?:AccountState;running:boolean;closeUnconfirmed?:boolean;completion?:Promise<void>};
const active=(attempt:LoginAttempt)=>['starting','waiting'].includes(attempt.state);
const identity=(connection:Connection)=>JSON.stringify([connection.id,connection.kind,connection.executable??'']);
export interface AccountServices {
 inspectAuth:typeof inspectAuth;
 startLogin:typeof startLogin;
 resolveCli:typeof resolveCli;
 runTerminalLogin:typeof runTerminalLogin;
}
/** Authentication URLs/codes stay in this ephemeral process, never in project history. */
export class Accounts {
 private sessions=new Map<string,Session>();
 private services:AccountServices;
 constructor(private credentials:CredentialStore,private directory:string,services:Partial<AccountServices>={}){this.services={inspectAuth,startLogin,resolveCli,runTerminalLogin,...services};}
 async status(connection:Connection):Promise<AccountState>{
  const existing=this.sessions.get(connection.id);const session=existing&&identity(existing.connection)===identity(connection)?existing:undefined;
  if(session&&active(session.attempt))return {connectionId:connection.id,state:'pending',detail:session.attempt.message,checkedAt:new Date().toISOString(),methods:[connection.kind==='antigravity'?'terminal':'browser']};
  if(connection.kind==='openai'||connection.kind==='systemone'){
   const saved=this.credentials.has(connection),env=Boolean(connection.envKey&&process.env[connection.envKey]);
   if(connection.allowUnauthenticated&&!saved&&!env)return {connectionId:connection.id,state:'configured',accountLabel:'키 없는 로컬 서버',detail:'인증 없이 사용하는 로컬 엔드포인트입니다. 서버 응답은 실행 시 확인합니다.',checkedAt:new Date().toISOString(),methods:[]};
   return {connectionId:connection.id,state:saved||env?'configured':'signed-out',accountLabel:saved?'이 Windows 계정에 저장된 키':env?'환경 변수의 키':undefined,detail:saved?'API 키를 암호화해 저장했습니다. 실제 요청의 인증과 모델 접근 권한은 실행 시 확인합니다.':env?'환경 변수에서 API 키를 사용할 수 있습니다.':'API 키를 연결해 주세요. 로컬 서버는 고급 설정에서 키 없이 사용할 수 있습니다.',checkedAt:new Date().toISOString(),methods:[]};
  }
  // Grok exposes no read-only auth-status command. Only preserve successful login
  // observed by this worker; never invent a persistent authenticated status.
  if(connection.kind==='grok'&&session?.account?.state==='signed-in'&&session.connection.executable===connection.executable)return session.account;
  return this.services.inspectAuth(connection);
 }
 get(connection:Connection){const session=this.sessions.get(connection.id);return session&&identity(session.connection)===identity(connection)?session.attempt:null;}
 validateSettings(connections:unknown){if(!Array.isArray(connections))return;for(const session of this.sessions.values())if(session.running){const current=connections.find(c=>c?.id===session.connection.id);if(!current||identity(current)!==identity(session.connection))throw new WorkbenchError('로그인 창을 닫은 뒤 해당 서비스 설정을 변경해 주세요.',409);}}
 start(connection:Connection,method:unknown):LoginAttempt{
  if(!['codex','grok','antigravity','claude'].includes(connection.kind))throw new WorkbenchError('이 연결은 API 키를 사용합니다.');
  if(!['browser','device-code','terminal'].includes(String(method))||(connection.kind==='antigravity'?method!=='terminal':connection.kind==='claude'?method!=='browser':method==='terminal'))throw new WorkbenchError('이 서비스에서 지원하지 않는 로그인 방식입니다.');
  const previous=this.sessions.get(connection.id);if(previous&&identity(previous.connection)===identity(connection)&&active(previous.attempt))return previous.attempt;
  // CLI sessions are shared by service; don't run two logins against the same store.
  if([...this.sessions.values()].some(session=>session.connection.kind===connection.kind&&session.running))throw new WorkbenchError('이 서비스의 이전 로그인 창이 종료되기를 기다리고 있습니다.',409);
  const attempt:LoginAttempt={id:randomUUID(),connectionId:connection.id,state:'starting',message:'공식 로그인 절차를 준비하고 있습니다.'};
  const session:Session={connection:structuredClone(connection),attempt,controller:new AbortController(),running:true};this.sessions.set(connection.id,session);
  const work=method==='terminal'?this.terminal(session):this.services.startLogin(connection,{method:method as 'browser'|'device-code',attemptId:attempt.id,signal:session.controller.signal,onUpdate:update=>{if(!session.controller.signal.aborted)session.attempt={...update};}}).then(account=>{if(session.controller.signal.aborted)return;session.account=account;if(account.state==='signed-in'){session.attempt={...session.attempt,state:'succeeded',message:'로그인했습니다. 작업별 모델을 배정할 수 있습니다.',authUrl:undefined,verificationUrl:undefined,userCode:undefined};}else if(active(session.attempt)){session.attempt={...session.attempt,state:'failed',message:account.detail};}});
  session.completion=work.catch(error=>{if(session.controller.signal.aborted){if(method==='terminal'&&error?.name!=='AbortError'){session.closeUnconfirmed=true;session.attempt={id:attempt.id,connectionId:connection.id,state:'failed',message:'로그인 창을 자동으로 닫지 못했습니다. 열린 Antigravity 창을 직접 닫고 작업실 서버를 다시 시작해 주세요.'};}return;}session.attempt={id:attempt.id,connectionId:connection.id,state:'failed',message:'로그인을 완료하지 못했습니다. 설치 상태를 확인하고 다시 시도해 주세요.'};}).finally(()=>{if(!session.closeUnconfirmed)session.running=false;});
  return attempt;
 }
 private async terminal(session:Session){
  const command=await this.services.resolveCli(session.connection);if(command.prefixArgs.length)throw new Error('Antigravity 실행 파일을 직접 선택해 주세요.');
  if(session.controller.signal.aborted)return;
  const cwd=join(this.directory,'login',session.attempt.id);await mkdir(cwd,{recursive:true});
  await this.services.runTerminalLogin({executable:command.executable,cwd,signal:session.controller.signal,onOpened:()=>{if(!session.controller.signal.aborted)session.attempt={...session.attempt,state:'waiting',message:'열린 Antigravity 창에서 로그인을 진행한 뒤 창을 닫아 주세요.'};}});
  if(!session.controller.signal.aborted)session.attempt={...session.attempt,state:'finished',message:'로그인 창을 닫았습니다. Antigravity는 로그인 상태 조회를 제공하지 않아 여기서 완료 여부를 확인할 수 없습니다.'};
 }
 async cancel(connectionId:string){const session=this.sessions.get(connectionId);if(!session)throw new WorkbenchError('진행 중인 로그인이 없습니다.',404);if(active(session.attempt)){session.controller.abort();session.attempt={id:session.attempt.id,connectionId,state:'cancelled',message:'이 로그인 절차를 취소했습니다.'};}await session.completion;return session.attempt;}
 async close(){for(const session of this.sessions.values())if(session.running)session.controller.abort();await Promise.allSettled([...this.sessions.values()].map(session=>session.completion));}
}
