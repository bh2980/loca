/**
 * The `style=` check of ui-rules.ts. A `style` is for a value computed from data or geometry (a measured width, a
 * person's colour, a point on a canvas). A value that is written out (a literal, or a choice between literals) is a
 * prop or a class of a @loca/ui part, where it has a name and the tokens apply. The test: no property of a `style`
 * object may be a literal; an identifier, a call or a template with a hole in it is taken as computed.
 */
import ts from 'typescript';

/** Elements that take a written-out value only as a style, each with why. */
export const STATIC_STYLE_ALLOWED: Record<string, string> = {
  // apps/web
  BaseEdge: 'React Flow draws the edge path itself: stroke, width, dash and joins reach it only as a style object',
  NodeToolbar: 'React Flow portals the toolbar: its layer above the frames reaches it only as a style',
  // packages/ui
  Sonner: "sonner's stylesheet sets its colour variables per theme with attribute selectors: only an inline style outranks it",
};

const unwrap = (node: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) ? unwrap(node.expression) : node);
const isUndefined = (node: ts.Expression) => ts.isIdentifier(unwrap(node)) && unwrap(node).getText() === 'undefined';
const isLiteral = (raw: ts.Expression): boolean => {
  const node = unwrap(raw);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isPrefixUnaryExpression(node)) return isLiteral(node.operand);
  // A choice between written-out values is a variant of a part, not a computed value; `undefined` is no value.
  if (ts.isConditionalExpression(node)) {
    const branches = [node.whenTrue, node.whenFalse];
    return branches.every((branch) => isLiteral(branch) || isUndefined(branch)) && branches.some(isLiteral);
  }
  return false;
};

/** The names of the properties of a style expression that are written out. */
function staticProperties(raw: ts.Expression): string[] {
  const node = unwrap(raw);
  if (ts.isConditionalExpression(node)) return [...staticProperties(node.whenTrue), ...staticProperties(node.whenFalse)];
  if (!ts.isObjectLiteralExpression(node)) return [];
  return node.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) return staticProperties(property.expression);
    if (ts.isPropertyAssignment(property) && isLiteral(property.initializer)) return [property.name.getText()];
    return [];
  });
}

/** Every `style` attribute of a TSX source that writes a value out, with its line and the properties. */
export function staticStyles(text: string): { line: number; element: string; properties: string[] }[] {
  const source = ts.createSourceFile('file.tsx', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const found: { line: number; element: string; properties: string[] }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText() === 'style' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      const element = node.parent.parent.tagName.getText();
      const properties = STATIC_STYLE_ALLOWED[element] ? [] : staticProperties(node.initializer.expression);
      if (properties.length) found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, element, properties });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
