import { describe, expect, it } from 'vitest';
import { SAMPLE_MEASURES } from '../../samples/sampleMeasures';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { childrenOf, findNode, toDebugString, type AstNode, type Expr } from './ast';
import { parse } from './parser';

function parseText(source: string) {
  return parse(tokenize(source).tokens);
}

/** Parses and returns the debug form, asserting there were no diagnostics. */
function tree(source: string): string {
  const { root, diagnostics } = parseText(source);
  expect(diagnostics).toEqual([]);
  if (!root) throw new Error('no root');
  return toDebugString(root);
}

function codes(source: string): string[] {
  return parseText(source).diagnostics.map((d) => d.code);
}

function allNodes(root: AstNode): AstNode[] {
  return [root, ...childrenOf(root).flatMap((c) => allNodes(c.node))];
}

describe('literals and references', () => {
  it.each([
    ['42', '42'],
    ['1.5E3', '1500'],
    ['"Widgets"', '"Widgets"'],
    ['TRUE', 'TRUE'],
    ['false', 'FALSE'],
    ['TRUE()', '(TRUE)'],
    ['[Total Sales]', '[Total Sales]'],
    ['Product[Category]', 'Product[Category]'],
    ["'Sales Order'[Net Price]", "'Sales Order'[Net Price]"],
    ['Sales', 'Sales'],
    ["'Sales Order'", "'Sales Order'"],
  ])('%s  →  %s', (source, expected) => {
    expect(tree(source)).toBe(expected);
  });

  it('records table and column names of a column reference', () => {
    const { root } = parseText("'Bob''s Plant'[Units]");
    expect(root).toMatchObject({ kind: 'ColumnRef', table: "Bob's Plant", tableQuoted: true, column: 'Units' });
  });

  it('leaves [Name] unresolved (measure or column needs model metadata)', () => {
    expect(parseText('[Amount]').root).toMatchObject({ kind: 'BracketRef', name: 'Amount' });
  });
});

describe('function calls', () => {
  it('parses nested calls', () => {
    expect(tree('CALCULATE([Total Sales], REMOVEFILTERS(Product[Category]))')).toBe(
      '(CALCULATE [Total Sales] (REMOVEFILTERS Product[Category]))',
    );
  });

  it('parses calls with no arguments', () => {
    expect(tree('BLANK()')).toBe('(BLANK)');
  });

  it('keeps unknown functions as plain calls', () => {
    expect(tree('MADEUPFUNCTION(1, 2)')).toBe('(MADEUPFUNCTION 1 2)');
  });

  it('keeps dotted function names', () => {
    expect(tree('PERCENTILE.INC(Sales[Amount], 0.9)')).toBe('(PERCENTILE.INC Sales[Amount] 0.9)');
  });

  it.each([
    ['RANKX(ALL(Product), [Total Sales], , DESC)', '(RANKX (ALL Product) [Total Sales] _ DESC)'],
    ['F(, 1)', '(F _ 1)'],
    ['F(1, )', '(F 1 _)'],
    ['F(, )', '(F _ _)'],
  ])('represents skipped arguments explicitly: %s', (source, expected) => {
    expect(tree(source)).toBe(expected);
  });

  it('records the function name span', () => {
    const { root } = parseText('  SUM(Sales[Amount])');
    expect(root).toMatchObject({ kind: 'FunctionCall', name: 'SUM', nameSpan: { start: 2, end: 5 }, span: { start: 2, end: 20 } });
  });
});

describe('operator precedence and associativity', () => {
  it.each([
    ['1 + 2 * 3', '(+ 1 (* 2 3))'],
    ['(1 + 2) * 3', '(* (+ 1 2) 3)'],
    ['1 - 2 - 3', '(- (- 1 2) 3)'],
    ['8 / 4 / 2', '(/ (/ 8 4) 2)'],
    ['2 ^ 3 ^ 2', '(^ (^ 2 3) 2)'],
    ['-2 ^ 2', '(- (^ 2 2))'],
    ['-[A] * [B]', '(* (- [A]) [B])'],
    ['2 * -3', '(* 2 (- 3))'],
    ['"a" & "b" = "ab"', '(= (& "a" "b") "ab")'],
    ['1 + 2 & "x"', '(& (+ 1 2) "x")'],
    ['[A] = 1 && [B] = 2 || [C]', '(|| (&& (= [A] 1) (= [B] 2)) [C])'],
    ['[A] || [B] && [C]', '(|| [A] (&& [B] [C]))'],
    ['NOT [A] = 1 && [B]', '(&& (NOT (= [A] 1)) [B])'],
    ['NOT([A])', '(NOT [A])'],
    ['[A] <> 1', '(<> [A] 1)'],
    ['[A] == BLANK()', '(== [A] (BLANK))'],
    ['[A] >= 1 + 1', '(>= [A] (+ 1 1))'],
    // Each level against its neighbours, from both sides:
    ['1 * 2 + 3', '(+ (* 1 2) 3)'],
    ['1 & 2 * 3', '(& 1 (* 2 3))'],
    ['1 * 2 & 3', '(& (* 1 2) 3)'],
    ['1 ^ 2 * 3', '(* (^ 1 2) 3)'],
    ['1 * 2 ^ 3', '(* 1 (^ 2 3))'],
    ['1 & 2 = 3 & 4', '(= (& 1 2) (& 3 4))'],
    ['1 = 2 && 3 = 4', '(&& (= 1 2) (= 3 4))'],
    ['1 && 2 || 3 && 4', '(|| (&& 1 2) (&& 3 4))'],
  ])('%s  →  %s', (source, expected) => {
    expect(tree(source)).toBe(expected);
  });
});

