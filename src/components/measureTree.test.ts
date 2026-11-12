import { describe, expect, it } from 'vitest';
import { measureTree, searchMeasures, type MeasureNode, type PickerMeasure } from './measureTree';

const m = (name: string, folder: string | null = null, table = 'Sales'): PickerMeasure => ({ name, text: `${name} =\n1`, table, folder });

/** One line per node, indented. */
function outline(nodes: MeasureNode[], depth = 0): string[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder' ? [`${'  '.repeat(depth)}[${n.name}] (${n.count})`, ...outline(n.children, depth + 1)] : [`${'  '.repeat(depth)}${n.measure.name}`],
  );
}

describe('measureTree', () => {
  it("one table: display folders (nested with \\), then measures; folders first, alphabetical", () => {
    expect(outline(measureTree([m('Total Sales'), m('Margin %', 'Profit'), m('Target', 'Profit\\Targets'), m('Average Order Value', 'KPIs')]))).toEqual([
      '[KPIs] (1)',
      '  Average Order Value',
      '[Profit] (2)',
      '  [Targets] (1)',
      '    Target',
      '  Margin %',
      'Total Sales',
    ]);
  });

  it('several tables with measures: the home table comes first', () => {
    expect(outline(measureTree([m('Total Sales'), m('Stock', 'Levels', 'Inventory')]))).toEqual(['[Inventory] (1)', '  [Levels] (1)', '    Stock', '[Sales] (1)', '  Total Sales']);
  });

  it('a measure in two folders (";") appears in both', () => {
    expect(outline(measureTree([m('Sales YTD', 'Time; Sales')]))).toEqual(['[Sales] (1)', '  Sales YTD', '[Time] (1)', '  Sales YTD']);
  });
});

describe('searchMeasures', () => {
  it('matches every word, shows the folder path, and finds nothing for an empty search', () => {
    const list = [m('Total Sales'), m('Sales YTD', 'Time\\To date'), m('Order Count')];
    expect(searchMeasures(list, 'sales').map((r) => `${r.measure.name} | ${r.path}`)).toEqual(['Sales YTD | Time › To date', 'Total Sales | ']);
    expect(searchMeasures(list, 'ytd sal').map((r) => r.measure.name)).toEqual(['Sales YTD']);
    expect(searchMeasures(list, '  ')).toEqual([]);
  });
});
