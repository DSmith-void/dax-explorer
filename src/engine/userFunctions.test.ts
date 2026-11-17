import { describe, expect, it } from 'vitest';
import { INITECH_MODEL } from '../samples/initechModel';
import { bind } from './binder/binder';
import { analyzeContext } from './context/analyzer';
import { INITIAL_CONTEXT } from './context/model';
import { splitMeasureDefinition } from './definition';
import { tokenize } from './lexer/lexer';
import { createModelIndex } from './model';
import { findNode, type AstNode } from './parser/ast';
import { parse } from './parser/parser';
import { readUserFunction, userFunctionSpec } from './userFunctions';

// Made-up functions, shaped like the ones Power BI lists (INFO.USERDEFINEDFUNCTIONS).
const FUNCTIONS = [
  { name: 'Text.Rounded', expression: '(\n    value : SCALAR NUMERIC VAL,\n    digits : SCALAR INT64 VAL = 2,\n    suffix : SCALAR STRING VAL = " units, net"\n) =>\n    ROUND(value, digits) & suffix', description: 'Rounds a number\n@param {NUMERIC} value - the number' },
  { name: 'AllProducts', expression: '(x : SCALAR NUMERIC EXPR) => CALCULATE(x, ALL(\'Product\'))' },
  { name: 'Distinct', expression: '(c : COLUMNREF) => COUNTROWS(VALUES(c))' },
  { name: 'Twice', expression: '(x) => x * 2' },
  { name: 'TopProducts', expression: '(n : SCALAR INT64) => VAR k = n RETURN TOPN(k, VALUES(\'Product\'[Product]))' },
];

const model = createModelIndex({
  tables: ['Sales', 'Product'],
  columns: [
    { table: 'Sales', name: 'Amount' },
    { table: 'Product', name: 'Category' },
    { table: 'Product', name: 'Product' },
  ],
  measures: [{ table: 'Sales', name: 'Total Sales', expression: 'SUM(Sales[Amount])' }],
  functions: FUNCTIONS,
});

function explain(definition: string) {
  const { root } = parse(tokenize(definition, splitMeasureDefinition(definition).header!.expressionStart).tokens);
  const binding = bind(root, { mode: 'convention', userChoices: {}, model });
  const analysis = analyzeContext(root, binding, definition, INITIAL_CONTEXT, INITECH_MODEL);
  const text = (node: AstNode) => definition.slice(node.span.start, node.span.end);
  /** The step of the code written exactly so. */
  const find = (written: string) => {
    for (const id of analysis.steps.keys()) {
      const node = findNode(root, id);
      if (node && text(node) === written) return analysis.steps.get(id)!;
    }
    throw new Error(`No step for ${written}`);
  };
  return { binding, analysis, find };
}

describe('reading a function of the model', () => {
  it('reads its inputs: type, VAL or EXPR (VAL by default, references are EXPR), defaults', () => {
    const fn = readUserFunction(FUNCTIONS[0].name, FUNCTIONS[0].expression);
    expect(fn.params).toEqual([
      { name: 'value', type: 'SCALAR NUMERIC', mode: 'val', defaultText: null },
      { name: 'digits', type: 'SCALAR INT64', mode: 'val', defaultText: '2' },
      // A comma inside a default's text doesn't split it.
      { name: 'suffix', type: 'SCALAR STRING', mode: 'val', defaultText: '" units, net"' },
    ]);
    expect(FUNCTIONS[0].expression.slice(fn.bodyStart).trim()).toMatch(/^ROUND\(value/);
    expect(readUserFunction('Twice', '(x) => x * 2').params).toEqual([{ name: 'x', type: '', mode: 'val', defaultText: null }]);
    expect(readUserFunction('AllProducts', FUNCTIONS[1].expression).params?.[0].mode).toBe('expr');
    expect(readUserFunction('Distinct', FUNCTIONS[2].expression).params?.[0]).toMatchObject({ mode: 'expr', reference: 'column' });
    expect(readUserFunction('None', '() => 1').params).toEqual([]);
  });

  it("can't read code that doesn't start with its inputs: then it stays unknown", () => {
    expect(readUserFunction('Odd', 'SUM(Sales[Amount])').params).toBeNull();
    expect(userFunctionSpec(readUserFunction('Odd', 'SUM(Sales[Amount])'))).toBeUndefined();
  });

  it('becomes a catalog entry: inputs with defaults are optional; a table function returns a table', () => {
    const spec = userFunctionSpec(readUserFunction(FUNCTIONS[0].name, FUNCTIONS[0].expression))!;
    expect(spec.overloads[0].map((p) => [p.role, p.optional ?? false])).toEqual([['scalar', false], ['scalar', true], ['scalar', true]]);
    expect(spec.returns).toBe('scalar');
    expect(userFunctionSpec(readUserFunction('TopProducts', FUNCTIONS[4].expression))!.returns).toBe('table');
  });
});

describe('a call to a function of the model', () => {
  it('is known (not "unknown"), case-insensitively, with its inputs checked', () => {
    const { binding } = explain('M = text.rounded([Total Sales]) & Twice(2)');
    expect(binding.unknownFunctions).toEqual([]);
    expect(binding.diagnostics).toEqual([]);
    const tooMany = explain('M = Twice(1, 2)').binding.diagnostics;
    expect(tooMany.map((d) => d.code)).toEqual(['argument-count']);
  });

  it('says how each input is passed, and which defaults are used', () => {
    const { find } = explain('M = Text.Rounded([Total Sales])');
    expect(find('Text.Rounded([Total Sales])').notes).toEqual([
      'Runs Text.Rounded, a function defined in this model: Rounds a number.',
      'value is worked out first, here, with the filters at this point, and passed in as a value (VAL).',
      'Left out, so they use their defaults: digits = 2, suffix = " units, net".',
    ]);
    // A value input is a normal step, with the filters at the call.
    expect(find('[Total Sales]').context.unknownReason).toBeNull();
  });

  it('an expression input is worked out inside the function: not claimed with the filters at the call', () => {
    const { find } = explain("M = CALCULATE(AllProducts([Total Sales]), 'Product'[Category] = \"Widgets\")");
    expect(find('AllProducts([Total Sales])').notes[1]).toContain('passed as code (EXPR or a reference)');
    expect(find('[Total Sales]').context.unknownReason).toBe('worked out inside the function it is passed to');
  });

  it('a column reference input makes [Name] a column', () => {
    const { binding } = explain('M = Distinct(Sales[Amount])');
    expect([...binding.references.values()].map((r) => r.type)).toEqual(['column']);
  });

  it("inside a loop, says that calling a function doesn't turn the row into a filter", () => {
    const { find } = explain("M = SUMX(VALUES('Product'[Category]), Twice(SUM(Sales[Amount])))");
    expect(find('Twice(SUM(Sales[Amount]))').notes.at(-1)).toContain("Unlike a measure, calling a function doesn't turn the current row into a filter");
  });
});