describe('IN, tuples and table constructors', () => {
  it.each([
    ['Product[Color] IN {"Red", "Blue"}', '(IN Product[Color] {"Red" "Blue"})'],
    ['(Product[Color], Plant[Code]) IN {("Red", "01"), ("Blue", "02")}', '(IN (tuple Product[Color] Plant[Code]) {(tuple "Red" "01") (tuple "Blue" "02")})'],
    ['{1, 2, 3}', '{1 2 3}'],
    ['{}', '{}'],
    ['[A] IN {1} && [B]', '(&& (IN [A] {1}) [B])'],
  ])('%s  →  %s', (source, expected) => {
    expect(tree(source)).toBe(expected);
  });
});

describe('variables', () => {
  it('parses VAR / RETURN and resolves references to their declaration', () => {
    const { root } = parseText('VAR x = 1 VAR y = x + 1 RETURN x * y');
    expect(toDebugString(root!)).toBe('(VAR (x 1) (y (+ var:x 1)) RETURN (* var:x var:y))');
    if (root?.kind !== 'VarBlock') throw new Error('expected VarBlock');
    const [x, y] = root.declarations;
    const body = root.body;
    expect(body).toMatchObject({ left: { declarationId: x.id }, right: { declarationId: y.id } });
  });

  it('matches variable names case-insensitively', () => {
    expect(tree('VAR Total = 1 RETURN TOTAL')).toBe('(VAR (Total 1) RETURN var:TOTAL)');
  });

  it('does not make a variable visible inside its own definition', () => {
    expect(tree('VAR Sales = Sales RETURN Sales')).toBe('(VAR (Sales Sales) RETURN var:Sales)');
  });

  it('supports nested VAR blocks with shadowing', () => {
    const { root } = parseText('VAR x = 1 RETURN VAR x = 2 RETURN x');
    if (root?.kind !== 'VarBlock' || root.body.kind !== 'VarBlock') throw new Error('expected nested VarBlocks');
    const inner = root.body;
    expect(inner.body).toMatchObject({ kind: 'VariableRef', declarationId: inner.declarations[0].id });
  });

  it('ends a variable scope with its block', () => {
    expect(tree('(VAR x = 1 RETURN x) + x')).toBe('(+ (VAR (x 1) RETURN var:x) x)');
  });

  it('allows VAR blocks as function arguments', () => {
    expect(tree('CALCULATE(VAR t = 1 RETURN t, ALL(Plant))')).toBe('(CALCULATE (VAR (t 1) RETURN var:t) (ALL Plant))');
  });
});

describe('comments', () => {
  it('ignores comments anywhere', () => {
    expect(tree('SUM( // total\n Sales[Amount] /* col */ ) -- end')).toBe('(SUM Sales[Amount])');
  });
});

