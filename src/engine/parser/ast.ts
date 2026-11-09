import type { Diagnostic } from '../diagnostics';
import type { Span } from '../source';

/**
 * Abstract syntax tree (AST) for DAX expressions.
 *
 * The AST describes STRUCTURE only. It does not know what any function does,
 * and it does not decide whether `[X]` is a measure or a column; later stages
 * add that meaning.
 */

interface NodeBase {
  /** Unique within one parse; used for selection in the UI. */
  id: number;
  span: Span;
}

export interface NumberLiteral extends NodeBase {
  kind: 'NumberLiteral';
  value: number;
}

export interface StringLiteral extends NodeBase {
  kind: 'StringLiteral';
  value: string;
}

/** Bare TRUE / FALSE. (TRUE() with parentheses is a FunctionCall.) */
export interface BooleanLiteral extends NodeBase {
  kind: 'BooleanLiteral';
  value: boolean;
}

export interface FunctionCall extends NodeBase {
  kind: 'FunctionCall';
  /** As written; DAX function names are case-insensitive. */
  name: string;
  nameSpan: Span;
  /** Skipped optional arguments appear as Omitted nodes. */
  args: Expr[];
}

/** Table[Column] or 'Table Name'[Column]. */
export interface ColumnRef extends NodeBase {
  kind: 'ColumnRef';
  table: string;
  tableQuoted: boolean;
  column: string;
}

/**
 * [Name] without a table. Could be a measure or a column (in row context):
 * deciding requires model metadata, so the parser leaves it unresolved.
 */
export interface BracketRef extends NodeBase {
  kind: 'BracketRef';
  name: string;
}

export interface TableRef extends NodeBase {
  kind: 'TableRef';
  name: string;
  quoted: boolean;
}

/** A name that refers to an enclosing VAR declaration. */
export interface VariableRef extends NodeBase {
  kind: 'VariableRef';
  name: string;
  /** id of the VarDeclaration this name refers to. */
  declarationId: number;
}

export type UnaryOperator = '-' | '+' | 'NOT';

export interface UnaryOp extends NodeBase {
  kind: 'UnaryOp';
  operator: UnaryOperator;
  operand: Expr;
}

export type BinaryOperator =
  | '^'
  | '*'
  | '/'
  | '+'
  | '-'
  | '&'
  | '='
  | '=='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'IN'
  | '&&'
  | '||';

export interface BinaryOp extends NodeBase {
  kind: 'BinaryOp';
  operator: BinaryOperator;
  left: Expr;
  right: Expr;
}

export interface VarDeclaration extends NodeBase {
  kind: 'VarDeclaration';
  name: string;
  nameSpan: Span;
  value: Expr;
}

/** VAR ... VAR ... RETURN body */
export interface VarBlock extends NodeBase {
  kind: 'VarBlock';
  declarations: VarDeclaration[];
  body: Expr;
}

/** { item, item, ... } where an item is a value or a Tuple (multi-column row). */
export interface TableConstructor extends NodeBase {
  kind: 'TableConstructor';
  items: Expr[];
}

/** ( a, b, ... ) — used for multi-column rows and on the left of IN. */
export interface Tuple extends NodeBase {
  kind: 'Tuple';
  items: Expr[];
}

/** A skipped optional argument, e.g. the middle of RANKX(T, [m], , DESC). Zero-width span. */
export interface Omitted extends NodeBase {
  kind: 'Omitted';
}

/** Placeholder where the parser could not build a valid expression. See diagnostics. */
export interface ErrorNode extends NodeBase {
  kind: 'Error';
}

export type Expr =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | FunctionCall
  | ColumnRef
  | BracketRef
  | TableRef
  | VariableRef
  | UnaryOp
  | BinaryOp
  | VarBlock
  | TableConstructor
  | Tuple
  | Omitted
  | ErrorNode;

export type AstNode = Expr | VarDeclaration;

export interface ParseResult {
  /** Null only when there was nothing to parse at all. */
  root: Expr | null;
  diagnostics: Diagnostic[];
}

export interface ChildEntry {
  node: AstNode;
  /** Optional role shown in the UI, e.g. "RETURN". */
  label?: string;
}

/** The direct children of a node, in source order. */
export function childrenOf(node: AstNode): ChildEntry[] {
  switch (node.kind) {
    case 'FunctionCall':
      return node.args.map((arg) => ({ node: arg }));
    case 'UnaryOp':
      return [{ node: node.operand }];
    case 'BinaryOp':
      return [{ node: node.left }, { node: node.right }];
    case 'VarBlock':
      return [...node.declarations.map((d) => ({ node: d })), { node: node.body, label: 'RETURN' }];
    case 'VarDeclaration':
      return [{ node: node.value }];
    case 'TableConstructor':
    case 'Tuple':
      return node.items.map((item) => ({ node: item }));
    default:
      return [];
  }
}

/** Depth-first search for a node by id. */
export function findNode(root: AstNode | null, id: number): AstNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of childrenOf(root)) {
    const found = findNode(child.node, id);
    if (found) return found;
  }
  return null;
}

/**
 * Compact, unambiguous text form of a tree, e.g.
 * `(DIVIDE [Total Sales] (CALCULATE [Total Sales] (REMOVEFILTERS Product[Category])))`.
 * Used by tests to assert tree shape; also handy when debugging.
 */
export function toDebugString(node: AstNode): string {
  switch (node.kind) {
    case 'NumberLiteral':
      return String(node.value);
    case 'StringLiteral':
      return JSON.stringify(node.value);
    case 'BooleanLiteral':
      return node.value ? 'TRUE' : 'FALSE';
    case 'FunctionCall':
      return `(${[node.name.toUpperCase(), ...node.args.map(toDebugString)].join(' ')})`;
    case 'ColumnRef':
      return `${node.tableQuoted ? `'${node.table}'` : node.table}[${node.column}]`;
    case 'BracketRef':
      return `[${node.name}]`;
    case 'TableRef':
      return node.quoted ? `'${node.name}'` : node.name;
    case 'VariableRef':
      return `var:${node.name}`;
    case 'UnaryOp':
    case 'BinaryOp':
      return `(${[node.operator, ...childrenOf(node).map((c) => toDebugString(c.node))].join(' ')})`;
    case 'VarBlock':
      return `(VAR ${node.declarations.map(toDebugString).join(' ')} RETURN ${toDebugString(node.body)})`;
    case 'VarDeclaration':
      return `(${node.name} ${toDebugString(node.value)})`;
    case 'TableConstructor':
      return `{${node.items.map(toDebugString).join(' ')}}`;
    case 'Tuple':
      return `(tuple ${node.items.map(toDebugString).join(' ')})`;
    case 'Omitted':
      return '_';
    case 'Error':
      return '!error';
  }
}
