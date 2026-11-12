import { describe, expect, it } from 'vitest';
import { INITECH_MODEL } from '../../samples/initechModel';
import { SAMPLE_MEASURES } from '../../samples/sampleMeasures';
import { bind } from '../binder/binder';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { analyzeContext } from './analyzer';
import { stepParts } from './stepParts';
import { buildTimeline } from './timeline';

function steps(text: string) {
  const start = splitMeasureDefinition(text).header!.expressionStart;
  const { root } = parse(tokenize(text, start).tokens);
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  const analysis = analyzeContext(root, binding, text, undefined, INITECH_MODEL);
  const flat = buildTimeline(root, binding, analysis, text);
  const of = (entry: (typeof flat)[number]) => stepParts(entry, root, binding, analysis, text);
  const parts = (title: string, nth = 0) => {
    const entry = flat.filter((e) => e.title === title)[nth];
    if (!entry) throw new Error(`no step "${title}": ${flat.map((e) => e.title).join(' | ')}`);
    return of(entry);
  };
  return { flat, of, parts };
}

const lines = (p: ReturnType<ReturnType<typeof steps>['parts']>) => p.diff.map((d) => `${d.kind} ${d.text} — ${d.note}`);
const sample = (id: string) => SAMPLE_MEASURES.find((s) => s.id === id)!.expression;

describe('stepParts: what changes', () => {
  it('a filter argument shows the change it prepares; CALCULATE shows it applied', () => {
    const { parts } = steps(sample('percent-of-total'));
    const prepare = parts('Prepare filter: REMOVEFILTERS(Product[Category])');
    expect(prepare.prepared).toBe(true);
    expect(lines(prepare)).toEqual(['remove Product[Category] — REMOVEFILTERS removes these filters (when CALCULATE runs)']);
    expect(prepare.where.map((c) => c.text)).toEqual(['CALCULATE']);
    expect(lines(parts('CALCULATE applies its filters'))).toEqual(['remove Product[Category] — REMOVEFILTERS removes these filters']);
  });

  it('a filter that replaces, one added on top, and a relationship change', () => {
    const replace = steps('M = CALCULATE([Total Sales], Product[Category] = "Gadgets")').parts('CALCULATE applies its filters');
    expect(replace.diff[0]).toMatchObject({ kind: 'replace', note: 'replaces any filter on Product[Category]' });
    expect(replace.diff[0].target).toEqual({ kind: 'columns', columns: [{ table: 'Product', column: 'Category' }] });
    const keep = steps('M = CALCULATE([Total Sales], KEEPFILTERS(Product[Category] = "Gadgets"))').parts('CALCULATE applies its filters');
    expect(keep.diff[0]).toMatchObject({ kind: 'add', note: 'added on top of the filters there (KEEPFILTERS)' });
    expect(lines(steps(sample('sales-by-ship-date')).parts('CALCULATE applies its filters'))).toEqual([
      'relationship Uses the relationship Sales[Ship Date] – Date[Date] — USERELATIONSHIP',
    ]);
  });

  it('inside a loop: the loop, then the current row becoming a filter', () => {
    const { parts } = steps(sample('average-per-customer'));
    expect(lines(parts('AVERAGEX goes row by row'))).toEqual([
      'loop each row of VALUES(Customer[Customer Key]) — AVERAGEX goes row by row: a current row, no filter yet (row context)',
    ]);
    const measure = parts('Calculate [Total Sales]');
    expect(lines(measure)).toEqual(['row Customer[Customer Key] = the current row of AVERAGEX — the current row becomes a filter (context transition)']);
    expect(measure.where.map((c) => c.text)).toEqual(['AVERAGEX ↻ VALUES(Customer[Customer Key])']);
  });

  it('filters DAX removes by itself say so, with the reason', () => {
    const p = steps(`M = CALCULATE([Total Sales], 'Date'[Date] >= DATE(2026, 1, 1))`).parts('CALCULATE applies its filters');
    expect(p.diff[0]).toMatchObject({ kind: 'remove', text: 'table Date', nodeId: null });
    expect(p.diff[0].note).toMatch(/^removed by DAX itself, because Date\[Date\] is a date column that a relationship uses/);
  });

  it('nested: where lists the loops and CALCULATEs around the step, outermost first', () => {
    const p = steps('M = SUMX(Customer, CALCULATE([Total Sales], ALL(Plant)))').parts('Calculate [Total Sales]');
    expect(p.where.map((c) => `${c.kind} ${c.text}`)).toEqual(['loop SUMX ↻ Customer', 'calculate CALCULATE']);
  });

  it("nothing is lost: every operation of every built-in example's steps becomes a diff line", () => {
    for (const s of SAMPLE_MEASURES) {
      const { flat, of } = steps(s.expression);
      for (const entry of flat) {
        const p = of(entry);
        const expected = entry.operations.reduce((n, op) => n + (op.kind === 'context-transition' ? op.added.length : 1), 0);
        expect(p.diff.length, `${s.id}: ${entry.title}`).toBeGreaterThanOrEqual(expected);
        if (entry.kind === 'filter-input') expect(p.diff.length, `${s.id}: ${entry.title}`).toBeGreaterThan(0);
      }
    }
  });
});
