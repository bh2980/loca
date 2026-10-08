import test from 'node:test';
import assert from 'node:assert/strict';
import {readRoute,routeUrl,validateRoute,writeRoute} from '../apps/web/src/navigation.ts';
test('document deep links round trip exact group/unit IDs and list origin without losing other URL parameters',()=>{
 const route={workspace:'demo' as const,projectId:'project:한글',page:'scene' as const,groupId:'document:RE: Helping hand',unitId:'record#1',sourcePage:3,graph:{mode:'scenes' as const,dataset:'library' as const,flow:'Gameflow Day 1'}};
 const url=routeUrl(route,'http://localhost:4318/?other=kept');assert.deepEqual(readRoute(`http://localhost:4318${url}`),route);assert.match(url,/other=kept/);
});
test('invalid or cross-project destinations recover to their own workspace graph',()=>{
 const groups=new Set(['doc']),units=new Map([['unit','doc']]);
 assert.equal(validateRoute({workspace:'main',projectId:'old',page:'scene',groupId:'doc'},'main','new',groups,units).page,'graph');
 assert.equal(validateRoute({workspace:'demo',page:'scene',groupId:'doc'},'main','new',groups,units).page,'graph');
 assert.equal(validateRoute({workspace:'main',page:'scene',groupId:'missing'},'main','new',groups,units).page,'graph');
 assert.equal(validateRoute({workspace:'main',page:'scene',groupId:'wrong',unitId:'unit'},'main','new',groups,units).groupId,'doc');
});
test('unknown pages and invalid page indexes normalize safely',()=>{
 assert.equal(readRoute('http://localhost/?view=invalid&sourcePage=-3').page,'graph');assert.equal(readRoute('http://localhost/?view=scene&sourcePage=Infinity').sourcePage,undefined);
});
test('legacy chat links open a dock without replacing the source destination or leaking session into a resource',()=>{
 const legacy=readRoute('http://localhost/?view=chat&project=work&resource=session-42');
 assert.equal(legacy.page,'graph');assert.deepEqual(legacy.legacyChat,{sessionId:'session-42'});assert.equal(legacy.resourceId,undefined);
 const canonical=routeUrl(legacy,'http://localhost/?view=chat&resource=session-42');
 assert.equal(new URL(canonical,'http://localhost').searchParams.get('view'),'graph');
 assert.equal(new URL(canonical,'http://localhost').searchParams.has('resource'),false);
 assert.equal(validateRoute(legacy,'main','other',new Set(),new Map()).legacyChat,undefined);
 const material=readRoute('http://localhost/?view=knowledge&resource=profile-42');
 assert.equal(material.resourceId,'profile-42');assert.equal(material.legacyChat,undefined);
});
test('explicit navigation pushes once and restoration replaces without adding entries',()=>{
 const originalWindow=globalThis.window,originalDocument=globalThis.document;
 let location=new URL('http://localhost/?view=graph'),pushes=0,replaces=0;
 const history={state:null as unknown,pushState(state:unknown,_title:string,url:string){this.state=state;location=new URL(url,location);pushes++;},replaceState(state:unknown,_title:string,url?:string){this.state=state;if(url)location=new URL(url,location);replaces++;}};
 Object.assign(globalThis,{window:{get location(){return location;},history},document:{querySelectorAll:()=>[]}});
 try{
  const graph={workspace:'main' as const,projectId:'p',page:'graph' as const};writeRoute(graph,'replace');
  const documentRoute={...graph,page:'scene' as const,groupId:'doc'};writeRoute(documentRoute,'push');writeRoute(documentRoute,'push');assert.equal(pushes,1);
  writeRoute(graph,'replace');assert.equal(pushes,1);assert.equal(replaces,2);assert.equal(readRoute(location.href).page,'graph');
 }finally{Object.assign(globalThis,{window:originalWindow,document:originalDocument});}
});
