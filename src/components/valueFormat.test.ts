import { describe, expect, it } from 'vitest';
import { tokenize } from '../engine/lexer/lexer';
import { childrenOf, type AstNode, type Expr } from '../engine/parser/ast';
import { parse } from '../engine/parser/parser';
import { formatQueryValue, isDatePart } from './valueFormat';

function parsed(source: string): Expr {
  return parse(tokenize(source).tokens).root!;
}

/** The first node of a kind (and name, for calls and variables), depth first. */
function find(root: AstNode, kind: AstNode['kind'], name?: string): AstNode {
  const stack: AstNode[] = [root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === kind && (!name || ('name' in node && node.name === name))) return node;
    stack.push(...childrenOf(node).map((c) => c.node));
  }
  throw new Error(`no ${kind} ${name ?? ''}`);
}

describe('numbers that are parts of a date', () => {
  const root = parsed('VAR ThisYear = YEAR(TODAY()) VAR Orders = COUNTROWS(Sales) RETURN ThisYear + Orders');

  it('a year is shown as written; other numbers keep the thousands separator', () => {
    expect(formatQueryValue(2026, true)).toBe('2026');
    expect(formatQueryValue(2026)).toBe((2026).toLocaleString());
    expect(formatQueryValue(2026.5, true)).toBe((2026.5).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  });

  it('knows YEAR(…), a variable holding it, and where that variable is used', () => {
    expect(isDatePart(root, find(root, 'FunctionCall', 'YEAR').id)).toBe(true);
    expect(isDatePart(root, find(root, 'VarDeclaration', 'ThisYear').id)).toBe(true);
    expect(isDatePart(root, find(root, 'VariableRef', 'ThisYear').id)).toBe(true);
  });

  it('is false for other values', () => {
    expect(isDatePart(root, find(root, 'VarDeclaration', 'Orders').id)).toBe(false);
    expect(isDatePart(root, find(root, 'BinaryOp').id)).toBe(false);
    expect(isDatePart(null, 1)).toBe(false);
  });
});
