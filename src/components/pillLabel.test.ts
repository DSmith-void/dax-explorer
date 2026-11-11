import { describe, expect, it } from 'vitest';
import type { ReportFilter } from '../engine/context/reportFilters';
import { pillLabel } from './pillLabel';

const category: ReportFilter = { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'] };

describe('pillLabel', () => {
  it('says what F is in a few words', () => {
    expect(pillLabel([])).toBe('No filters');
    expect(pillLabel([category])).toBe('Product[Category] = "Widgets"');
    expect(pillLabel([category, { ...category, column: { table: 'Plant', column: 'Plant Name' } }])).toBe('2 filters');
  });

  it("from a visual: the chosen row's values, or the measure on its own", () => {
    const slicer: ReportFilter = { ...category, source: 'visual-filter' };
    const row: ReportFilter[] = [
      { kind: 'values', column: { table: 'Plant', column: 'Plant Name' }, values: ['Austin'], source: 'visual-row' },
      { kind: 'values', column: { table: 'Date', column: 'Year' }, values: [2025], source: 'visual-row' },
    ];
    expect(pillLabel([slicer, ...row])).toBe('From a visual: Austin · 2025');
    expect(pillLabel([slicer])).toBe('From a visual: measure on its own');
  });
});
