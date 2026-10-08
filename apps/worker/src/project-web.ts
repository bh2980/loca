import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isLocalApiHost, type WebSearchSettings } from '@workbench/contracts';
import { ProviderError } from '@workbench/providers';

export interface WebResult {url:string;title:string;excerpt:string}
export interface WebSearchResult {query:string;results:WebResult[];returned:number;available:number;retrievedAt:string;truncated:boolean;service:'searxng'}
export interface WebPageResult {url:string;text:string;retrievedAt:string;truncated:boolean}
export interface ProjectWeb {
 search(settings:WebSearchSettings,args:{query:string;limit?:number},signal:AbortSignal):Promise<WebSearchResult>;
 readPage?(url:string,signal:AbortSignal):Promise<WebPageResult>;
}
function error(code:string,message:string):never {throw new ProviderError(code,message);}
function configuredUrl(settings:WebSearchSettings){
 if(settings.kind!=='searxng')error('web-settings','지원하지 않는 웹 검색 서비스입니다.');
 let url:URL;try{url=new URL(settings.baseUrl);}catch{error('web-settings','검색 서비스 주소가 잘못되었습니다.');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||(url.protocol==='http:'&&!isLocalApiHost(url.hostname)))error('web-settings','검색 서비스는 HTTPS 또는 설정한 로컬 HTTP 주소여야 합니다.');
 url.pathname=url.pathname.replace(/\/+$/,'')+'/search';return url;
}
export function publicWebUrl(value:string):URL {
 let url:URL;try{url=new URL(value);}catch{error('web-url','웹 페이지 주소가 잘못되었습니다.');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!host.includes('.')||host.startsWith('[')|| (isIP(host)&&!publicAddress(host)))error('web-url','공개 HTTPS 웹 페이지 주소만 읽을 수 있습니다.');
 url.hash='';return url;
}
function publicAddress(address:string):boolean {
 if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));}
 if(isIP(address)===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:db8|0):/i.test(address);
 return false;
}
async function boundedText(response:Response,signal:AbortSignal){
 if(!response.ok)error('web-http',`웹 검색 서비스가 HTTP ${response.status}로 실패했습니다. JSON 검색 지원과 서비스 설정을 확인하세요.`);
 const reader=response.body?.getReader();if(!reader)error('web-response','검색 응답이 비어 있습니다.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){if(signal.aborted)error('cancelled','웹 조사를 중지했습니다.');const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1024*1024)error('web-output-limit','웹 검색 응답 크기 제한을 초과했습니다.');chunks.push(chunk.value);}return Buffer.concat(chunks).toString('utf8');}
 finally {if(signal.aborted||size>1024*1024)void reader.cancel().catch(()=>{});}
}
async function readPublicPage(value:string,signal:AbortSignal):Promise<WebPageResult>{
 const url=publicWebUrl(value);if(signal.aborted)error('cancelled','웹 조사를 중지했습니다.');
 const addresses=await lookup(url.hostname,{all:true});
 if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))error('web-url','사설망·예약 주소로 연결되는 웹 페이지는 읽을 수 없습니다.');
 const target=addresses[0];
 const html=await new Promise<string>((resolve,reject)=>{
  const req=httpsRequest(url,{method:'GET',signal,headers:{Accept:'text/html,text/plain'},family:target.family,lookup:(_host,_options,callback)=>callback(null,target.address,target.family as 4|6)},res=>{
   if(res.statusCode!==200){res.destroy();reject(new ProviderError('web-http',`웹 페이지가 HTTP ${res.statusCode??0}로 실패했습니다. 리디렉션은 자동으로 열지 않습니다.`));return;}
   if(!/^text\/(html|plain)(?:;|$)/i.test(res.headers['content-type']??'')){res.destroy();reject(new ProviderError('web-content-type','HTML 또는 일반 텍스트 페이지만 읽을 수 있습니다.'));return;}
   const chunks:Buffer[]=[];let size=0;
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1024*1024){res.destroy();reject(new ProviderError('web-output-limit','웹 페이지 크기 제한을 초과했습니다.'));}else chunks.push(chunk);});
   res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));res.on('error',()=>reject(new ProviderError('web-network','웹 페이지 본문을 읽지 못했습니다.')));
  });
  req.setTimeout(15000,()=>req.destroy(new ProviderError('web-timeout','웹 페이지 읽기 제한 시간을 초과했습니다.')));
  req.on('error',failure=>reject(failure instanceof ProviderError?failure:new ProviderError(signal.aborted?'cancelled':'web-network',signal.aborted?'웹 조사를 중지했습니다.':'웹 페이지에 연결하지 못했습니다.')));req.end();
 });
 const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim();
 return {url:url.href,text:text.slice(0,80000),retrievedAt:new Date().toISOString(),truncated:text.length>80000};
}

/** Search service credentials never flow to pages, model providers, redirects or logs. */
export function createProjectWeb(options:{fetch?:typeof fetch;credential?:(id:string)=>string|undefined;readPage?:ProjectWeb['readPage']}={}):ProjectWeb {
 return {readPage:options.readPage??readPublicPage,async search(settings,args,signal){
  if(typeof args.query!=='string'||!args.query.trim()||args.query.length>1000)error('web-query','웹 검색어는 1~1000자여야 합니다.');
  const limit=args.limit??Math.min(settings.maxResults??5,10);
  if(!Number.isInteger(limit)||limit<1||limit>10||(settings.maxResults!==undefined&&(!Number.isInteger(settings.maxResults)||settings.maxResults<1||settings.maxResults>20)))error('web-settings','웹 검색 도구 결과는 1~10개, 서비스 설정 한도는 1~20개여야 합니다.');
  const url=configuredUrl(settings);url.searchParams.set('q',args.query);url.searchParams.set('format','json');
  const headers:Record<string,string>={Accept:'application/json'};
  if(settings.credentialId){const key=options.credential?.(settings.credentialId);if(!key?.trim()||/[\r\n\0]/.test(key))error('web-credential','웹 검색 서비스 인증을 연결하세요.');headers.Authorization=`Bearer ${key}`;}
  try{
   const response=await (options.fetch??fetch)(url,{headers,signal,redirect:'error'});
   let data:unknown;try{data=JSON.parse(await boundedText(response,signal));}catch(failure){if(failure instanceof ProviderError)throw failure;error('web-response','웹 검색 응답 JSON이 잘못되었습니다.');}
   const results=(data as {results?:unknown[]})?.results;if(!Array.isArray(results))error('web-response','검색 결과 목록이 없습니다.');
   const available:WebResult[]=[];
   for(const raw of results){const item=raw as {url?:unknown;title?:unknown;content?:unknown};if(typeof item?.url!=='string'||typeof item.title!=='string')continue;let link:URL;try{link=publicWebUrl(item.url);}catch{continue;}available.push({url:link.href,title:item.title.slice(0,1000),excerpt:typeof item.content==='string'?item.content.slice(0,4000):''});}
   const selected=available.slice(0,Math.min(limit,settings.maxResults??10));
   return {query:args.query,results:selected,returned:selected.length,available:available.length,truncated:selected.length<available.length,retrievedAt:new Date().toISOString(),service:'searxng'};
  }catch(failure){if(failure instanceof ProviderError)throw failure;error(signal.aborted?'cancelled':'web-network',signal.aborted?'웹 조사를 중지했습니다.':'웹 검색 서비스에 연결하지 못했습니다.');}
 }};
}
