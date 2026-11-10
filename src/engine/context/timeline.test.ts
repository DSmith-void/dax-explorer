import { describe, expect, it } from 'vitest';
import { SAMPLE_MEASURES } from '../../samples/sampleMeasures';
import { bind } from '../binder/binder';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { analyzeContext } from './analyzer';
import { describeContext } from './describe';
import { buildTimeline, type TimelineEntry } from './timeline';

/** The timeline of a "Name = expression" measure, using naming conventions for measures and columns. */
function timeline(definition: string): TimelineEntry[] {
  const start = splitMeasureDefinition(definition).header!.expressionStart;
  const { root, diagnostics } = parse(tokenize(definition, start).tokens);
  expect(diagnostics).toEqual([]);
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  return buildTimeline(root, binding, analyzeContext(root, binding, definition), definition);
}

const titles = (entries: TimelineEntry[]) => entries.map((e) => e.title);
const sample = (id: string) => SAMPLE_MEASURES.find((s) => s.id === id)!.expression;
const START = "Start with the report's filters";
const RESULT = 'The result goes back to the report';

describe('buildTimeline: DAX evaluation order', () => {
  it('percent of total: numerator, then the CALCULATE filter input, then CALCULATE, then its inside, then DIVIDE', () => {
    const entries = timeline(sample('percent-of-total'));
    expect(titles(entries)).toEqual([
      START,
      'Calculate [Total Sales]',
      'Prepare filter: REMOVEFILTERS(Product[Category])',
      'CALCULATE applies its filters',
      'Calculate [Total Sales]',
      'DIVIDE',
      RESULT,
    ]);
    expect(entries.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // The first [Total Sales] sees all of the report's filters; the second is calculated without the Category filter.
    expect(describeContext(entries[1].context)).toEqual(["All of the report's filters"]);
    expect(describeContext(entries[4].context)).toEqual(["The report's filters, except any filter on Product[Category]"]);
    expect(entries[3].operations.map((o) => o.kind)).toEqual(['remove-filters']);
  });

  it('average per customer: the table first, then the per-row measure, then the combining', () => {
    const entries = timeline(sample('average-per-customer'));
    expect(entries.map((e) => e.kind)).toEqual(['start', 'function', 'iterate', 'measure', 'iterate-done', 'result']);
    expect(entries[2].summary).toBe('AVERAGEX goes through VALUES(Customer[Customer Key]) one row at a time.');
    expect(entries[3].operations.map((o) => o.kind)).toEqual(['context-transition']);
    expect(entries[4].summary).toBe('After the last row, AVERAGEX averages the results from every row.');
    expect(entries[3].depth).toBeGreaterThan(entries[2].depth); // per-row work is nested inside the iterator
  });

  it('variables are calculated where they are written, before RETURN uses them', () => {
    expect(titles(timeline(sample('plant-share-with-vars')))).toEqual([
      START,
      'Calculate [Total Sales]',
      'VAR CurrentPlantSales is stored',
      'Prepare filter: ALL(Plant)',
      'CALCULATE applies its filters',
      'Calculate [Total Sales]',
      'VAR AllPlantSales is stored',
      'Use CurrentPlantSales',
      'Use AllPlantSales',
      'DIVIDE',
      RESULT,
    ]);
  });

  it('nested iterators: FILTER finishes before TOPN starts; CONCATENATEX reads each row', () => {
    expect(timeline(sample('top-plant')).map((e) => `${e.kind}: ${e.title}`)).toEqual([
      `start: ${START}`,
      'function: VALUES',
      'iterate: FILTER goes row by row',
      'column: Read Plant[Plant Name]',
      'iterate-done: FILTER: after the last row',
      'iterate: TOPN goes row by row',
      'measure: Calculate [Total Sales]',
      'iterate-done: TOPN: after the last row',
      'variable: VAR TopPlant is stored',
      'variable-use: Use TopPlant',
      'iterate: CONCATENATEX goes row by row',
      'column: Read Plant[Plant Name]',
      'measure: Calculate [Total Sales]',
      'function: FORMAT',
      'iterate-done: CONCATENATEX: after the last row',
      `result: ${RESULT}`,
    ]);
  });

  it('the variable trap: the stored value is reused inside CALCULATE, and the moment says so', () => {
    const entries = timeline(
      'Trap = VAR SalesHere = [Total Sales] RETURN DIVIDE(SalesHere, CALCULATE(SalesHere, REMOVEFILTERS(Product[Category])))',
    );
    const reuse = entries.filter((e) => e.kind === 'variable-use');
    expect(reuse).toHaveLength(2);
    expect(reuse[1].summary).toBe('SalesHere keeps its earlier value here, even though the filters are different.');
    expect(entries.findIndex((e) => e.kind === 'variable')).toBeLessThan(entries.findIndex((e) => e.kind === 'calculate'));
  });

  it('an iterator used as a CALCULATE filter runs (row by row) before CALCULATE applies it', () => {
    const entries = timeline('Big = CALCULATE([Total Sales], FILTER(ALL(Customer), [Total Sales] > 1000))');
    expect(entries.map((e) => e.kind)).toEqual(['start', 'iterate', 'measure', 'iterate-done', 'filter-input', 'calculate', 'measure', 'result']);
    expect(entries[1].summary).toBe('FILTER goes through ALL(Customer) one row at a time.');
    expect(entries[2].summary).toBe('[Total Sales] is calculated for one row of FILTER at a time.');
  });

  it('KEEPFILTERS: the filter input is one moment; the condition inside is not split up', () => {
    const entries = timeline('W = CALCULATE([Total Sales], KEEPFILTERS(Product[Category] = "Widgets"))');
    expect(entries.map((e) => e.kind)).toEqual(['start', 'filter-input', 'calculate', 'measure', 'result']);
    expect(entries[1].summary).toBe('Adds Product[Category] = "Widgets" on top of the existing filters (only inside this CALCULATE).');
  });

  it('skips literals, operators and plain column inputs; reads columns in a row context', () => {
    expect(titles(timeline('Amount = SUMX(Sales, Sales[Quantity] * Sales[Net Price]) + SUM(Sales[Amount]) * 2'))).toEqual([
      START,
      'SUMX goes row by row',
      'Read Sales[Quantity]',
      'Read Sales[Net Price]',
      'SUMX: after the last row',
      'SUM',
      RESULT,
    ]);
  });

  it("does not follow the inside of a function the app doesn't know", () => {
    expect(timeline('X = MYSTERY([Total Sales], CALCULATE([Total Sales]))').map((e) => e.kind)).toEqual(['start', 'unknown', 'result']);
  });

  it('an empty expression has no timeline', () => {
    const binding = bind(null, { mode: 'convention', userChoices: {} });
    expect(buildTimeline(null, binding, analyzeContext(null, binding, ''), '')).toEqual([]);
  });
});
