import type {LayoutEdge,LayoutNode} from './flow-layout.ts';
import {containsShape} from './graph-shapes.js';

export interface CanvasBounds {left:number;top:number;right:number;bottom:number}
export const CELL_SIZE=1024;
export const boundsIntersect=(a:CanvasBounds,b:CanvasBounds)=>a.left<=b.right&&a.right>=b.left&&a.top<=b.bottom&&a.bottom>=b.top;
export const nodeBounds=(node:LayoutNode):CanvasBounds=>({left:node.x,top:node.y,right:node.x+node.width,bottom:node.y+node.height});
export function polylineBounds(edge:LayoutEdge):CanvasBounds{
 const bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
 for(const point of edge.points){bounds.left=Math.min(bounds.left,point.x);bounds.top=Math.min(bounds.top,point.y);bounds.right=Math.max(bounds.right,point.x);bounds.bottom=Math.max(bounds.bottom,point.y);}
 return bounds;
}
export function hitTestNode(nodes:LayoutNode[],x:number,y:number){
 for(let index=nodes.length-1;index>=0;index--){const node=nodes[index];if(!node.external&&containsShape(node.shape,(x-node.x)/node.width,(y-node.y)/node.height))return node;}
}

function segmentIntersects(a:{x:number;y:number},b:{x:number;y:number},bounds:CanvasBounds){
 // Liang-Barsky clips a segment, including diagonal routes with both endpoints
 // outside. A broad route bounding box alone overdraws entire loop interiors.
 let low=0,high=1;const dx=b.x-a.x,dy=b.y-a.y;
 for(const [p,q] of [[-dx,a.x-bounds.left],[dx,bounds.right-a.x],[-dy,a.y-bounds.top],[dy,bounds.bottom-a.y]]){
  if(p===0){if(q<0)return false;continue;}
  const ratio=q/p;if(p<0)low=Math.max(low,ratio);else high=Math.min(high,ratio);if(low>high)return false;
 }
 return true;
}
export function polylineIntersects(edge:LayoutEdge,bounds:CanvasBounds){
 for(let index=1;index<edge.points.length;index++)if(segmentIntersects(edge.points[index-1],edge.points[index],bounds))return true;
 return false;
}
export interface EdgeIndex {cells:Map<string,Set<number>>;long:Set<number>;bounds:CanvasBounds[]}
export function indexEdges(edges:LayoutEdge[]):EdgeIndex{
 const cells=new Map<string,Set<number>>(),long=new Set<number>(),bounds=edges.map(polylineBounds);
 edges.forEach((edge,index)=>{
  for(let offset=1;offset<edge.points.length;offset++){
   const a=edge.points[offset-1],b=edge.points[offset],left=Math.floor(Math.min(a.x,b.x)/CELL_SIZE),right=Math.floor(Math.max(a.x,b.x)/CELL_SIZE),top=Math.floor(Math.min(a.y,b.y)/CELL_SIZE),bottom=Math.floor(Math.max(a.y,b.y)/CELL_SIZE);
   if((right-left+1)*(bottom-top+1)>128){long.add(index);continue;}
   for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++){const key=`${x}:${y}`,entries=cells.get(key)??new Set<number>();entries.add(index);cells.set(key,entries);}
  }
 });
 return {cells,long,bounds};
}
export function queryVisibleEdges(edges:LayoutEdge[],index:EdgeIndex,bounds:CanvasBounds){
 const left=Math.floor(bounds.left/CELL_SIZE),right=Math.floor(bounds.right/CELL_SIZE),top=Math.floor(bounds.top/CELL_SIZE),bottom=Math.floor(bounds.bottom/CELL_SIZE);
 const candidates=new Set<number>();
 if((right-left+1)*(bottom-top+1)>Math.max(1,edges.length/3))edges.forEach((_,offset)=>candidates.add(offset));
 else{for(const offset of index.long)candidates.add(offset);for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++)for(const offset of index.cells.get(`${x}:${y}`)??[])candidates.add(offset);}
 return [...candidates].filter(offset=>boundsIntersect(index.bounds[offset],bounds)&&polylineIntersects(edges[offset],bounds)).sort((a,b)=>a-b).map(offset=>edges[offset]);
}
export function hitTestEdge(edges:LayoutEdge[],x:number,y:number,tolerance:number){
 let closest:LayoutEdge|undefined,distance=tolerance*tolerance;
 for(const edge of edges)for(let index=1;index<edge.points.length;index++){
  const a=edge.points[index-1],b=edge.points[index],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const ratio=length?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/length)):0;
  const squared=(x-a.x-ratio*dx)**2+(y-a.y-ratio*dy)**2;
  if(squared<=distance){distance=squared;closest=edge;}
 }
 return closest;
}
export function indexNodes(nodes:LayoutNode[]){
 const cells=new Map<string,LayoutNode[]>();
 for(const node of nodes)for(let x=Math.floor(node.x/CELL_SIZE);x<=Math.floor((node.x+node.width)/CELL_SIZE);x++)for(let y=Math.floor(node.y/CELL_SIZE);y<=Math.floor((node.y+node.height)/CELL_SIZE);y++){
  const key=`${x}:${y}`,list=cells.get(key)??[];list.push(node);cells.set(key,list);
 }
 return cells;
}
export function queryVisibleNodes(nodes:LayoutNode[],cells:Map<string,LayoutNode[]>,bounds:CanvasBounds){
 const left=Math.floor(bounds.left/CELL_SIZE),right=Math.floor(bounds.right/CELL_SIZE),top=Math.floor(bounds.top/CELL_SIZE),bottom=Math.floor(bounds.bottom/CELL_SIZE);
 // A zoomed-out overview can span mostly empty world cells. Scan the retained
 // node array in that case; the spatial grid is faster for close reading.
 if((right-left+1)*(bottom-top+1)>nodes.length/3)return nodes.filter(node=>boundsIntersect(nodeBounds(node),bounds));
 const result=new Map<string,LayoutNode>();
 for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++)for(const node of cells.get(`${x}:${y}`)??[])if(boundsIntersect(nodeBounds(node),bounds))result.set(node.id,node);
 return [...result.values()];
}
