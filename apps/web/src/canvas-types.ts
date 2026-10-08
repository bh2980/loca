import type {NodeShape} from './flow-layout.js';

/** Legacy snapshots may lack the signature; they cannot restore changed geometry. */
export interface CanvasViewport {x:number;y:number;k:number;layoutSignature?:string}
export interface CanvasNode {id:string;title:string;subtitle?:string;kind?:string;status?:string;active:boolean;order?:number;shape?:NodeShape;condition?:boolean;sceneLabel?:string;layoutGroup?:string}
export interface CanvasEdge {id:string;from:string;to?:string;externalTarget?:string;conditions?:unknown;direction?:unknown;secondary?:boolean;label?:string;arrow?:'directed'|'mutual'|'undirected'}
export interface FlowCanvasProps {nodes:CanvasNode[];edges:CanvasEdge[];selectedId?:string;onSelect(id:string):void;onOpen?(id:string):void;selectedEdgeId?:string;onSelectEdge?(id:string):void;onOpenEdge?(id:string):void;scopeKey:string;focusId?:string;focusToken?:number;rightInset?:number;showSecondaryEdges?:boolean;viewport?:CanvasViewport;viewportToken?:number;onViewportChange?(view:CanvasViewport):void}
