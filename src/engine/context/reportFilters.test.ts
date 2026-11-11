import { describe, expect, it } from 'vitest';
import {
  columnDax,
  daxLiteral,
  reportFilterDax,
  reportFilterStatus,
  reportFilterText,
  type ReportFilter,
} from './reportFilters';

const category: ReportFilter = { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'] };

describe('DAX for report filters', () => {
  it('quotes table names and escapes quotes and brackets', () => {
    expect(columnDax({ table: 'Product', column: 'Category' })).toBe("'Product'[Category]");
    expect(columnDax({ table: "Bob's Table", column: 'Net [Price]' })).toBe("'Bob''s Table'[Net [Price]]]");
    expect(() => columnDax({ table: '', column: 'X' })).toThrow('need a table name');
  });

  it('writes literals for every kind of value', () => {
    expect(daxLiteral('Say "hi"')).toBe('"Say ""hi"""');
    expect(daxLiteral(12.5)).toBe('12.5');
    expect(daxLiteral(true)).toBe('TRUE()');
    expect(daxLiteral(null)).toBe('BLANK()');
    expect(daxLiteral({ date: '2024-03-07' })).toBe('DATE(2024, 3, 7)');
    expect(daxLiteral({ date: '2024-03-07T08:30:00' })).toBe('DATE(2024, 3, 7) + TIME(8, 30, 0)');
    expect(() => daxLiteral({ date: '7/3/2024' })).toThrow('Not a date');
    expect(() => daxLiteral(Number.NaN)).toThrow('Not a usable number');
  });

  it('turns value filters into TREATAS, and uses filter tables from a visual as they are', () => {
    expect(reportFilterDax(category)).toBe(`TREATAS({"Widgets"}, 'Product'[Category])`);
    expect(reportFilterDax({ kind: 'values', column: { table: 'Date', column: 'Year' }, values: [2024, 2025] })).toBe(
      `TREATAS({2024, 2025}, 'Date'[Year])`,
    );
    const top: ReportFilter = { kind: 'table', columns: [{ table: 'Customer', column: 'Customer' }], dax: 'TOPN(5, VALUES(Customer[Customer]))', description: 'Top 5 customers' };
    expect(reportFilterDax(top)).toBe('TOPN(5, VALUES(Customer[Customer]))');
  });

  it('describes filters in plain words', () => {
    expect(reportFilterText(category)).toBe('Product[Category] = "Widgets"');
    expect(reportFilterText({ kind: 'values', column: { table: 'Plant', column: 'Plant Name' }, values: ['Austin', null] })).toBe(
      'Plant[Plant Name] is one of "Austin", (Blank)',
    );
  });
});

describe('reportFilterStatus', () => {
  it('applies when nothing is removed, or something else is', () => {
    expect(reportFilterStatus(category, [])).toBe('applies');
    expect(reportFilterStatus(category, [{ kind: 'column', column: { table: 'Product', column: 'Color' } }])).toBe('applies');
  });

  it('is removed by its column, its table (case-insensitively), or by removing everything', () => {
    expect(reportFilterStatus(category, [{ kind: 'column', column: { table: 'product', column: 'CATEGORY' } }])).toBe('removed');
    expect(reportFilterStatus(category, [{ kind: 'table', table: 'Product', except: [] }])).toBe('removed');
    expect(reportFilterStatus(category, [{ kind: 'all' }])).toBe('removed');
  });

  it('is kept by ALLEXCEPT when its column is one of the kept columns', () => {
    expect(reportFilterStatus(category, [{ kind: 'table', table: 'Product', except: [{ table: 'Product', column: 'Category' }] }])).toBe('applies');
  });

  it("doesn't guess when another whole table is removed (relationships may carry it)", () => {
    expect(reportFilterStatus(category, [{ kind: 'table', table: 'Sales', except: [] }])).toBe('maybe-removed');
  });
});

describe('ALLSELECTED and where report filters come from', () => {
  const row: ReportFilter = { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'], source: 'visual-row' };
  const slicer: ReportFilter = { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets', 'Gadgets'], source: 'visual-filter' };
  const typed: ReportFilter = { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'] };
  const allSelected = { kind: 'visual' as const, columns: [{ table: 'Product', column: 'Category' }], table: null };

  it("drops the visual's own row, keeps the slicer, and can't tell for filters typed by hand", () => {
    expect(reportFilterStatus(row, [allSelected])).toBe('removed');
    expect(reportFilterStatus(slicer, [allSelected])).toBe('applies');
    expect(reportFilterStatus(typed, [allSelected])).toBe('maybe-removed');
  });

  it('brings back a slicer filter that an earlier ALL removed, in order', () => {
    const all = { kind: 'column' as const, column: { table: 'Product', column: 'Category' } };
    expect(reportFilterStatus(slicer, [all])).toBe('removed');
    expect(reportFilterStatus(slicer, [all, allSelected])).toBe('applies');
    expect(reportFilterStatus(slicer, [allSelected, all])).toBe('removed');
  });

  it('only covers the columns (or table) it names; with no arguments, all of them', () => {
    const plant: ReportFilter = { kind: 'values', column: { table: 'Plant', column: 'Plant Name' }, values: ['Austin'], source: 'visual-row' };
    expect(reportFilterStatus(plant, [allSelected])).toBe('applies');
    expect(reportFilterStatus(plant, [{ kind: 'visual', columns: null, table: 'Plant' }])).toBe('removed');
    expect(reportFilterStatus(plant, [{ kind: 'visual', columns: null, table: null }])).toBe('removed');
  });
});
