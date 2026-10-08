import {LargeGraphCanvas} from './LargeGraphCanvas';
import type {FlowCanvasProps} from './canvas-types';

export type {CanvasNode,CanvasEdge,FlowCanvasProps,CanvasViewport} from './canvas-types';

/** One read-only source renderer for every graph size. Workflow editing keeps
 * its own data model rather than rewriting these source relationships. */
export function FlowCanvas(props:FlowCanvasProps){
 return <LargeGraphCanvas key={props.scopeKey} {...props}/>;
}
