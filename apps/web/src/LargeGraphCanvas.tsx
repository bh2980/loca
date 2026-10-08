import { Button } from './components/ui/button';
import {memo,useEffect,useId,useMemo,useRef,useState} from 'react';
import {select} from 'd3-selection';
import {zoom,zoomIdentity,type D3ZoomEvent,type ZoomBehavior} from 'd3-zoom';
import type {CanvasNode,FlowCanvasProps,CanvasViewport} from './canvas-types';
import {paintNodePath,prepareOverviewRaster,overviewRasterScale,type OverviewRaster} from './canvas-overview';
import {readCanvasView,saveCanvasView,compatibleViewport,focusAfterLayout} from './canvas-view';
import {graphStructureSignature,type LayoutEdge,type LayoutNode,type LayoutResult} from './flow-layout';
import {CELL_SIZE,boundsIntersect,hitTestNode,hitTestEdge,indexNodes,queryVisibleNodes,indexEdges,queryVisibleEdges,type EdgeIndex,type CanvasBounds} from './canvas-geometry';
import './large-graph-canvas.css';

type View=CanvasViewport;
interface Scene {layout:LayoutResult;nodes:Map<string,LayoutNode>;cells:Map<string,LayoutNode[]>;edgeIndex:EdgeIndex;bounds:CanvasBounds;ordered:LayoutNode[];connected:Set<string>;externalCount:number}
interface SavedView {signature:string;layout:LayoutResult;view:View}
const savedViews=new Map<string,SavedView>(),MIN_ZOOM=.00001,MAX_ZOOM=2;
function saveView(scope:string,value:SavedView){saveCanvasView(scope,value.signature,value.view);savedViews.delete(scope);savedViews.set(scope,value);while(savedViews.size>3)savedViews.delete(savedViews.keys().next().value!);}
function prepareScene(layout:LayoutResult,items:Map<string,CanvasNode>):Scene{
 const nodes=new Map(layout.nodes.map(node=>[node.id,node])),cells=indexNodes(layout.nodes),edgeIndex=indexEdges(layout.edges),bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
 for(const node of layout.nodes){
  bounds.left=Math.min(bounds.left,node.x);bounds.top=Math.min(bounds.top,node.y);bounds.right=Math.max(bounds.right,node.x+node.width);bounds.bottom=Math.max(bounds.bottom,node.y+node.height);
 }
 for(const route of edgeIndex.bounds){bounds.left=Math.min(bounds.left,route.left);bounds.top=Math.min(bounds.top,route.top);bounds.right=Math.max(bounds.right,route.right);bounds.bottom=Math.max(bounds.bottom,route.bottom);}
 if(!layout.nodes.length)Object.assign(bounds,{left:0,top:0,right:1,bottom:1});
 const incoming=new Set(layout.edges.filter(edge=>!edge.secondary).map(edge=>edge.to));
 const ordered=layout.nodes.filter(node=>!node.external).sort((a,b)=>{
  const aa=items.get(a.id),bb=items.get(b.id);
  return Number(incoming.has(a.id))-Number(incoming.has(b.id))||(aa?.order??Infinity)-(bb?.order??Infinity)||a.y-b.y||a.x-b.x;
 });
 return {layout,nodes,cells,bounds,ordered,edgeIndex,connected:new Set(layout.edges.flatMap(edge=>[edge.from,edge.to])),externalCount:layout.nodes.filter(node=>node.external).length};
}
function worldBounds(view:View,width:number,height:number,padding=0):CanvasBounds{return {left:(-view.x-padding)/view.k,top:(-view.y-padding)/view.k,right:(width-view.x+padding)/view.k,bottom:(height-view.y+padding)/view.k};}
function clipText(context:CanvasRenderingContext2D,text:string,width:number){
 if(context.measureText(text).width<=width)return text;
 let left=0,right=text.length;
 while(left<right){const middle=Math.ceil((left+right)/2);if(context.measureText(text.slice(0,middle)+'…').width<=width)left=middle;else right=middle-1;}
 return text.slice(0,left)+'…';
}
const hasConditions=(conditions:unknown)=>conditions!==undefined&&conditions!==null&&(Array.isArray(conditions)?conditions.length>0:typeof conditions==='object'?Object.keys(conditions).length>0:conditions!=='');
interface Palette {bg:string;panel:string;line:string;text:string;muted:string;accent:string;condition:string}
function nodePath(context:CanvasRenderingContext2D,node:LayoutNode,shape:CanvasNode['shape'],rounded:boolean){paintNodePath(context,node.shape===shape?node:{...node,shape},rounded);}

