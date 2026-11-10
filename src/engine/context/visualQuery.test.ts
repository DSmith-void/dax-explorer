import { describe, expect, it } from 'vitest';
import { readVisualQuery, visualRowsDax, type VisualQuery } from './visualQuery';

// Synthetic queries in the shape Performance analyzer's "Copy query" produces (Initech sample names).
const TABLE_VISUAL = `// DAX Query
DEFINE
	VAR __DS0FilterTable =
		TREATAS({"Widgets"}, 'Product'[Category])

	VAR __DS0FilterTable2 =
		FILTER(
			KEEPFILTERS(VALUES('Date'[Date])),
			AND('Date'[Date] >= DATE(2024, 1, 1), 'Date'[Date] < DATE(2025, 1, 1))
		)

	VAR __DS0Core =
		SUMMARIZECOLUMNS(
			ROLLUPADDISSUBTOTAL('Plant'[Plant Name], "IsGrandTotalRowTotal"),
			__DS0FilterTable,
			__DS0FilterTable2,
			"Total_Sales", 'Sales'[Total Sales],
			"Sales_Percent_of_Total", 'Sales'[Sales Percent of Total]
		)

	VAR __DS0PrimaryWindowed =
		TOPN(502, __DS0Core, [IsGrandTotalRowTotal], 0, 'Plant'[Plant Name], 1)

EVALUATE
	__DS0PrimaryWindowed

ORDER BY
	[IsGrandTotalRowTotal] DESC, 'Plant'[Plant Name]
`;

const CARD_VISUAL = `// DAX Query
DEFINE
	VAR __DS0FilterTable =
		TREATAS({2024, 2025}, 'Date'[Year])

EVALUATE
	SUMMARIZECOLUMNS(__DS0FilterTable, "Total_Sales", IGNORE('Sales'[Total Sales]))
`;

const MATRIX_VISUAL = `DEFINE
	VAR __DS0Core =
		SUMMARIZECOLUMNS(
			ROLLUPADDISSUBTOTAL(ROLLUPGROUP('Customer'[Region], 'Product'[Category]), "IsGrandTotalRowTotal"),
			TREATAS({"Austin", BLANK()}, 'Plant'[Plant Name]),
			"Average_Sales_per_Customer", 'Sales'[Average Sales per Customer]
		)
EVALUATE
	TOPN(102, __DS0Core, [IsGrandTotalRowTotal], 0, 'Customer'[Region], 1, 'Product'[Category], 1)
`;

function read(source: string): VisualQuery {
  const result = readVisualQuery(source);
  if (!result.ok) throw new Error(result.error);
  return result.visual;
}

describe('readVisualQuery', () => {
  it('reads a table visual: its group-by column, slicer filters and measures', () => {
    const visual = read(TABLE_VISUAL);
    expect(visual.groupBy).toEqual([{ table: 'Plant', column: 'Plant Name' }]);
    expect(visual.filters[0]).toEqual({ kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Widgets'] });
    expect(visual.filters[1]).toMatchObject({ kind: 'table', columns: [{ table: 'Date', column: 'Date' }] });
    expect(visual.filters[1].kind === 'table' && visual.filters[1].dax).toContain("KEEPFILTERS(VALUES('Date'[Date]))");
    expect(visual.measures).toEqual([
      { label: 'Total_Sales', dax: "'Sales'[Total Sales]", measureName: 'Total Sales' },
      { label: 'Sales_Percent_of_Total', dax: "'Sales'[Sales Percent of Total]", measureName: 'Sales Percent of Total' },
    ]);
    expect(visual.notes).toEqual([]);
  });

  it('reads a card: no group-by, filters only; IGNORE around a measure is looked through', () => {
    const visual = read(CARD_VISUAL);
    expect(visual.groupBy).toEqual([]);
    expect(visual.filters).toEqual([{ kind: 'values', column: { table: 'Date', column: 'Year' }, values: [2024, 2025] }]);
    expect(visual.measures[0]).toMatchObject({ label: 'Total_Sales', measureName: 'Total Sales' });
  });

  it('reads a matrix: every column in ROLLUPGROUP, inline filters and BLANK values', () => {
    const visual = read(MATRIX_VISUAL);
    expect(visual.groupBy).toEqual([
      { table: 'Customer', column: 'Region' },
      { table: 'Product', column: 'Category' },
    ]);
    expect(visual.filters).toEqual([{ kind: 'values', column: { table: 'Plant', column: 'Plant Name' }, values: ['Austin', null] }]);
  });

  it('includes filters from a CALCULATETABLE around SUMMARIZECOLUMNS', () => {
    const visual = read(`EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS('Plant'[Plant Name], "S", [Total Sales]), 'Date'[Year] = 2025)`);
    expect(visual.filters).toMatchObject([{ kind: 'table', columns: [{ table: 'Date', column: 'Year' }], dax: "'Date'[Year] = 2025" }]);
  });

  it('notes what it does not use instead of guessing', () => {
    const visual = read(`DEFINE
  MEASURE 'Sales'[Local] = 1
  VAR __A = TREATAS({"Widgets"}, 'Product'[Category])
  VAR __B = INTERSECT(__A, VALUES('Product'[Category]))
EVALUATE SUMMARIZECOLUMNS('Plant'[Plant Name], __B, "S", [Local])`);
    expect(visual.notes).toHaveLength(2);
    expect(visual.notes[0]).toContain('defines its own measure [Local]');
    expect(visual.notes[1]).toContain('depends on other parts of the query');
    expect(visual.filters).toEqual([]);
  });

  it('explains when the text is not a visual query', () => {
    expect(readVisualQuery('Total Sales = SUM(Sales[Amount])')).toEqual({ ok: false, error: expect.stringContaining('no EVALUATE') });
    expect(readVisualQuery('EVALUATE VALUES(Product[Category])')).toEqual({ ok: false, error: expect.stringContaining('No SUMMARIZECOLUMNS') });
  });
});

describe('visualRowsDax', () => {
  it("lists the visual's rows under its filters, sorted by its columns", () => {
    expect(visualRowsDax(read(TABLE_VISUAL), 50)).toBe(
      `TOPN(50, SUMMARIZECOLUMNS(
    'Plant'[Plant Name],
    TREATAS({"Widgets"}, 'Product'[Category]),
    FILTER(
			KEEPFILTERS(VALUES('Date'[Date])),
			AND('Date'[Date] >= DATE(2024, 1, 1), 'Date'[Date] < DATE(2025, 1, 1))
		),
    "Total_Sales", 'Sales'[Total Sales],
    "Sales_Percent_of_Total", 'Sales'[Sales Percent of Total]
), 'Plant'[Plant Name], ASC)`,
    );
  });

  it('a card has one row: no TOPN needed', () => {
    expect(visualRowsDax(read(CARD_VISUAL), 50)).toBe(`SUMMARIZECOLUMNS(
    TREATAS({2024, 2025}, 'Date'[Year]),
    "Total_Sales", 'Sales'[Total Sales]
)`);
  });
});
