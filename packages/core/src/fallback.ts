/** Only provider/transport failures qualify. Never infer retryability from model output. */
export function isTransientProviderFailure(error:unknown):boolean {
 if(!error||typeof error!=='object')return false;
 const {code,message}=error as {code?:string;message?:string};
 if(['timeout','api-network-error','rate-limit','service-unavailable','ECONNRESET','ETIMEDOUT','ECONNREFUSED','EAI_AGAIN'].includes(code??''))return true;
 if(['api-http-error','model-list-http-error'].includes(code??''))return /\b(?:408|429|500|502|503|504)\b/.test(message??'');
 // Legacy fetch/injected network errors; structured validation errors never reach this branch.
 return !code&&/^(?:fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|timeout)(?:\b|$)/i.test(message??'');
}
