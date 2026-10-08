export const PAGES=['scene','flow','graph','knowledge','glossary','reviews','settings','history','execute','workflow'] as const;
export type Page=typeof PAGES[number];
export interface GraphNavigation {mode:'scenes'|'all-dialogue';dataset:'scenes'|'library';flow:string}
export interface NavigationRoute {workspace:'main'|'demo';projectId?:string;page:Page;groupId?:string;unitId?:string;sourcePage?:number;resourceId?:string;graph?:GraphNavigation;legacyChat?:{sessionId:string}}
export interface ScrollPosition {index:number;top:number;left:number}
export interface NavigationEntry {workbenchNavigation:1;route:NavigationRoute;scroll?:ScrollPosition[]}
const SCROLLERS='.shell-content,.shell-page,.material-library-table-scroll,.scene-detail-body,.map-inspector';
const scrollKeys=new WeakMap<HTMLElement,number>();let nextScrollKey=0;
export function readRoute(href:string):NavigationRoute{
 const p=new URL(href).searchParams,page=p.get('view');
 const route:NavigationRoute={workspace:p.get('workspace')==='demo'?'demo':'main',page:PAGES.includes(page as Page)?page as Page:'graph'};
 for(const [key,param] of [['projectId','project'],['groupId','group'],['unitId','unit'],['resourceId','resource']] as const){const value=p.get(param);if(value)route[key]=value;}
 if(page==='chat'){route.legacyChat={sessionId:route.resourceId??''};delete route.resourceId;}
 const sourcePage=Number(p.get('sourcePage'));if(Number.isSafeInteger(sourcePage)&&sourcePage>0)route.sourcePage=sourcePage;
 route.graph={mode:p.get('graphMode')==='all-dialogue'?'all-dialogue':'scenes',dataset:p.get('dataset')==='library'?'library':'scenes',flow:p.get('flow')??''};
 return route;
}
export function routeUrl(route:NavigationRoute,href:string):string{
 const url=new URL(href);for(const key of ['workspace','view','project','group','unit','sourcePage','resource','graphMode','dataset','flow'])url.searchParams.delete(key);
 if(route.workspace==='demo')url.searchParams.set('workspace','demo');url.searchParams.set('view',route.page);
 for(const [key,param] of [['projectId','project'],['groupId','group'],['unitId','unit'],['resourceId','resource']] as const)if(route[key])url.searchParams.set(param,route[key]!);
 if(route.sourcePage)url.searchParams.set('sourcePage',String(route.sourcePage));
 if(route.graph?.mode==='all-dialogue')url.searchParams.set('graphMode','all-dialogue');
 if(route.graph?.dataset==='library')url.searchParams.set('dataset','library');
 if(route.graph?.flow)url.searchParams.set('flow',route.graph.flow);
 return `${url.pathname}${url.search}${url.hash}`;
}
export function validateRoute(route:NavigationRoute,workspace:'main'|'demo',projectId:string,groups:ReadonlySet<string>,unitGroups:ReadonlyMap<string,string>):NavigationRoute{
 if(route.workspace!==workspace||route.projectId&&route.projectId!==projectId)return {workspace,projectId,page:'graph'};
 const result={...route,workspace,projectId};
 if(result.unitId){const group=unitGroups.get(result.unitId);if(group)result.groupId=group;else delete result.unitId;}
 if(result.page==='scene'||result.page==='flow'){if(!result.groupId||!groups.has(result.groupId)){result.page='graph';delete result.groupId;delete result.unitId;delete result.sourcePage;}}
 return result;
}
export function captureScroll():ScrollPosition[]{return Array.from(document.querySelectorAll<HTMLElement>(SCROLLERS)).map(element=>{let index=scrollKeys.get(element);if(index===undefined){index=nextScrollKey++;scrollKeys.set(element,index);}return {index,top:element.scrollTop,left:element.scrollLeft};});}
export function restoreScroll(positions:ScrollPosition[]|undefined){if(!positions)return;requestAnimationFrame(()=>requestAnimationFrame(()=>{const elements=new Map(Array.from(document.querySelectorAll<HTMLElement>(SCROLLERS)).map(element=>[scrollKeys.get(element),element]));for(const position of positions){const element=elements.get(position.index);if(element){element.scrollTop=position.top;element.scrollLeft=position.left;}}}));}
export function checkpoint(){const previous=window.history.state as NavigationEntry|null;if(previous?.workbenchNavigation===1)window.history.replaceState({...previous,scroll:captureScroll()},'');}
export function writeRoute(route:NavigationRoute,mode:'push'|'replace'){
 const url=routeUrl(route,window.location.href),entry:NavigationEntry={workbenchNavigation:1,route};
 if(mode==='push'){if(`${window.location.pathname}${window.location.search}${window.location.hash}`===url)return;window.history.pushState(entry,'',url);}else window.history.replaceState({...window.history.state,...entry,scroll:(window.history.state as NavigationEntry|null)?.scroll},'',url);
}
