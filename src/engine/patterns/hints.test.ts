import { describe, expect, it } from 'vitest';
import { INITECH_MODEL } from '../../samples/initechModel';
import { SAMPLE_MEASURES } from '../../samples/sampleMeasures';
import { bind } from '../binder/binder';
import { analyzeContext } from '../context/analyzer';
import type { ReportFilter } from '../context/reportFilters';
import type { RelationshipModel } from '../context/relationships';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { findHints, hintBadge, type Hint } from './hints';

function hints(definition: string, options: { reportFilters?: ReportFilter[]; model?: RelationshipModel | null } = {}): Hint[] {
  const start = splitMeasureDefinition(definition).header!.expressionStart;
  const { root } = parse(tokenize(definition, start).tokens);
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  const model = options.model === undefined ? INITECH_MODEL : options.model;
  const analysis = analyzeContext(root, binding, definition, undefined, model ?? undefined);
  return findHints({ root, binding, analysis, source: definition, reportFilters: options.reportFilters, model });
}

const checks = (list: Hint[]) => list.map((h) => h.check);
const one = (list: Hint[], check: string) => {
  const found = list.filter((h) => h.check === check);
  expect(found).toHaveLength(1);
  return found[0];
};

const RED: ReportFilter[] = [{ kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'] }];

describe('FILTER over a whole table as a CALCULATE filter', () => {
  it('suggests a column filter with KEEPFILTERS, and says when it differs', () => {
    const hint = one(hints('M = CALCULATE([Total Sales], FILTER(Sales, Sales[Quantity] > 1))'), 'filter-whole-table');
    expect(hint.kind).toBe('cost');
    expect(hint.suggestion?.dax).toBe('KEEPFILTERS(Sales[Quantity] > 1)');
    expect(hint.suggestion?.note).toContain('removes filters from a related table');
  });

  it('is quiet for FILTER over a column, over ALL, or with a measure in the condition', () => {
    expect(checks(hints('M = CALCULATE([Total Sales], FILTER(VALUES(Product[Category]), Product[Category] <> "Gadgets"))'))).not.toContain('filter-whole-table');
    expect(checks(hints('M = CALCULATE([Total Sales], FILTER(ALL(Product), Product[Category] = "Gadgets"))'))).not.toContain('filter-whole-table');
    expect(checks(hints('M = CALCULATE([Total Sales], FILTER(Sales, [Total Sales] > 100))'))).not.toContain('filter-whole-table');
    expect(checks(hints('M = CALCULATE([Total Sales], FILTER(Sales, Product[Category] = "Gadgets"))'))).not.toContain('filter-whole-table');
  });
});

describe('a measure inside an iterator over a whole fact table', () => {
  it('Sales is a fact table: one calculation per row, and duplicate rows counted twice', () => {
    const hint = one(hints('M = SUMX(Sales, [Total Sales])'), 'measure-over-table');
    expect(hint.title).toBe('[Total Sales] is calculated once for every row of Sales.');
    expect(hint.why).toContain('counted twice');
    // The general "done silently" note for the same measure is not repeated.
    expect(checks(hints('M = SUMX(Sales, [Total Sales])'))).not.toContain('context-transition');
  });

  it('is quiet over a lookup table (Customer), over a column, and when the model is not known', () => {
    expect(checks(hints('M = AVERAGEX(Customer, [Total Sales])'))).not.toContain('measure-over-table');
    expect(checks(hints('M = SUMX(VALUES(Sales[Order Key]), [Total Sales])'))).not.toContain('measure-over-table');
    expect(checks(hints('M = SUMX(Sales, [Total Sales])', { model: null }))).not.toContain('measure-over-table');
  });
});

describe('turning BLANK into 0', () => {
  it('finds + 0, COALESCE and IF(ISBLANK) in the result, also through a returned variable', () => {
    expect(one(hints('M = [Total Sales] + 0'), 'blank-to-zero').title).toBe('Adding 0 turns BLANK into 0.');
    expect(one(hints('M = COALESCE([Total Sales], 0)'), 'blank-to-zero').title).toContain('COALESCE');
    expect(one(hints('M = VAR s = [Total Sales] VAR r = IF(ISBLANK(s), 0, s) RETURN r'), 'blank-to-zero').title).toContain('IF(ISBLANK');
  });

  it('is quiet when the 0 is not the result', () => {
    expect(checks(hints('M = SUMX(Customer, [Total Sales] + 0)'))).not.toContain('blank-to-zero');
    expect(checks(hints('M = [Total Sales] + 1'))).not.toContain('blank-to-zero');
  });
});

describe('"/"', () => {
  it('a divisor that can be 0 or BLANK: suggests DIVIDE', () => {
    const hint = one(hints('M = [Total Sales] / [Order Count]'), 'divide-operator');
    expect(hint.suggestion?.dax).toBe('DIVIDE([Total Sales], [Order Count])');
  });

  it('is quiet when dividing by a fixed number, or inside DIVIDE / IF / IFERROR', () => {
    expect(checks(hints('M = [Total Sales] / 1000'))).not.toContain('divide-operator');
    expect(checks(hints('M = IF([Order Count] > 0, [Total Sales] / [Order Count])'))).not.toContain('divide-operator');
    expect(checks(hints('M = IFERROR([Total Sales] / [Order Count], 0)'))).not.toContain('divide-operator');
  });
});

describe('IFERROR / ISERROR', () => {
  it('suggests DIVIDE for a division, keeping the alternate result', () => {
    expect(one(hints('M = IFERROR([Total Sales] / [Order Count], 0)'), 'iferror').suggestion?.dax).toBe('DIVIDE([Total Sales], [Order Count], 0)');
    expect(one(hints('M = IFERROR([Total Sales] / [Order Count], BLANK())'), 'iferror').suggestion?.dax).toBe('DIVIDE([Total Sales], [Order Count])');
    expect(one(hints('M = IF(ISERROR([Total Sales]), 1, 2)'), 'iferror').suggestion).toBeUndefined();
  });
});

describe('the variable trap', () => {
  it('a variable used inside CALCULATE keeps its value', () => {
    const hint = one(hints('M = VAR s = [Total Sales] RETURN DIVIDE(s, CALCULATE(s, REMOVEFILTERS(Product)))'), 'variable-fixed');
    expect(hint.kind).toBe('warning');
  });
});

describe('a CALCULATE filter replaces the filter on the same column', () => {
  const measure = 'M = CALCULATE([Total Sales], Product[Category] = "Gadgets")';

  it('with a report filter on that column: a warning naming it, with KEEPFILTERS', () => {
    const hint = one(hints(measure, { reportFilters: RED }), 'replaces-report-filter');
    expect(hint.kind).toBe('warning');
    expect(hint.title).toBe('Product[Category] = "Gadgets" replaces the report\'s filter Product[Category] = "Widgets".');
    expect(hint.why).toContain('Filters on other columns of Product still apply.');
    expect(hint.suggestion?.dax).toBe('KEEPFILTERS(Product[Category] = "Gadgets")');
  });

  it('without one: done silently, said once', () => {
    const hint = one(hints(measure), 'replaces-filter');
    expect(hint.kind).toBe('silent');
    expect(hint.why).toContain('If a slicer or the report filters Product[Category], this result ignores it.');
    const other: ReportFilter[] = [{ kind: 'values', column: { table: 'Plant', column: 'Plant Name' }, values: ['Austin'] }];
    expect(checks(hints(measure, { reportFilters: other }))).toContain('replaces-filter');
  });

  it('a report filter already removed (ALL) is not reported as replaced', () => {
    const list = hints('M = CALCULATE([Total Sales], ALL(Product), Product[Category] = "Gadgets")', { reportFilters: RED });
    expect(checks(list)).not.toContain('replaces-report-filter');
  });

  it('is quiet for KEEPFILTERS, FILTER over a table as it is, TREATAS and time intelligence', () => {
    for (const text of [
      'M = CALCULATE([Total Sales], KEEPFILTERS(Product[Category] = "Gadgets"))',
      'M = CALCULATE([Total Sales], FILTER(Sales, Sales[Quantity] > 1))',
      'M = CALCULATE([Total Sales], TREATAS({"Gadgets"}, Product[Category]))',
      "M = CALCULATE([Total Sales], DATESYTD('Date'[Date]))",
    ]) {
      expect(checks(hints(text, { reportFilters: RED }))).not.toContain('replaces-report-filter');
      expect(checks(hints(text))).not.toContain('replaces-filter');
    }
  });
});

describe('a filter on a column sorted by another column', () => {
  it("Month is sorted by Month Number: the Month Number filter stays; suggests removing it", () => {
    const hint = one(hints(`M = CALCULATE([Total Sales], 'Date'[Month] = "Jan")`), 'sort-by-column');
    expect(hint.kind).toBe('warning');
    expect(hint.title).toBe(`'Date'[Month] = "Jan" leaves the filter on Date[Month Number] in place (Month is sorted by it).`);
    expect(hint.suggestion?.dax).toBe("REMOVEFILTERS('Date'[Month Number])");
  });

  it('is quiet when the same CALCULATE removes or sets Month Number, or the model is not known', () => {
    for (const text of [
      `M = CALCULATE([Total Sales], 'Date'[Month] = "Jan", REMOVEFILTERS('Date'[Month Number]))`,
      `M = CALCULATE([Total Sales], 'Date'[Month] = "Jan", 'Date'[Month Number] = 1)`,
      `M = CALCULATE([Total Sales], 'Date'[Month] = "Jan", ALL('Date'))`,
      `M = CALCULATE([Total Sales], 'Date'[Year] = 2025)`,
    ]) {
      expect(checks(hints(text))).not.toContain('sort-by-column');
    }
    expect(checks(hints(`M = CALCULATE([Total Sales], 'Date'[Month] = "Jan")`, { model: null }))).not.toContain('sort-by-column');
  });
});

describe('the built-in examples made for these checks', () => {
  it('Total Sales (Row by Row) and January Sales show their hint', () => {
    const example = (id: string) => SAMPLE_MEASURES.find((m) => m.id === id)!.expression;
    expect(checks(hints(example('total-sales-row-by-row')))).toContain('measure-over-table');
    expect(checks(hints(example('january-sales')))).toContain('sort-by-column');
  });
});

describe('done silently', () => {
  it('context transition of a measure inside an iterator', () => {
    expect(one(hints('M = AVERAGEX(Customer, [Total Sales])'), 'context-transition').kind).toBe('silent');
  });

  it('a whole-table filter also filters the tables it looks up (expanded table)', () => {
    const hint = one(hints('M = CALCULATE([Total Sales], FILTER(Sales, Sales[Quantity] > 1))'), 'expanded-table');
    expect(hint.title).toMatch(/^Filtering the whole Sales table also filters /);
    expect(hint.title).toContain('Product');
    expect(checks(hints('M = CALCULATE([Total Sales], FILTER(Sales, Sales[Quantity] > 1))', { model: null }))).not.toContain('expanded-table');
  });

  it("a date table's other filters are removed automatically", () => {
    const hint = one(hints(`M = CALCULATE([Total Sales], 'Date'[Date] >= DATE(2026, 1, 1))`), 'date-table-filters-removed');
    expect(hint.title).toBe('All other filters on Date are removed automatically.');
  });

  it('ALLSELECTED depends on the visual', () => {
    expect(one(hints('M = CALCULATE([Total Sales], ALLSELECTED(Product))'), 'allselected').kind).toBe('silent');
  });
});

describe('order', () => {
  it('warnings first, then slow patterns, notes, and things done silently; within a kind, in code order', () => {
    const list = hints('M = VAR s = [Total Sales] RETURN CALCULATE(s, Product[Category] = "Gadgets") / [Order Count] + 0', { reportFilters: RED });
    const kinds = list.map((h) => h.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => ['warning', 'cost', 'note', 'silent'].indexOf(a) - ['warning', 'cost', 'note', 'silent'].indexOf(b)));
    expect(checks(list)).toEqual(expect.arrayContaining(['variable-fixed', 'replaces-report-filter', 'blank-to-zero', 'divide-operator']));
  });
});

describe("the Hints tab's badge", () => {
  it('counts every hint, coloured by the most important kind, with a breakdown', () => {
    expect(hintBadge([])).toBeNull();
    const silentOnly = hints('M = CALCULATE([Total Sales], Product[Category] = "Gadgets")');
    expect(hintBadge(silentOnly)).toEqual({ count: 1, kind: 'silent', breakdown: '1 done silently' });
    const mixed = hints('M = VAR s = [Total Sales] RETURN CALCULATE(s, Product[Category] = "Gadgets") / [Order Count] + 0');
    const badge = hintBadge(mixed)!;
    expect(badge.kind).toBe('warning');
    expect(badge.count).toBe(mixed.length);
    expect(badge.breakdown).toBe('1 to check, 1 slow, 1 worth knowing, 1 done silently');
  });
});
