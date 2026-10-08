import {useEffect,useRef,useState} from 'react';
import type {RouteGeometry,RoutePoint,RoutedEdge} from './obstacle-routing';

/** Geometry changes are coalesced; selection, pan, zoom, and job polling do not
 * invoke the router. Heavy native routing runs outside the browser UI thread. */
export function useObstacleRoutes(geometry:RouteGeometry){
 const key=JSON.stringify(geometry),worker=useRef<Worker|undefined>(undefined),sequence=useRef(0),lastKey=useRef(''),request=useRef<{key:string;geometry:RouteGeometry}>({key,geometry}),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 request.current={key,geometry};
 const [result,setResult]=useState<{key:string;paths:Record<string,RoutePoint[]>;error?:string}>({key:'',paths:{}});
 useEffect(()=>{const instance=new Worker(new URL('./obstacle-routing.worker.ts',import.meta.url),{type:'module'});worker.current=instance;
  instance.onmessage=(event:MessageEvent<{id:number;edges?:RoutedEdge[];error?:string}>)=>{if(event.data.id!==sequence.current)return;setResult({key:lastKey.current,paths:Object.fromEntries((event.data.edges??[]).map(edge=>[edge.id,edge.points])),error:event.data.error});};
  instance.onerror=event=>setResult({key:lastKey.current,paths:{},error:event.message||'연결선 라이브러리를 불러오지 못했습니다.'});
  return()=>{worker.current=undefined;if(timer.current)clearTimeout(timer.current);timer.current=undefined;instance.terminate();};
 },[]);
 useEffect(()=>{if(timer.current!==undefined)return;timer.current=setTimeout(()=>{timer.current=undefined;const latest=request.current;lastKey.current=latest.key;worker.current?.postMessage({id:++sequence.current,geometry:latest.geometry});},32);},[key]);
 // Last complete native geometry remains a faint preview while a new transaction
 // runs. Its loading/stale status is explicit; it is never reported as current.
 return {paths:result.paths,loading:result.key!==key,stale:result.key!==key,error:result.key===key?result.error:undefined};
}
