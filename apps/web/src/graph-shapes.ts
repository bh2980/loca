import type {NodeShape} from './flow-layout.js';

/** Normalized semantic outlines, used identically for drawing and picking. */
export function shapePolygon(shape?:NodeShape):readonly (readonly [number,number])[]|undefined {
 switch(shape){
  case 'condition':return [[.5,0],[1,.5],[.5,1],[0,.5]];
  case 'wait':return [[0,0],[1,0],[.6,.5],[1,1],[0,1],[.4,.5]];
  case 'state':return [[.15,0],[.85,0],[1,.5],[.85,1],[.15,1],[0,.5]];
  case 'unknown':return [[.12,0],[.88,0],[1,.22],[1,.78],[.88,1],[.12,1],[0,.78],[0,.22]];
 }
}
export const circularShape=(shape?:NodeShape)=>shape==='connector'||shape==='event'||shape==='person';
export function containsShape(shape:NodeShape|undefined,x:number,y:number){
 if(x<0||x>1||y<0||y>1)return false;
 if(circularShape(shape))return (x-.5)**2+(y-.5)**2<=.25;
 const polygon=shapePolygon(shape);if(!polygon)return true;
 let inside=false;
 for(let index=0,previous=polygon.length-1;index<polygon.length;previous=index++){
  const a=polygon[index],b=polygon[previous];
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
/** Top/bottom boundary at the port's x. */
export function portBoundary(shape:NodeShape|undefined,x:number,bottom:boolean){
 if(circularShape(shape)){const distance=Math.sqrt(Math.max(0,.25-(x-.5)**2));return bottom?.5+distance:.5-distance;}
 if(shape==='condition')return bottom?1-Math.abs(x-.5):Math.abs(x-.5);
 if(shape==='state'){const top=x<.15?.5-x/.3:x>.85?(x-.85)/.3:0;return bottom?1-top:top;}
 if(shape==='unknown'){const top=x<.12?.22-x*.22/.12:x>.88?(x-.88)*.22/.12:0;return bottom?1-top:top;}
 return bottom?1:0;
}
