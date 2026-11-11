import { describe, expect, it } from 'vitest';
import type { BindOptions } from '../engine/binder/binder';
import { describeContext } from '../engine/context/describe';
import type { ReportFilter } from '../engine/context/reportFilters';
import { buildStepQuery, rowKey, type RowChoice, type StepQuery } from '../engine/context/stepQuery';
import { SAMPLE_MEASURES, sampleDefinition } from '../samples/sampleMeasures';
import { analyze } from './analysis';
import { buildFrame, callersOf, flattenTimeline, framePath, stepIntoTarget, type FlatEntry } from './frames';

const OPTIONS: BindOptions = { mode: 'convention', userChoices: {} };
const BEST_PLANT = SAMPLE_MEASURES.find((s) => s.id === 'best-plant-order-value')!.expression;
const WIDGETS: ReportFilter[] = [{ kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'] }];

function explain(text: string, expanded: string[] = [], lookup = sampleDefinition) {
  const root = buildFrame(analyze(text, 'measure-definition'), OPTIONS);
  const flat = flattenTimeline(root, new Set(expanded), lookup, OPTIONS);
  const find = (title: string, nth = 0) => {
    const entry = flat.filter((e) => e.title === title)[nth];
    if (!entry) throw new Error(`no step "${title}" in: ${flat.map((e) => e.title).join(' | ')}`);
    return entry;
  };
  return { root, flat, find, titles: flat.map((e) => e.title) };
}

/** The key that steps into the measure called at this step. */
function keyOf(entry: FlatEntry): string {
  const target = stepIntoTarget(entry.frame, entry, sampleDefinition);
  if (target?.kind !== 'available') throw new Error(`can't step into ${entry.title}`);
  return target.key;
}

function query(entry: FlatEntry, rows: ReadonlyMap<string, RowChoice> = new Map(), reportFilters: ReportFilter[] = []): StepQuery {
  const { frame } = entry;
  return buildStepQuery(entry, {
    root: frame.result.parse!.root,
    binding: frame.binding!,
    source: frame.result.text,
    reportFilters,
    rows,
    frameKey: frame.key,
    callers: callersOf(frame),
  });
}

describe('stepping into measures', () => {
  it('without stepping in, the flat timeline is the measure\'s own', () => {
    const { root, flat } = explain(BEST_PLANT);
    expect(flat.map((e) => e.title)).toEqual(root.timeline.map((e) => e.title));
    expect(flat.every((e) => e.frame === root && e.index === e.localIndex)).toBe(true);
  });

  it("puts the called measure's steps right after the step that calls it, from Enter to Back in", () => {
    const outer = explain(BEST_PLANT);
    const key = keyOf(outer.find('Calculate [Average Order Value]'));
    const { titles, find, flat } = explain(BEST_PLANT, [key]);
    expect(titles).toEqual([
      "Start with the report's filters",
      'VALUES',
      'MAXX goes row by row',
      'Calculate [Average Order Value]',
      'Enter [Average Order Value]',
      'Calculate [Total Sales]',
      'Calculate [Order Count]',
      'DIVIDE',
      'Back in [Best Plant Order Value]',
      'MAXX: after the last row',
      'The result goes back to the report',
    ]);
    expect(flat.map((e) => e.index)).toEqual(flat.map((_, i) => i));
    const enter = find('Enter [Average Order Value]');
    expect(enter.frame.level).toBe(1);
    expect(enter.depth).toBeGreaterThan(find('Calculate [Average Order Value]').depth);
    expect(framePath(enter.frame).map((f) => f.name)).toEqual(['[Best Plant Order Value]', '[Average Order Value]']);
  });

  it("starts the called measure with the caller's filters after context transition, and no current row", () => {
    const key = keyOf(explain(BEST_PLANT).find('Calculate [Average Order Value]'));
    const { find } = explain(BEST_PLANT, [key]);
    const enter = find('Enter [Average Order Value]');
    expect(enter.context.rows).toEqual([]);
    expect(describeContext(enter.context)).toEqual([
      "The report's filters, except any filter on Plant[Plant Name]",
      "Plant[Plant Name] = the current row's value  (the current row of MAXX, turned into a filter)",
    ]);
    // The steps inside see the same filters.
    expect(describeContext(find('Calculate [Total Sales]').context)).toEqual(describeContext(enter.context));
  });

  it('can step in more than one level', () => {
    const first = keyOf(explain(BEST_PLANT).find('Calculate [Average Order Value]'));
    const second = keyOf(explain(BEST_PLANT, [first]).find('Calculate [Total Sales]'));
    const { titles, find } = explain(BEST_PLANT, [first, second]);
    expect(titles.slice(5, 9)).toEqual(['Calculate [Total Sales]', 'Enter [Total Sales]', 'SUM', 'Back in [Average Order Value]']);
    expect(find('SUM').frame.level).toBe(2);
    // Hiding the outer measure hides everything inside it.
    expect(explain(BEST_PLANT, [second]).titles).not.toContain('Enter [Total Sales]');
  });

  it("says why a measure can't be stepped into: unknown code, or going round in a circle", () => {
    const unknown = explain('M = [Mystery Measure] + 1');
    expect(stepIntoTarget(unknown.root, unknown.find('Calculate [Mystery Measure]'), sampleDefinition)).toMatchObject({ kind: 'unavailable', name: 'Mystery Measure' });

    const loop = (name: string) => (name.toLowerCase() === 'loop' ? { name: 'Loop', expression: '[Loop] + 1' } : undefined);
    const self = explain('Loop = [Loop] + 1', [], loop);
    const target = stepIntoTarget(self.root, self.find('Calculate [Loop]'), loop);
    expect(target).toMatchObject({ kind: 'unavailable' });
    expect(target?.kind === 'unavailable' && target.reason).toContain('circle');
  });
});

describe('values inside a measure stepped into', () => {
  const plant: RowChoice = { columns: ['Plant[Plant Name]'], values: ['Austin'] };

  it("wrap the measure's code in CALCULATE, then in everything around the call, then in F", () => {
    const outer = explain(BEST_PLANT);
    const callStep = outer.find('Calculate [Average Order Value]');
    const { find } = explain(BEST_PLANT, [keyOf(callStep)]);
    const inner = find('Calculate [Total Sales]');

    // The caller's MAXX needs a row first; it belongs to the caller's frame.
    expect(query(inner)).toEqual({ kind: 'needs-row', frameKey: '', iteratorNodeId: expect.any(Number), iteratorName: 'MAXX' });

    const maxx = find('MAXX goes row by row');
    const rows = new Map([[rowKey('', maxx.nodeId!), plant]]);
    const q = query(inner, rows, WIDGETS);
    expect(q.kind === 'scalar' && q.dax).toBe(
      `CALCULATE(\nVAR __DaxExplorerRow =\nFILTER(\nVALUES(Plant[Plant Name]),\nPlant[Plant Name] == "Austin"\n)\nRETURN\nIF(\nCOUNTROWS(__DaxExplorerRow) = 0,\nERROR("The picked row is no longer there; pick it again."),\nMAXX(__DaxExplorerRow,\nCALCULATE(\n[Total Sales]\n)\n)\n),\nTREATAS({"Widgets"}, 'Product'[Category])\n)`,
    );

    // "Back in" shows the whole called measure's value, the same way.
    const back = query(find('Back in [Best Plant Order Value]'), rows);
    expect(back.kind === 'scalar' && back.dax).toContain('CALCULATE(\nDIVIDE([Total Sales], [Order Count])\n)');
    expect(query(find('Enter [Average Order Value]'))).toEqual({ kind: 'none', reason: '' });
  });

  it('two levels deep: one CALCULATE per measure call', () => {
    const first = keyOf(explain(BEST_PLANT).find('Calculate [Average Order Value]'));
    const second = keyOf(explain(BEST_PLANT, [first]).find('Calculate [Total Sales]'));
    const { find } = explain(BEST_PLANT, [first, second]);
    const rows = new Map([[rowKey('', find('MAXX goes row by row').nodeId!), plant]]);
    const q = query(find('SUM'), rows);
    expect(q.kind === 'scalar' && q.dax).toContain('MAXX(__DaxExplorerRow,\nCALCULATE(\nCALCULATE(\nSUM(Sales[Amount])\n)\n)\n)');
  });

  it("refuses when a caller's value depends on the visual", () => {
    const text = 'Outer = CALCULATE([Total Sales], ALLSELECTED(Plant))';
    const key = keyOf(explain(text).find('Calculate [Total Sales]'));
    const q = query(explain(text, [key]).find('SUM'));
    expect(q).toMatchObject({ kind: 'none' });
    expect(q.kind === 'none' && q.reason).toContain('A measure that calls this one uses ALLSELECTED');
  });
});
