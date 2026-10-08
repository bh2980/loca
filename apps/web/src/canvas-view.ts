import type {CanvasViewport} from './canvas-types.js';

const STORAGE_KEY='workbench.canvas.views.v8';
interface SavedViewport {signature:string;view:CanvasViewport;updatedAt:number}
export const validViewport=(value:unknown):value is CanvasViewport=>!!value&&typeof value==='object'&&['x','y','k'].every(key=>Number.isFinite((value as Record<string,unknown>)[key]))&&(value as CanvasViewport).k>0;
/** Navigation snapshots and canvas storage must obey the same geometry check. */
export const compatibleViewport=(value:unknown,signature:string):value is CanvasViewport=>validViewport(value)&&value.layoutSignature===signature;
/** An explicit locate request made during layout wins over the earlier saved
 * viewport. A reload/history restore with no new request keeps its exact pan. */
export function focusAfterLayout(focusId:string|undefined,focusToken:number|undefined,targetExists:boolean,alreadyHandled:boolean,hasRestoredViewport:boolean){return !!focusId&&targetExists&&(!hasRestoredViewport||focusToken!==undefined&&!alreadyHandled);}
export function readCanvasView(scope:string,signature:string):CanvasViewport|undefined{
 try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)??'{}')[scope] as SavedViewport|undefined;return value?.signature===signature&&validViewport(value.view)?value.view:undefined;}catch{return undefined;}
}
export function saveCanvasView(scope:string,signature:string,view:CanvasViewport){
 if(!validViewport(view))return;
 try{const all=JSON.parse(localStorage.getItem(STORAGE_KEY)??'{}') as Record<string,SavedViewport>;all[scope]={signature,view,updatedAt:Date.now()};localStorage.setItem(STORAGE_KEY,JSON.stringify(Object.fromEntries(Object.entries(all).sort((a,b)=>b[1].updatedAt-a[1].updatedAt).slice(0,30))));}catch{/* Optional storage: private mode and quota cannot prevent navigation. */}
}
