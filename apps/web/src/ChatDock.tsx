import {useEffect,useRef,useState,type ReactNode} from 'react';
import './chat-dock.css';

export interface ChatDockState {open:boolean;sessionId:string}
export function readChatDock(key:string):ChatDockState {
 try {const value=JSON.parse(sessionStorage.getItem(key)??'null');return {open:value?.open===true,sessionId:typeof value?.sessionId==='string'?value.sessionId:''};}
 catch {return {open:false,sessionId:''};}
}
export function ChatDock({open,storageKey,children}:{open:boolean;storageKey:string;children:ReactNode}) {
 const [width,setWidth]=useState(()=>{try {const saved=Number(localStorage.getItem(storageKey+':width'));return saved>=340&&saved<=720?saved:420;}catch{return 420;}});
 const resize=useRef<{x:number;width:number}|undefined>(undefined);
 useEffect(()=>{try{localStorage.setItem(storageKey+':width',String(width));}catch{}},[width,storageKey]);
 const clamp=(value:number)=>Math.max(340,Math.min(720,value));
 return <aside id="project-chat-dock" className="chat-dock" hidden={!open} style={{width}} aria-label="AI 채팅 사이드바">
  <div className="chat-dock-resize" role="separator" aria-label="채팅 패널 너비 조절" aria-orientation="vertical" aria-valuemin={340} aria-valuemax={720} aria-valuenow={width} tabIndex={0}
   onPointerDown={event=>{resize.current={x:event.clientX,width:event.currentTarget.parentElement?.getBoundingClientRect().width??width};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}}
   onPointerMove={event=>{if(resize.current)setWidth(clamp(resize.current.width+resize.current.x-event.clientX));}}
   onPointerUp={()=>{resize.current=undefined;}} onPointerCancel={()=>{resize.current=undefined;}} onLostPointerCapture={()=>{resize.current=undefined;}}
   onDoubleClick={()=>setWidth(420)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setWidth(value=>clamp(value+(event.key==='ArrowLeft'?20:-20)));}else if(event.key==='Home'){event.preventDefault();setWidth(420);}}}/>
  {children}
 </aside>;
}