describe('errors and recovery', () => {
  it('reports empty input', () => {
    const { root, diagnostics } = parseText('  // only a comment');
    expect(root).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['expected-expression']);
  });

  it('reports a missing closing parenthesis but keeps the call', () => {
    const { root, diagnostics } = parseText('SUM(Sales[Amount]');
    expect(diagnostics.map((d) => d.code)).toEqual(['expected-closing-paren']);
    expect(toDebugString(root!)).toBe('(SUM Sales[Amount])');
  });

  it('reports a missing comma and recovers at the closing parenthesis', () => {
    const { root, diagnostics } = parseText('DIVIDE([A] [B], [C])');
    expect(diagnostics.map((d) => d.code)).toEqual(['expected-comma-or-paren']);
    expect(toDebugString(root!)).toBe('(DIVIDE [A] [C])');
  });

  it('reports a dangling operator', () => {
    expect(codes('1 +')).toEqual(['expected-expression']);
  });

  it('reports trailing input once', () => {
    expect(codes('1 2 3')).toEqual(['unexpected-trailing-input']);
    expect(codes('SUM(Sales[Amount]))')).toEqual(['unexpected-trailing-input']);
  });

  it('reports VAR problems', () => {
    expect(codes('VAR = 1 RETURN 1')).toContain('expected-variable-name');
    expect(codes('VAR x 1 RETURN x')).toEqual(['expected-equals']);
    expect(codes('VAR x = 1')).toEqual(['expected-return']);
  });

  it('reports RETURN without VAR', () => {
    expect(codes('RETURN 1')[0]).toBe('expected-expression');
  });

  it('reports an unclosed table constructor', () => {
    expect(codes('{1, 2')).toEqual(['expected-closing-brace']);
  });

  it('does not repeat errors the lexer already reported', () => {
    const lex = tokenize('1 + @');
    expect(lex.diagnostics).toHaveLength(1);
    const { root, diagnostics } = parse(lex.tokens);
    expect(diagnostics).toEqual([]);
    expect(toDebugString(root!)).toBe('(+ 1 !error)');
  });

  it('never throws and always terminates on every prefix of every sample', () => {
    for (const sample of SAMPLE_MEASURES) {
      const header = splitMeasureDefinition(sample.expression).header!;
      for (let end = header.expressionStart; end <= sample.expression.length; end++) {
        const text = sample.expression.slice(0, end);
        expect(() => parse(tokenize(text, header.expressionStart).tokens)).not.toThrow();
      }
    }
  });

  it.each([')', ',', '}', '((((', ')))', ',,,', 'VAR VAR VAR', 'RETURN RETURN', '{,}', 'F(,,(', 'NOT NOT', '- - -'])(
    'survives token soup: %j',
    (source) => {
      expect(() => parseText(source)).not.toThrow();
      expect(parseText(source).diagnostics.length).toBeGreaterThan(0);
    },
  );
});

describe('built-in samples', () => {
  const expected: Record<string, string> = {
    'percent-of-total': '(DIVIDE [Total Sales] (CALCULATE [Total Sales] (REMOVEFILTERS Product[Category])))',
    'average-per-customer': '(AVERAGEX (VALUES Customer[Customer Key]) [Total Sales])',
    'plant-share-with-vars':
      '(VAR (CurrentPlantSales [Total Sales]) (AllPlantSales (CALCULATE [Total Sales] (ALL Plant))) RETURN (DIVIDE var:CurrentPlantSales var:AllPlantSales))',
    'top-plant':
      '(VAR (TopPlant (TOPN 1 (FILTER (VALUES Plant[Plant Name]) (<> Plant[Plant Name] "Unknown")) [Total Sales] DESC)) RETURN (CONCATENATEX var:TopPlant (& (& Plant[Plant Name] ": ") (FORMAT [Total Sales] "#,##0"))))',
    'best-plant-order-value': '(MAXX (VALUES Plant[Plant Name]) [Average Order Value])',
    'sales-by-ship-date': "(CALCULATE [Total Sales] (USERELATIONSHIP Sales[Ship Date] 'Date'[Date]))",
    'customers-who-bought': '(CALCULATE (COUNTROWS Customer) (CROSSFILTER Sales[Customer Key] Customer[Customer Key] BOTH))',
    'featured-category-sales': '(CALCULATE [Total Sales] (TREATAS {"Widgets" "Gadgets"} Product[Category]))',
  };

  it.each(SAMPLE_MEASURES.map((s) => [s.id, s.expression]))('parses sample "%s" into the expected tree', (sampleId, text) => {
    const header = splitMeasureDefinition(text).header!;
    const { root, diagnostics } = parse(tokenize(text, header.expressionStart).tokens);
    expect(diagnostics).toEqual([]);
    expect(toDebugString(root!)).toBe(expected[sampleId]);
  });
});

describe('span invariants', () => {
  const inputs = [
    ...SAMPLE_MEASURES.map((s) => s.expression.slice(splitMeasureDefinition(s.expression).header!.expressionStart)),
    'VAR x = {1, (2, 3)} RETURN -x ^ 2 IN T && NOT [A]',
    'DIVIDE([A] [B], ',
  ];

  it.each(inputs)('every child span lies within its parent span: %#', (source) => {
    const { root } = parseText(source);
    const check = (node: AstNode) => {
      expect(node.span.start).toBeLessThanOrEqual(node.span.end);
      for (const { node: child } of childrenOf(node)) {
        expect(child.span.start).toBeGreaterThanOrEqual(node.span.start);
        expect(child.span.end).toBeLessThanOrEqual(node.span.end);
        check(child);
      }
    };
    check(root!);
  });

  it.each(inputs)('node ids are unique and findNode locates every node: %#', (source) => {
    const root = parseText(source).root as Expr;
    const nodes = allNodes(root);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    for (const node of nodes) expect(findNode(root, node.id)).toBe(node);
  });
});
