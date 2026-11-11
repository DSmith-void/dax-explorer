import { describe, expect, it } from 'vitest';
import { SAMPLE_MEASURES } from '../../samples/sampleMeasures';
import { bind, type BindOptions } from '../binder/binder';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { childrenOf, type AstNode, type Expr } from '../parser/ast';
import { parse } from '../parser/parser';
import { analyzeContext } from './analyzer';
import { describeContext } from './describe';
import type { Step } from './model';
import { buildTimeline } from './timeline';

const CONVENTION: BindOptions = { mode: 'convention', userChoices: {} };

/** Analyzes an expression (or, with isMeasureDefinition, a "Name = expression" sample). */
function run(source: string, options: BindOptions = CONVENTION, isMeasureDefinition = false) {
  const start = isMeasureDefinition ? splitMeasureDefinition(source).header!.expressionStart : 0;
  const { root, diagnostics } = parse(tokenize(source, start).tokens);
  expect(diagnostics).toEqual([]);
  const binding = bind(root, options);
  const analysis = analyzeContext(root, binding, source);
  const nodes = allNodes(root!);
  /** The nth node whose source text is exactly `text`. */
  const node = (text: string, nth = 0): AstNode => {
    const matches = nodes.filter((n) => source.slice(n.span.start, n.span.end) === text);
    if (!matches[nth]) throw new Error(`node "${text}" #${nth} not found`);
    return matches[nth];
  };
  const step = (text: string, nth = 0): Step => {
    const s = analysis.steps.get(node(text, nth).id);
    if (!s) throw new Error(`no step for "${text}"`);
    return s;
  };
  return { root: root as Expr, analysis, nodes, node, step };
}

function allNodes(node: AstNode): AstNode[] {
  return [node, ...childrenOf(node).flatMap((c) => allNodes(c.node))];
}

const ALL_REPORT_FILTERS = "All of the report's filters";

describe('samples', () => {
  it("percent of total: the numerator sees all of the report's filters, the denominator loses Category", () => {
    const { step } = run(SAMPLE_MEASURES[0].expression, CONVENTION, true);
    expect(describeContext(step('[Total Sales]', 0).context)).toEqual([ALL_REPORT_FILTERS]);
    expect(describeContext(step('[Total Sales]', 1).context)).toEqual(["The report's filters, except any filter on Product[Category]"]);
    expect(step('REMOVEFILTERS(Product[Category])').notes[0]).toBe(
      'Removes any filter on Product[Category], but only for the calculation inside this CALCULATE.',
    );
  });

  it('average per customer: the current row becomes a filter inside AVERAGEX', () => {
    const { step, analysis } = run(SAMPLE_MEASURES[1].expression, CONVENTION, true);
    const measure = step('[Total Sales]');
    expect(measure.operations.map((o) => o.kind)).toEqual(['context-transition']);
    expect(describeContext(measure.innerContext!)).toEqual([
      "The report's filters, except any filter on Customer[Customer Key]",
      "Customer[Customer Key] = the current row of AVERAGEX  (context transition)",
      'AVERAGEX is going through VALUES(Customer[Customer Key]) one row at a time',
    ]);
    expect(analysis.insights.map((i) => i.message)).toEqual([
      "[Total Sales] is calculated for each row of AVERAGEX (VALUES(Customer[Customer Key])). Each time, the current row becomes a filter (context transition), so only that row's data counts.",
    ]);
  });

  it('plant share: ALL(Plant) removes the Plant table filters, with a data-model caveat', () => {
    const { step, analysis } = run(SAMPLE_MEASURES[2].expression, CONVENTION, true);
    const lines = describeContext(step('[Total Sales]', 1).context);
    expect(lines[0]).toBe("The report's filters, except any filter on table Plant");
    expect(lines[1]).toMatch(/^Not checked: removing filters from the whole Plant table can also remove filters on tables related to it/);
    // The variables are used with the same filters they were calculated with: nothing to point out.
    expect(analysis.insights).toEqual([]);
  });

  it('top plant: TOPN and CONCATENATEX each go row by row, and each row becomes a filter', () => {
    const { step, analysis } = run(SAMPLE_MEASURES[3].expression, CONVENTION, true);
    expect(describeContext(step('[Total Sales]', 0).innerContext!)).toContain(
      "Plant[Plant Name] = the current row of TOPN  (context transition)",
    );
    expect(describeContext(step('[Total Sales]', 1).innerContext!)).toContain(
      "Plant[Plant Name] = the current row of CONCATENATEX  (context transition)",
    );
    expect(step('Plant[Plant Name]', 1).notes[0]).toBe('Reads Plant[Plant Name] from the row that FILTER is currently on.');
    expect(step('Plant[Plant Name]', 2).notes[0]).toBe('Reads Plant[Plant Name] from the row that CONCATENATEX is currently on.');
    expect(analysis.insights.map((i) => i.message)).toEqual([
      "[Total Sales] is calculated for each row of TOPN (FILTER over VALUES(Plant[Plant Name])). Each time, the current row becomes a filter (context transition), so only that row's data counts.",
      "[Total Sales] is calculated for each row of CONCATENATEX (TopPlant). Each time, the current row becomes a filter (context transition), so only that row's data counts.",
    ]);
  });

  it.each(SAMPLE_MEASURES.map((s) => [s.id, s.expression]))('records a step for every node of sample "%s"', (_id, text) => {
    const { analysis, nodes } = run(text, CONVENTION, true);
    for (const n of nodes) expect(analysis.steps.has(n.id), `node ${n.kind}`).toBe(true);
  });
});

