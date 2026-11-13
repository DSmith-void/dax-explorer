import { describe, expect, it } from 'vitest';
import { FUNCTION_CATALOG, arity, lookupFunction, parametersForCall } from '../catalog/functions';
import { tokenize } from '../lexer/lexer';
import { createModelIndex } from '../model';
import { childrenOf, type AstNode, type Expr } from '../parser/ast';
import { parse } from '../parser/parser';
import { bind, referenceKey, type BindOptions, type ReferenceResolution } from './binder';

const CONVENTION: BindOptions = { mode: 'convention', userChoices: {} };
const STRICT: BindOptions = { mode: 'strict', userChoices: {} };

function rootOf(source: string): Expr {
  const { root, diagnostics } = parse(tokenize(source).tokens);
  expect(diagnostics).toEqual([]);
  return root!;
}

function allNodes(node: AstNode): AstNode[] {
  return [node, ...childrenOf(node).flatMap((c) => allNodes(c.node))];
}

/** Resolutions in source order, as compact strings: "[Total Sales] measure convention". */
function resolutions(source: string, options: BindOptions = CONVENTION): string[] {
  const root = rootOf(source);
  const result = bind(root, options);
  return allNodes(root)
    .filter((n) => n.kind === 'BracketRef' || n.kind === 'ColumnRef')
    .map((n) => {
      const r = result.references.get(n.id) as ReferenceResolution;
      return `${source.slice(n.span.start, n.span.end)} ${r.type ?? '?'} ${r.source}${r.locked ? ' locked' : ''}`;
    });
}

describe('function catalog', () => {
  it('has unique, upper-case names', () => {
    const names = FUNCTION_CATALOG.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toBe(name.toUpperCase());
  });

  it('looks up names case-insensitively', () => {
    expect(lookupFunction('calculate')?.name).toBe('CALCULATE');
    expect(lookupFunction('NOTAFUNCTION')).toBeUndefined();
  });

  it('only allows optional/repeating parameters at the end', () => {
    for (const spec of FUNCTION_CATALOG) {
      for (const params of spec.overloads) {
        const firstOptional = params.findIndex((param) => param.optional);
        if (firstOptional !== -1) {
          expect(params.slice(firstOptional).every((param) => param.optional || param.repeating), spec.name).toBe(true);
        }
        const firstRepeating = params.findIndex((param) => param.repeating);
        if (firstRepeating !== -1) {
          expect(params.slice(firstRepeating).every((param) => param.repeating), `${spec.name}: repeating group must be trailing`).toBe(true);
        }
        params.forEach((param) => {
          if (param.role === 'keyword') expect(param.keywords?.length, `${spec.name}: keywords`).toBeGreaterThan(0);
        });
      }
    }
  });

  it('gives iterators an iterated table argument and a row expression', () => {
    for (const spec of FUNCTION_CATALOG.filter((f) => f.category === 'iterator')) {
      const params = spec.overloads[0];
      expect(spec.iteratesArgument, spec.name).toBeDefined();
      // A table, or for FIRSTNONBLANK and the like, a column (they go through its values).
      expect(params[spec.iteratesArgument!].role, `${spec.name}: iterated argument is a table or a column`).toBeOneOf(['table', 'column']);
      expect(params.some((param) => param.role === 'rowExpression'), spec.name).toBe(true);
    }
  });

  it.each([
    ['TOPN', 6, ['scalar', 'table', 'rowExpression', 'keyword', 'rowExpression', 'keyword']],
    ['ADDCOLUMNS', 5, ['table', 'scalar', 'rowExpression', 'scalar', 'rowExpression']],
    ['CONCATENATEX', 5, ['table', 'rowExpression', 'scalar', 'rowExpression', 'keyword']],
  ] as const)('cycles repeating parameter groups: %s with %i arguments', (name, count, roles) => {
    expect(parametersForCall(lookupFunction(name)!, count)?.map((param) => param.role)).toEqual(roles);
  });

  it.each([
    ['CALCULATE', 1, ['scalar']],
    ['CALCULATE', 3, ['scalar', 'filter', 'filter']],
    ['MIN', 1, ['column']],
    ['MIN', 2, ['scalar', 'scalar']],
    ['ALL', 0, []],
    ['ALL', 3, ['tableOrColumn', 'column', 'column']],
    ['DIVIDE', 3, ['scalar', 'scalar', 'scalar']],
  ] as const)('maps %s with %i arguments to roles %j', (name, count, roles) => {
    expect(parametersForCall(lookupFunction(name)!, count)?.map((param) => param.role)).toEqual(roles);
  });

  it.each([
    ['SUM', 0],
    ['SUM', 2],
    ['DIVIDE', 1],
    ['DIVIDE', 4],
    ['MIN', 3],
  ])('rejects %s with %i arguments', (name, count) => {
    expect(parametersForCall(lookupFunction(name)!, count)).toBeNull();
  });

  it('computes arity', () => {
    expect(arity(lookupFunction('CALCULATE')!.overloads[0])).toEqual({ min: 1, max: Infinity });
    expect(arity(lookupFunction('DIVIDE')!.overloads[0])).toEqual({ min: 2, max: 3 });
  });
});

