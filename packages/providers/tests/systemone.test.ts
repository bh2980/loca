import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {getSystemOneModels,ProviderError,systemOneUrl,type ProviderRequest} from '../src/index.js';
import {invokeSystemOne as invokeProvider} from '../src/systemone.js';

const schema={type:'object',properties:{translations:{type:'array',items:{type:'object',properties:{unitId:{type:'string'},text:{type:'string'},issues:{type:'array',items:{type:'string'}}},required:['unitId','text','issues'],additionalProperties:false}}},required:['translations'],additionalProperties:false};
function request(baseUrl:string):ProviderRequest{return {connection:{id:'jev',name:'TypeSafe Jev',kind:'systemone',baseUrl},credential:'fake-test-key',profile:{connectionId:'jev',model:'user-selected-alias',effort:'',timeoutMs:4000,maxOutputTokens:500,maxAttempts:1},prompt:'MUST NOT BE SENT AS A GENERATION PROMPT',schema,context:{stage:'review',targets:[{id:'line-1',source:'Keep the code {id}.',currentTranslation:'암호 {id}를 보관하세요.'}],terms:[],knowledge:[]}};}
const goodAnswer=()=>({type:'choice',choice:'pass',confidence:0.95,probabilities:{pass:0.95,issue:0.03,uncertain:0.02}});
function goodResponse(body:any){return {model:'provider-resolved-model',usage:{input_tokens:120,output_tokens:12},answers:Object.fromEntries(Object.keys(body.questions).map(key=>[key,goodAnswer()]))};}
async function serve(handler:(request:IncomingMessage,response:ServerResponse,body:any)=>void|Promise<void>,fn:(base:string)=>Promise<void>){
 const server=createServer((req,res)=>{void(async()=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const text=Buffer.concat(chunks).toString();await handler(req,res,text?JSON.parse(text):undefined);})().catch(error=>{res.statusCode=500;res.end(String(error));});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{await fn(`http://127.0.0.1:${address.port}/v1`);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

test('SystemOne sends official choice wire format and preserves original candidate exactly',async()=>{
 await serve((req,res,body)=>{
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/systemone');assert.equal(req.headers.authorization,'Bearer fake-test-key');
  assert.deepEqual(Object.keys(body).sort(),['model','questions','state']);assert.equal(body.model,'user-selected-alias');
  assert.equal(Object.keys(body.questions).length,4);assert.ok(Object.values(body.questions).every((q:any)=>q.type==='choice'&&Object.keys(q.criteria).length===3));
  assert.ok(!JSON.stringify(body).includes('MUST NOT BE SENT'));assert.equal(body.state.targets[0].currentTranslation,'수정안 {id}입니다.');
  res.end(JSON.stringify(goodResponse(body)));
 },async base=>{
  const input=request(base);(input.context!.targets as any[])[0].pendingDraft='수정안 {id}입니다.';
  const result=await invokeProvider(input);
  assert.deepEqual(result.data,{translations:[{unitId:'line-1',text:'수정안 {id}입니다.',issues:[]}]});
  assert.deepEqual(result.usage,{inputTokens:120,outputTokens:12});assert.equal(result.reportedModel,'provider-resolved-model');assert.equal(result.reportedEffort,undefined);
 });
});

test('concrete issues and uncertain judgments become bounded Korean issues, never new translation',async()=>{
 await serve((_req,res,body)=>{
  const response=goodResponse(body),keys=Object.keys(response.answers);
  response.answers[keys[0]]={type:'choice',choice:'issue',confidence:0.91,probabilities:{pass:0.02,issue:0.91,uncertain:0.07}};
  response.answers[keys[1]]={type:'choice',choice:'pass',confidence:0.6,probabilities:{pass:0.6,issue:0.1,uncertain:0.3}};
  response.answers[keys[2]]={type:'choice',choice:'uncertain',confidence:0.9,probabilities:{pass:0.06,issue:0.04,uncertain:0.9}};
  res.end(JSON.stringify(response));
 },async base=>{
  const result=await invokeProvider(request(base)),row=(result.data as any).translations[0];
  assert.equal(row.text,'암호 {id}를 보관하세요.');assert.equal(row.issues.length,3);assert.match(row.issues[0],/^TypeSafe 판정:/);assert.match(row.issues[1],/^TypeSafe 판정 보류:/);
 });
});

test('SystemOne preserves the reviewed text candidate attribution using the task schema',async()=>{
 const candidateSchema=structuredClone(schema) as any;
 candidateSchema.properties.translations.items.properties.termUsages={type:'array',items:{type:'object',properties:{termId:{type:'string'},candidateId:{type:'string'},candidateVersion:{type:'integer',minimum:1}},required:['termId','candidateId','candidateVersion'],additionalProperties:false}};
 candidateSchema.properties.translations.items.required.push('termUsages');
 const current={termId:'code',candidateId:'code:default',candidateVersion:1,origin:'observed'};
 const pending={termId:'code',candidateId:'code:password',candidateVersion:3,origin:'model'};
 await serve((_req,res,body)=>{
  assert.deepEqual(body.state.targets[0].termUsages,[pending]);
  assert.ok(body.questions.u0_terms.instructions.includes('conditional guidance'));
  res.end(JSON.stringify(goodResponse(body)));
 },async base=>{
  const input=request(base);input.schema=candidateSchema;
  Object.assign((input.context!.targets as any[])[0],{termUsages:[current],pendingDraft:'비밀번호 {id}를 보관하세요.',pendingTermUsages:[pending]});
  const row=(await invokeProvider(input)).data as any;
  assert.deepEqual(row.translations[0].termUsages,[{termId:'code',candidateId:'code:password',candidateVersion:3}]);
  assert.equal(row.translations[0].text,'비밀번호 {id}를 보관하세요.');
 });
 await serve((_req,res,body)=>{res.end(JSON.stringify(goodResponse(body)));},async base=>{
  const input=request(base);input.schema=candidateSchema;(input.context!.targets as any[])[0].termUsages=[current];
  assert.deepEqual(((await invokeProvider(input)).data as any).translations[0].termUsages,[{termId:'code',candidateId:'code:default',candidateVersion:1}]);
  (input.context!.targets as any[])[0].pendingDraft='다른 수정안 {id}';
  assert.deepEqual(((await invokeProvider(input)).data as any).translations[0].termUsages,[],'a pending draft without attribution cannot inherit the current text selection');
 });
});

test('invalid judgment keys, probabilities, model and usage never reach the engine',async()=>{
 const mutations=[
  (r:any)=>{delete r.answers.u0_meaning;},(r:any)=>{r.answers.unknown=goodAnswer();},
  (r:any)=>{r.answers.u0_meaning.type='noul';},(r:any)=>{r.answers.u0_meaning.choice='invented';},
  (r:any)=>{r.answers.u0_meaning.confidence=1.1;},(r:any)=>{r.answers.u0_meaning.probabilities.pass=-1;},
  (r:any)=>{r.answers.u0_meaning.probabilities.pass=0.1;},(r:any)=>{r.answers.u0_meaning.choice='issue';},
  (r:any)=>{r.model='';},(r:any)=>{r.usage.input_tokens=-1;},(r:any)=>{r.usage.output_tokens=1.5;},(r:any)=>{r.answers.u0_meaning.probabilities.extra=0;},
 ];
 for(const mutate of mutations)await serve((_req,res,body)=>{const response=goodResponse(body);mutate(response);res.end(JSON.stringify(response));},async base=>{
  await assert.rejects(invokeProvider(request(base)),error=>error instanceof ProviderError&&error.code==='invalid-judgment');
 });
});

test('effort, wrong stage, missing candidate and missing credential fail before any API call',async()=>{
 let calls=0;
 await serve((_req,res)=>{calls++;res.end('{}');},async base=>{
  for(const mutate of [(r:ProviderRequest)=>{r.profile.effort='medium';},(r:ProviderRequest)=>{r.context!.stage='translate';},(r:ProviderRequest)=>{(r.context!.targets as any[])[0].currentTranslation='';},(r:ProviderRequest)=>{r.credential=undefined;},(r:ProviderRequest)=>{r.context=undefined;}]){
   const input=request(base);mutate(input);await assert.rejects(invokeProvider(input),ProviderError);
  }
  assert.equal(calls,0);
 });
});

test('model discovery uses authenticated GET models[].name and validates metadata',async()=>{
 await serve((req,res)=>{assert.equal(req.method,'GET');assert.equal(req.url,'/v1/models');assert.equal(req.headers.authorization,'Bearer fake-test-key');res.end(JSON.stringify({models:[{name:'advertised-model',description:'test',release_date:'2026-09-15'}]}));},async base=>{
  assert.deepEqual((await getSystemOneModels(request(base).connection,'fake-test-key')).models,[{id:'advertised-model',name:'advertised-model',efforts:[],effortSupport:'unsupported'}]);
 });
 await serve((_req,res)=>{res.end('{"models":[{"id":"wrong-wire-format"}]}');},async base=>{
  await assert.rejects(getSystemOneModels(request(base).connection,'fake-test-key'),error=>error instanceof ProviderError&&error.code==='invalid-model-list');
 });
});

test('HTTP errors are redacted; cancellation and timeout remain distinguishable',async()=>{
 await serve((_req,res)=>{res.statusCode=401;res.end('fake-test-key raw-secret-body');},async base=>{
  await assert.rejects(invokeProvider(request(base)),error=>error instanceof ProviderError&&error.code==='api-http-error'&&!error.message.includes('raw-secret'));
 });
 await serve(()=>{},async base=>{
  const input=request(base);input.profile.timeoutMs=20;
  await assert.rejects(invokeProvider(input),error=>error instanceof ProviderError&&error.code==='timeout');
  const controller=new AbortController();controller.abort();input.signal=controller.signal;
  await assert.rejects(invokeProvider(input),error=>error instanceof ProviderError&&error.code==='cancelled');
 });
});

test('official default and explicitly configured secure compatible endpoints retain their paths',()=>{
 const connection=request('https://configured.example/v1').connection;
 assert.equal(systemOneUrl({...connection,baseUrl:undefined},'systemone').href,'https://api.typesafe.ai/v1/systemone');
 assert.equal(systemOneUrl(connection,'models').href,'https://configured.example/v1/models');
 for(const baseUrl of ['http://remote.example/v1','https://user:password@example.test/v1','https://example.test/v1?key=secret'])assert.throws(()=>systemOneUrl({...connection,baseUrl},'systemone'),ProviderError);
});
