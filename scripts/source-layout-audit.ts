import {readFile,writeFile} from 'node:fs/promises';
import {classifyGraphNode,layoutGraph} from '../apps/web/src/flow-layout.ts';
import type {ProjectInput} from '@workbench/contracts';
const inputPath=process.argv[2]??'artifacts/orwell2-en-2026-10-08T16-08-46-865Z/workbench-input-orwell2-en.json';
const p=JSON.parse(await readFile(inputPath,'utf8')) as ProjectInput,graph=p.graph!;
const started=performance.now(),layout=await layoutGraph(graph.nodes.map((node,order)=>({id:node.id,order,shape:classifyGraphNode(node)})),graph.edges),layoutMs=performance.now()-started;
const byId=new Map(layout.nodes.map(node=>[node.id,node])),originalIds=new Set(graph.nodes.map(node=>node.id));
if(layout.skippedEdges||graph.edges.length!==layout.edges.length||layout.nodes.filter(n=>!n.external).length!==graph.nodes.length)throw new Error('Source graph coverage changed.');
for(const edge of layout.edges)if(!byId.has(edge.from)||!byId.has(edge.to)||edge.points.length<2)throw new Error(`Invalid route ${edge.id}`);
const forward=layout.edges.filter(edge=>byId.get(edge.to)!.y>byId.get(edge.from)!.y+byId.get(edge.from)!.height).length;
const result={inputPath,library:'elkjs 0.12 · layered COFFMAN_GRAHAM · DOWN · orthogonal',layoutMs,nodes:graph.nodes.length,edges:graph.edges.length,externalNodes:layout.nodes.filter(n=>n.external).length,sections:layout.sections?.length,forwardEdges:forward,otherEdges:layout.edges.length-forward,unknownRoles:graph.nodes.filter(n=>classifyGraphNode(n)==='unknown').length,
 width:Math.max(...layout.nodes.map(n=>n.x+n.width))-Math.min(...layout.nodes.map(n=>n.x)),height:Math.max(...layout.nodes.map(n=>n.y+n.height))-Math.min(...layout.nodes.map(n=>n.y)),sourceIdsPreserved:layout.nodes.filter(n=>originalIds.has(n.id)).length,originalWrites:0,modelCalls:0};
await writeFile('artifacts/source-elk-layout-audit.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
