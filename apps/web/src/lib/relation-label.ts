/** A relationship as the graph names it: its kind, then each kind it changes to, in script order ("협력자 ▸ 배신자"). */
export const relationLabel = (kind: string, changes: readonly { kind: string }[] = []) => [kind, ...changes.map((change) => change.kind).filter(Boolean)].join(' ▸ ');

/** One row of an edge label: the arrow of its direction (↔ for a mutual relationship; a one-direction line also gets its arrow) and the relationship. */
export const relationRow = (direction: 'forward' | 'back' | 'both', kind: string, changes?: readonly { kind: string }[]) => `${direction === 'both' ? '↔' : direction === 'back' ? '←' : '→'} ${relationLabel(kind, changes)}`;
