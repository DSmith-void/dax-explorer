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
    // Its "what changes" line says it; no note repeats it.
    expect(step('REMOVEFILTERS(Product[Category])').summary).toBe('Removes any filter on Product[Category] (only inside this CALCULATE).');
    expect(step('REMOVEFILTERS(Product[Category])').notes).toEqual([]);
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
    expect(step('[Total Sales]').summary).toBe('[Total Sales], with the filters shown.');
    expect(step('[Total Sales]').notes).toEqual([]);
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
    expect(analysis.insights[0].message).toBe('Nothing is going row by row here, so DAX can\'t pick one value from the whole column. Wrap it in something like SUM(Sales[Amount]) or SELECTEDVALUE(Sales[Amount]).');
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
      'It got that value at line 1, with the filters there. A common surprise when a variable is used inside CALCULATE.',
    ]);
  });

  it('a variable calculated before a row-by-row function has the same value for every row', () => {
    const { analysis } = run('VAR v = [Total Sales] RETURN SUMX(Customer, v)');
    expect(analysis.insights.map((i) => i.message)).toEqual([
      'It got that value at line 1, before SUMX started going row by row.',
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

describe('LOOKUPVALUE (checked in Power BI Desktop: it ignores every filter in effect)', () => {
  it('says what it looks up, where, and that the filters do not apply', () => {
    const source = `CALCULATE(LOOKUPVALUE('Product'[Category], 'Product'[Product], "Widget Pro"), 'Product'[Category] = "Gadgets")`;
    const { step } = run(source);
    const s = step(`LOOKUPVALUE('Product'[Category], 'Product'[Product], "Widget Pro")`);
    expect(s.summary).toBe(`Looks up 'Product'[Category] where 'Product'[Product] = "Widget Pro", ignoring the filters.`);
    expect(s.notes[1]).toContain('No match gives BLANK');
    expect(s.notes[1]).toContain('otherwise an error');
  });

  it('reads an even number of inputs as ending with the alternate result, even a measure', () => {
    const source = `LOOKUPVALUE('Product'[Category], 'Product'[Product], "Widget Pro", [Fallback])`;
    const { step, analysis } = run(source);
    expect(step(source).notes[1]).toContain('No match gives [Fallback]');
    expect(analysis.insights.filter((i) => i.kind === 'unknown-function')).toEqual([]);
    const binding = bind(parse(tokenize(source).tokens).root, CONVENTION);
    expect(binding.diagnostics).toEqual([]);
    expect([...binding.references.values()].find((r) => r.key === '[fallback]')?.type).toBe('measure');
  });
});

describe('EARLIER and EARLIEST (each case checked in Power BI Desktop on Initech)', () => {
  const earlierStep = (source: string, call: string) => run(source).step(call);

  it('the classic pattern reads the outer loop, not the current one', () => {
    const s = earlierStep(
      "SUMX('Product', COUNTROWS(FILTER('Product', 'Product'[List Price] < EARLIER('Product'[List Price]))))",
      "EARLIER('Product'[List Price])",
    );
    expect(s.summary).toBe("Reads 'Product'[List Price] from the row of SUMX (line 1), not the current row of FILTER.");
  });

  it('steps out of loops over other tables too, then takes the nearest loop through the column’s table', () => {
    // Power BI: Gadget Max > Gizmo Lite > Date years, EARLIER(…, 1) gave Gizmo Lite's price (the middle loop).
    const source = "AVERAGEX('Product', MINX('Product', MAXX(VALUES('Date'[Year]), EARLIER('Product'[List Price], 1))))";
    expect(earlierStep(source, "EARLIER('Product'[List Price], 1)").summary).toContain('from the row of MINX');
    const two = "AVERAGEX('Product', MINX('Product', MAXX(VALUES('Date'[Year]), EARLIER('Product'[List Price], 2))))";
    expect(earlierStep(two, "EARLIER('Product'[List Price], 2)").summary).toContain('from the row of AVERAGEX');
    // A Date loop between two Product loops is skipped: SUMX's row, as in Power BI (198 = 3 × 66).
    const between = "SUMX('Product', SUMX(VALUES('Date'[Year]), COUNTROWS(FILTER('Product', 'Product'[List Price] < EARLIER('Product'[List Price])))))";
    expect(earlierStep(between, "EARLIER('Product'[List Price])").summary).toContain('from the row of SUMX (line 1), not the current row of FILTER');
  });

  it('EARLIEST takes the outermost loop through the column’s table', () => {
    const source = "AVERAGEX('Product', MINX('Product', MAXX('Product', EARLIEST('Product'[List Price]))))";
    expect(earlierStep(source, "EARLIEST('Product'[List Price])").summary).toContain('from the row of AVERAGEX');
    const withDate = "MAXX('Product', MAXX(VALUES('Date'[Year]), EARLIEST('Product'[List Price])))";
    expect(earlierStep(withDate, "EARLIEST('Product'[List Price])").summary).toContain('from the row of MAXX');
  });

  it('with only one loop there is no earlier row: an error', () => {
    const { step, analysis } = run("SUMX('Product', EARLIER('Product'[List Price]))");
    expect(step("EARLIER('Product'[List Price])").summary).toContain('There is no earlier loop through Product');
    expect(analysis.insights.map((i) => i.kind)).toContain('column-without-row-context');
    expect(run("SUMX('Product', EARLIEST('Product'[List Price]))").step("EARLIEST('Product'[List Price])").summary).toContain('no earlier loop');
  });

  it('EARLIER(column, 0) is an error', () => {
    const s = earlierStep("SUMX('Product', MAXX('Product', EARLIER('Product'[List Price], 0)))", "EARLIER('Product'[List Price], 0)");
    expect(s.summary).toContain('whole number above zero');
  });

  it('inside CALCULATE the loops around it became filters: EARLIER cannot reach them', () => {
    const source = "SUMX('Product', CALCULATE(MAXX(ALL('Product'), EARLIER('Product'[List Price]))))";
    expect(earlierStep(source, "EARLIER('Product'[List Price])").summary).toContain('inside CALCULATE it became a filter');
  });
});

describe('a loop’s row inside CALCULATE (checked in Power BI Desktop: it becomes a filter and can’t be read)', () => {
  it('reading the column there is an error, with the variable fix', () => {
    const { step } = run("SUMX('Product', CALCULATE('Product'[List Price] + 0))");
    const s = step("'Product'[List Price]");
    expect(s.summary).toBe("'Product'[List Price] can't be read here: the row of SUMX became a filter (an error).");
    expect(s.notes[0]).toContain('VAR value');
  });

  it('a variable stored before the CALCULATE reads it fine', () => {
    const { step, analysis } = run("SUMX('Product', VAR p = 'Product'[List Price] RETURN CALCULATE(p + 0))");
    expect(step("'Product'[List Price]").summary).toBe("Reads 'Product'[List Price] from the row that SUMX is currently on.");
    expect(analysis.insights.filter((i) => i.kind === 'column-without-row-context')).toEqual([]);
  });

  it('a loop inside the CALCULATE starts a readable row again', () => {
    const { step } = run("SUMX('Product', CALCULATE(MAXX('Product', 'Product'[List Price])))");
    expect(step("'Product'[List Price]").summary).toBe("Reads 'Product'[List Price] from the row that MAXX is currently on.");
  });

  it('a CALCULATE inside another one does not turn the same row into a filter twice', () => {
    const { step } = run("SUMX('Product', CALCULATE(CALCULATE([Total Sales])))");
    const inner = step('CALCULATE([Total Sales])');
    expect(inner.operations.filter((o) => o.kind === 'context-transition')).toEqual([]);
  });
});

describe('FIRSTNONBLANK and LASTNONBLANK (checked in Power BI Desktop on Initech)', () => {
  it('go through the values of the column, smallest first, and say what they keep', () => {
    const { step } = run("FIRSTNONBLANK('Date'[Date], [Total Sales])");
    const s = step("FIRSTNONBLANK('Date'[Date], [Total Sales])");
    expect(s.summary).toBe("FIRSTNONBLANK goes through the values of 'Date'[Date] one row at a time.");
    expect(s.notes[0]).toContain("smallest first (text alphabetically, not in a sort-by column's order)");
    expect(s.notes[0]).toContain('as a one-row table, or an empty table');
    const v = run("LASTNONBLANKVALUE('Date'[Date], [Total Sales])").step("LASTNONBLANKVALUE('Date'[Date], [Total Sales])");
    expect(v.notes[0]).toContain('the expression’s value there, or BLANK');
  });

  it('a measure inside is worked out for each value (context transition)', () => {
    const { step } = run("FIRSTNONBLANK('Date'[Date], [Total Sales])");
    expect(step('[Total Sales]').operations.map((o) => o.kind)).toEqual(['context-transition']);
  });

  it('as a CALCULATE filter, it sets the column to that one value', () => {
    const { step } = run("CALCULATE([Total Sales], LASTNONBLANK('Date'[Date], [Total Sales]))");
    const calc = step("CALCULATE([Total Sales], LASTNONBLANK('Date'[Date], [Total Sales]))");
    const filter = calc.operations.find((o) => o.kind === 'add-filter');
    expect(filter && filter.kind === 'add-filter' ? filter.entry.condition : '').toBe("= the last value (smallest first) where [Total Sales] isn't blank");
  });
});

describe('SUMMARIZE (checked in Power BI Desktop on Initech)', () => {
  const source = `SUMMARIZE(Sales, 'Product'[Category], "Sales", SUM(Sales[Amount]), "Name", 'Product'[Category] & "!")`;

  it('goes group by group, and its extra columns see the table filtered to the group', () => {
    const { step } = run(source);
    const s = step(source);
    expect(s.summary).toBe("SUMMARIZE groups Sales by Product[Category], one group at a time.");
    // First (the step shows it; the rest fold under More).
    expect(s.notes[0]).toBe("Each extra column is worked out per group, with Sales filtered to that group's rows.");
    // The note on removing filters only when an extra column removes some.
    expect(s.notes).toHaveLength(2);
    const withAll = `SUMMARIZE(Sales, 'Product'[Category], "All", CALCULATE(SUM(Sales[Amount]), ALL('Product')))`;
    expect(run(withAll).step(withAll).notes[1]).toBe("Removing filters from another table (such as ALL on a related table) doesn't undo this; removing filters from Sales does.");
    const inner = step('SUM(Sales[Amount])');
    expect(describeContext(inner.context)).toContain('table Sales limited to the rows of the current group  (set by SUMMARIZE for each group)');
  });

  it("can read the group's columns, but not another column of the table (an error)", () => {
    expect(run(source).step("'Product'[Category]", 1).summary).toBe("Reads 'Product'[Category] from the row that SUMMARIZE is currently on.");
    const bad = run(`SUMMARIZE(Sales, 'Product'[Category], "Qty", Sales[Quantity])`);
    expect(bad.step('Sales[Quantity]').summary).toBe('Sales[Quantity] isn’t in the current row of SUMMARIZE, which has only Product[Category] (an error).'.replace('’', "'"));
    expect(bad.step('Sales[Quantity]').notes[0]).toContain('MAX(Sales[Quantity]) or SUM(Sales[Quantity]): SUMMARIZE filters the table');
  });

  it('a plain loop over VALUES gives the CALCULATE advice instead (MAX alone sees every row)', () => {
    const { step } = run("SUMX(VALUES('Product'[Category]), LEN('Product'[Product]))");
    expect(step("'Product'[Product]").notes[0]).toContain("CALCULATE(MAX('Product'[Product]))");
  });

  it('as a table, its rows have the group-by columns (a measure over it filters them)', () => {
    const { step } = run("SUMX(SUMMARIZE(Sales, 'Product'[Category]), [Total Sales])");
    expect(step("SUMX(SUMMARIZE(Sales, 'Product'[Category]), [Total Sales])").summary).toBe(
      "SUMX goes through SUMMARIZE(Sales, 'Product'[Category]) one row at a time.",
    );
    const transition = step('[Total Sales]').operations.find((o) => o.kind === 'context-transition');
    expect(transition && transition.kind === 'context-transition' ? transition.added.map((e) => e.target) : []).toEqual([
      { kind: 'columns', columns: [{ table: 'Product', column: 'Category' }] },
    ]);
  });

  it('ROLLUP adds a total row, where ISSUBTOTAL is TRUE', () => {
    const { step } = run(`SUMMARIZE(Sales, ROLLUP('Product'[Category]), "Total?", ISSUBTOTAL('Product'[Category]))`);
    expect(step("ROLLUP('Product'[Category])").summary).toContain('Adds a total row');
    expect(step("ISSUBTOTAL('Product'[Category])").summary).toContain('TRUE on the total row');
  });
});

describe('GROUPBY and CURRENTGROUP (checked in Power BI Desktop on Initech)', () => {
  const ok = `GROUPBY(Sales, 'Product'[Category], "Sum", SUMX(CURRENTGROUP(), Sales[Amount]))`;

  it('goes group by group; SUMX goes through the group’s rows, and nothing is filtered for the group', () => {
    const { step, analysis } = run(ok);
    expect(step(ok).summary).toBe('GROUPBY groups Sales by Product[Category], one group at a time.');
    expect(step('Sales[Amount]').summary).toBe('Reads Sales[Amount] from the row that SUMX is currently on.');
    expect(step('SUMX(CURRENTGROUP(), Sales[Amount])').summary).toContain('the rows of the current group');
    expect(describeContext(step('SUMX(CURRENTGROUP(), Sales[Amount])').context)[0]).toBe("All of the report's filters");
    expect(analysis.insights.filter((i) => i.kind === 'dax-error')).toEqual([]);
  });

  it('refuses anything but one aggregation over CURRENTGROUP(), and CALCULATE or measures', () => {
    const errors = (source: string) => run(source).analysis.insights.filter((i) => i.kind === 'dax-error').map((i) => i.summary);
    expect(errors(`GROUPBY(Sales, 'Product'[Category], "M", MEDIANX(CURRENTGROUP(), Sales[Amount]))`)[0]).toContain('must be one SUMX');
    expect(errors(`GROUPBY(Sales, 'Product'[Category], "S", SUM(Sales[Amount]))`)[0]).toContain('must be one SUMX');
    expect(errors(`GROUPBY(Sales, 'Product'[Category], "S", SUMX(CURRENTGROUP(), [Total Sales]))`)[0]).toContain("doesn't allow CALCULATE or measures");
    expect(errors(`GROUPBY(Sales, 'Product'[Category], "S", SUMX(CURRENTGROUP(), 1))`)).toEqual([]);
  });

  it('CURRENTGROUP() outside GROUPBY is an error', () => {
    const { analysis } = run('COUNTROWS(CURRENTGROUP())');
    expect(analysis.insights.map((i) => i.kind)).toContain('dax-error');
  });
});

describe('functions that combine tables (checked in Power BI Desktop on Initech)', () => {
  const lastFilter = (source: string) => {
    const { step } = run(source);
    const inner = step(source).innerContext ?? step(source).context;
    return inner.filter.entries[inner.filter.entries.length - 1];
  };

  it('CROSSJOIN of two columns filters both', () => {
    const entry = lastFilter(`CALCULATE([Total Sales], CROSSJOIN(VALUES('Product'[Category]), VALUES('Date'[Year])))`);
    expect(entry.target).toEqual({ kind: 'columns', columns: [{ table: 'Product', column: 'Category' }, { table: 'Date', column: 'Year' }] });
  });

  it('UNION of the same column keeps the link; EXCEPT and INTERSECT keep the first table\'s', () => {
    const category = { kind: 'columns', columns: [{ table: 'Product', column: 'Category' }] };
    expect(lastFilter(`CALCULATE([Total Sales], UNION(VALUES('Product'[Category]), VALUES('Product'[Category])))`).target).toEqual(category);
    expect(lastFilter(`CALCULATE([Total Sales], EXCEPT(VALUES('Product'[Category]), {"Widgets"}))`).target).toEqual(category);
    expect(lastFilter(`CALCULATE([Total Sales], INTERSECT(VALUES('Product'[Category]), {"Widgets"}))`).target).toEqual(category);
  });

  it('UNION with a {…} list, or EXCEPT starting with one, filters nothing', () => {
    for (const filter of [`UNION(VALUES('Product'[Category]), {"Extra"})`, `EXCEPT({"Widgets", "Gadgets"}, VALUES('Product'[Category]))`, `UNION(VALUES('Product'[Category]), VALUES('Customer'[Region]))`]) {
      const source = `CALCULATE([Total Sales], ${filter})`;
      const { step, analysis } = run(source);
      expect(step(source).innerContext!.filter.entries).toEqual([]);
      expect(analysis.insights.map((i) => i.kind)).toContain('filters-nothing');
      expect(step(filter).summary).toContain('filters nothing here');
    }
  });

  it('a table it cannot place stays "not checked", not a guess', () => {
    const source = `CALCULATE([Total Sales], CROSSJOIN(VALUES('Product'[Category]), Sales))`;
    expect(lastFilter(source).target.kind).not.toBe('columns');
  });

  it('GENERATE goes row by row, and says the row filters nothing in the second table', () => {
    const source = `SUMX(GENERATE(VALUES('Product'[Category]), TOPN(1, VALUES('Date'[Year]))), [Total Sales])`;
    const { step } = run(source);
    const generate = step(`GENERATE(VALUES('Product'[Category]), TOPN(1, VALUES('Date'[Year])))`);
    expect(generate.notes.join(' ')).toContain('unless it is wrapped in CALCULATETABLE');
    const inner = step(`TOPN(1, VALUES('Date'[Year]))`).context;
    expect(inner.rows.map((r) => r.functionName)).toEqual(['GENERATE']);
  });
});

describe('tables made from values (checked in Power BI Desktop on Initech)', () => {
  it('as a CALCULATE filter, each filters nothing', () => {
    for (const filter of [`DATATABLE("Category", STRING, {{"Widgets"}})`, `ROW("Category", "Widgets")`, `GENERATESERIES(2025, 2025)`, `CALENDAR(DATE(2025, 1, 1), DATE(2025, 12, 31))`, `CALENDARAUTO()`]) {
      const source = `CALCULATE([Total Sales], ${filter})`;
      const { step } = run(source);
      expect(step(source).innerContext!.filter.entries).toEqual([]);
      expect(step(filter).summary).toContain('filters nothing here');
    }
  });

  it('in a loop, the row filters nothing when it becomes a filter (twice the total for two rows)', () => {
    const { step } = run(`SUMX(GENERATESERIES(1, 2), [Total Sales])`);
    const measure = step('[Total Sales]');
    expect(measure.innerContext!.filter.entries).toEqual([]);
    expect(measure.summary).toContain('filters nothing');
  });

  it('knows their columns: [Value], [Date], and the names written in ROW and DATATABLE', () => {
    expect(run(`SUMX(GENERATESERIES(1, 3), [Value])`).step('[Value]').summary).toBe('Reads [Value] from the row that SUMX is currently on.');
    expect(run(`MAXX(CALENDAR(DATE(2025, 1, 1), DATE(2025, 1, 3)), [Date])`).step('[Date]').summary).toBe('Reads [Date] from the row that MAXX is currently on.');
    expect(run(`MAXX(ROW("S", [Total Sales]), [S])`).step('[S]').summary).toBe('Reads [S] from the row that MAXX is currently on.');
    expect(run(`MAXX(DATATABLE("A", INTEGER, {{1}, {2}}), [A])`).step('[A]').summary).toBe('Reads [A] from the row that MAXX is currently on.');
  });

  it("a model column isn't in their rows (an error)", () => {
    const { step, analysis } = run(`MAXX(GENERATESERIES(1, 3), 'Date'[Year])`);
    expect(step(`'Date'[Year]`).summary).toBe("'Date'[Year] isn't in the current row of MAXX, which has only [Value] (an error).");
    expect(analysis.insights.map((i) => i.kind)).toContain('column-without-row-context');
  });

  it('DATATABLE values must be written out, each row in its own {…}', () => {
    const errors = (source: string) => run(source).analysis.insights.filter((i) => i.kind === 'dax-error').map((i) => i.summary);
    expect(errors(`DATATABLE("A", INTEGER, {{1}, {-2}, {BLANK()}})`)).toEqual([]);
    expect(errors(`DATATABLE("A", BOOLEAN, "B", STRING, {{TRUE(), "x"}})`)).toEqual([]);
    expect(errors(`DATATABLE("A", INTEGER, {{1 + 1}})`)[0]).toContain('must be written out; 1 + 1 is worked out');
    expect(errors(`DATATABLE("A", INTEGER, {{[Total Sales]}})`)).toHaveLength(1);
    expect(errors(`DATATABLE("A", INTEGER, {1, 2})`)[0]).toContain('in their own {…}');
  });

  it('GENERATESERIES step must be above zero', () => {
    const errors = (source: string) => run(source).analysis.insights.filter((i) => i.kind === 'dax-error');
    expect(errors(`GENERATESERIES(1, 2, 0)`)).toHaveLength(1);
    expect(errors(`GENERATESERIES(1, 2, -1)`)).toHaveLength(1);
    expect(errors(`GENERATESERIES(1, 2, 0.5)`)).toEqual([]);
  });
});

describe('ALLNOBLANKROW, ALLCROSSFILTERED and FILTERS (checked in Power BI Desktop on Initech)', () => {
  const errors = (source: string, options?: BindOptions) => run(source, options).analysis.insights.filter((i) => i.kind === 'dax-error').map((i) => i.summary);

  it('ALLNOBLANKROW inside CALCULATE replaces the filter rather than removing it (ISFILTERED stays TRUE)', () => {
    const source = `CALCULATE([Total Sales], ALLNOBLANKROW('Product'[Category]))`;
    const { step } = run(source);
    const inner = step(source).innerContext!;
    expect(inner.filter.entries.map((e) => e.target)).toEqual([{ kind: 'columns', columns: [{ table: 'Product', column: 'Category' }] }]);
    expect(step(`ALLNOBLANKROW('Product'[Category])`).notes.join(' ')).toContain("doesn't remove the filter");
  });

  it('ALLNOBLANKROW on its own gives all values, without the blank row', () => {
    const { step } = run(`COUNTROWS(ALLNOBLANKROW('Product'[Category]))`);
    expect(step(`ALLNOBLANKROW('Product'[Category])`).notes[0]).toContain('without the blank row');
  });

  it('ALLCROSSFILTERED removes the table’s filters; with a CROSSFILTER in the code, the rest is "not checked"', () => {
    const plain = `CALCULATE([Total Sales], ALLCROSSFILTERED('Product'))`;
    const one = run(plain).step(plain).innerContext!.filter;
    expect(one.removals).toEqual([{ kind: 'table', table: 'Product', except: [] }]);
    expect(one.caveats[0]).toContain('two-way relationships'); // no model here: they can't be ruled out
    const twoWay = `CALCULATE(CALCULATE([Total Sales], ALLCROSSFILTERED('Product')), CROSSFILTER(Sales[Product Key], 'Product'[Product Key], BOTH))`;
    expect(run(twoWay).step(`CALCULATE([Total Sales], ALLCROSSFILTERED('Product'))`).innerContext!.filter.caveats[0]).toContain('two-way relationships');
  });

  it('ALLCROSSFILTERED is an error outside CALCULATE, or with a column', () => {
    expect(errors(`COUNTROWS(ALLCROSSFILTERED(Sales))`)[0]).toContain('only works as a filter inside CALCULATE');
    expect(errors(`CALCULATE([Total Sales], ALLCROSSFILTERED('Product'[Category]))`)[0]).toContain('takes a table');
    expect(errors(`CALCULATE([Total Sales], ALLCROSSFILTERED('Product'))`)).toEqual([]);
  });

  it('FILTERS keeps its link as a CALCULATE filter, says what it lists, and takes a column only', () => {
    const source = `CALCULATE([Total Sales], FILTERS('Product'[Category]))`;
    const { step } = run(source);
    expect(step(source).innerContext!.filter.entries.map((e) => e.target)).toEqual([{ kind: 'columns', columns: [{ table: 'Product', column: 'Category' }] }]);
    expect(run(`COUNTROWS(FILTERS('Product'[Category]))`).step(`FILTERS('Product'[Category])`).notes[0]).toContain('unlike VALUES');
    expect(errors(`COUNTROWS(FILTERS('Product'))`)[0]).toContain('takes a column');
  });
});

describe('dates written as dt"…" (checked in Power BI Desktop)', () => {
  it('filter like any date, and count as written-out values in DATATABLE', () => {
    const source = `CALCULATE([Total Sales], 'Date'[Date] >= dt"2025-01-01")`;
    expect(run(source).step(source).innerContext!.filter.entries.map((e) => e.target)).toEqual([{ kind: 'columns', columns: [{ table: 'Date', column: 'Date' }] }]);
    expect(run(`DATATABLE("D", DATETIME, {{dt"2025-01-01"}})`).analysis.insights.filter((i) => i.kind === 'dax-error')).toEqual([]);
  });
});

describe('Wave 2 group 4 (checked in Power BI Desktop on Initech)', () => {
  const errors = (source: string) => run(source).analysis.insights.filter((i) => i.kind === 'dax-error').map((i) => i.summary);
  const category = [{ kind: 'columns', columns: [{ table: 'Product', column: 'Category' }] }];

  it('TOPNSKIP and SAMPLE go row by row and keep the link as CALCULATE filters', () => {
    for (const filter of [`TOPNSKIP(1, 0, VALUES('Product'[Category]), [Total Sales], DESC)`, `SAMPLE(1, VALUES('Product'[Category]), [Total Sales], DESC)`]) {
      const source = `CALCULATE([Total Sales], ${filter})`;
      const { step } = run(source);
      expect(step(source).innerContext!.filter.entries.map((e) => e.target)).toEqual(category);
      expect(step('[Total Sales]', 1).context.rows.map((r) => r.functionName)).toEqual([filter.slice(0, filter.indexOf('('))]);
    }
  });

  it('TOPNSKIP says skipping rows is an error on DirectQuery, only when it skips', () => {
    const notes = (source: string) => run(source).step(source).notes.join(' ');
    expect(notes(`TOPNSKIP(1, 2, VALUES('Product'[Category]), [Total Sales])`)).toContain('DirectQuery');
    expect(notes(`TOPNSKIP(1, 0, VALUES('Product'[Category]), [Total Sales])`)).not.toContain('DirectQuery');
  });

  it("SUBSTITUTEWITHINDEX keeps the first table's other columns, and adds the named index column", () => {
    const table = `SUBSTITUTEWITHINDEX(SUMMARIZE(Sales, 'Product'[Category], 'Date'[Year]), "Idx", VALUES('Product'[Category]), 'Product'[Category], ASC)`;
    const source = `CALCULATE([Total Sales], ${table})`;
    expect(run(source).step(source).innerContext!.filter.entries.map((e) => e.target)).toEqual([{ kind: 'columns', columns: [{ table: 'Date', column: 'Year' }] }]);
    expect(run(`MAXX(${table}, [Idx])`).step('[Idx]').summary).toBe('Reads [Idx] from the row that MAXX is currently on.');
  });

  it('LINEST and LINESTX give one row with [Slope1], [Intercept] and the like; LINEST needs columns of one table', () => {
    expect(run(`MAXX(LINEST(Sales[Amount], Sales[Quantity]), [Slope1])`).step('[Slope1]').summary).toBe('Reads [Slope1] from the row that MAXX is currently on.');
    expect(run(`MAXX(LINESTX(Sales, Sales[Amount], Sales[Quantity]), [Intercept])`).step('[Intercept]').summary).toBe('Reads [Intercept] from the row that MAXX is currently on.');
    expect(errors(`LINEST(Sales[Amount], 'Date'[Year])`)[0]).toContain('one table');
    expect(errors(`LINEST(Sales[Amount], Sales[Quantity], TRUE)`)).toEqual([]);
  });

  it('NAMEOF and TABLEOF only use a reference, which is not calculated', () => {
    const { step, analysis } = run(`NAMEOF('Product'[Category])`);
    expect(step(`'Product'[Category]`).summary).toBe("Not calculated: only the name of 'Product'[Category] is used.");
    expect(analysis.insights.filter((i) => i.kind === 'column-without-row-context')).toEqual([]);
    expect(errors(`NAMEOF(SUM(Sales[Amount]))`)[0]).toContain('needs a reference');
    expect(errors(`COUNTROWS(TABLEOF(VALUES('Product'[Category])))`)[0]).toContain('needs a reference');
    expect(errors(`NAMEOF([Total Sales], MEASURE)`)).toEqual([]);
  });

  it("ALL(TABLEOF('Product'[Category])) removes the filters of the whole Product table", () => {
    const source = `CALCULATE([Total Sales], ALL(TABLEOF('Product'[Category])))`;
    expect(run(source).step(source).innerContext!.filter.removals).toEqual([{ kind: 'table', table: 'Product', except: [] }]);
  });

  it('ISAFTER and ISONORAFTER take groups of value, starting value and an optional ASC or DESC', () => {
    expect(errors(`ISONORAFTER(1, 1, ASC, 3, 2)`)).toEqual([]);
    const { analysis } = run(`ISAFTER(2, 1, DESC)`);
    expect(analysis.insights.filter((i) => i.kind === 'unknown-function')).toEqual([]);
  });
});

describe('window functions (checked in Power BI Desktop on Initech)', () => {
  const errors = (source: string) => run(source).analysis.insights.filter((i) => i.kind === 'dax-error').map((i) => i.summary);
  const year = [{ kind: 'columns', columns: [{ table: 'Date', column: 'Year' }] }];

  it('OFFSET as a CALCULATE filter filters the table’s columns, and says which row it picks', () => {
    const offset = `OFFSET(-1, ALL('Date'[Year]), ORDERBY('Date'[Year]))`;
    const source = `CALCULATE([Total Sales], ${offset})`;
    const { step } = run(source);
    expect(step(source).innerContext!.filter.entries.map((e) => e.target)).toEqual(year);
    expect(run(offset).step(offset).summary).toBe(`OFFSET: the row just before the current one of ALL('Date'[Year]), sorted by 'Date'[Year] (smallest first).`);
    expect(step(offset).notes.join(' ')).toContain('If they leave several (on a total), it does this for each and returns them all.');
  });

  it('the current row comes from a loop whose row has the table’s columns', () => {
    const offset = `OFFSET(-1, ALL('Date'[Year]), ORDERBY('Date'[Year]))`;
    const { step } = run(`SUMX(VALUES('Date'[Year]), CALCULATE([Total Sales], ${offset}))`);
    expect(step(offset).notes[0]).toBe('The current row is the row SUMX is on.');
  });

  it('RANK and ROWNUMBER give BLANK when the filters leave more than one row', () => {
    const rank = `RANK(DENSE, ALL('Product'[Category]), ORDERBY([Total Sales], DESC))`;
    expect(run(rank).step(rank).notes[0]).toContain('it gives BLANK');
  });

  it("ORDERBY's expressions are worked out for each row of the table (a measure: for that row)", () => {
    const { step } = run(`RANK(DENSE, ALL('Product'[Category]), ORDERBY([Total Sales], DESC))`);
    expect(step('[Total Sales]').context.rows.map((r) => r.functionName)).toEqual(['RANK']);
    expect(step('[Total Sales]').summary).toContain('for the current row of RANK');
    const bad = run(`OFFSET(-1, ALL('Date'[Month Number]), ORDERBY('Date'[Year]))`);
    expect(bad.step(`'Date'[Year]`).summary).toContain("isn't in the current row of OFFSET");
  });

  it('INDEX picks by position; WINDOW says which rows', () => {
    const index = `INDEX(-1, ALL('Date'[Year]), ORDERBY('Date'[Year]))`;
    expect(run(index).step(index).summary).toContain('the last row');
    const window = `WINDOW(1, ABS, 0, REL, ALL('Date'[Year]), ORDERBY('Date'[Year]))`;
    expect(run(window).step(window).summary).toContain('the rows from the first row to the current row');
    const relative = `WINDOW(-1, 0, ALL('Date'[Year]), ORDERBY('Date'[Year]))`;
    expect(run(relative).step(relative).summary).toContain('the rows from 1 row before the current one to the current row');
  });

  it('with no table written, it uses ALLSELECTED of the ORDERBY columns; with neither, an error', () => {
    const offset = `OFFSET(-1, ORDERBY('Date'[Year]))`;
    const source = `CALCULATE([Total Sales], ${offset})`;
    const { step } = run(source);
    expect(step(source).innerContext!.filter.entries.map((e) => e.target)).toEqual(year);
    expect(step(offset).notes.join(' ')).toContain("ALLSELECTED('Date'[Year])");
    expect(errors(`COUNTROWS(OFFSET(-1))`)[0]).toContain('needs a table');
    expect(errors(`ROWNUMBER()`)[0]).toContain('needs a table');
  });

  it('PARTITIONBY counts within each value separately', () => {
    const offset = `OFFSET(-1, ALL('Date'[Year], 'Date'[Month Number]), ORDERBY('Date'[Month Number]), PARTITIONBY('Date'[Year]))`;
    expect(run(offset).step(offset).notes.join(' ')).toContain("within each value of 'Date'[Year] separately");
  });
});

describe('RANK and ROWNUMBER ties (checked in Power BI Desktop: all tied gave 1,1,1,1 and 1,2,3,4)', () => {
  it('says how ties are numbered', () => {
    const dense = `RANK(DENSE, ALL('Product'[Category]), ORDERBY([Total Sales], DESC))`;
    expect(run(dense).step(dense).notes.join(' ')).toContain('(1, 1, 2)');
    const skip = `RANK(SKIP, ALL('Product'[Category]), ORDERBY([Total Sales], DESC))`;
    expect(run(skip).step(skip).notes.join(' ')).toContain('(1, 1, 3)');
    const number = `ROWNUMBER(ALL('Product'[Category]), ORDERBY([Total Sales], DESC))`;
    expect(run(number).step(number).notes.join(' ')).toContain('every row gets its own number');
    expect(run(number).step(number).notes[0]).toBe("The current row is the one the filters leave in ALL('Product'[Category]). If they leave several (on a total), it gives BLANK.");
  });
});

describe('SUMMARIZECOLUMNS in a measure (checked in Power BI Desktop on Initech)', () => {
  const category = { table: 'Product', column: 'Category' };
  const errors = (source: string) => run(source).analysis.insights.filter((i) => i.kind === 'dax-error' || i.kind === 'column-without-row-context').map((i) => i.summary);

  it("the extra columns see each group's values as filters, after its filter tables", () => {
    const source = `SUMMARIZECOLUMNS('Product'[Category], TREATAS({"Widgets"}, 'Product'[Category]), "S", [Total Sales])`;
    const { step } = run(source);
    expect(step(source).summary).toBe('SUMMARIZECOLUMNS groups by Product[Category], one group at a time.');
    const entries = step('[Total Sales]').context.filter.entries;
    expect(entries.at(-1)).toMatchObject({ target: { kind: 'columns', columns: [category] }, condition: "= the current group's value" });
  });

  it('ALL inside an extra column removes the group filter; a column on its own is an error', () => {
    const { step } = run(`SUMMARIZECOLUMNS('Product'[Category], "A", CALCULATE([Total Sales], ALL('Product')))`);
    expect(step(`CALCULATE([Total Sales], ALL('Product'))`).innerContext!.filter.entries).toEqual([]);
    expect(errors(`SUMMARIZECOLUMNS('Product'[Category], "C", 'Product'[Category])`)[0]).toContain('no current row');
  });

  it("says a loop's row doesn't filter the groups, and (after the last group) that blank groups are left out", () => {
    const sc = `SUMMARIZECOLUMNS('Product'[Category], "S", SUM(Sales[Amount]))`;
    const notes = run(`SUMX(VALUES('Date'[Year]), COUNTROWS(${sc}))`).step(sc).notes.join(' ');
    expect(notes).toContain("The row of SUMX doesn't filter the groups");
    expect(notes).not.toContain('BLANK');
    const alone = run(sc);
    const binding = bind(alone.root, CONVENTION);
    const done = buildTimeline(alone.root, binding, alone.analysis, sc).find((e) => e.title === 'SUMMARIZECOLUMNS: after the last group')!;
    expect(done.summary).toContain('groups where every extra column is BLANK are left out');
    expect(run(`SUMMARIZECOLUMNS('Product'[Category], 'Customer'[Region])`).step(`SUMMARIZECOLUMNS('Product'[Category], 'Customer'[Region])`).notes[0]).toContain('every combination');
  });

  it('the same name twice is an error; as a CALCULATE filter it filters its group columns', () => {
    expect(errors(`SUMMARIZECOLUMNS('Product'[Category], "S", 1, "S", 2)`)[0]).toContain('twice');
    const source = `CALCULATE([Total Sales], SUMMARIZECOLUMNS('Product'[Category], TREATAS({"Widgets"}, 'Product'[Category])))`;
    expect(run(source).step(source).innerContext!.filter.entries.map((e) => e.target)).toEqual([{ kind: 'columns', columns: [category] }]);
  });
});

describe('calculation item code (checked in Power BI Desktop: outside an item, these are errors)', () => {
  it('SELECTEDMEASURE() is the measure being rewritten: in a loop, worked out for the current row', () => {
    const { step } = run(`SUMX(VALUES('Date'[Year]), SELECTEDMEASURE())`);
    const selected = step('SELECTEDMEASURE()');
    expect(selected.operations.map((o) => o.kind)).toEqual(['context-transition']);
    expect(selected.notes.join(' ')).toContain('code for a calculation item');
  });

  it('ISSELECTEDMEASURE names measures without working them out', () => {
    const { step, analysis } = run(`IF(ISSELECTEDMEASURE([Total Sales]), 1, 0)`);
    expect(step('[Total Sales]').summary).toBe('Not calculated: only the name of [Total Sales] is used.');
    expect(analysis.insights.filter((i) => i.kind === 'unknown-function')).toEqual([]);
  });
});

describe('DETAILROWS (checked in Power BI Desktop on Initech)', () => {
  it('lists the rows behind a measure; a column is an error', () => {
    const { step } = run(`COUNTROWS(DETAILROWS([Total Sales]))`);
    expect(step('DETAILROWS([Total Sales])').notes[0]).toContain("rows of the measure's own table that the filters here allow");
    expect(step('[Total Sales]').summary).toBe('Not calculated: only the name of [Total Sales] is used.');
    const errors = run(`COUNTROWS(DETAILROWS(Sales[Amount]))`).analysis.insights.filter((i) => i.kind === 'dax-error');
    expect(errors[0].summary).toContain('needs a measure');
  });
});
