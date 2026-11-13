import { describe, expect, it } from 'vitest';
import { SAMPLE_MEASURES } from '../../samples/sampleMeasures';
import { bind } from '../binder/binder';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { analyzeContext } from './analyzer';
import type { ReportFilter } from './reportFilters';
import { buildStepQuery, columnNameDax, evaluateText, rowColumns, rowKey, type RowChoice, type StepQuery } from './stepQuery';
import { buildTimeline, type TimelineEntry } from './timeline';

// The values these queries produce were checked live against the Initech sample in Power BI Desktop
// (e.g. percent of total for Widgets = 77,035 / 254,899; the variable trap stays at 77,035 inside CALCULATE).

const WIDGETS: ReportFilter[] = [{ kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'] }];

function steps(definition: string, reportFilters: ReportFilter[] = [], rows: (entry: TimelineEntry) => RowChoice | undefined = () => undefined) {
  const start = splitMeasureDefinition(definition).header!.expressionStart;
  const { root } = parse(tokenize(definition, start).tokens);
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  const timeline = buildTimeline(root, binding, analyzeContext(root, binding, definition), definition);
  const picked = new Map<string, RowChoice>();
  for (const e of timeline) {
    const choice = e.kind === 'iterate' && e.nodeId !== null ? rows(e) : undefined;
    if (choice) picked.set(rowKey('', e.nodeId!), choice);
  }
  const query = (title: string, nth = 0): StepQuery => {
    const entry = timeline.filter((e) => e.title === title)[nth];
    if (!entry) throw new Error(`no step "${title}"`);
    return buildStepQuery(entry, { root, binding, source: definition, reportFilters, rows: picked });
  };
  return { timeline, query };
}

const dax = (q: StepQuery) => (q.kind === 'scalar' || q.kind === 'table' || q.kind === 'rows' ? q.dax : `(${q.kind})`);

describe('buildStepQuery', () => {
  it('a measure outside any CALCULATE: just the measure, under the report filters', () => {
    const { query } = steps(SAMPLE_MEASURES[0].expression, WIDGETS);
    expect(query('Calculate [Total Sales]', 0)).toEqual({
      kind: 'scalar',
      dax: `CALCULATE(\n[Total Sales],\nTREATAS({"Widgets"}, 'Product'[Category])\n)`,
    });
  });

  it('inside CALCULATE: wrapped in the same CALCULATE, with its filter arguments as written', () => {
    const { query } = steps(SAMPLE_MEASURES[0].expression, WIDGETS);
    expect(dax(query('Calculate [Total Sales]', 1))).toBe(
      `CALCULATE(\nCALCULATE(\n[Total Sales],\nREMOVEFILTERS(Product[Category])\n),\nTREATAS({"Widgets"}, 'Product'[Category])\n)`,
    );
  });

  it('without report filters, nothing is added around the expression', () => {
    const { query } = steps(SAMPLE_MEASURES[0].expression);
    expect(query('Calculate [Total Sales]', 0)).toEqual({ kind: 'scalar', dax: '[Total Sales]' });
  });

  it('variables in scope are defined where they are written, so the variable trap shows its real value', () => {
    const { query } = steps(
      'Trap = VAR SalesHere = [Total Sales] RETURN DIVIDE(SalesHere, CALCULATE(SalesHere, REMOVEFILTERS(Product[Category])))',
    );
    expect(dax(query('Use SalesHere', 1))).toBe(
      `VAR SalesHere =\n[Total Sales]\nRETURN\nCALCULATE(\nSalesHere,\nREMOVEFILTERS(Product[Category])\n)`,
    );
    expect(dax(query('VAR SalesHere is stored'))).toBe('[Total Sales]');
  });

  it('a later VAR sees only the VARs written before it', () => {
    const { query } = steps(SAMPLE_MEASURES[2].expression);
    expect(dax(query('VAR AllPlantSales is stored'))).toBe(
      `VAR CurrentPlantSales =\n[Total Sales]\nRETURN\nCALCULATE(\n        [Total Sales],\n        ALL(Plant)\n    )`,
    );
  });

  it("inside an iterator, a value needs a picked row; the iterator's step lists its rows with per-row values", () => {
    const { query } = steps(SAMPLE_MEASURES[1].expression, WIDGETS);
    expect(query('Calculate [Total Sales]')).toEqual({ kind: 'needs-row', frameKey: '', iteratorNodeId: expect.any(Number), iteratorName: 'AVERAGEX' });
    const rows = query('AVERAGEX goes row by row');
    expect(rows.kind).toBe('rows');
    expect(dax(rows)).toBe(
      `CALCULATETABLE(\nADDCOLUMNS(\nVALUES(Customer[Customer Key]),\n"@DaxExplorerValue",\n[Total Sales]\n),\nTREATAS({"Widgets"}, 'Product'[Category])\n)`,
    );
  });

  it('with a picked row, the value is calculated for that row (found by its values; a missing row is an error)', () => {
    const { query } = steps(SAMPLE_MEASURES[1].expression, [], () => ({ columns: ['Customer[Customer Key]'], values: [1] }));
    expect(dax(query('Calculate [Total Sales]'))).toBe(
      `VAR __DaxExplorerRow =\nFILTER(\nVALUES(Customer[Customer Key]),\n'Customer'[Customer Key] == 1\n)\nRETURN\nIF(\nCOUNTROWS(__DaxExplorerRow) = 0,\nERROR("The picked row is no longer there; pick it again."),\nMAXX(__DaxExplorerRow,\n[Total Sales]\n)\n)`,
    );
  });

  it('a BLANK in the picked row is matched with ISBLANK', () => {
    const { query } = steps('S = SUMX(Sales, Sales[Quantity])', [], () => ({ columns: ['Sales[Order Key]', 'Sales[Date]'], values: [7, null] }));
    expect(dax(query('Read Sales[Quantity]'))).toContain("'Sales'[Order Key] == 7 && ISBLANK('Sales'[Date])");
  });

  it('tables get their rows and a count; table results are wrapped in CALCULATETABLE', () => {
    const { query } = steps(SAMPLE_MEASURES[3].expression, WIDGETS);
    const values = query('VALUES');
    expect(values).toEqual({
      kind: 'table',
      dax: `CALCULATETABLE(\nVALUES(Plant[Plant Name]),\nTREATAS({"Widgets"}, 'Product'[Category])\n)`,
      countDax: `COUNTROWS(CALCULATETABLE(\nVALUES(Plant[Plant Name]),\nTREATAS({"Widgets"}, 'Product'[Category])\n))`,
    });
    expect(query('VAR TopPlant is stored').kind).toBe('table');
    expect(query('Use TopPlant').kind).toBe('table');
  });

  it('says why there is no value instead of guessing', () => {
    const { query } = steps(SAMPLE_MEASURES[0].expression);
    expect(query("Start with the report's filters")).toEqual({ kind: 'none', reason: '' });
    expect(query('Prepare filter: REMOVEFILTERS(Product[Category])')).toEqual({ kind: 'none', reason: 'This is a filter for CALCULATE, not a value.' });

    const typedByHand = steps('S = DIVIDE([Total Sales], CALCULATE([Total Sales], ALLSELECTED(Product)))', WIDGETS).query('DIVIDE');
    expect(typedByHand.kind === 'none' && typedByHand.reason).toContain('Take the report filters from a visual');
    const calculationGroups = steps('S = SELECTEDMEASURE()').query('SELECTEDMEASURE: not followed');
    expect(calculationGroups.kind === 'none' && calculationGroups.reason).toContain('calculation groups');
  });

  it("values that depend on the visual are calculated inside the visual's own query, for the chosen row", () => {
    const visual: ReportFilter[] = [
      { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'], source: 'visual-row' },
      { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets', 'Gadgets'], source: 'visual-filter' },
    ];
    const q = steps('S = DIVIDE([Total Sales], CALCULATE([Total Sales], ALLSELECTED(Product[Category])))', visual).query('DIVIDE');
    expect(q).toEqual({
      kind: 'scalar',
      visual: true,
      dax: `FILTER(
SUMMARIZECOLUMNS(
'Product'[Category],
TREATAS({"Widgets", "Gadgets"}, 'Product'[Category]),
"@DaxExplorerValue",
DIVIDE([Total Sales], CALCULATE([Total Sales], ALLSELECTED(Product[Category])))
),
'Product'[Category] == "Widgets"
)`,
    });
    expect(evaluateText(q as Extract<typeof q, { dax: string }>).startsWith('EVALUATE\nFILTER(')).toBe(true);
  });
});

describe('engine column names', () => {
  it('are used as DAX, quoting a table name when the engine did not', () => {
    expect(columnNameDax('Customer[Customer Key]')).toBe("'Customer'[Customer Key]");
    expect(columnNameDax('Date[Year]')).toBe("'Date'[Year]"); // unquoted, Date is a syntax error
    expect(columnNameDax("'Product Line'[Name]")).toBe("'Product Line'[Name]");
    expect(columnNameDax('Product Line[Name]')).toBe("'Product Line'[Name]");
    expect(columnNameDax('[@DaxExplorerValue]')).toBe('[@DaxExplorerValue]');
    expect(columnNameDax('not a column')).toBeNull();
  });

  it("separate an iterator's own columns from the per-row value", () => {
    expect(rowColumns(['Plant[Plant Name]', '[@DaxExplorerValue]'])).toEqual({ indexes: [0], valueIndex: 1 });
  });
});

describe('evaluateText', () => {
  it('makes a complete query to paste into DAX Studio, as the helper runs it', () => {
    expect(evaluateText({ kind: 'scalar', dax: '[Total Sales]' })).toBe('EVALUATE\nROW("value",\n[Total Sales]\n)');
    expect(evaluateText({ kind: 'table', dax: 'VALUES(Plant[Plant Name])', countDax: '' })).toBe('EVALUATE\nVALUES(Plant[Plant Name])');
  });
});