describe('reference resolution: function signature evidence', () => {
  it.each([
    'SUM([Amount])',
    'VALUES([Category])',
    'REMOVEFILTERS([Category])',
    'SELECTEDVALUE([Category], "none")',
    'HASONEVALUE([Category])',
    'RELATED([Category])',
  ])('locks [X] as a column in %s', (source) => {
    expect(resolutions(source)[0]).toMatch(/ column function-signature locked$/);
  });

  it('locks every column of ALL(col, col, col)', () => {
    expect(resolutions('ALL(Product[Category], Product[Color], [Size])')).toEqual([
      'Product[Category] column function-signature locked',
      'Product[Color] column function-signature locked',
      '[Size] column function-signature locked',
    ]);
  });

  it('applies signature evidence in strict mode too', () => {
    expect(resolutions('SUM(Sales[Amount])', STRICT)).toEqual(['Sales[Amount] column function-signature locked']);
  });

  it('does not treat a reference nested inside an argument expression as that argument', () => {
    // The CALCULATE filter argument is "[A] = 1"; [A] itself is not required to be a column.
    expect(resolutions('CALCULATE([X], [A] = 1)')).toEqual(['[X] measure convention', '[A] measure convention']);
  });

  it('describes the requirement', () => {
    const root = rootOf('SUM([Amount])');
    const [ref] = [...bind(root, CONVENTION).references.values()];
    expect(ref.detail).toBe('certain: SUM only accepts a column here');
  });

  it('ignores evidence from functions that are not in the catalog', () => {
    expect(resolutions('MYFUNC([X])')).toEqual(['[X] measure convention']);
  });
});

describe('reference resolution: convention mode', () => {
  it('assumes [X] is a measure and Table[X] is a column', () => {
    expect(resolutions('DIVIDE([Total Sales], Sales[Amount])')).toEqual([
      '[Total Sales] measure convention',
      'Sales[Amount] column convention',
    ]);
  });

  it('uses a column requirement elsewhere for other occurrences of the same name', () => {
    expect(resolutions('SUM([Amount]) + [Amount]')).toEqual([
      '[Amount] column function-signature locked',
      '[Amount] column other-occurrence',
    ]);
  });
});

describe('reference resolution: strict mode', () => {
  it('leaves references unresolved without evidence', () => {
    expect(resolutions('DIVIDE([Total Sales], Sales[Amount])', STRICT)).toEqual([
      '[Total Sales] ? unresolved',
      'Sales[Amount] ? unresolved',
    ]);
  });

  it('mentions other column use as a hint but does not assume', () => {
    const root = rootOf('SUM([Amount]) + [Amount]');
    const refs = [...bind(root, STRICT).references.values()];
    expect(refs[1]).toMatchObject({ type: null, source: 'unresolved' });
    expect(refs[1].detail).toContain('it is used as a column in SUM elsewhere');
  });
});

