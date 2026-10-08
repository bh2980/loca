import wasmURL from '../../../node_modules/libavoid-js/dist/libavoid.wasm?url';
import {routeObstacles,type RouteGeometry} from './obstacle-routing';
let pending:{id:number;geometry:RouteGeometry}|undefined,running=false;
async function drain(){
 if(running)return;running=true;
 try{while(pending){const request=pending;pending=undefined;try{const edges=await routeObstacles(request.geometry,wasmURL);if(!pending)postMessage({id:request.id,edges});}catch(error){if(!pending)postMessage({id:request.id,error:(error as Error).message});}}}finally{running=false;}
}
self.onmessage=(event:MessageEvent<{id:number;geometry:RouteGeometry}>)=>{pending=event.data;void drain();};