describe('CALCULATE filters', () => {
  it('a filter condition replaces the filter on its column', () => {
    const { step } = run('CALCULATE([X], Product[Color] = "Red")');
    expect(describeContext(step('[X]').context)).toEqual([
      "The report's filters, except any filter on Product[Color]",
      'Product[Color] = "Red"  (added by CALCULATE)',
    ]);
  });

  it('the filter condition is checked value by value (so the column has a current value, no error)', () => {
    const { step, analysis } = run('CALCULATE([X], Product[Color] = "Red")');
    expect(step('Product[Color]').notes[0]).toBe(
      'CALCULATE checks this condition once for each value of Product[Color]; here Product[Color] is the value being checked.',
    );
    expect(analysis.insights).toEqual([]);
  });

  it('KEEPFILTERS adds on top instead of replacing', () => {
    const { step } = run('CALCULATE([X], KEEPFILTERS(Product[Color] = "Red"))');
    expect(describeContext(step('[X]').context)).toEqual([
      ALL_REPORT_FILTERS,
      'Product[Color] = "Red"  (added by CALCULATE, on top of existing filters (KEEPFILTERS))',
    ]);
  });

  it('IN filters get a short condition', () => {
    const { step } = run('CALCULATE([X], Product[Color] IN {"Red", "Blue"})');
    expect(describeContext(step('[X]').context)[1]).toBe('Product[Color] IN {"Red", "Blue"}  (added by CALCULATE)');
  });

  it('an inner CALCULATE overrides an outer filter on the same column', () => {
    const { step } = run('CALCULATE(CALCULATE([X], Product[Color] = "Blue"), Product[Color] = "Red")');
    expect(describeContext(step('[X]').context)).toEqual([
      "The report's filters, except any filter on Product[Color]",
      'Product[Color] = "Blue"  (added by CALCULATE)',
    ]);
    const inner = step('CALCULATE([X], Product[Color] = "Blue")');
    const add = inner.operations.find((o) => o.kind === 'add-filter');
    expect(add?.kind === 'add-filter' && add.replaced.map((e) => e.condition)).toEqual(['= "Red"']);
  });

  it('keeps filters on other columns', () => {
    const { step } = run('CALCULATE(CALCULATE([X], Product[Color] = "Blue"), Date[Year] = 2026)');
    expect(describeContext(step('[X]').context)).toEqual([
      "The report's filters, except any filter on Date[Year]; Product[Color]",
      'Date[Year] = 2026  (added by CALCULATE)',
      'Product[Color] = "Blue"  (added by CALCULATE)',
    ]);
  });

  it('removes filters before adding new ones, whatever the order they are written in', () => {
    const { step } = run('CALCULATE([X], Product[Color] = "Red", REMOVEFILTERS(Product))');
    const lines = describeContext(step('[X]').context);
    expect(lines[0]).toBe("The report's filters, except any filter on table Product");
    expect(lines).toContain('Product[Color] = "Red"  (added by CALCULATE)');
  });

  it('REMOVEFILTERS() with no inputs removes everything', () => {
    expect(describeContext(run('CALCULATE([X], REMOVEFILTERS())').step('[X]').context)).toEqual([
      "None of the report's filters (all removed)",
    ]);
  });

  it('ALLEXCEPT keeps the listed columns', () => {
    expect(describeContext(run('CALCULATE([X], ALLEXCEPT(Product, Product[Category]))').step('[X]').context)[0]).toBe(
      "The report's filters, except any filter on table Product (but keeping Product[Category])",
    );
  });

  it('ALL in an inner CALCULATE removes a filter added by an outer one', () => {
    const { step } = run('CALCULATE(CALCULATE([X], ALL(Product[Color])), Product[Color] = "Red")');
    expect(describeContext(step('[X]').context)).toEqual(["The report's filters, except any filter on Product[Color]"]);
    const remove = step('CALCULATE([X], ALL(Product[Color]))').operations[0];
    expect(remove.kind === 'remove-filters' && remove.removedEntries.length).toBe(1);
  });

  it('table filters from FILTER use the columns of the table being filtered', () => {
    const { step } = run('CALCULATE([X], FILTER(ALL(Product[Color]), Product[Color] <> "Red"))');
    expect(describeContext(step('[X]').context)[1]).toBe(
      'Product[Color] limited to the rows of FILTER(ALL(Product[Color]), Product[Color] <> "Red")  (added by CALCULATE)',
    );
  });

  it.each([
    ['CALCULATE([X], ALLSELECTED(VALUES(Product[Color])))', /^The app can't work out ALLSELECTED/],
    ['CALCULATE([X], [Y] > 0)', /compares a measure \(\[Y\]\)/],
    ['CALCULATE([X], Product[Color] = Plant[Code])', /uses columns from more than one table/],
  ])('says what it cannot check: %s', (source, pattern) => {
    const { analysis } = run(source);
    expect(analysis.insights.find((i) => i.kind === 'not-modeled')?.message).toMatch(pattern);
  });
});

describe('going row by row, and rows becoming filters', () => {
  it('CALCULATE inside SUMX turns the current row into a filter', () => {
    const { step } = run('SUMX(Customer, CALCULATE(SUM(Sales[Amount])))');
    const calc = step('CALCULATE(SUM(Sales[Amount]))');
    expect(calc.operations[0].kind).toBe('context-transition');
    expect(describeContext(calc.innerContext!)).toContain(
      'table Customer limited to the current row of SUMX  (context transition)',
    );
  });

  it("checks CALCULATE's filter conditions with the filters from before it (before the row becomes a filter)", () => {
    const { step } = run('SUMX(Customer, CALCULATE([X], Product[Color] = "Red"))');
    const predicate = step('Product[Color] = "Red"');
    expect(predicate.context.filter.entries).toEqual([]);
    expect(predicate.context.rows.map((r) => r.functionName)).toEqual(['SUMX', 'the filter condition']);
  });

  it('a measure outside any row-by-row function adds nothing', () => {
    const { step } = run('[Total Sales] * 2');
    expect(step('[Total Sales]').operations).toEqual([]);
    expect(step('[Total Sales]').notes[0]).toBe(
      'Nothing goes row by row here, so no filter is added.',
    );
  });

  it('reads columns of the table being gone through from the current row', () => {
    const { step } = run('SUMX(Sales, Sales[Qty] * Sales[Price])');
    expect(step('Sales[Qty]').notes[0]).toBe('Reads Sales[Qty] from the row that SUMX is currently on.');
  });

  it('points out a column from another table (usually needs RELATED)', () => {
    expect(run('SUMX(Sales, Product[List Price])').step('Product[List Price]').notes[0]).toMatch(
      /^SUMX is going row by row through Sales, but Product\[List Price\] is in a different table\. You would usually need RELATED\(Product\[List Price\]\)/,
    );
  });

  it('points out a column used where there is no current row', () => {
    const { analysis } = run('Sales[Amount] * 2');
    expect(analysis.insights.map((i) => i.kind)).toEqual(['column-without-row-context']);
    expect(analysis.insights[0].message).toMatch(/^Sales\[Amount\] is used on its own here, but nothing is going row by row/);
  });

  it('treats a column handed to SUM as the column itself, not a value', () => {
    const { step, analysis } = run('SUM(Sales[Amount])');
    expect(step('Sales[Amount]').notes[0]).toMatch(/^Here the column itself is handed to the function around it/);
    expect(analysis.insights).toEqual([]);
  });

  it('nested row-by-row functions: every current row becomes a filter', () => {
    const { step } = run('SUMX(Customer, SUMX(Product, [Total Sales]))');
    expect(describeContext(step('[Total Sales]').innerContext!)).toEqual([
      "The report's filters, except any filter on table Customer; table Product",
      'table Customer limited to the current row of SUMX  (context transition)',
      'table Product limited to the current row of SUMX  (context transition)',
      expect.stringMatching(/^Not checked: filtering the whole Customer table/),
      expect.stringMatching(/^Not checked: filtering the whole Product table/),
      'SUMX is going through Customer one row at a time',
      'SUMX is going through Product one row at a time',
    ]);
  });
});

describe('variables', () => {
  it('a variable used inside CALCULATE is not recalculated', () => {
    const { analysis } = run('VAR v = [Total Sales] RETURN CALCULATE(v, ALL(Product))');
    expect(analysis.insights.map((i) => i.message)).toEqual([
      'The filters here are different from where v was calculated (line 1), but v is not recalculated: it keeps the value it got there. This is a common surprise when a variable is used inside CALCULATE.',
    ]);
  });

  it('a variable calculated before a row-by-row function has the same value for every row', () => {
    const { analysis } = run('VAR v = [Total Sales] RETURN SUMX(Customer, v)');
    expect(analysis.insights.map((i) => i.message)).toEqual([
      'v was calculated once (line 1), before SUMX started going row by row, so it has the same value for every row.',
    ]);
  });

  it('says where a variable is calculated', () => {
    const { step } = run('VAR v = 1 RETURN v');
    expect(step('VAR v = 1').notes[0]).toBe('With the filters shown above. Every later use of v reuses this value.');
  });
});

describe('one-line summaries (for "Brief" explanations)', () => {
  it('summarizes each insight in one short sentence', () => {
    const cases: [string, string][] = [
      ['AVERAGEX(Customer, [Total Sales])', '[Total Sales] for the current row of AVERAGEX.'],
      ['SUMX(Customer, CALCULATE(SUM(Sales[Amount])))', 'This CALCULATE works on one row of SUMX at a time.'],
      ['VAR v = [Total Sales] RETURN CALCULATE(v, ALL(Product))', 'v keeps its earlier value here, even though the filters are different.'],
      ['VAR v = [Total Sales] RETURN SUMX(Customer, v)', 'v has the same value for every row of SUMX.'],
      ['Sales[Amount] * 2', 'Sales[Amount] has no current row to read from (an error in a measure).'],
      ['CALCULATE([X], ALLSELECTED(VALUES(Product[Color])))', "The app can't check ALLSELECTED(VALUES(Product[Color])) yet."],
      ['MYHELPER(1)', "The app doesn't know MYHELPER yet, so the parts inside it aren't checked."],
    ];
    for (const [source, summary] of cases) {
      expect(run(source).analysis.insights.map((i) => i.summary), source).toEqual([summary]);
    }
  });

  it('summarizes what a CALCULATE does, in one sentence', () => {
    expect(run(SAMPLE_MEASURES[0].expression, CONVENTION, true).step('CALCULATE(\n        [Total Sales],\n        REMOVEFILTERS(Product[Category])\n    )').summary).toBe(
      'CALCULATE calculates [Total Sales] without filters on Product[Category].',
    );
    expect(run('SUMX(Customer, CALCULATE([X], Product[Color] = "Red", REMOVEFILTERS(Plant)))').step('CALCULATE([X], Product[Color] = "Red", REMOVEFILTERS(Plant))').summary).toBe(
      'CALCULATE calculates [X] for the current row of SUMX, without filters on table Plant, with Product[Color] = "Red".',
    );
    expect(run('CALCULATE([X])').step('CALCULATE([X])').summary).toBe('CALCULATE calculates [X] with the same filters (nothing changes).');
  });

  it('gives every node of every sample that has an explanation a summary too', () => {
    for (const sample of SAMPLE_MEASURES) {
      const { analysis } = run(sample.expression, CONVENTION, true);
      for (const step of analysis.steps.values()) {
        if (step.notes.length > 0) expect(step.summary, `${sample.id}: ${step.notes[0]}`).toBeTruthy();
      }
    }
  });
});

describe('unknowns', () => {
  it("marks everything inside a function the app doesn't know as unknown", () => {
    const { step, analysis } = run('MYHELPER([Total Sales])');
    expect(describeContext(step('[Total Sales]').context)).toEqual(["Unknown: this is inside MYHELPER, which the app doesn't know yet"]);
    expect(analysis.insights.map((i) => i.kind)).toEqual(['unknown-function']);
  });

  it('shows both outcomes for a name that could be a measure or a column (strict mode)', () => {
    const { step } = run('AVERAGEX(Customer, [Total Sales])', { mode: 'strict', userChoices: {} });
    const s = step('[Total Sales]');
    expect(s.alternatives?.ifMeasure.operations.map((o) => o.kind)).toEqual(['context-transition']);
    // [Total Sales] has no table name, so the app can't be sure it belongs to Customer, and says so.
    expect(s.alternatives?.ifColumn.notes[0]).toBe(
      'Reads [Total Sales] from the row that AVERAGEX is currently on (assuming Customer has this column).',
    );
  });

  it('returns no steps for no tree', () => {
    expect(analyzeContext(null, bind(null, CONVENTION), '').steps.size).toBe(0);
  });
});

describe('ALLSELECTED', () => {
  it("removes the visual's own rows and columns on the column, and filters the measure added there", () => {
    const steps = buildTimeline(...(() => {
      const source = 'M = CALCULATE(CALCULATE([Total Sales], ALLSELECTED(Product[Category])), Product[Category] = "Widgets")';
      const { root } = parse(tokenize(source, splitMeasureDefinition(source).header!.expressionStart).tokens);
      const binding = bind(root, CONVENTION);
      return [root, binding, analyzeContext(root, binding, source), source] as const;
    })());
    const inner = steps.filter((e) => e.kind === 'calculate')[1];
    expect(inner.summary).toBe("CALCULATE calculates [Total Sales] without filters on the visual's own rows and columns on Product[Category] (slicers and the filter pane stay).");
    expect(describeContext(inner.innerContext!)).toEqual(["The report's filters, except any filter on the visual's own rows and columns on Product[Category] (slicers and the filter pane stay)"]);
  });

  it('inside a row-by-row calculation, says what is not checked', () => {
    const { analysis } = run('SUMX(VALUES(Plant[Plant Name]), CALCULATE([Total Sales], ALLSELECTED(Product[Category])))');
    const step = [...analysis.steps.values()].find((s) => s.innerContext?.filter.caveats.length);
    expect(step?.innerContext?.filter.caveats[0]).toContain('ALLSELECTED inside a row-by-row calculation (SUMX)');
  });
});
