import type {LayoutNode,LayoutResult} from './flow-layout.js';
import type {CanvasBounds} from './canvas-geometry.js';
import {shapePolygon,circularShape} from './graph-shapes.js';
export interface OverviewPalette {bg:string;panel:string;line:string;text:string;muted:string;accent:string;condition:string}
export interface OverviewRaster {bitmap:HTMLCanvasElement;scale:number;left:number;top:number;ready:boolean;cancel():void;prepMs:number;maxBatchMs:number;nodeCount:number;edgeCount:number}
export function paintNodePath(context:CanvasRenderingContext2D,node:LayoutNode,rounded=false){
 const polygon=shapePolygon(node.shape);
 if(polygon){for(let index=0;index<polygon.length;index++){const [x,y]=polygon[index];if(index)context.lineTo(node.x+x*node.width,node.y+y*node.height);else context.moveTo(node.x+x*node.width,node.y+y*node.height);}context.closePath();}
 else if(circularShape(node.shape)){context.moveTo(node.x+node.width,node.y+node.height/2);context.ellipse(node.x+node.width/2,node.y+node.height/2,node.width/2,node.height/2,0,0,Math.PI*2);}
 else if(rounded)context.roundRect(node.x,node.y,node.width,node.height,8);
 else context.rect(node.x,node.y,node.width,node.height);
}
/** Static geometry only. Prepare bounded batches between browser tasks; publish
 * only a complete raster. Selection/active overlays and picking stay exact. */
export function prepareOverviewRaster(layout:LayoutResult,bounds:CanvasBounds,scale:number,palette:OverviewPalette,conditionIds:ReadonlySet<string>,showSecondary:boolean,onReady:()=>void):OverviewRaster{
 const pad=4,left=bounds.left-pad/scale,top=bounds.top-pad/scale,bitmap=document.createElement('canvas');bitmap.width=Math.ceil((bounds.right-left)*scale)+pad;bitmap.height=Math.ceil((bounds.bottom-top)*scale)+pad;
 const context=bitmap.getContext('2d',{willReadFrequently:true})!,groups=[layout.edges.filter(edge=>!edge.secondary&&!conditionIds.has(edge.id)),layout.edges.filter(edge=>!edge.secondary&&conditionIds.has(edge.id)),showSecondary?layout.edges.filter(edge=>edge.secondary):[]];
 const result:OverviewRaster={bitmap,scale,left,top,ready:false,prepMs:0,maxBatchMs:0,nodeCount:0,edgeCount:0,cancel:()=>{cancelled=true;}},batch=192;let group=0,index=0,cancelled=false;
 context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,bitmap.width,bitmap.height);context.setTransform(scale,0,0,scale,-left*scale,-top*scale);
 const schedule=()=>{if('requestIdleCallback' in window)window.requestIdleCallback(step,{timeout:100});else setTimeout(step,0);};
 const step=()=>{if(cancelled)return;const started=performance.now();
  if(group<3){const edges=groups[group],end=Math.min(index+batch,edges.length);context.beginPath();context.strokeStyle=group===1?palette.condition:palette.muted;context.lineWidth=1;context.globalAlpha=.2;context.setLineDash(group===2?[2,5]:[]);
   // World geometry is transformed once. A reference scale of one raster pixel
   // keeps thin edges legible when the bitmap is projected back onto the view.
   context.lineWidth=1/scale;if(group===2)context.setLineDash([2/scale,5/scale]);
   for(;index<end;index++){const edge=edges[index];for(let point=0;point<edge.points.length;point++){const p=edge.points[point];if(point)context.lineTo(p.x,p.y);else context.moveTo(p.x,p.y);}result.edgeCount++;}context.stroke();if(index===edges.length){group++;index=0;}
  }else{context.setLineDash([]);context.globalAlpha=1;context.fillStyle=palette.panel;context.strokeStyle=palette.line;context.lineWidth=12;context.beginPath();const end=Math.min(index+batch,layout.nodes.length);for(;index<end;index++){paintNodePath(context,layout.nodes[index]);result.nodeCount++;}context.fill();context.stroke();}
  // Complete each offscreen batch now, so later drawImage cannot inherit an
  // accumulated rasterization stall. The tiny read is included in prep metrics.
  context.getImageData(0,0,1,1);
  const elapsed=performance.now()-started;result.prepMs+=elapsed;result.maxBatchMs=Math.max(result.maxBatchMs,elapsed);if(group===3&&index===layout.nodes.length){result.ready=true;onReady();}else schedule();
 };schedule();return result;
}
/** Cache only overview textures that fit a bounded pixel budget. A long graph
 * zoomed into a small portion keeps the existing spatially culled vector path. */
export function overviewRasterScale(bounds:CanvasBounds,k:number,dpr:number):number|undefined{
 if(k>.025)return undefined;const scale=2**Math.ceil(Math.log2(k*dpr)),width=(bounds.right-bounds.left)*scale+8,height=(bounds.bottom-bounds.top)*scale+8;
 return width<=4096&&height<=4096&&width*height<=4_000_000?scale:undefined;
}
