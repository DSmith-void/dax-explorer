import { describe, expect, it } from 'vitest';
import { INITECH_MODEL } from '../../samples/initechModel';
import { bind } from '../binder/binder';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { analyzeContext } from './analyzer';
import { describeContext } from './describe';
import { INITIAL_CONTEXT } from './model';
import type { RelationshipModel } from './relationships';
import { buildStepQuery, dateRangeQueries, type StepQueryOptions } from './stepQuery';
import { technicalOperation } from './technical';
import { buildTimeline } from './timeline';

function explain(definition: string, model: RelationshipModel | null = INITECH_MODEL) {
  const { root } = parse(tokenize(definition, splitMeasureDefinition(definition).header!.expressionStart).tokens);
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  const analysis = analyzeContext(root, binding, definition, INITIAL_CONTEXT, model);
  const timeline = buildTimeline(root, binding, analysis, definition);
  const options: StepQueryOptions = { root, binding, source: definition, reportFilters: [], rows: new Map() };
  return { timeline, analysis, options, calculate: timeline.find((e) => e.kind === 'calculate')! };
}

describe('time intelligence in CALCULATE', () => {
  it('DATESYTD replaces the date filter with a rule, and DAX clears the rest of the Date table by itself', () => {
    const { calculate } = explain("M = CALCULATE([Total Sales], DATESYTD('Date'[Date]))");
    expect(calculate.operations.map(technicalOperation)).toEqual([
      'Automatic REMOVEFILTERS(Date): Date[Date] is a date column that a relationship uses',
      'Filter Date[Date] = every date from the start of the year up to the last date in the current filter: overwrites existing filters on the same columns',
    ]);
    expect(describeContext(calculate.innerContext!)).toEqual([
      "The report's filters, except any filter on table Date",
      'Date[Date] = every date from the start of the year up to the last date in the current filter  (added by CALCULATE)',
    ]);
  });

  it('without the model, it says nothing about the rest of the Date table (not guessed)', () => {
    const { calculate } = explain("M = CALCULATE([Total Sales], DATESYTD('Date'[Date]))", null);
    expect(calculate.operations.map((op) => op.kind)).toEqual(['add-filter']);
  });

  it('the automatic removal is a modifier: a Year filter in the same CALCULATE still applies', () => {
    const { calculate } = explain("M = CALCULATE([Total Sales], 'Date'[Year] = 2025, DATESYTD('Date'[Date]))");
    expect(describeContext(calculate.innerContext!)).toContain('Date[Year] = 2025  (added by CALCULATE)');
  });

  it.each([
    ["SAMEPERIODLASTYEAR('Date'[Date])", 'the same dates as the current filter, one year earlier'],
    ["DATEADD('Date'[Date], -1, MONTH)", 'the dates in the current filter, 1 month earlier'],
    ["DATEADD('Date'[Date], 2, QUARTER)", 'the dates in the current filter, 2 quarters later'],
    ["PARALLELPERIOD('Date'[Date], -1, YEAR)", 'the whole years of the current filter, 1 year earlier'],
    ["PREVIOUSMONTH('Date'[Date])", 'the whole month before the first date in the current filter'],
    ["NEXTYEAR('Date'[Date])", 'the whole year after the last date in the current filter'],
    ["DATESBETWEEN('Date'[Date], DATE(2025, 1, 1), DATE(2025, 6, 30))", 'every date from DATE(2025, 1, 1) to DATE(2025, 6, 30)'],
    ["DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -3, MONTH)", "the 3 months up to MAX('Date'[Date])"],
    ["DATESYTD('Date'[Date], \"6/30\")", 'every date from the start of the year up to the last date in the current filter (for a year ending "6/30")'],
  ])('%s: %s', (filter, rule) => {
    const { calculate } = explain(`M = CALCULATE([Total Sales], ${filter})`);
    const add = calculate.operations.find((op) => op.kind === 'add-filter');
    expect(add?.kind === 'add-filter' && add.entry.condition).toBe(`= ${rule}`);
  });
});

describe('TOTALYTD', () => {
  it('is a CALCULATE with DATESYTD: same steps, and the date column is not a "column without a row"', () => {
    const { timeline, analysis } = explain("M = TOTALYTD([Total Sales], 'Date'[Date])");
    expect(timeline.map((e) => e.title)).toEqual([
      "Start with the report's filters",
      "Prepare filter: DATESYTD('Date'[Date])",
      'TOTALYTD applies its filters',
      'Calculate [Total Sales]',
      'The result goes back to the report',
    ]);
    expect(analysis.insights.filter((i) => i.kind === 'column-without-row-context')).toEqual([]);
    const calculate = timeline.find((e) => e.kind === 'calculate')!;
    expect(calculate.operations.map((op) => op.kind)).toEqual(['remove-filters', 'add-filter']);
  });

  it('a step inside it is calculated with CALCULATE(…, DATESYTD(dates), filter)', () => {
    const { timeline, options } = explain("M = TOTALYTD([Total Sales], 'Date'[Date], Product[Category] = \"Widgets\", \"6/30\")");
    const inner = timeline.find((e) => e.kind === 'measure')!;
    const q = buildStepQuery(inner, options);
    expect(q).toEqual({ kind: 'scalar', dax: "CALCULATE(\n[Total Sales],\nDATESYTD('Date'[Date], \"6/30\"),\nProduct[Category] = \"Widgets\"\n)" });
  });
});

describe('date ranges for the date strip', () => {
  it('asks for the first and last date before the CALCULATE and inside it', () => {
    const { calculate, options } = explain("M = CALCULATE([Total Sales], SAMEPERIODLASTYEAR('Date'[Date]))");
    const range = dateRangeQueries(calculate, options)!;
    const probe = `FORMAT(MIN('Date'[Date]), "yyyy-mm-dd") & "|" & FORMAT(MAX('Date'[Date]), "yyyy-mm-dd") & "|" & COUNTROWS(VALUES('Date'[Date]))`;
    expect(range.functionName).toBe('SAMEPERIODLASTYEAR');
    expect(range.before).toEqual({ kind: 'scalar', dax: probe });
    expect(range.after).toEqual({ kind: 'scalar', dax: `CALCULATE(\n${probe},\nSAMEPERIODLASTYEAR('Date'[Date])\n)` });
  });

  it('is null for steps that do not change dates', () => {
    const { calculate, options } = explain('M = CALCULATE([Total Sales], Product[Category] = "Widgets")');
    expect(dateRangeQueries(calculate, options)).toBeNull();
  });
});
