import { describe, expect, it } from 'vitest';
import { INITECH_MODEL } from '../../samples/initechModel';
import { bind } from '../binder/binder';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { analyzeContext } from './analyzer';
import { describeContext, incomingText } from './describe';
import { INITIAL_CONTEXT, type EvalContext } from './model';
import { expandedTables, filterReach, flowFrom, pathText, relationshipFromInfo, type Relationship, type RelationshipModel } from './relationships';
import { reportFilterStatus, type ReportFilter } from './reportFilters';
import { buildTimeline } from './timeline';

const rel = (from: string, to: string, extra: Partial<Relationship> = {}): Relationship => ({
  fromTable: from,
  fromColumn: `${to} Key`,
  toTable: to,
  toColumn: `${to} Key`,
  fromMany: true,
  toMany: false,
  active: true,
  bothDirections: false,
  ...extra,
});

const CATEGORY: ReportFilter = { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'] };

/** The filters at a step: the report filters given, plus an added filter context. */
function reach(model: RelationshipModel, context: EvalContext = INITIAL_CONTEXT, report: ReportFilter[] = []) {
  const seeds = report.map((f) => ({ columns: f.kind === 'values' ? [f.column] : f.columns, text: 'F', applies: reportFilterStatus(f, context.filter.removals, model) === 'applies' }));
  const result = filterReach(context, seeds, model);
  const state = Object.fromEntries(result.tables.map((t) => [t.table, t.state]));
  return { result, state };
}

function analysis(definition: string, model: RelationshipModel | null) {
  const { root } = parse(tokenize(definition, splitMeasureDefinition(definition).header!.expressionStart).tokens);
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  const a = analyzeContext(root, binding, definition, INITIAL_CONTEXT, model);
  return buildTimeline(root, binding, a, definition);
}

describe('relationships', () => {
  it('reads the helper\'s relationship fields', () => {
    expect(
      relationshipFromInfo({ fromTable: 'Sales', fromColumn: 'Date', fromCardinality: 'Many', toTable: 'Date', toColumn: 'Date', toCardinality: 'One', isActive: false, crossFilteringBehavior: 'BothDirections' }),
    ).toEqual({ fromTable: 'Sales', fromColumn: 'Date', toTable: 'Date', toColumn: 'Date', fromMany: true, toMany: false, active: false, bothDirections: true });
  });

  it('filters flow from the one side to the many side, both ways when set, never through inactive relationships', () => {
    expect(flowFrom(rel('Sales', 'Product'), 'Product')).toEqual({ kind: 'flows', to: 'Sales' });
    expect(flowFrom(rel('Sales', 'Product'), 'Sales')).toEqual({ kind: 'blocked' });
    expect(flowFrom(rel('Sales', 'Product', { bothDirections: true }), 'Sales')).toEqual({ kind: 'flows', to: 'Product' });
    expect(flowFrom(rel('Sales', 'Product', { active: false }), 'Product')).toEqual({ kind: 'blocked' });
    expect(flowFrom(rel('A', 'B', { fromMany: false }), 'A')).toEqual({ kind: 'flows', to: 'B' }); // one-to-one
    expect(flowFrom(rel('A', 'B', { toMany: true }), 'A')).toEqual({ kind: 'unknown' }); // many-to-many, one direction
  });

  it("a table's expanded table follows many-to-one relationships, repeatedly", () => {
    const model: RelationshipModel = { source: 'report', tables: ['Sales', 'Product', 'Category', 'Customer'], relationships: [rel('Sales', 'Product'), rel('Product', 'Category'), rel('Sales', 'Customer', { active: false })] };
    expect(expandedTables(model, 'Sales')).toEqual(['Sales', 'Product', 'Category']);
    expect(expandedTables(model, 'Product')).toEqual(['Product', 'Category']);
    expect(expandedTables(model, 'Category')).toEqual(['Category']);
  });
});

describe('where filters reach', () => {
  it('a filter on Product reaches Sales but not Customer, Plant or Date (Initech)', () => {
    const { state, result } = reach(INITECH_MODEL, INITIAL_CONTEXT, [CATEGORY]);
    expect(state).toEqual({ Sales: 'reached', Product: 'filtered', Customer: 'not-reached', Plant: 'not-reached', Date: 'not-reached' });
    expect(pathText(result.tables.find((t) => t.table === 'Sales')!)).toBe('Product → Sales (through Sales[Product Key] → Product[Product Key])');
    expect(result.flowing.map((r) => r.toTable)).toEqual(['Product']);
  });

  it('with a both-ways relationship the filter carries on to the other dimensions it reaches', () => {
    const model: RelationshipModel = { source: 'report', tables: ['Sales', 'Product', 'Customer'], relationships: [rel('Sales', 'Product'), rel('Sales', 'Customer', { bothDirections: true })] };
    expect(reach(model, INITIAL_CONTEXT, [CATEGORY]).state).toEqual({ Sales: 'reached', Product: 'filtered', Customer: 'reached' });
  });

  it('a removed report filter reaches nothing; filters the expression adds do', () => {
    const steps = analysis('M = CALCULATE([Total Sales], REMOVEFILTERS(Product), Plant[Plant Name] = "Austin")', INITECH_MODEL);
    const inside = steps.find((e) => e.kind === 'calculate')!.innerContext!;
    expect(reach(INITECH_MODEL, inside, [CATEGORY]).state).toEqual({ Sales: 'reached', Product: 'not-reached', Customer: 'not-reached', Plant: 'filtered', Date: 'not-reached' });
  });
});

describe('a filter on a whole table', () => {
  it('reaches the tables it looks up too (checked live: ISCROSSFILTERED on Initech)', () => {
    const inside = analysis('M = CALCULATE([Total Sales], FILTER(Sales, Sales[Quantity] > 5))', INITECH_MODEL).find((e) => e.kind === 'calculate')!.innerContext!;
    const { state, result } = reach(INITECH_MODEL, inside);
    expect(state).toEqual({ Sales: 'filtered', Product: 'reached', Customer: 'reached', Plant: 'reached', Date: 'reached' });
    expect(result.against).toHaveLength(4);
    const product = result.tables.find((t) => t.table === 'Product')!;
    expect(product.expanded).toBe(true);
    expect(pathText(product)).toContain('only Product rows with matching Sales rows are kept');
  });
});

describe('removed filters on the map', () => {
  it('marks the column a removal covers, and the whole expanded table for ALL(Sales)', () => {
    const percent = analysis('M = CALCULATE([Total Sales], REMOVEFILTERS(Product[Category]))', INITECH_MODEL).find((e) => e.kind === 'calculate')!.innerContext!;
    const removed = (context: EvalContext) => Object.fromEntries(reach(INITECH_MODEL, context).result.tables.filter((t) => t.removed.length > 0).map((t) => [t.table, t.removed]));
    expect(removed(percent)).toEqual({ Product: ['Category'] });
    const all = analysis('M = CALCULATE([Total Sales], ALL(Sales))', INITECH_MODEL).find((e) => e.kind === 'calculate')!.innerContext!;
    expect(removed(all)).toEqual({ Sales: ['all'], Product: ['all'], Customer: ['all'], Plant: ['all'], Date: ['all'] });
    // A filter that replaces another (context transition, Plant[Plant Name] = "Austin") is not shown as a removal.
    const transition = analysis('M = AVERAGEX(VALUES(Customer[Customer Key]), [Total Sales])', INITECH_MODEL).find((e) => e.kind === 'measure')!.innerContext!;
    expect(removed(transition)).toEqual({});
    const overwrite = analysis('M = CALCULATE([Total Sales], Plant[Plant Name] = "Austin")', INITECH_MODEL).find((e) => e.kind === 'calculate')!.innerContext!;
    expect(removed(overwrite)).toEqual({});
  });
});

describe('with the relationships known, whole-table removals are certain', () => {
  it('REMOVEFILTERS(Sales) also removes report filters on the tables Sales looks up', () => {
    const removals = [{ kind: 'table' as const, table: 'Sales', except: [] }];
    expect(reportFilterStatus(CATEGORY, removals)).toBe('maybe-removed');
    expect(reportFilterStatus(CATEGORY, removals, INITECH_MODEL)).toBe('removed');
    expect(reportFilterStatus(CATEGORY, [{ kind: 'table', table: 'Customer', except: [] }], INITECH_MODEL)).toBe('applies');
    expect(incomingText(removals, INITECH_MODEL)).toBe("The report's filters, except any filter on table Sales and the tables it looks up (Date, Product, Customer, Plant)");
  });

  it('the analyzer drops the "depends on the data model" note and removes added filters on looked-up tables', () => {
    const text = 'M = CALCULATE(CALCULATE([Total Sales], REMOVEFILTERS(Sales)), Product[Color] = "Red")';
    const without = analysis(text, null).filter((e) => e.kind === 'calculate')[1].innerContext!;
    expect(describeContext(without).some((l) => l.startsWith('Not checked'))).toBe(true);
    expect(describeContext(without)).toContain('Product[Color] = "Red"  (added by CALCULATE)');

    const withModel = analysis(text, INITECH_MODEL).filter((e) => e.kind === 'calculate')[1].innerContext!;
    expect(describeContext(withModel).some((l) => l.startsWith('Not checked'))).toBe(false);
    expect(describeContext(withModel)).toEqual(["The report's filters, except any filter on Product[Color]; table Sales"]);
  });
});

describe('USERELATIONSHIP, CROSSFILTER and TREATAS', () => {
  const DATE_2025: ReportFilter = { kind: 'values', column: { table: 'Date', column: 'Year' }, values: [2025] };
  const inside = (text: string) => analysis(text, INITECH_MODEL).find((e) => e.kind === 'calculate')!.innerContext!;

  it('USERELATIONSHIP: the ship date relationship carries the Date filter; the order date one is switched off', () => {
    const context = inside("M = CALCULATE([Total Sales], USERELATIONSHIP(Sales[Ship Date], 'Date'[Date]))");
    expect(describeContext(context)).toContain('Uses the relationship Sales[Ship Date] – Date[Date]  (USERELATIONSHIP)');
    const { result, state } = reach(INITECH_MODEL, context, [DATE_2025]);
    expect(state.Sales).toBe('reached');
    const ship = result.model.relationships.find((r) => r.fromColumn === 'Ship Date')!;
    const order = result.model.relationships.find((r) => r.fromColumn === 'Date')!;
    expect([ship.active, order.active, ship.changedBy, order.switchedOffBy]).toEqual([true, false, 'USERELATIONSHIP', 'USERELATIONSHIP']);
    expect(result.flowing).toEqual([ship]);
    expect(pathText(result.tables.find((t) => t.table === 'Sales')!)).toBe('Date → Sales (through Sales[Ship Date] → Date[Date])');
  });

  it('CROSSFILTER BOTH: a Product filter reaches Customer through Sales', () => {
    const context = inside('M = CALCULATE(COUNTROWS(Customer), CROSSFILTER(Sales[Customer Key], Customer[Customer Key], BOTH))');
    expect(reach(INITECH_MODEL, context, [CATEGORY]).state).toEqual({ Sales: 'reached', Product: 'filtered', Customer: 'reached', Plant: 'not-reached', Date: 'not-reached' });
    expect(reach(INITECH_MODEL, INITIAL_CONTEXT, [CATEGORY]).state.Customer).toBe('not-reached');
  });

  it('CROSSFILTER NONE cuts a relationship; a named direction filters only that way', () => {
    const none = inside('M = CALCULATE([Total Sales], CROSSFILTER(Sales[Product Key], Product[Product Key], NONE))');
    expect(reach(INITECH_MODEL, none, [CATEGORY]).state.Sales).toBe('not-reached');
    const productToSales = inside('M = CALCULATE([Total Sales], CROSSFILTER(Sales[Product Key], Product[Product Key], ONEWAY_RIGHTFILTERSLEFT))');
    expect(reach(INITECH_MODEL, productToSales, [CATEGORY]).state.Sales).toBe('reached');
  });

  it('CROSSFILTER letting only the many side filter the one side is a DAX error (checked live), not a direction', () => {
    const text = 'M = CALCULATE([Total Sales], CROSSFILTER(Sales[Product Key], Product[Product Key], ONEWAY_LEFTFILTERSRIGHT))';
    const result = reach(INITECH_MODEL, inside(text), [CATEGORY]).result;
    expect(result.problems).toEqual(["CROSSFILTER can't make only the many side (Sales) filter the one side (Product), so DAX shows an error here"]);
    expect(result.model.relationships.some((r) => r.changedBy)).toBe(false);
    // Also checked live: the same direction with the columns swapped, and on another relationship, error too;
    // the allowed direction with swapped columns works.
    const problems = (t: string) => reach(INITECH_MODEL, inside(t), [CATEGORY]).result.problems.length;
    expect(problems('M = CALCULATE([Total Sales], CROSSFILTER(Product[Product Key], Sales[Product Key], ONEWAY_RIGHTFILTERSLEFT))')).toBe(1);
    expect(problems('M = CALCULATE([Total Sales], CROSSFILTER(Sales[Customer Key], Customer[Customer Key], ONEWAY_LEFTFILTERSRIGHT))')).toBe(1);
    const allowed = inside('M = CALCULATE([Total Sales], CROSSFILTER(Product[Product Key], Sales[Product Key], ONEWAY_LEFTFILTERSRIGHT))');
    expect(reach(INITECH_MODEL, allowed, [CATEGORY]).state).toMatchObject({ Sales: 'reached', Product: 'filtered', Customer: 'not-reached' });
    const step = analysis(text, INITECH_MODEL).find((e) => e.kind === 'filter-input')!;
    expect(step.summary).toBe("Sets the relationship Sales[Product Key] – Product[Product Key] filtering only from Sales to Product: CROSSFILTER can't make only the many side (Sales) filter the one side (Product), so DAX shows an error here.");
  });

  it('says when the model has no such relationship', () => {
    const context = inside('M = CALCULATE([Total Sales], USERELATIONSHIP(Sales[Quantity], Product[Category]))');
    expect(reach(INITECH_MODEL, context).result.problems).toEqual([
      'there is no relationship between Sales[Quantity] and Product[Category] in this model, so USERELATIONSHIP shows an error here',
    ]);
    const step = analysis('M = CALCULATE([Total Sales], USERELATIONSHIP(Sales[Quantity], Product[Category]))', INITECH_MODEL).find((e) => e.kind === 'filter-input')!;
    expect(step.summary).toBe('Uses the relationship Sales[Quantity] – Product[Category]: this model has no relationship between Sales[Quantity] and Product[Category], so DAX shows an error here.');
  });

  it('TREATAS filters the named columns, and remembers where its values come from', () => {
    const literal = inside('M = CALCULATE([Total Sales], TREATAS({"Widgets", "Gadgets"}, Product[Category]))');
    expect(describeContext(literal)).toContain('Product[Category] in {"Widgets", "Gadgets"}  (added by CALCULATE)');
    expect(reach(INITECH_MODEL, literal).state).toMatchObject({ Product: 'filtered', Sales: 'reached' });
    const lineage = inside('M = CALCULATE([Total Sales], TREATAS(VALUES(Customer[Customer Key]), Plant[Plant Key]))');
    expect(reach(INITECH_MODEL, lineage).result.treatAs).toEqual([{ from: 'Customer', to: 'Plant' }]);
  });
});
