/**
 * What the claim checker runs: the built-in examples plus deliberately awkward synthetic measures on the
 * Initech sample (never real work measures), each under a few report-filter setups.
 */
import type { ReportFilter } from '../engine/context/reportFilters';
import { SAMPLE_MEASURES } from '../samples/sampleMeasures';

export interface LibraryMeasure {
  id: string;
  /** A measure definition: "Name = expression". */
  definition: string;
}

/** Combinations chosen to exercise the engine's rules where they meet (filters, removals, rows, relationships). */
const AWKWARD: LibraryMeasure[] = [
  ['all-sales-keeps-product', 'CALCULATE([Total Sales], ALL(Sales))'],
  ['all-product-then-category', `CALCULATE([Total Sales], 'Product'[Category] = "Widgets", ALL('Product'))`],
  ['keepfilters-category', `CALCULATE([Total Sales], KEEPFILTERS('Product'[Category] = "Widgets"))`],
  ['allexcept-category', `CALCULATE([Total Sales], ALLEXCEPT('Product', 'Product'[Category]))`],
  ['removefilters-date', `CALCULATE([Total Sales], REMOVEFILTERS('Date'))`],
  ['datesytd-removes-date', `CALCULATE([Total Sales], DATESYTD('Date'[Date]))`],
  ['plain-date-filter', `CALCULATE([Total Sales], 'Date'[Date] >= DATE(2025, 1, 1))`],
  ['month-filter', `CALCULATE([Total Sales], 'Date'[Month] = "Mar")`],
  ['loop-values-transition', `SUMX(VALUES('Product'[Category]), CALCULATE([Total Sales]))`],
  ['loop-measure-transition', `AVERAGEX(VALUES('Date'[Year]), [Total Sales])`],
  ['nested-calculate-all', `CALCULATE(CALCULATE([Total Sales], 'Product'[Category] = "Gadgets"), ALL('Product'))`],
  ['filter-all-column', `CALCULATE([Total Sales], FILTER(ALL('Product'[Category]), 'Product'[Category] <> "Widgets"))`],
  ['userelationship', `CALCULATE([Total Sales], USERELATIONSHIP(Sales[Ship Date], 'Date'[Date]))`],
  ['treatas', `CALCULATE([Total Sales], TREATAS({"Widgets"}, 'Product'[Category]))`],
  ['in-list', `CALCULATE([Total Sales], 'Product'[Category] IN {"Widgets", "Gadgets"})`],
  ['removefilters-all', `CALCULATE(SUMX(Sales, Sales[Amount]), REMOVEFILTERS())`],
  ['variable-outside', `VAR s = [Total Sales] RETURN CALCULATE(s, ALL('Product'))`],
  ['loop-all-category', `AVERAGEX(VALUES('Date'[Year]), CALCULATE([Total Sales], ALL('Product'[Category])))`],
  ['all-customer-other-table', `CALCULATE([Total Sales], ALL('Customer'))`],
  ['lookup-ignores', `LOOKUPVALUE('Product'[Category], 'Product'[Product], "Widget Pro")`],
  ['summarize-all-product', `COUNTROWS(SUMMARIZE(Sales, 'Product'[Category], "All", CALCULATE(SUM(Sales[Amount]), ALL('Product'))))`],
  ['column-inside-calculate', `SUMX('Product', CALCULATE('Product'[List Price] + 0))`],
  ['earlier-classic', `SUMX('Product', COUNTROWS(FILTER('Product', 'Product'[List Price] < EARLIER('Product'[List Price]))))`],
  ['lastnonblank-filter', `CALCULATE([Total Sales], LASTNONBLANK('Date'[Date], [Total Sales]))`],
  ['crossjoin-filter', `CALCULATE([Total Sales], CROSSJOIN(VALUES('Product'[Category]), VALUES('Date'[Year])))`],
  ['except-filter', `CALCULATE([Total Sales], EXCEPT(VALUES('Product'[Category]), {"Widgets"}))`],
  ['intersect-filter', `CALCULATE([Total Sales], INTERSECT(ALL('Product'[Category]), {"Widgets", "Gadgets"}))`],
  ['union-unlinked', `CALCULATE([Total Sales], UNION(VALUES('Product'[Category]), {"Extra"}))`],
  ['except-list-first', `CALCULATE([Total Sales], EXCEPT({"Widgets", "Gadgets"}, VALUES('Product'[Category])))`],
  ['naturaljoin-filter', `CALCULATE([Total Sales], NATURALINNERJOIN(VALUES('Product'[Category]), ALL('Product'[Category], 'Product'[Product])))`],
  ['generate-loop', `SUMX(GENERATE(VALUES('Product'[Category]), TOPN(1, VALUES('Date'[Year]))), [Total Sales])`],
  ['datatable-filter', `CALCULATE([Total Sales], DATATABLE("Category", STRING, {{"Widgets"}}))`],
  ['row-filter', `CALCULATE([Total Sales], ROW("Category", "Widgets"))`],
  ['series-filter', `CALCULATE([Total Sales], GENERATESERIES(2025, 2025))`],
  ['calendar-filter', `CALCULATE([Total Sales], CALENDAR(DATE(2025, 1, 1), DATE(2025, 12, 31)))`],
  ['series-treatas', `CALCULATE([Total Sales], TREATAS(GENERATESERIES(2025, 2025), 'Date'[Year]))`],
  ['series-loop', `SUMX(GENERATESERIES(1, 2), [Total Sales])`],
  ['row-current-filters', `MAXX(ROW("S", [Total Sales]), [S])`],
  ['series-model-column', `MAXX(GENERATESERIES(1, 3), 'Date'[Year])`],
  ['datatable-worked-out', `MAXX(DATATABLE("A", INTEGER, {{1 + 1}}), [A])`],
  ['series-step-zero', `COUNTROWS(GENERATESERIES(1, 2, 0))`],
  ['allnoblankrow-filter', `CALCULATE([Total Sales], ALLNOBLANKROW('Product'[Category]))`],
  ['allnoblankrow-sales', `CALCULATE([Total Sales], ALLNOBLANKROW(Sales))`],
  ['allcrossfiltered-sales', `CALCULATE([Total Sales], ALLCROSSFILTERED(Sales))`],
  ['allcrossfiltered-product', `CALCULATE([Total Sales], ALLCROSSFILTERED('Product'))`],
  ['allcrossfiltered-alone', `COUNTROWS(ALLCROSSFILTERED(Sales))`],
  ['filters-filter', `CALCULATE([Total Sales], ALL('Product'), FILTERS('Product'[Category]))`],
  ['filters-loop', `SUMX(FILTERS('Product'[Category]), [Total Sales])`],
  ['filters-transition', `SUMX(VALUES('Product'[Category]), CALCULATE(COUNTROWS(FILTERS('Product'[Category]))))`],
  ['filters-table', `COUNTROWS(FILTERS('Product'))`],
  ['dt-date-filter', `CALCULATE([Total Sales], 'Date'[Date] >= dt"2025-01-01")`],
  ['dt-datatable', `MAXX(DATATABLE("D", DATETIME, {{dt"2025-01-01"}}), [D])`],
  ['topnskip-filter', `CALCULATE([Total Sales], TOPNSKIP(1, 0, VALUES('Product'[Category]), [Total Sales], DESC))`],
  ['topnskip-loop', `SUMX(TOPNSKIP(2, 0, VALUES('Date'[Year]), [Total Sales]), [Total Sales])`],
  ['sample-filter', `CALCULATE([Total Sales], SAMPLE(2, VALUES('Product'[Category]), 'Product'[Category], ASC))`],
  ['swi-filter', `CALCULATE([Total Sales], SUBSTITUTEWITHINDEX(SUMMARIZE(Sales, 'Product'[Category], 'Date'[Year]), "Idx", VALUES('Product'[Category]), 'Product'[Category], ASC))`],
  ['linest-slope', `MAXX(LINEST(Sales[Amount], Sales[Quantity]), [Slope1])`],
  ['linestx-related', `MAXX(LINESTX(Sales, Sales[Amount], RELATED('Date'[Year])), [Slope1])`],
  ['linest-two-tables', `COUNTROWS(LINEST(Sales[Amount], 'Date'[Year]))`],
  ['nameof-measure', `LEN(NAMEOF([Total Sales]))`],
  ['nameof-expression', `LEN(NAMEOF(SUM(Sales[Amount])))`],
  ['tableof-all', `CALCULATE([Total Sales], ALL(TABLEOF('Product'[Category])))`],
  ['addmissingitems', `COUNTROWS(ADDMISSINGITEMS('Product'[Category], SUMMARIZE(Sales, 'Product'[Category], "S", SUM(Sales[Amount])), 'Product'[Category]))`],
  ['isonorafter', `IF(ISONORAFTER(MAX('Date'[Year]), 2025, ASC), 1, 0)`],
  ['offset-previous-year', `CALCULATE([Total Sales], OFFSET(-1, ALL('Date'[Year]), ORDERBY('Date'[Year])))`],
  ['offset-in-loop', `SUMX(VALUES('Date'[Year]), CALCULATE([Total Sales], OFFSET(-1, ALL('Date'[Year]), ORDERBY('Date'[Year]))))`],
  ['offset-partition', `CALCULATE([Total Sales], OFFSET(-1, ALL('Date'[Year], 'Date'[Month Number]), ORDERBY('Date'[Month Number]), PARTITIONBY('Date'[Year])))`],
  ['offset-no-table', `CALCULATE([Total Sales], OFFSET(-1, ORDERBY('Date'[Year])))`],
  ['offset-bare', `COUNTROWS(OFFSET(-1))`],
  ['index-first-year', `CALCULATE([Total Sales], INDEX(1, ALL('Date'[Year]), ORDERBY('Date'[Year])))`],
  ['window-running-total', `CALCULATE([Total Sales], WINDOW(1, ABS, 0, REL, ALL('Date'[Year]), ORDERBY('Date'[Year])))`],
  ['rank-categories', `RANK(DENSE, ALL('Product'[Category]), ORDERBY([Total Sales], DESC))`],
  ['rownumber-categories', `ROWNUMBER(ALL('Product'[Category]), ORDERBY([Total Sales], DESC))`],
  ['rank-in-loop', `MAXX(VALUES('Product'[Category]), RANK(DENSE, ALL('Product'[Category]), ORDERBY([Total Sales], DESC)))`],
  ['offset-two-after', `CALCULATE([Total Sales], OFFSET(2, ALL('Date'[Year])))`],
  ['index-last-year', `CALCULATE([Total Sales], INDEX(-1, ALL('Date'[Year]), ORDERBY('Date'[Year], ASC)))`],
  ['rownumber-years', `ROWNUMBER(ALL('Date'[Year]), ORDERBY('Date'[Year], DESC))`],
  ['sc-count', `COUNTROWS(SUMMARIZECOLUMNS('Product'[Category], "S", [Total Sales]))`],
  ['sc-max-sum', `MAXX(SUMMARIZECOLUMNS('Product'[Category], "S", SUM(Sales[Amount])), [S])`],
  ['sc-filter-table', `MAXX(SUMMARIZECOLUMNS('Product'[Category], FILTER(ALL('Date'[Year]), 'Date'[Year] = 2025), "S", [Total Sales]), [S])`],
  ['sc-all-inside', `MAXX(SUMMARIZECOLUMNS('Product'[Category], "A", CALCULATE([Total Sales], ALL('Product'))), [A])`],
  ['sc-in-loop', `SUMX(VALUES('Date'[Year]), MAXX(SUMMARIZECOLUMNS('Product'[Category], "S", SUM(Sales[Amount])), [S]))`],
  ['sc-two-tables', `MAXX(SUMMARIZECOLUMNS('Product'[Category], 'Date'[Year], "S", [Total Sales]), [S])`],
  ['sc-column-alone', `COUNTROWS(SUMMARIZECOLUMNS('Product'[Category], "C", 'Product'[Category]))`],
  ['sc-as-filter', `CALCULATE([Total Sales], SUMMARIZECOLUMNS('Product'[Category], TREATAS({"Widgets"}, 'Product'[Category])))`],
  ['sc-rollup', `COUNTROWS(SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL('Product'[Category], "IsTotal"), "S", [Total Sales]))`],
  ['sc-ignore', `COUNTROWS(SUMMARIZECOLUMNS('Product'[Category], "B", IGNORE(BLANK())))`],
  ['detailrows', `COUNTROWS(DETAILROWS([Total Sales]))`],
  ['detailrows-column', `COUNTROWS(DETAILROWS(Sales[Amount]))`],
  ['generateall-loop', `COUNTROWS(GENERATEALL(VALUES('Product'[Category]), CALCULATETABLE(VALUES('Date'[Year]))))`],
].map(([id, expression]) => ({ id, definition: `Check ${id} = ${expression}` }));

export const CLAIM_LIBRARY: readonly LibraryMeasure[] = [
  ...SAMPLE_MEASURES.map((m) => ({ id: m.id, definition: m.expression })),
  ...AWKWARD,
];

/** Report-filter setups each measure is checked under. */
export const CLAIM_SCENARIOS: readonly { id: string; filters: ReportFilter[] }[] = [
  { id: 'no-filters', filters: [] },
  { id: 'gadgets', filters: [{ kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Gadgets'] }] },
  { id: 'year-2025', filters: [{ kind: 'values', column: { table: 'Date', column: 'Year' }, values: [2025] }] },
  {
    id: 'gadgets-2025',
    filters: [
      { kind: 'values', column: { table: 'Product', column: 'Category' }, values: ['Gadgets'] },
      { kind: 'values', column: { table: 'Date', column: 'Year' }, values: [2025] },
    ],
  },
];
