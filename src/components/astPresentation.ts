import type { BindResult, ReferenceResolution } from '../engine/binder/binder';
import type { FunctionCategory } from '../engine/catalog/functions';

/** Plain-language names for function categories. */
const CATEGORY_TEXT: Record<FunctionCategory, string> = {
  aggregation: 'adds up or counts',
  iterator: 'goes row by row',
  'filter modification': 'changes filters',
  table: 'returns a table',
  'scope and filter inspection': 'checks filters',
  relationship: 'uses relationships',
  'time intelligence': 'works with dates',
  logical: 'logic',
  math: 'math',
  text: 'text',
  'date and time': 'date and time',
  information: 'checks a value',
  statistical: 'statistics',
  financial: 'finance',
  'parent and child': 'parent-child hierarchy',
  other: 'other',
};
import type { AstNode, BinaryOperator } from '../engine/parser/ast';

/** Visual grouping used for styling tree nodes. */
export type NodeCategory =
  | 'function'
  | 'unknown-function'
  | 'measure'
  | 'reference'
  | 'unresolved'
  | 'variable'
  | 'operator'
  | 'literal'
  | 'structure'
  | 'error';

/** How certain a reference classification is. */
export type CertaintyTone = 'certain' | 'user' | 'assumed' | 'unknown';

export interface NodePresentation {
  /** Short text shown for the node, e.g. "CALCULATE" or "Product[Category]". */
  label: string;
  /** What kind of syntax this is, in plain words. */
  kind: string;
  category: NodeCategory;
  /** Optional certainty tag for references, e.g. "required" or "assumed". */
  tag?: { text: string; tone: CertaintyTone; title: string };
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

/** Short certainty tag for a resolved reference. */
export function resolutionTag(resolution: ReferenceResolution): NonNullable<NodePresentation['tag']> {
  switch (resolution.source) {
    case 'model':
      return { text: 'from your model', tone: 'certain', title: resolution.detail };
    case 'function-signature':
      return { text: 'required', tone: 'certain', title: resolution.detail };
    case 'user':
      return { text: 'your choice', tone: 'user', title: resolution.detail };
    case 'other-occurrence':
    case 'convention':
      return { text: 'assumed', tone: 'assumed', title: resolution.detail };
    case 'unresolved':
      return { text: 'unknown', tone: 'unknown', title: resolution.detail };
  }
}

export function presentNode(node: AstNode, source: string, binding?: BindResult | null): NodePresentation {
  switch (node.kind) {
    case 'NumberLiteral':
      return { label: sourceText(node, source), kind: 'number', category: 'literal' };
    case 'StringLiteral':
      return { label: sourceText(node, source), kind: 'text', category: 'literal' };
    case 'BooleanLiteral':
      return { label: node.value ? 'TRUE' : 'FALSE', kind: 'boolean', category: 'literal' };
    case 'FunctionCall': {
      const call = binding?.calls.get(node.id);
      if (binding && !call?.spec) {
        return { label: node.name, kind: 'function · unknown to this app', category: 'unknown-function' };
      }
      return { label: node.name, kind: call?.spec ? `function · ${CATEGORY_TEXT[call.spec.category]}` : 'function', category: 'function' };
    }
    case 'ColumnRef':
    case 'BracketRef': {
      const resolution = binding?.references.get(node.id);
      if (!resolution) {
        return {
          label: sourceText(node, source),
          kind: node.kind === 'ColumnRef' ? 'column reference' : 'measure or column?',
          category: node.kind === 'ColumnRef' ? 'reference' : 'unresolved',
        };
      }
      return {
        label: sourceText(node, source),
        kind: resolution.type ?? 'measure or column?',
        category: resolution.type === 'measure' ? 'measure' : resolution.type === 'column' ? 'reference' : 'unresolved',
        tag: resolutionTag(resolution),
      };
    }
    case 'TableRef':
      if (binding?.keywordNodeIds.has(node.id)) {
        return { label: node.name, kind: 'keyword argument', category: 'literal' };
      }
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
      return {
        label: '{ … }',
        kind: `table constructor, ${node.items.length} ${node.items.length === 1 ? 'row' : 'rows'}`,
        category: 'structure',
      };
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