/** Canvas owns drawing; D3 owns the transform. React renders only the controls. */
export const LargeGraphCanvas=memo(function LargeGraphCanvas(props:FlowCanvasProps){
 const propsRef=useRef(props);propsRef.current=props;
 const items=useMemo(()=>new Map(props.nodes.map(node=>[node.id,node])),[props.nodes]),itemsRef=useRef(items);itemsRef.current=items;
 const conditionIds=useMemo(()=>new Set(props.edges.filter(edge=>hasConditions(edge.conditions)).map(edge=>edge.id)),[props.edges]),conditionKey=[...conditionIds].join('|');
 const edgeItems=useMemo(()=>new Map(props.edges.map(edge=>[edge.id,edge])),[props.edges]),edgeItemsRef=useRef(edgeItems);edgeItemsRef.current=edgeItems;
 const signature=useMemo(()=>graphStructureSignature(props.nodes,props.edges),[props.nodes,props.edges]);
 const [layout,setLayout]=useState<LayoutResult>(),[busy,setBusy]=useState(true),[error,setError]=useState(''),[generation,setGeneration]=useState(0),[miniMapOpen,setMiniMapOpen]=useState(true),[helpOpen,setHelpOpen]=useState(false),[overviewPending,setOverviewPending]=useState(false),overviewPendingRef=useRef(false);
 const helpId=useId(),surface=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),miniMap=useRef<HTMLCanvasElement>(null),tools=useRef<HTMLDivElement>(null),counts=useRef<HTMLSpanElement>(null);
 const sceneRef=useRef<Scene|undefined>(undefined),viewRef=useRef<View>({x:0,y:0,k:1}),sizeRef=useRef({width:800,height:600,dpr:1}),behaviorRef=useRef<ZoomBehavior<HTMLCanvasElement,unknown>|undefined>(undefined),frameRef=useRef<number|undefined>(undefined),busyRef=useRef(true),signatureRef=useRef(signature),miniProjection=useRef({x:0,y:0,k:1});
 const paletteRef=useRef<Palette>({bg:'#10161c',panel:'#202c36',line:'#40505d',text:'#dce6ef',muted:'#90a1b0',accent:'#67b7ed',condition:'#d9a557'});
 const metrics=useRef({count:0,max:0}),drawRef=useRef<()=>void>(()=>{}),loadedRef=useRef({scope:props.scopeKey,signature});
 const overviewRef=useRef<{scene:Scene;scale:number;palette:Palette;key:string;raster:OverviewRaster}[]>([]);
 const miniBase=useRef<{scene:Scene;width:number;height:number;dpr:number;palette:Palette;bitmap:HTMLCanvasElement}|undefined>(undefined);
 signatureRef.current=signature;busyRef.current=busy||overviewPending;
 const requestDraw=()=>{if(frameRef.current!==undefined)return;frameRef.current=requestAnimationFrame(()=>{frameRef.current=undefined;drawRef.current();});};
 const overviewRaster=(scene:Scene,scale:number)=>{const palette=paletteRef.current,key=conditionKey+':'+!!propsRef.current.showSecondaryEdges;let cached=overviewRef.current.find(value=>value.scene===scene&&value.scale===scale&&value.palette===palette&&value.key===key);if(!cached){const raster=prepareOverviewRaster(scene.layout,scene.bounds,scale,palette,conditionIds,!!propsRef.current.showSecondaryEdges,requestDraw);cached={scene,scale,palette,key,raster};overviewRef.current.push(cached);while(overviewRef.current.length>2)overviewRef.current.shift()!.raster.cancel();}return cached.raster;};
 const remember=(notify=true)=>{const scene=sceneRef.current;if(scene){const view={...viewRef.current,layoutSignature:loadedRef.current.signature};saveView(loadedRef.current.scope,{signature:loadedRef.current.signature,layout:scene.layout,view});if(notify)propsRef.current.onViewportChange?.(view);}};
 const setView=(view:View)=>{
  const behavior=behaviorRef.current,element=canvas.current;
  if(behavior&&element)select(element).call(behavior.transform,zoomIdentity.translate(view.x,view.y).scale(Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,view.k))));
  else{viewRef.current=view;requestDraw();remember();}
 };
 const readingArea=()=>{
  const {width,height}=sizeRef.current,bounds=surface.current?.getBoundingClientRect(),toolbar=tools.current?.getBoundingClientRect();
  const right=width-Math.min(Math.max(0,propsRef.current.rightInset??0),Math.max(0,width-260))-24;
  const toolRight=bounds&&toolbar?toolbar.right-bounds.left+20:300,beside=right-toolRight>220;
  return {left:beside?toolRight:24,right,top:beside?28:Math.min((toolbar?.height??160)+30,height-160),bottom:height-36};
 };
 const fitAll=()=>{
  const scene=sceneRef.current;if(!scene?.layout.nodes.length)return;
  const area=readingArea(),bounds=scene.bounds,k=Math.max(MIN_ZOOM,Math.min(1,(area.right-area.left)/(bounds.right-bounds.left+180),(area.bottom-area.top)/(bounds.bottom-bounds.top+180)));
  setView({x:(area.left+area.right)/2-(bounds.left+bounds.right)/2*k,y:(area.top+area.bottom)/2-(bounds.top+bounds.bottom)/2*k,k});
 };
 const readNode=(id?:string)=>{
  const scene=sceneRef.current,node=(id?scene?.nodes.get(id):undefined)??scene?.ordered.find(node=>scene.connected.has(node.id))??scene?.ordered[0];if(!node)return;
  const area=readingArea(),k=Math.max(.65,Math.min(.95,(area.right-area.left)/(node.width+40),(area.bottom-area.top)/(node.height+40)));
  setView({x:(area.left+area.right)/2-(node.x+node.width/2)*k,y:(area.top+area.bottom)/2-(node.y+node.height/2)*k,k});
 };
 const zoomBy=(factor:number)=>{if(canvas.current&&behaviorRef.current)select(canvas.current).call(behaviorRef.current.scaleBy,factor);};
 const nodeAt=(clientX:number,clientY:number)=>{
  const scene=sceneRef.current,bounds=canvas.current?.getBoundingClientRect();if(!scene||!bounds)return;
  const view=viewRef.current,x=(clientX-bounds.left-view.x)/view.k,y=(clientY-bounds.top-view.y)/view.k;
  return hitTestNode(scene.cells.get(`${Math.floor(x/CELL_SIZE)}:${Math.floor(y/CELL_SIZE)}`)??[],x,y);
 };
 const edgeAt=(clientX:number,clientY:number)=>{
  const scene=sceneRef.current,bounds=canvas.current?.getBoundingClientRect();if(!scene||!bounds||!propsRef.current.onSelectEdge)return;
  const view=viewRef.current,x=(clientX-bounds.left-view.x)/view.k,y=(clientY-bounds.top-view.y)/view.k,tolerance=7/view.k;
  const visible=queryVisibleEdges(scene.layout.edges,scene.edgeIndex,{left:x-tolerance,top:y-tolerance,right:x+tolerance,bottom:y+tolerance}).filter(edge=>!edge.secondary||propsRef.current.showSecondaryEdges||edge.from===propsRef.current.selectedId||edge.to===propsRef.current.selectedId||edge.id===propsRef.current.selectedEdgeId);
  return hitTestEdge(visible,x,y,tolerance);
 };
 const moveSelection=(direction:number)=>{
  const scene=sceneRef.current;if(!scene)return;
  const index=scene.ordered.findIndex(node=>node.id===propsRef.current.selectedId),next=scene.ordered[Math.max(0,Math.min(scene.ordered.length-1,index+direction))];
  if(next){propsRef.current.onSelect(next.id);readNode(next.id);}
 };

 drawRef.current=()=>{
  const element=canvas.current,scene=sceneRef.current,context=element?.getContext('2d');if(!element||!scene||!context)return;
  const started=performance.now(),{width,height,dpr}=sizeRef.current,view=viewRef.current,palette=paletteRef.current,source=propsRef.current;
  context.setTransform(dpr,0,0,dpr,0,0);context.fillStyle=palette.bg;context.fillRect(0,0,width,height);
  const bounds=worldBounds(view,width,height,24),whole=bounds.left<=scene.bounds.left&&bounds.right>=scene.bounds.right&&bounds.top<=scene.bounds.top&&bounds.bottom>=scene.bounds.bottom,visible=whole?scene.layout.nodes:queryVisibleNodes(scene.layout.nodes,scene.cells,bounds),rasterScale=overviewRasterScale(scene.bounds,view.k,dpr),overview=rasterScale?overviewRaster(scene,rasterScale):undefined,cached=overview?.ready;
  const waitForOverview=!!overview&&!cached&&visible.length>1000;if(overviewPendingRef.current!==waitForOverview){overviewPendingRef.current=waitForOverview;setOverviewPending(waitForOverview);}if(waitForOverview){for(const target of [element,surface.current])if(target)Object.assign(target.dataset,{drawingMode:'preparing-overview',overviewReady:'false',overviewPrepMs:overview!.prepMs.toFixed(2),overviewMaxBatchMs:overview!.maxBatchMs.toFixed(2)});return;}
  if(cached){context.drawImage(overview.bitmap,view.x+overview.left*view.k,view.y+overview.top*view.k,overview.bitmap.width*view.k/overview.scale,overview.bitmap.height*view.k/overview.scale);}
  context.setTransform(dpr*view.k,0,0,dpr*view.k,dpr*view.x,dpr*view.y);
  context.lineWidth=1/view.k;context.strokeStyle=palette.line;context.globalAlpha=.45;
  for(const section of scene.layout.sections??[])if(boundsIntersect({left:section.x,top:section.y,right:section.x+section.width,bottom:section.y+section.height},bounds))context.strokeRect(section.x,section.y,section.width,section.height);
  const routes:LayoutEdge[][]=[[],[],[],[]];let visibleEdges=0;
  (whole?scene.layout.edges:queryVisibleEdges(scene.layout.edges,scene.edgeIndex,bounds)).forEach(edge=>{
   const incident=edge.from===source.selectedId||edge.to===source.selectedId||edge.id===source.selectedEdgeId;
   if(edge.secondary&&!source.showSecondaryEdges&&!incident)return;
   if(!cached||incident)routes[incident?3:edge.secondary?2:conditionIds.has(edge.id)?1:0].push(edge);visibleEdges++;
  });
  routes.forEach((edges,index)=>{
   context.beginPath();context.strokeStyle=index===3?palette.accent:index===1?palette.condition:palette.muted;context.lineWidth=(index===3?2.4:1)/view.k;context.globalAlpha=index===3?.95:view.k<.2?.2:index===2?.25:.5;context.setLineDash(index===2?[2/view.k,5/view.k]:[]);
   for(const edge of edges){edge.points.forEach((point,index)=>index?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y));}
   context.stroke();
   if(view.k>.25){context.fillStyle=context.strokeStyle;
    const arrow=(end:{x:number;y:number},previous:{x:number;y:number})=>{const angle=Math.atan2(end.y-previous.y,end.x-previous.x),size=6/view.k;context.beginPath();context.moveTo(end.x,end.y);context.lineTo(end.x-size*Math.cos(angle-.5),end.y-size*Math.sin(angle-.5));context.lineTo(end.x-size*Math.cos(angle+.5),end.y-size*Math.sin(angle+.5));context.closePath();context.fill();};
    for(const edge of edges){const item=edgeItemsRef.current.get(edge.id),mode=item?.arrow??(['directed','mutual','undirected'].includes(String(item?.direction))?item?.direction:'directed');if(mode==='undirected')continue;const end=edge.points.at(-1),previous=edge.points.at(-2);if(end&&previous)arrow(end,previous);if(mode==='mutual'&&edge.points.length>1)arrow(edge.points[0],edge.points[1]);}
   }
  });
  context.setLineDash([]);context.globalAlpha=1;
  if(view.k>.35){context.font=`11px system-ui, sans-serif`;context.textAlign='center';
   for(const edge of routes.flat()){
    const label=edgeItemsRef.current.get(edge.id)?.label;if(!label)continue;
    const center=edge.points[Math.floor(edge.points.length/2)];if(!center)continue;
    const text=clipText(context,label,180),width=context.measureText(text).width;
    context.fillStyle=palette.bg;context.fillRect(center.x-width/2-5,center.y-15,width+10,19);context.fillStyle=edge.id===source.selectedEdgeId?palette.accent:palette.text;context.fillText(text,center.x,center.y-2);
   }
   context.textAlign='left';
  }
  if(view.k<=.25){
   // Overview paints a handful of batches, rather than fill/stroke calls for
   // every retained record. Shape semantics and IDs remain unchanged.
   const groups:LayoutNode[][]=[[],[],[]];
   for(const node of visible){const group=node.id===source.selectedId?2:itemsRef.current.get(node.id)?.active?1:0;if(!cached||group)groups[group].push(node);}
   groups.forEach((nodes,index)=>{context.beginPath();for(const node of nodes)nodePath(context,node,node.shape??itemsRef.current.get(node.id)?.shape,false);context.fillStyle=index?palette.accent:palette.panel;context.strokeStyle=index?palette.accent:palette.line;context.lineWidth=Math.min(12,(index===2?2:1)/view.k);context.fill();context.stroke();});
  }
  for(const node of view.k>.25?visible:[]){
   const item=itemsRef.current.get(node.id),selected=node.id===source.selectedId;
   context.fillStyle=selected?palette.accent:item?.active?palette.accent:palette.panel;
   context.globalAlpha=selected?.9:item?.active?.6:1;
   context.beginPath();
   const shape=node.shape??item?.shape??'scene';
   // Shapes remain distinct even at overview scale; only their labels vanish.
   nodePath(context,node,shape,true);
   context.fill();context.globalAlpha=1;
   context.strokeStyle=selected||item?.active?palette.accent:item?.condition?palette.condition:palette.line;context.lineWidth=(selected?2.5:1)/view.k;
   context.stroke();
   if(shape==='connector')continue;
   if(shape==='unknown'||shape==='event'){context.font='bold 22px system-ui';context.fillStyle=selected?palette.bg:palette.text;context.textAlign='center';context.fillText(shape==='unknown'?'?':'⚡',node.x+node.width/2,node.y+25);context.textAlign='left';}
   context.save();context.beginPath();context.rect(node.x+12,node.y+8,node.width-24,node.height-16);context.clip();
   context.fillStyle=selected?palette.bg:palette.text;context.font='600 14px system-ui, sans-serif';
   const centered=shape!=='scene'&&shape!=='script';
   context.textAlign=centered?'center':'left';const textX=centered?node.x+node.width/2:node.x+12,textWidth=shape==='wait'?node.width*.5:centered?node.width*.65:node.width-24,titleY=shape==='wait'?node.y+28:centered?node.y+node.height/2+4:node.y+35;
   context.fillText(clipText(context,item?.title??'범위 밖 연결',textWidth),textX,titleY);
   context.font='10px system-ui, sans-serif';context.fillStyle=selected?palette.bg:palette.muted;
   context.fillText(clipText(context,`${item?.kind??(node.external?'범위 밖 연결':'장면')}${item?.condition?' · 조건':''}${item?.status?` · ${item.status}`:''}${item?.active?' · AI 작업':''}`,textWidth),textX,shape==='wait'?node.y+node.height-22:centered?titleY+18:node.y+17);
   if(item?.subtitle&&!centered){context.font='12px system-ui, sans-serif';context.fillStyle=selected?palette.bg:palette.text;const text=item.subtitle.replace(/\s+/g,' '),lineWidth=node.width-24;let remaining=text;
    for(let row=0;row<3&&remaining;row++){const line=clipText(context,remaining,lineWidth);context.fillText(line,node.x+12,node.y+55+row*16);remaining=line.endsWith('…')?remaining.slice(Math.max(1,line.length-1)):'';}
   }
   context.restore();
  }
  // Section labels use screen-sized text so the complete overview stays legible.
  context.setTransform(dpr,0,0,dpr,0,0);context.font='600 12px system-ui, sans-serif';context.fillStyle=palette.text;
  for(const section of scene.layout.sections??[]){const x=section.x*view.k+view.x,y=section.y*view.k+view.y,w=section.width*view.k,h=section.height*view.k;if(x+w<0||x>width||y+h<0||y>height||w<30)continue;const label=clipText(context,section.title.replace('Gameflow Day','Day'),Math.min(400,w-8)),textX=Math.max(4,x+4),textY=Math.max(16,y+16);context.fillStyle=palette.bg;context.fillRect(textX-2,textY-13,Math.min(400,w),18);context.fillStyle=palette.text;context.fillText(label,textX,textY);}
  const mini=miniMap.current,miniContext=mini?.getContext('2d');
  if(mini&&miniContext){
   const miniWidth=mini.clientWidth||180,miniHeight=mini.clientHeight||120,b=scene.bounds,k=Math.min((miniWidth-12)/(b.right-b.left+1),(miniHeight-12)/(b.bottom-b.top+1)),x=(miniWidth-(b.right-b.left)*k)/2-b.left*k,y=(miniHeight-(b.bottom-b.top)*k)/2-b.top*k;
   miniProjection.current={x,y,k};if(mini.width!==Math.round(miniWidth*dpr))mini.width=Math.round(miniWidth*dpr);if(mini.height!==Math.round(miniHeight*dpr))mini.height=Math.round(miniHeight*dpr);
   let base=miniBase.current;
   if(!base||base.scene!==scene||base.width!==miniWidth||base.height!==miniHeight||base.dpr!==dpr||base.palette!==palette){
    const bitmap=document.createElement('canvas');bitmap.width=mini.width;bitmap.height=mini.height;const background=bitmap.getContext('2d')!;
    background.setTransform(dpr,0,0,dpr,0,0);background.fillStyle=palette.bg;background.fillRect(0,0,miniWidth,miniHeight);background.fillStyle=palette.muted;background.globalAlpha=.5;
    for(const node of scene.layout.nodes)background.fillRect(node.x*k+x,node.y*k+y,Math.max(1,node.width*k),Math.max(1,node.height*k));
    base={scene,width:miniWidth,height:miniHeight,dpr,palette,bitmap};miniBase.current=base;
   }
   miniContext.setTransform(1,0,0,1,0,0);miniContext.drawImage(base.bitmap,0,0);miniContext.setTransform(dpr,0,0,dpr,0,0);
   const selected=source.selectedId?scene.nodes.get(source.selectedId):undefined;if(selected){miniContext.fillStyle=palette.accent;miniContext.fillRect(selected.x*k+x-2,selected.y*k+y-2,5,5);}
   const viewport=worldBounds(view,width-Math.min(source.rightInset??0,width-260),height);miniContext.strokeStyle=palette.accent;miniContext.lineWidth=1.5;miniContext.strokeRect(viewport.left*k+x,viewport.top*k+y,Math.max(2,(viewport.right-viewport.left)*k),Math.max(2,(viewport.bottom-viewport.top)*k));
  }
  const elapsed=performance.now()-started;metrics.current.count++;metrics.current.max=Math.max(metrics.current.max,elapsed);
  const data={renderMs:elapsed.toFixed(2),drawingMode:cached?'bitmap-overview':view.k<=.25?'vector-overview':'vector-reading',overviewPrepMs:(overview?.prepMs??0).toFixed(2),overviewMaxBatchMs:(overview?.maxBatchMs??0).toFixed(2),overviewReady:String(!!cached),renderMaxMs:metrics.current.max.toFixed(2),renderCount:String(metrics.current.count),visibleNodes:String(visible.length),visibleEdges:String(visibleEdges),totalNodes:String(scene.layout.nodes.length),sourceNodes:String(source.nodes.length),displayStubs:String(scene.externalCount),totalEdges:String(scene.layout.edges.length),zoom:view.k.toFixed(7),viewportX:view.x.toFixed(3),viewportY:view.y.toFixed(3),viewportWidth:String(width),viewportHeight:String(height),dpr:String(dpr)};
  for(const target of [element,surface.current])if(target)Object.assign(target.dataset,data);
  if(counts.current)counts.current.textContent=`${source.nodes.length.toLocaleString()} 노드${scene.layout.nodes.length>source.nodes.length?` · 범위 밖 참조 ${scene.layout.nodes.length-source.nodes.length}`:''} · 연결 ${scene.layout.edges.length.toLocaleString()}개 · 화면 ${visible.length.toLocaleString()} 노드`;
 };

 useEffect(()=>{
  const element=canvas.current,wrapper=surface.current;if(!element||!wrapper)return;
  // Local diagnostics: sample browser animation-frame intervals only during real
  // input gestures. These are separate from Canvas draw time and never sent out.
  let probeFrame:number|undefined,previousFrame:number|undefined;
  const intervals:number[]=[];
  const probe=(time:number)=>{if(previousFrame!==undefined){intervals.push(time-previousFrame);if(intervals.length>600)intervals.shift();}previousFrame=time;probeFrame=requestAnimationFrame(probe);};
  const stopProbe=()=>{if(probeFrame!==undefined)cancelAnimationFrame(probeFrame);probeFrame=undefined;previousFrame=undefined;if(intervals.length){const ordered=[...intervals].sort((a,b)=>a-b);Object.assign(wrapper.dataset,{interactionFrameSamples:String(ordered.length),interactionFrameMedianMs:ordered[Math.floor(ordered.length/2)].toFixed(2),interactionFrameP95Ms:ordered[Math.max(0,Math.ceil(ordered.length*.95)-1)].toFixed(2),interactionFrameMaxMs:ordered.at(-1)!.toFixed(2)});}};
  const behavior=zoom<HTMLCanvasElement,unknown>().clickDistance(4).scaleExtent([MIN_ZOOM,MAX_ZOOM]).extent(()=>[[0,0],[sizeRef.current.width,sizeRef.current.height]]).on('start.graph',(event:D3ZoomEvent<HTMLCanvasElement,unknown>)=>{if(event.sourceEvent&&probeFrame===undefined)probeFrame=requestAnimationFrame(probe);}).on('zoom.graph',(event:D3ZoomEvent<HTMLCanvasElement,unknown>)=>{viewRef.current={x:event.transform.x,y:event.transform.y,k:event.transform.k};requestDraw();}).on('end.graph',()=>{stopProbe();remember();});
  behaviorRef.current=behavior;
  const selection=select(element).call(behavior).on('dblclick.zoom',null).on('click.graph',(event:MouseEvent)=>{if(busyRef.current||event.defaultPrevented)return;const node=nodeAt(event.clientX,event.clientY);if(node)propsRef.current.onSelect(node.id);else{const edge=edgeAt(event.clientX,event.clientY);if(edge)propsRef.current.onSelectEdge?.(edge.id);}}).on('dblclick.graph',(event:MouseEvent)=>{event.preventDefault();if(busyRef.current)return;const node=nodeAt(event.clientX,event.clientY);if(node){propsRef.current.onSelect(node.id);propsRef.current.onOpen?.(node.id);}else{const edge=edgeAt(event.clientX,event.clientY);if(edge){propsRef.current.onSelectEdge?.(edge.id);propsRef.current.onOpenEdge?.(edge.id);}}}).on('mousemove.graph',(event:MouseEvent)=>{element.style.cursor=nodeAt(event.clientX,event.clientY)||edgeAt(event.clientX,event.clientY)?'pointer':'grab';});
  const resize=()=>{
   const box=wrapper.getBoundingClientRect();if(!box.width||!box.height)return;const dpr=Math.min(2,window.devicePixelRatio||1);sizeRef.current={width:Math.max(1,box.width),height:Math.max(1,box.height),dpr};element.width=Math.round(box.width*dpr);element.height=Math.round(box.height*dpr);
   const css=getComputedStyle(wrapper),read=(name:string,fallback:string)=>css.getPropertyValue(name).trim()||fallback;
   paletteRef.current={bg:read('--bg','#10161c'),panel:read('--panel2','#202c36'),line:read('--line','#40505d'),text:read('--text','#dce6ef'),muted:read('--muted','#90a1b0'),accent:read('--accent','#67b7ed'),condition:read('--condition','#d9a557')};requestDraw();
  };
  const observer=new ResizeObserver(resize);observer.observe(wrapper);window.addEventListener('resize',resize);
  return()=>{stopProbe();for(const value of overviewRef.current)value.raster.cancel();overviewRef.current=[];observer.disconnect();window.removeEventListener('resize',resize);selection.on('.zoom',null).on('.graph',null);behaviorRef.current=undefined;if(frameRef.current!==undefined){cancelAnimationFrame(frameRef.current);frameRef.current=undefined;}remember(false);};
 },[]);

 useEffect(()=>{
  let cancelled=false;const saved=savedViews.get(props.scopeKey),restored=compatibleViewport(props.viewport,signature)?props.viewport:readCanvasView(props.scopeKey,signature);
  const apply=(result:LayoutResult,view?:View)=>{
   if(cancelled)return;loadedRef.current={scope:props.scopeKey,signature};sceneRef.current=prepareScene(result,itemsRef.current);
   const current=propsRef.current,key=`${props.scopeKey}:${current.focusId}:${current.focusToken}`,latestView=compatibleViewport(current.viewport,signature)?current.viewport:view;
   const locate=focusAfterLayout(current.focusId,current.focusToken,!!current.focusId&&sceneRef.current.nodes.has(current.focusId),focusedRequest.current===key,!!latestView);
   setLayout(result);setBusy(false);setError('');const area=readingArea(),b=sceneRef.current.bounds,fitK=Math.max(MIN_ZOOM,Math.min(1,(area.right-area.left)/(b.right-b.left+180),(area.bottom-area.top)/(b.bottom-b.top+180))),warmScale=overviewRasterScale(b,fitK,sizeRef.current.dpr);if(warmScale)overviewRaster(sceneRef.current,warmScale);
   if(locate)readNode(current.focusId);else if(latestView)setView(latestView);else readNode();
   focusedRequest.current=key;requestDraw();
  };
  if(generation===0&&saved?.signature===signature){apply(saved.layout,restored??saved.view);return()=>{cancelled=true;remember(false);};}
  setBusy(true);setError('');
  const worker=new Worker(new URL('./flow-layout.worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=(event:MessageEvent<{result?:LayoutResult;error?:string}>)=>{if(cancelled)return;if(event.data.error){setError(event.data.error);setBusy(false);}else if(event.data.result)apply(event.data.result,restored);worker.terminate();};
  worker.onerror=()=>{if(!cancelled){setError('그래프를 배치하지 못했습니다. 재정렬로 다시 시도하세요.');setBusy(false);}worker.terminate();};
  worker.postMessage({requestId:1,nodes:props.nodes.map(({id,order,shape,layoutGroup})=>({id,order,shape,layoutGroup})),edges:props.edges.map(({id,from,to,externalTarget,secondary})=>({id,from,to,externalTarget,secondary}))});
  return()=>{
   cancelled=true;remember(false);
   // Cooperative acknowledgement terminates ELK's nested worker as well.
   // Ignore stale results while allowing the cancellation handler to run.
   worker.onmessage=()=>worker.terminate();worker.postMessage({type:'cancel',requestId:1});setTimeout(()=>worker.terminate(),200);
  };
 },[signature,props.scopeKey,generation]);
 const focusedRequest=useRef<string|undefined>(undefined);
 useEffect(()=>{const key=`${props.scopeKey}:${props.focusId}:${props.focusToken}`;if(busy||loadedRef.current.signature!==signature||!props.focusId||focusedRequest.current===key||!sceneRef.current?.nodes.has(props.focusId))return;focusedRequest.current=key;if(compatibleViewport(props.viewport,signature)&&props.focusToken===undefined)return;readNode(props.focusId);},[props.focusId,props.focusToken,layout,busy]);
 useEffect(()=>{if(compatibleViewport(props.viewport,signature)&&sceneRef.current&&loadedRef.current.signature===signature)setView(props.viewport);},[props.viewportToken]);
 useEffect(requestDraw,[items,edgeItems,props.selectedId,props.selectedEdgeId,props.showSecondaryEdges,props.rightInset,miniMapOpen]);

 const selected=props.selectedId?items.get(props.selectedId):undefined;
 return <div ref={surface} className="large-graph-canvas" aria-busy={busy||overviewPending} data-renderer="d3-canvas" data-total-nodes={layout?.nodes.length??props.nodes.length} data-total-edges={layout?.edges.length??props.edges.length}>
  <canvas ref={canvas} className="large-graph-surface" role="application" aria-roledescription={props.nodes[0]?.shape==='person'?'인물 관계 그래프':'원문 흐름 그래프'} aria-label={`${props.nodes[0]?.shape==='person'?'인물 관계':'원문 흐름'}: ${props.nodes.length.toLocaleString()}개 노드, ${props.edges.length.toLocaleString()}개 연결. 방향키로 이동, 더하기와 빼기로 확대·축소, PageUp과 PageDown으로 노드 선택, Enter로 선택 상세 열기.`} tabIndex={0} onKeyDown={event=>{
   if(busyRef.current)return;
   if(['+','=','-','_'].includes(event.key)){event.preventDefault();zoomBy(event.key==='-'||event.key==='_'?1/1.3:1.3);}
   else if(event.key.startsWith('Arrow')){event.preventDefault();const view=viewRef.current;setView({...view,x:view.x+(event.key==='ArrowLeft'?100:event.key==='ArrowRight'?-100:0),y:view.y+(event.key==='ArrowUp'?100:event.key==='ArrowDown'?-100:0)});}
   else if(event.key==='Home'){event.preventDefault();fitAll();}
   else if(event.key==='PageDown'||event.key==='PageUp'){event.preventDefault();moveSelection(event.key==='PageDown'?1:-1);}
   else if(event.key==='Enter'){event.preventDefault();if(propsRef.current.selectedEdgeId)propsRef.current.onOpenEdge?.(propsRef.current.selectedEdgeId);else if(propsRef.current.selectedId)propsRef.current.onOpen?.(propsRef.current.selectedId);}
  }}/>
  {(busy||overviewPending)&&<div className="large-graph-loading" role="status">전체 원본 연결 준비 중…</div>}
  {error&&<div className="large-graph-error" role="alert">{error}<Button type="button" onClick={()=>setGeneration(value=>value+1)} variant="ghost">다시 배치</Button></div>}
  <div className="large-graph-overlay" ref={tools}>
   <div className="large-graph-toolbar" role="group" aria-label="그래프 보기 조절">
    <div className="large-graph-actions"><Button type="button" disabled={busy} onClick={fitAll} variant="ghost">전체 맞춤</Button><Button type="button" disabled={busy} onClick={()=>readNode(props.selectedId)} variant="ghost">읽기 배율</Button><Button type="button" disabled={busy||!props.selectedId} onClick={()=>readNode(props.selectedId)} variant="ghost">선택 맞춤</Button><Button type="button" disabled={busy} onClick={()=>setGeneration(value=>value+1)} variant="ghost">재정렬</Button></div>
    <div className="large-graph-counts"><span ref={counts}>{props.nodes.length.toLocaleString()} 노드 · 연결 {props.edges.length.toLocaleString()}개</span></div>
    <div className="large-graph-actions"><Button type="button" aria-label="그래프 확대" disabled={busy} onClick={()=>zoomBy(1.3)} variant="ghost">＋</Button><Button type="button" aria-label="그래프 축소" disabled={busy} onClick={()=>zoomBy(1/1.3)} variant="ghost">−</Button><Button type="button" aria-expanded={miniMapOpen} onClick={()=>setMiniMapOpen(value=>!value)} variant="ghost">미니맵 {miniMapOpen?'접기':'열기'}</Button></div>
    {selected&&!props.selectedEdgeId&&!(props.rightInset??0)&&<div className="large-graph-selection" aria-live="polite"><strong>{selected.title}</strong><span>{selected.subtitle?.slice(0,110)}</span><Button type="button" onClick={()=>props.onOpen?.(selected.id)} disabled={!props.onOpen} variant="ghost">선택 상세</Button></div>}
    {props.selectedEdgeId&&edgeItems.get(props.selectedEdgeId)&&!(props.rightInset??0)&&<div className="large-graph-selection" aria-live="polite"><strong>{edgeItems.get(props.selectedEdgeId)?.label??'선택 연결'}</strong><span>{items.get(edgeItems.get(props.selectedEdgeId)!.from)?.title} · {items.get(edgeItems.get(props.selectedEdgeId)!.to??'')?.title}</span>{props.onOpenEdge&&<Button type="button" onClick={()=>props.onOpenEdge?.(props.selectedEdgeId!)} variant="ghost">연결 상세</Button>}</div>}
    <div className="large-graph-actions"><Button type="button" disabled={busy} onClick={()=>moveSelection(-1)} variant="ghost">이전 노드 선택</Button><Button type="button" disabled={busy} onClick={()=>moveSelection(1)} variant="ghost">다음 노드 선택</Button></div>
    <Button className="large-graph-help-toggle" type="button" aria-expanded={helpOpen} aria-controls={helpId} onClick={()=>setHelpOpen(value=>!value)} variant="ghost">그래프 안내{layout?.skippedEdges?` · 미해석 연결 ${layout.skippedEdges}`:''}</Button>
    {helpOpen&&<p id={helpId} className="large-graph-help">전체 데이터는 한 캔버스에 유지됩니다. 확대하면 화자와 원문이 보입니다. 노드를 클릭하면 선택하고, 두 번 클릭하면 상세를 엽니다. 방향키 이동 · +/− 확대·축소 · PageUp/Down 노드 선택 · Enter 상세. 조건과 배치는 실제 실행 순서를 판정하지 않습니다.</p>}
   </div>
   {miniMapOpen&&<canvas ref={miniMap} className="large-graph-minimap" width={180} height={120} role="img" aria-label="전체 그래프 미니맵. 클릭한 위치로 이동합니다." onClick={event=>{const bounds=event.currentTarget.getBoundingClientRect(),projection=miniProjection.current,view=viewRef.current,area=readingArea(),x=(event.clientX-bounds.left-projection.x)/projection.k,y=(event.clientY-bounds.top-projection.y)/projection.k;setView({...view,x:(area.left+area.right)/2-x*view.k,y:(area.top+area.bottom)/2-y*view.k});}}/>}
  </div>
 </div>;
});
