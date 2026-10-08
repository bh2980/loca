import {AvoidLib} from 'libavoid-js';

export interface RoutePoint {x:number;y:number}
export interface RouteBox extends RoutePoint {id:string;width:number;height:number}
export interface RouteEdge {id:string;from:string;to:string;fromPort:string;toPort:string;source:RoutePoint;target:RoutePoint;sourceDirection?:'right'|'down';targetDirection?:'left'|'up'}
export interface RouteGeometry {nodes:RouteBox[];edges:RouteEdge[]}
export interface RoutedEdge {id:string;points:RoutePoint[]}

// The package's declaration still describes the older WebIDL build. The current
// release is Embind: returned geometry is borrowed; Router owns shapes and pins.
interface NativeObject {delete():void}
interface NativePoint extends NativeObject,RoutePoint {}
interface NativeShape extends NativeObject {}
interface NativePin extends NativeObject {setExclusive(value:boolean):void}
interface NativePath {size():number;at(index:number):NativePoint}
interface NativeConnector extends NativeObject {displayRoute():NativePath}
interface NativeRouter extends NativeObject {processTransaction():void;setRoutingParameter(parameter:unknown,value:number):void}
interface AvoidRuntime {
 Point:new(x:number,y:number)=>NativePoint;
 Rectangle:new(topLeft:NativePoint,bottomRight:NativePoint)=>NativeObject;
 Router:new(flags:number)=>NativeRouter;
 ShapeRef:new(router:NativeRouter,rectangle:NativeObject)=>NativeShape;
 ShapeConnectionPin:new(shape:NativeShape,id:number,x:number,y:number,proportional:boolean,insideOffset:number,direction:number)=>NativePin;
 ConnEnd:new(shape:NativeShape,pin:number)=>NativeObject;
 ConnRef:new(router:NativeRouter,source:NativeObject,target:NativeObject)=>NativeConnector;
 RoutingParameter:Record<string,unknown>;
}
let loading:Promise<AvoidRuntime>|undefined;
export function loadObstacleRouter(wasmURL?:string):Promise<AvoidRuntime> {
 return loading??=AvoidLib.load(wasmURL).then(()=>AvoidLib.getInstance() as unknown as AvoidRuntime).catch(error=>{loading=undefined;throw error;});
}

/** Route fixed ports around fixed node rectangles. No placement or handmade
 * fallback is performed here; callers show loading/failure explicitly. */
export async function routeObstacles(geometry:RouteGeometry,wasmURL?:string):Promise<RoutedEdge[]> {
 const avoid=await loadObstacleRouter(wasmURL),router=new avoid.Router(2),temporary:NativeObject[]=[];
 try {
  router.setRoutingParameter(avoid.RoutingParameter.segmentPenalty,20);
  router.setRoutingParameter(avoid.RoutingParameter.shapeBufferDistance,10);
  router.setRoutingParameter(avoid.RoutingParameter.idealNudgingDistance,8);
  const shapes=new Map<string,NativeShape>(),boxes=new Map(geometry.nodes.map(node=>[node.id,node]));
  for(const box of geometry.nodes){const p=new avoid.Point(box.x,box.y),q=new avoid.Point(box.x+box.width,box.y+box.height),rectangle=new avoid.Rectangle(p,q);temporary.push(p,q,rectangle);shapes.set(box.id,new avoid.ShapeRef(router,rectangle));}
  const pins=new Map<string,number>();let nextPin=1;
  const endpoint=(nodeId:string,portId:string,point:RoutePoint,direction:number)=>{
   const shape=shapes.get(nodeId),box=boxes.get(nodeId);if(!shape||!box)throw new Error(`연결 노드가 없습니다: ${nodeId}`);
   const key=JSON.stringify([nodeId,portId,direction]);let pin=pins.get(key);
   if(pin===undefined){pin=nextPin++;pins.set(key,pin);new avoid.ShapeConnectionPin(shape,pin,point.x-box.x,point.y-box.y,false,0,direction).setExclusive(false);}
   const end=new avoid.ConnEnd(shape,pin);temporary.push(end);return end;
  };
  const connectors=geometry.edges.map(edge=>({id:edge.id,connector:new avoid.ConnRef(router,endpoint(edge.from,edge.fromPort,edge.source,edge.sourceDirection==='down'?2:8),endpoint(edge.to,edge.toPort,edge.target,edge.targetDirection==='up'?1:4))}));
  router.processTransaction();
  return connectors.map(({id,connector})=>{const path=connector.displayRoute(),points:RoutePoint[]=[];for(let index=0;index<path.size();index++){const point=path.at(index);points.push({x:point.x,y:point.y});}if(points.length<2||points.some(point=>!Number.isFinite(point.x)||!Number.isFinite(point.y)))throw new Error(`연결 경로를 만들지 못했습니다: ${id}`);return {id,points};});
 } finally {
  // Router releases its connectors, shapes, and connection pins. ConnEnds and
  // constructor geometry are separate copied values and are released here.
  router.delete();for(const object of temporary.reverse())object.delete();
 }
}
