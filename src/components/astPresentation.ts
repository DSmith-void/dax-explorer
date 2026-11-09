import type { AstNode, BinaryOperator } from '../engine/parser/ast';

/** Visual grouping used for styling tree nodes. */
export type NodeCategory = 'function' | 'reference' | 'unresolved' | 'variable' | 'operator' | 'literal' | 'structure' | 'error';

export interface NodePresentation {
  /** Short text shown for the node, e.g. "CALCULATE" or "Product[Category]". */
  label: string;
  /** What kind of syntax this is, in plain words. */
  kind: string;
  category: NodeCategory;
}

const BINARY_KIND: Record<BinaryOperator, string> = {
  '+': 'arithmetic',
  '-': 'arithmetic',
  '*': 'arithmetic',
  '/': 'arithmetic',
  '^': 'arithmetic',
  '&': 'text concatenation',
  '=': 'comparison',
  '==': 'strict comparison',
  '<>': 'comparison',
  '<': 'comparison',
  '<=': 'comparison',
  '>': 'comparison',
  '>=': 'comparison',
  IN: 'membership test',
  '&&': 'logical AND',
  '||': 'logical OR',
};

function sourceText(node: AstNode, source: string, maxLength = 60): string {
  const text = source.slice(node.span.start, node.span.end).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function presentNode(node: AstNode, source: string): NodePresentation {
  switch (node.kind) {
    case 'NumberLiteral':
      return { label: sourceText(node, source), kind: 'number', category: 'literal' };
    case 'StringLiteral':
      return { label: sourceText(node, source), kind: 'text', category: 'literal' };
    case 'BooleanLiteral':
      return { label: node.value ? 'TRUE' : 'FALSE', kind: 'boolean', category: 'literal' };
    case 'FunctionCall':
      return { label: node.name, kind: 'function call', category: 'function' };
    case 'ColumnRef':
      return { label: sourceText(node, source), kind: 'column reference', category: 'reference' };
    case 'BracketRef':
      return { label: sourceText(node, source), kind: 'measure or column?', category: 'unresolved' };
    case 'TableRef':
      return { label: sourceText(node, source), kind: 'table reference', category: 'reference' };
    case 'VariableRef':
      return { label: node.name, kind: 'variable reference', category: 'variable' };
    case 'UnaryOp':
      return { label: node.operator, kind: node.operator === 'NOT' ? 'logical NOT' : 'sign', category: 'operator' };
    case 'BinaryOp':
      return { label: node.operator, kind: BINARY_KIND[node.operator], category: 'operator' };
    case 'VarBlock':
      return { label: 'VAR … RETURN', kind: 'variable block', category: 'structure' };
    case 'VarDeclaration':
      return { label: `VAR ${node.name}`, kind: 'variable definition', category: 'variable' };
    case 'TableConstructor':
      return { label: '{ … }', kind: `table constructor, ${node.items.length} ${node.items.length === 1 ? 'row' : 'rows'}`, category: 'structure' };
    case 'Tuple':
      return { label: '( … )', kind: `row of ${node.items.length} values`, category: 'structure' };
    case 'Omitted':
      return { label: '(skipped)', kind: 'omitted optional argument', category: 'structure' };
    case 'Error': {
      const text = sourceText(node, source);
      return { label: text === '' ? '(missing)' : text, kind: 'syntax error', category: 'error' };
    }
  }
}