describe('reference resolution: user choices', () => {
  it('applies a choice to every occurrence of the name (case-insensitively)', () => {
    const options: BindOptions = { mode: 'strict', userChoices: { '[total sales]': 'column' } };
    expect(resolutions('[Total Sales] + [TOTAL SALES]', options)).toEqual([
      '[Total Sales] column user',
      '[TOTAL SALES] column user',
    ]);
  });

  it('overrides the convention', () => {
    const options: BindOptions = { mode: 'convention', userChoices: { 'sales[total sales]': 'measure' } };
    expect(resolutions('Sales[Total Sales]', options)).toEqual(['Sales[Total Sales] measure user']);
  });

  it('cannot override a function signature, and reports the conflict', () => {
    const options: BindOptions = { mode: 'convention', userChoices: { '[amount]': 'measure' } };
    const root = rootOf('SUM([Amount])');
    const result = bind(root, options);
    expect([...result.references.values()][0]).toMatchObject({ type: 'column', source: 'function-signature' });
    expect(result.diagnostics).toMatchObject([{ severity: 'warning', code: 'reference-type-conflict' }]);
  });

  it('keys bracket and qualified references separately', () => {
    const root = rootOf('[A] + T[A]');
    const keys = allNodes(root)
      .filter((n) => n.kind === 'BracketRef' || n.kind === 'ColumnRef')
      .map((n) => referenceKey(n as never));
    expect(keys).toEqual(['[a]', 't[a]']);
  });
});

describe('reference resolution: connected model', () => {
  const model = createModelIndex({
    tables: ['Sales', 'Product', 'Sales Order'],
    columns: [
      { table: 'Sales', name: 'Amount' },
      { table: 'Product', name: 'Category' },
      { table: 'Product', name: 'Amount' }, // same column name in two tables
      { table: 'Sales Order', name: 'Net Price' },
    ],
    measures: [{ table: 'Sales', name: 'Total Sales', expression: 'SUM(Sales[Amount])' }],
    calendars: ['Fiscal Calendar'],
  });
  const WITH_MODEL: BindOptions = { mode: 'strict', userChoices: {}, model };

  it("accepts a calendar's name where a table is written (calendar-based time intelligence)", () => {
    expect(bind(rootOf("SAMEPERIODLASTYEAR('Fiscal Calendar')"), WITH_MODEL).diagnostics).toEqual([]);
  });

  it('makes measures and columns certain, even in strict mode', () => {
    expect(resolutions("DIVIDE([total sales], 'Sales Order'[Net Price])", WITH_MODEL)).toEqual([
      '[total sales] measure model locked',
      "'Sales Order'[Net Price] column model locked",
    ]);
  });

  it("attaches the measure's DAX definition", () => {
    const [ref] = [...bind(rootOf('[Total Sales]'), WITH_MODEL).references.values()];
    expect(ref.definition).toEqual({ table: 'Sales', name: 'Total Sales', expression: 'SUM(Sales[Amount])' });
    expect(ref.detail).toBe('certain: [Total Sales] is a measure in your model');
  });

  it('recognizes a measure written with a table name', () => {
    expect(resolutions('Sales[Total Sales]', WITH_MODEL)).toEqual(['Sales[Total Sales] measure model locked']);
  });

  it('knows an unqualified column, and names every table that has it', () => {
    const [ref] = [...bind(rootOf('SUMX(Sales, [Amount])'), WITH_MODEL).references.values()];
    expect(ref).toMatchObject({ type: 'column', source: 'model' });
    expect(ref.detail).toBe('certain: your model has a column named Amount (in the tables Sales, Product)');
  });

  it('overrides your own choices and the naming convention', () => {
    const options: BindOptions = { mode: 'convention', userChoices: { '[total sales]': 'column' }, model };
    expect(resolutions('[Total Sales]', options)).toEqual(['[Total Sales] measure model locked']);
  });

  it('reports a measure used where a column is required as a real error', () => {
    const result = bind(rootOf('SUM([Total Sales])'), WITH_MODEL);
    expect(result.diagnostics).toMatchObject([{ severity: 'error', code: 'measure-where-column-required' }]);
    expect(result.diagnostics[0].message).toBe(
      '[Total Sales] is a measure in your model, but SUM only accepts a column here. DAX will report an error.',
    );
  });

  it('warns about names the model does not have, and falls back to the other evidence', () => {
    const result = bind(rootOf('[Totl Sales] + SUM(Sales[Amout])'), { ...WITH_MODEL, mode: 'convention' });
    expect(result.diagnostics.map((d) => d.code)).toEqual(['not-in-model', 'not-in-model']);
    expect([...result.references.values()].map((r) => `${r.type} ${r.source}`)).toEqual(['measure convention', 'column function-signature']);
  });

  it('warns about tables the model does not have', () => {
    const result = bind(rootOf('COUNTROWS(Salse)'), WITH_MODEL);
    expect(result.diagnostics).toMatchObject([{ code: 'table-not-in-model' }]);
    expect(result.diagnostics[0].message).toContain('no table or calendar named Salse');
  });

  it('does not treat keyword arguments as tables', () => {
    expect(bind(rootOf('RANKX(ALL(Product), [Total Sales], , DESC)'), WITH_MODEL).diagnostics).toEqual([]);
  });

  it('changes nothing when no model is connected', () => {
    expect(bind(rootOf('[Anything] + COUNTROWS(Whatever)'), CONVENTION).diagnostics).toEqual([]);
  });
});

