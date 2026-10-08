interface SceneFocusNode {id:string;groupIds:string[];unitIds:string[];projection?:{groupId?:string;kind:string}}

/** A group can share projected content with other groups. Locate its strongest
 * actual content representative without treating associated control nodes as
 * that group's scene. The explicit group remains the preview/read scope. */
export function findSceneGroupNode<T extends SceneFocusNode>(nodes:T[],groupId:string,unitIds:ReadonlySet<string>):T|undefined {
 const exact=nodes.find(node=>node.projection?.kind!=='control'&&node.projection?.groupId===groupId);if(exact)return exact;
 const unitOrder=new Map([...unitIds].map((id,index)=>[id,index]));let match:T|undefined,count=0,firstUnit=Infinity;
 for(const node of nodes){if(node.projection?.kind==='control'||node.projection?.groupId&&node.projection.groupId!==groupId)continue;const own=node.unitIds.filter(id=>unitIds.has(id)),first=Math.min(...own.map(id=>unitOrder.get(id)!));if(own.length>count||own.length>0&&own.length===count&&first<firstUnit){match=node;count=own.length;firstUnit=first;}}
 return match;
}