describe('calls, keywords and unknown functions', () => {
  it('records the catalog entry and parameters for each call', () => {
    const root = rootOf('CALCULATE([X], ALL(Plant))');
    const calls = bind(root, CONVENTION).calls;
    const roles = [...calls.values()].map((c) => `${c.spec?.name}:${c.params?.map((p) => p.role).join(',')}`);
    expect(roles).toEqual(['CALCULATE:scalar,filter', 'ALL:tableOrColumn']);
  });

  it('lists unknown functions once each', () => {
    const root = rootOf('MYFUNC(1) + myfunc(2) + OTHER()');
    expect(bind(root, CONVENTION).unknownFunctions).toEqual(['MYFUNC', 'OTHER']);
  });

  it('recognizes keyword arguments such as DESC and BOTH', () => {
    const root = rootOf('RANKX(ALL(Product), [Total Sales], , DESC) + CALCULATE([X], CROSSFILTER(Sales[ProductKey], Product[ProductKey], BOTH))');
    const result = bind(root, CONVENTION);
    const keywordTexts = allNodes(root)
      .filter((n) => result.keywordNodeIds.has(n.id))
      .map((n) => (n.kind === 'TableRef' ? n.name : ''));
    expect(keywordTexts).toEqual(['DESC', 'BOTH']);
  });

  it('does not treat an unexpected name in a keyword position as a keyword', () => {
    const root = rootOf('RANKX(ALL(Product), [Total Sales], , Sideways)');
    expect(bind(root, CONVENTION).keywordNodeIds.size).toBe(0);
  });

  it.each([
    ['SUM(Sales[Amount], 1)', 'SUM does not accept 2 arguments (expects 1).'],
    ['DIVIDE(1)', 'DIVIDE does not accept 1 argument (expects 2 to 3).'],
    ['MIN(1, 2, 3)', 'MIN does not accept 3 arguments (expects 1 or 2).'],
    ['COALESCE(1)', 'COALESCE does not accept 1 argument (expects 2 or more).'],
  ])('warns about argument counts: %s', (source, message) => {
    expect(bind(rootOf(source), CONVENTION).diagnostics).toMatchObject([{ severity: 'warning', code: 'argument-count', message }]);
  });

  it('returns an empty result for no tree', () => {
    expect(bind(null, CONVENTION).references.size).toBe(0);
  });
});
