/**
 * Function catalog: what each supported DAX function expects in each argument position.
 *
 * This is deliberately small and curated. A function that is not listed here is
 * still parsed and shown, but nothing is concluded from its arguments.
 *
 * Sources: Microsoft DAX function reference (learn.microsoft.com/dax). Each entry
 * describes argument roles only; evaluation semantics are added in later milestones.
 */

import { PLAIN_FUNCTIONS } from './plainFunctions';
import { p, type FunctionSpec, type ParamSpec } from './spec';

export type { ArgRole, FunctionCategory, FunctionSpec, ParamSpec } from './spec';

const aggregation = (name: string, summary: string): FunctionSpec => ({
  name,
  category: 'aggregation',
  returns: 'scalar',
  summary,
  overloads: [[p('column', 'column')]],
});

const iterator = (name: string, summary: string, extra: ParamSpec[] = []): FunctionSpec => ({
  name,
  category: 'iterator',
  returns: 'scalar',
  summary,
  overloads: [[p('table', 'table'), p('expression', 'rowExpression'), ...extra]],
  iteratesArgument: 0,
});

/** MINX and MAXX take an optional TRUE/FALSE "variant" flag (Power BI rejects other values). */
const variant = p('variant', 'scalar', { optional: true });

const columnInspection = (name: string, summary: string): FunctionSpec => ({
  name,
  category: 'scope and filter inspection',
  returns: 'scalar',
  summary,
  overloads: [[p('column', 'column')]],
});

const SPECS: FunctionSpec[] = [
  // --- Aggregations over a column ---
  aggregation('SUM', 'Adds up a column, using only the rows that pass the filters in effect.'),
  aggregation('AVERAGE', 'Averages a column, using only the rows that pass the filters in effect.'),
  aggregation('COUNT', 'Counts the numbers or dates in a column (blanks are skipped), using only rows that pass the filters.'),
  aggregation('COUNTA', 'Counts the non-blank values in a column, using only rows that pass the filters.'),
  aggregation('COUNTBLANK', 'Counts the blank values in a column, using only rows that pass the filters.'),
  aggregation('DISTINCTCOUNT', 'Counts how many different values a column has, using only rows that pass the filters.'),
  {
    name: 'MIN',
    category: 'aggregation',
    returns: 'scalar',
    summary: 'The smallest value in a column (rows that pass the filters), or the smaller of two values.',
    overloads: [[p('column', 'column')], [p('value1', 'scalar'), p('value2', 'scalar')]],
  },
  {
    name: 'MAX',
    category: 'aggregation',
    returns: 'scalar',
    summary: 'The largest value in a column (rows that pass the filters), or the larger of two values.',
    overloads: [[p('column', 'column')], [p('value1', 'scalar'), p('value2', 'scalar')]],
  },
  {
    name: 'COUNTROWS',
    category: 'aggregation',
    returns: 'scalar',
    summary: 'Counts the rows of a table that pass the filters in effect.',
    overloads: [[p('table', 'table', { optional: true })]],
  },

  // --- Iterators ---
  iterator('SUMX', 'Goes through a table row by row, calculates something for each row, and adds up the results.'),
  iterator('AVERAGEX', 'Goes through a table row by row, calculates something for each row, and averages the results.'),
  iterator('MINX', 'Goes through a table row by row, calculates something for each row, and returns the smallest result.', [variant]),
  iterator('MAXX', 'Goes through a table row by row, calculates something for each row, and returns the largest result.', [variant]),
  iterator('COUNTX', 'Goes through a table row by row, calculates something for each row, and counts the non-blank results.'),
  {
    name: 'FILTER',
    category: 'iterator',
    returns: 'table',
    summary: 'Goes through a table row by row and keeps only the rows where the condition is true.',
    overloads: [[p('table', 'table'), p('condition', 'rowExpression')]],
    iteratesArgument: 0,
  },
  {
    name: 'ADDCOLUMNS',
    category: 'iterator',
    returns: 'table',
    summary: 'Adds new columns to a table; each new value is calculated row by row.',
    overloads: [[p('table', 'table'), p('name', 'scalar', { repeating: true }), p('expression', 'rowExpression', { repeating: true })]],
    iteratesArgument: 0,
  },
  {
    name: 'RANKX',
    category: 'iterator',
    returns: 'scalar',
    summary: 'Goes through a table row by row, calculates something for each row, and gives the rank of a value among the results.',
    overloads: [
      [
        p('table', 'table'),
        p('expression', 'rowExpression'),
        p('value', 'scalar', { optional: true }),
        p('order', 'keyword', { optional: true, keywords: ['ASC', 'DESC'] }),
        p('ties', 'keyword', { optional: true, keywords: ['SKIP', 'DENSE'] }),
      ],
    ],
    iteratesArgument: 0,
  },

  // --- Filter modification ---
  {
    name: 'CALCULATE',
    category: 'filter modification',
    returns: 'scalar',
    summary: 'Calculates something with changed filters: it can add, replace or remove filters, but only for that calculation.',
    overloads: [[p('expression', 'scalar'), p('filter', 'filter', { optional: true, repeating: true })]],
  },
  {
    name: 'CALCULATETABLE',
    category: 'filter modification',
    returns: 'table',
    summary: 'Returns a table using changed filters: it can add, replace or remove filters, but only for that table.',
    overloads: [[p('table', 'table'), p('filter', 'filter', { optional: true, repeating: true })]],
  },
  {
    name: 'ALL',
    category: 'filter modification',
    returns: 'table',
    summary: 'Inside CALCULATE: removes filters from a table or columns. Used on its own: returns all rows or values, ignoring filters.',
    overloads: [[p('table or column', 'tableOrColumn', { optional: true }), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    name: 'REMOVEFILTERS',
    category: 'filter modification',
    returns: 'table',
    summary: 'Removes filters from a table or columns. Only works inside CALCULATE (or CALCULATETABLE).',
    overloads: [[p('table or column', 'tableOrColumn', { optional: true }), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    name: 'ALLEXCEPT',
    category: 'filter modification',
    returns: 'table',
    summary: 'Removes all filters from a table, except the filters on the columns you list.',
    overloads: [[p('table', 'table'), p('column', 'column', { repeating: true })]],
  },
  {
    name: 'ALLSELECTED',
    category: 'filter modification',
    returns: 'table',
    summary: 'Brings back the filters chosen outside the current visual (such as slicers), ignoring the visual\'s own rows and columns.',
    overloads: [[p('table or column', 'tableOrColumn', { optional: true }), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    // Checked in Power BI Desktop: on its own it gives what ALL gives, without the blank row. Inside CALCULATE it
    // doesn't remove the filter: it replaces it with a filter on every value (ISFILTERED stays TRUE).
    name: 'ALLNOBLANKROW',
    category: 'filter modification',
    returns: 'table',
    summary: 'All rows or values, ignoring filters, like ALL, but without the extra blank row. Inside CALCULATE it replaces the filter with one on every value, rather than removing it.',
    overloads: [[p('table or column', 'tableOrColumn'), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    // Checked in Power BI Desktop: only as a CALCULATE filter (otherwise an error), and only with a table.
    name: 'ALLCROSSFILTERED',
    category: 'filter modification',
    returns: 'table',
    summary: 'Inside CALCULATE: removes every filter on a table, including filters that reach it through two-way relationships.',
    overloads: [[p('table', 'table')]],
  },
  {
    name: 'KEEPFILTERS',
    category: 'filter modification',
    returns: 'table',
    summary: 'Inside CALCULATE: adds a filter on top of the existing ones instead of replacing them, so rows must pass both.',
    overloads: [[p('filter', 'filter')]],
  },

  // --- Table functions ---
  {
    name: 'VALUES',
    category: 'table',
    returns: 'table',
    summary: 'Lists the different values of a column (or the rows of a table) that pass the filters in effect.',
    overloads: [[p('table or column', 'tableOrColumn')]],
  },
  {
    name: 'DISTINCT',
    category: 'table',
    returns: 'table',
    summary: 'Lists the different values of a column (or the rows of a table) that pass the filters in effect.',
    overloads: [[p('table or column', 'tableOrColumn')]],
  },

  // --- Scope and filter inspection ---
  {
    name: 'SELECTEDVALUE',
    category: 'scope and filter inspection',
    returns: 'scalar',
    summary: 'If the filters leave exactly one value in the column, returns it; otherwise returns the fallback (BLANK if none is given).',
    overloads: [[p('column', 'column'), p('alternate result', 'scalar', { optional: true })]],
  },
  {
    // Checked in Power BI Desktop: under a filter on Product[Product] only, FILTERS(Category) gave all 4
    // categories where VALUES gave 1. It takes a column only.
    name: 'FILTERS',
    category: 'scope and filter inspection',
    returns: 'table',
    summary: "Lists the values that the filters on the column itself allow (filters on other columns don't count); with no filter on it, all its values.",
    overloads: [[p('column', 'column')]],
  },
  columnInspection('HASONEVALUE', 'TRUE when the filters leave exactly one value in the column.'),
  columnInspection('HASONEFILTER', 'TRUE when the column itself is filtered to exactly one value.'),
  columnInspection('ISINSCOPE', 'TRUE when the visual is currently grouping by this column at this point (for example, a row level in a matrix).'),
  {
    name: 'ISFILTERED',
    category: 'scope and filter inspection',
    returns: 'scalar',
    summary: 'TRUE when the table or column itself has a filter on it.',
    overloads: [[p('table or column', 'tableOrColumn')]],
  },
  {
    name: 'ISCROSSFILTERED',
    category: 'scope and filter inspection',
    returns: 'scalar',
    summary: 'TRUE when the table or column is filtered, either directly or through a related table.',
    overloads: [[p('table or column', 'tableOrColumn')]],
  },

  // --- First / last value where an expression isn't blank ---
  // Checked in Power BI Desktop: they go through the column's values that pass the filters, in ascending order
  // (text alphabetically; a sort-by column is not used), and calculate the expression for each value.
  ...(['FIRST', 'LAST'] as const).flatMap((which): FunctionSpec[] => [
    {
      name: `${which}NONBLANK`,
      category: 'iterator',
      returns: 'table',
      summary: `Goes through the values of a column, smallest first, and keeps the ${which === 'FIRST' ? 'first' : 'last'} one where an expression isn't blank (a one-row table).`,
      overloads: [[p('column', 'column'), p('expression', 'rowExpression')]],
      iteratesArgument: 0,
    },
    {
      name: `${which}NONBLANKVALUE`,
      category: 'iterator',
      returns: 'scalar',
      summary: `Goes through the values of a column, smallest first, and returns the expression's value for the ${which === 'FIRST' ? 'first' : 'last'} one where it isn't blank.`,
      overloads: [[p('column', 'column'), p('expression', 'rowExpression')]],
      iteratesArgument: 0,
    },
  ]),

  // --- Combining tables (checked in Power BI Desktop: which columns keep their link to the model) ---
  ...(['CROSSJOIN', 'UNION'] as const).map(
    (name): FunctionSpec => ({
      name,
      category: 'table',
      returns: 'table',
      summary:
        name === 'CROSSJOIN'
          ? 'Every combination of the rows of the tables.'
          : 'The rows of all the tables together; their columns stay linked to the model only if they are the same columns.',
      overloads: [[p('table', 'table'), p('table', 'table'), p('table', 'table', { optional: true, repeating: true })]],
    }),
  ),
  {
    name: 'EXCEPT',
    category: 'table',
    returns: 'table',
    summary: "The rows of the first table that aren't in the second.",
    overloads: [[p('table', 'table'), p('table to take away', 'table')]],
  },
  {
    name: 'INTERSECT',
    category: 'table',
    returns: 'table',
    summary: 'The rows of the first table that are also in the second.',
    overloads: [[p('table', 'table'), p('other table', 'table')]],
  },
  {
    name: 'NATURALINNERJOIN',
    category: 'table',
    returns: 'table',
    summary: 'Joins two tables on the columns they have in common, keeping the rows that match.',
    overloads: [[p('left table', 'table'), p('right table', 'table')]],
  },
  {
    name: 'NATURALLEFTOUTERJOIN',
    category: 'table',
    returns: 'table',
    summary: 'Joins two tables on the columns they have in common, keeping every row of the first table.',
    overloads: [[p('left table', 'table'), p('right table', 'table')]],
  },
  ...(['GENERATE', 'GENERATEALL'] as const).map(
    (name): FunctionSpec => ({
      name,
      category: 'iterator',
      returns: 'table',
      summary:
        name === 'GENERATE'
          ? 'Goes through a table row by row, works out a second table for each row, and joins them (rows with an empty second table are left out).'
          : 'Goes through a table row by row, works out a second table for each row, and joins them (rows with an empty second table are kept, with blanks).',
      overloads: [[p('table', 'table'), p('table for each row', 'rowExpression')]],
      iteratesArgument: 0,
    }),
  ),

  // --- Tables made from values (checked in Power BI Desktop: no link to the model's columns, so as a CALCULATE
  //     filter, or as the row of a loop turned into a filter, each filters nothing) ---
  dataTable(),
  {
    name: 'ROW',
    category: 'table',
    returns: 'table',
    summary: 'A table with one row: each column is named in the code and worked out with the filters here.',
    overloads: [[p('name', 'scalar', { repeating: true }), p('expression', 'scalar', { repeating: true })]],
  },
  {
    name: 'GENERATESERIES',
    category: 'table',
    returns: 'table',
    summary: 'A one-column table of numbers (or dates) from a start to an end, in steps (1 by default); its column is [Value].',
    overloads: [[p('start', 'scalar'), p('end', 'scalar'), p('step', 'scalar', { optional: true })]],
  },
  {
    name: 'CALENDAR',
    category: 'table',
    returns: 'table',
    summary: 'A one-column table of every date from a start date to an end date; its column is [Date].',
    overloads: [[p('start date', 'scalar'), p('end date', 'scalar')]],
  },
  {
    name: 'CALENDARAUTO',
    category: 'table',
    returns: 'table',
    summary: "A one-column table of dates covering whole years around the dates stored in the model's date columns; its column is [Date].",
    overloads: [[p('last month of the year', 'scalar', { optional: true })]],
  },

  // --- Picking and indexing rows (checked in Power BI Desktop) ---
  {
    // Largest first unless ASC is written (like TOPN), but exactly N rows even with ties (TOPN gave 4 for a tie,
    // TOPNSKIP 1). On a DirectQuery model, skipping rows (a skip above 0) is an error.
    name: 'TOPNSKIP',
    category: 'iterator',
    returns: 'table',
    summary: 'Goes through a table row by row, sorts the rows (largest first unless ASC), skips some and keeps the next N, exactly N even with ties.',
    overloads: [
      [
        p('N', 'scalar'),
        p('rows to skip', 'scalar'),
        p('table', 'table'),
        p('order by', 'rowExpression', { optional: true, repeating: true }),
        p('order', 'keyword', { optional: true, repeating: true, keywords: ['ASC', 'DESC'] }),
      ],
    ],
    iteratesArgument: 2,
  },
  {
    // SAMPLE(2, VALUES(Category), Category, ASC) gave the first and the last category.
    name: 'SAMPLE',
    category: 'iterator',
    returns: 'table',
    summary: 'Goes through a table row by row, sorts the rows, and keeps N rows spread evenly from first to last.',
    overloads: [
      [
        p('N', 'scalar'),
        p('table', 'table'),
        p('order by', 'rowExpression', { repeating: true }),
        p('order', 'keyword', { optional: true, repeating: true, keywords: ['ASC', 'DESC'] }),
      ],
    ],
    iteratesArgument: 1,
  },
  {
    // The first table's columns that the index table also has are replaced by one number column (from 0).
    name: 'SUBSTITUTEWITHINDEX',
    category: 'iterator',
    returns: 'table',
    summary: "Replaces the columns a table shares with an index table by one number column: each row's position in the sorted index table (from 0).",
    overloads: [
      [
        p('table', 'table'),
        p('name', 'scalar'),
        p('index table', 'table'),
        p('order by', 'rowExpression', { repeating: true }),
        p('order', 'keyword', { optional: true, repeating: true, keywords: ['ASC', 'DESC'] }),
      ],
    ],
    iteratesArgument: 2,
  },
  {
    // Shows the missing values of the show-all columns, from the filters here (4 with no filter, 2 under a
    // two-category filter), with blanks in the other columns. Mainly used in Power BI's own queries.
    name: 'ADDMISSINGITEMS',
    category: 'table',
    returns: 'table',
    summary: "Adds rows for the values of the show-all columns that a table leaves out (taken from the filters here), with blanks in its other columns.",
    overloads: [[p('show-all column or table', 'tableOrColumn'), p('more', 'scalar', { optional: true, repeating: true })]],
    paramsFor: (args) => {
      const table = args.findIndex((a) => a.kind !== 'ColumnRef' && a.kind !== 'BracketRef');
      if (table === -1) return null;
      return args.map((a, i) =>
        i < table ? p('show-all column', 'column') : i === table ? p('table', 'table') : a.kind === 'ColumnRef' || a.kind === 'BracketRef' ? p('group by column', 'column') : p('filter table', 'table'),
      );
    },
  },

  // --- Regression (checked in Power BI Desktop: a one-row table of results; follows the filters) ---
  linest('LINEST'),
  linest('LINESTX'),

  // --- Names (checked in Power BI Desktop: only references, which are not calculated) ---
  {
    name: 'NAMEOF',
    category: 'information',
    returns: 'scalar',
    summary: "The name of a column, measure, table or calendar, as text (a column as 'Table'[Column], a measure with its home table).",
    overloads: [
      [
        p('reference', 'name'),
        p('part', 'keyword', { optional: true, keywords: ['TABLE', 'COLUMN', 'MEASURE', 'CALENDAR', 'FULL', 'SELF', 'PARENT'] }),
        p('quoting', 'keyword', { optional: true, keywords: ['ESCAPED', 'UNESCAPED', 'MINIMALLYESCAPED'] }),
      ],
    ],
  },
  {
    name: 'TABLEOF',
    category: 'information',
    returns: 'table',
    summary: "The table a column, measure or calendar belongs to (a measure's home table).",
    overloads: [[p('reference', 'name')]],
  },

  // --- Comparing with a starting point (checked in Power BI Desktop: ASC unless DESC; ties go to the next pair) ---
  startAt('ISAFTER', 'TRUE when the values come after the starting values in the given order (ASC unless DESC), comparing the first pair, then the next pair on a tie.'),
  startAt('ISONORAFTER', 'TRUE when the values come after, or are equal to, the starting values in the given order (ASC unless DESC), comparing pair by pair.'),

  // --- Window functions (checked in Power BI Desktop): a row (or rows, or a number) found from the current row ---
  windowFunction('OFFSET', 'The row a number of rows before (negative) or after the current row, in a sorted table.'),
  windowFunction('INDEX', 'The row at a position in a sorted table (1 is the first, -1 the last), whatever the current row is.'),
  windowFunction('WINDOW', 'The rows between two positions in a sorted table, each counted from the current row (unless ABS) — for example, a running total.'),
  windowFunction('RANK', 'The rank of the current row in a sorted table (tied rows get the same rank).'),
  windowFunction('ROWNUMBER', 'The position of the current row in a sorted table (ties are broken by the other columns, so every row gets its own number).'),
  {
    name: 'ORDERBY',
    category: 'other',
    returns: 'table',
    summary: 'Inside OFFSET, INDEX, WINDOW, RANK and ROWNUMBER: how to sort the rows (each expression is worked out for every row; ASC unless DESC).',
    overloads: [[p('expression', 'scalar', { optional: true, repeating: true }), p('order', 'keyword', { optional: true, repeating: true, keywords: ['ASC', 'DESC'] })]],
    paramsFor: (args) => args.map((a) => (isKeyword(a, ['ASC', 'DESC']) ? p('order', 'keyword', { keywords: ['ASC', 'DESC'] }) : p('expression', 'scalar'))),
  },
  {
    name: 'PARTITIONBY',
    category: 'other',
    returns: 'table',
    summary: 'Inside OFFSET, INDEX, WINDOW, RANK and ROWNUMBER: counts within each value of these columns separately.',
    overloads: [[p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    name: 'MATCHBY',
    category: 'other',
    returns: 'table',
    summary: 'Inside OFFSET, INDEX, WINDOW, RANK and ROWNUMBER: the columns that identify the current row.',
    overloads: [[p('column', 'column', { optional: true, repeating: true })]],
  },

  // --- SUMMARIZECOLUMNS (checked in Power BI Desktop, inside measures) ---
  {
    name: 'SUMMARIZECOLUMNS',
    category: 'table',
    returns: 'table',
    summary: "Groups by columns, with extra columns worked out for each group (the group's values as filters); groups where every extra column is BLANK are left out.",
    overloads: [[p('group by column', 'column'), p('more', 'scalar', { optional: true, repeating: true })]],
    paramsFor: (args) => {
      const params: ParamSpec[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.kind === 'StringLiteral') {
          params.push(p('name', 'scalar'));
          if (i + 1 >= args.length) return null;
          params.push(p('expression', 'scalar'));
          i++;
        } else if (a.kind === 'ColumnRef' || a.kind === 'BracketRef') params.push(p('group by column', 'column'));
        else if (isCallTo(a, 'ROLLUPADDISSUBTOTAL') || isCallTo(a, 'ROLLUPGROUP')) params.push(p('group by', 'scalar'));
        else params.push(p('filter table', 'table'));
      }
      return params;
    },
  },
  {
    // Checked in Power BI Desktop: (filter table,) column, "name" … : a total row per level, its name column TRUE.
    name: 'ROLLUPADDISSUBTOTAL',
    category: 'table',
    returns: 'table',
    summary: 'Inside SUMMARIZECOLUMNS: adds subtotal rows for these group columns, with a TRUE/FALSE column saying which rows are subtotals.',
    overloads: [[p('group by column', 'column'), p('name', 'scalar'), p('more', 'scalar', { optional: true, repeating: true })]],
    paramsFor: (args) =>
      args.map((a) => (a.kind === 'ColumnRef' || a.kind === 'BracketRef' ? p('group by column', 'column') : a.kind === 'StringLiteral' ? p('name', 'scalar') : p('filter table', 'table'))),
  },
  {
    name: 'IGNORE',
    category: 'other',
    returns: 'scalar',
    summary: "Inside SUMMARIZECOLUMNS: this extra column doesn't count when groups with only BLANK values are left out.",
    overloads: [[p('expression', 'scalar')]],
  },
  {
    name: 'NONVISUAL',
    category: 'other',
    returns: 'table',
    summary: "Inside SUMMARIZECOLUMNS: a filter that, in a visual's query, doesn't change the totals (documentation). In a measure it filters like the other filters.",
    overloads: [[p('filter table', 'table')]],
  },

  // --- Grouping ---
  summarize(),
  groupBy(),
  {
    name: 'CURRENTGROUP',
    category: 'table',
    returns: 'table',
    summary: "Inside GROUPBY: the rows of the table that belong to the current group (only as the table of SUMX, AVERAGEX, …).",
    overloads: [[]],
  },
  {
    name: 'ROLLUP',
    category: 'table',
    returns: 'table',
    summary: 'Inside SUMMARIZE: adds total rows for these group columns (their value is BLANK on those rows).',
    overloads: [[p('column', 'column'), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    name: 'ROLLUPGROUP',
    category: 'table',
    returns: 'table',
    summary: 'Inside ROLLUP: treats these columns as one, so they get one total row together.',
    overloads: [[p('column', 'column'), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    name: 'ISSUBTOTAL',
    category: 'table',
    returns: 'scalar',
    summary: 'Inside SUMMARIZE: TRUE on the total row that ROLLUP adds for this column.',
    overloads: [[p('column', 'column')]],
  },

  // --- Lookup ---
  lookupValue(),
  {
    name: 'EARLIER',
    category: 'lookup',
    returns: 'scalar',
    summary: 'The value of a column in the row of an outer loop (going row by row), not the current one.',
    overloads: [[p('column', 'column'), p('number of loops out', 'scalar', { optional: true })]],
  },
  {
    name: 'EARLIEST',
    category: 'lookup',
    returns: 'scalar',
    summary: 'The value of a column in the row of the outermost loop (going row by row) through its table.',
    overloads: [[p('column', 'column')]],
  },

  // --- Relationships ---
  {
    name: 'RELATED',
    category: 'relationship',
    returns: 'scalar',
    summary: 'While going row by row, looks up a value from a related table (for example, the product\'s category for a sales row).',
    overloads: [[p('column', 'column')]],
  },
  {
    name: 'USERELATIONSHIP',
    category: 'relationship',
    returns: 'table',
    summary: 'Inside CALCULATE: uses a different (normally inactive) relationship between two tables.',
    overloads: [[p('column 1', 'column'), p('column 2', 'column')]],
  },
  {
    name: 'CROSSFILTER',
    category: 'relationship',
    returns: 'table',
    summary: 'Inside CALCULATE: changes the direction in which a relationship passes filters between two tables.',
    overloads: [[p('column 1', 'column'), p('column 2', 'column'), p('direction', 'keyword', { keywords: ['NONE', 'ONEWAY', 'BOTH', 'ONEWAY_LEFTFILTERSRIGHT', 'ONEWAY_RIGHTFILTERSLEFT'] })]],
  },
  {
    name: 'TREATAS',
    category: 'relationship',
    returns: 'table',
    summary: 'Applies the values of a table as a filter on other columns, as if through a relationship.',
    overloads: [[p('table', 'table'), p('column', 'column', { repeating: true })]],
  },

  // --- Time intelligence: tables of dates, used as CALCULATE filters (or tables) ---
  ...timeIntelligence(),

  // --- Logical and math ---
  {
    name: 'IF',
    category: 'logical',
    returns: 'scalar',
    summary: 'Returns one result when a condition is true and another (BLANK if none is given) when it is false.',
    overloads: [[p('condition', 'scalar'), p('value if true', 'scalar'), p('value if false', 'scalar', { optional: true })]],
  },
  {
    name: 'COALESCE',
    category: 'logical',
    returns: 'scalar',
    summary: 'Returns the first value in the list that is not BLANK.',
    overloads: [[p('value', 'scalar'), p('value', 'scalar', { repeating: true })]],
  },
  {
    name: 'DIVIDE',
    category: 'math',
    returns: 'scalar',
    summary: 'Divides; by zero, it gives BLANK (or the fallback) instead of an error.',
    overloads: [[p('numerator', 'scalar'), p('denominator', 'scalar'), p('alternate result', 'scalar', { optional: true })]],
  },
  {
    name: 'TOPN',
    category: 'iterator',
    returns: 'table',
    summary: 'Goes through a table row by row, calculates a ranking value for each row, and keeps the top N rows.',
    overloads: [
      [
        p('N', 'scalar'),
        p('table', 'table'),
        p('order by', 'rowExpression', { optional: true, repeating: true }),
        p('order', 'keyword', { optional: true, repeating: true, keywords: ['ASC', 'DESC'] }),
      ],
    ],
    iteratesArgument: 1,
  },
  {
    name: 'CONCATENATEX',
    category: 'iterator',
    returns: 'scalar',
    summary: 'Goes through a table row by row, calculates a piece of text for each row, and joins them into one text.',
    overloads: [
      [
        p('table', 'table'),
        p('expression', 'rowExpression'),
        p('delimiter', 'scalar', { optional: true }),
        p('order by', 'rowExpression', { optional: true, repeating: true }),
        p('order', 'keyword', { optional: true, repeating: true, keywords: ['ASC', 'DESC'] }),
      ],
    ],
    iteratesArgument: 0,
  },
  {
    name: 'SELECTCOLUMNS',
    category: 'iterator',
    returns: 'table',
    summary: 'Builds a new table whose columns are calculated row by row from another table.',
    // Power BI also accepts a column on its own, without a name: SELECTCOLUMNS('Sales', 'Sales'[Amount]).
    overloads: [[p('table', 'table'), p('name', 'scalar', { repeating: true }), p('expression', 'rowExpression', { optional: true, repeating: true })]],
    iteratesArgument: 0,
  },
  {
    name: 'RELATEDTABLE',
    category: 'relationship',
    returns: 'table',
    summary: 'While going row by row, returns the related rows from another table (for example, all sales of the current customer).',
    overloads: [[p('table', 'table')]],
  },
  {
    name: 'ISBLANK',
    category: 'logical',
    returns: 'scalar',
    summary: 'TRUE when the value is BLANK (empty).',
    overloads: [[p('value', 'scalar')]],
  },
  {
    name: 'AND',
    category: 'logical',
    returns: 'scalar',
    summary: 'TRUE when both values are true (same as &&).',
    overloads: [[p('logical 1', 'scalar'), p('logical 2', 'scalar')]],
  },
  {
    name: 'OR',
    category: 'logical',
    returns: 'scalar',
    summary: 'TRUE when either value is true (same as ||).',
    overloads: [[p('logical 1', 'scalar'), p('logical 2', 'scalar')]],
  },
  {
    name: 'SWITCH',
    category: 'logical',
    returns: 'scalar',
    summary: 'Compares a value with a list of options and returns the result for the first match.',
    overloads: [
      [p('expression', 'scalar'), p('value', 'scalar'), p('result', 'scalar'), p('more values, results or else', 'scalar', { optional: true, repeating: true })],
    ],
  },
  {
    name: 'FORMAT',
    category: 'text',
    returns: 'scalar',
    summary: 'Converts a value to text using a format string.',
    overloads: [[p('value', 'scalar'), p('format', 'scalar'), p('locale', 'scalar', { optional: true })]],
  },
  {
    name: 'UNICHAR',
    category: 'text',
    returns: 'scalar',
    summary: 'Returns the character for a Unicode code point.',
    overloads: [[p('number', 'scalar')]],
  },
  {
    name: 'ROUND',
    category: 'math',
    returns: 'scalar',
    summary: 'Rounds a number to the given number of digits.',
    overloads: [[p('number', 'scalar'), p('digits', 'scalar')]],
  },
  {
    name: 'ABS',
    category: 'math',
    returns: 'scalar',
    summary: 'Absolute value of a number.',
    overloads: [[p('number', 'scalar')]],
  },
  { name: 'BLANK', category: 'logical', returns: 'scalar', summary: 'Returns BLANK.', overloads: [[]] },
  { name: 'TRUE', category: 'logical', returns: 'scalar', summary: 'Returns TRUE.', overloads: [[]] },
  { name: 'FALSE', category: 'logical', returns: 'scalar', summary: 'Returns FALSE.', overloads: [[]] },

  // --- Plain functions: they change no filters and no rows (date, text, maths, statistics, finance, …) ---
  ...PLAIN_FUNCTIONS,
];

const BY_NAME: ReadonlyMap<string, FunctionSpec> = new Map(SPECS.map((spec) => [spec.name, spec]));

/** All catalog entries (for documentation and tests). */
export const FUNCTION_CATALOG: readonly FunctionSpec[] = SPECS;

/**
 * INFO.TABLES(), INFO.VIEW.MEASURES() and the other INFO functions describe the model itself. They return a
 * table, change no filters or rows, and take optional restrictions, so one shared entry covers them all.
 */
function infoFunction(name: string): FunctionSpec {
  return {
    name,
    category: 'information',
    returns: 'table',
    summary: 'A table describing the data model itself (its tables, columns, measures, …).',
    overloads: [[p('restriction', 'scalar', { optional: true, repeating: true })]],
  };
}

/** Case-insensitive lookup. Returns undefined for functions not in the catalog. */
export function lookupFunction(name: string): FunctionSpec | undefined {
  const upper = name.toUpperCase();
  return BY_NAME.get(upper) ?? (upper.startsWith('INFO.') ? infoFunction(upper) : undefined);
}

/** Minimum and maximum argument counts of one parameter list (max is Infinity when repeating). */
export function arity(params: readonly ParamSpec[]): { min: number; max: number } {
  const min = params.filter((param) => !param.optional).length;
  const max = params.some((param) => param.repeating) ? Infinity : params.length;
  return { min, max };
}

/**
 * Picks the overload matching the argument count and returns the parameter
 * for each argument position. Returns null if no overload fits.
 */
export function parametersForCall(spec: FunctionSpec, argumentCount: number, args?: readonly { kind: string }[]): ParamSpec[] | null {
  if (spec.paramsFor && args) return spec.paramsFor(args);
  for (const params of spec.overloads) {
    const { min, max } = arity(params);
    if (argumentCount < min || argumentCount > max) continue;
    // Trailing repeating parameters form a group that cycles: a, b, a, b, ...
    const groupStart = params.findIndex((param) => param.repeating);
    const groupSize = groupStart === -1 ? 0 : params.length - groupStart;
    const result: ParamSpec[] = [];
    for (let i = 0; i < argumentCount; i++) {
      result.push(i < params.length ? params[i] : params[groupStart + ((i - groupStart) % groupSize)]);
    }
    return result;
  }
  return null;
}

/**
 * LOOKUPVALUE(result column, search column, search value, [search column, search value]…, [alternate result]).
 * A trailing alternate result makes the count of inputs decide what the last one is: odd = only pairs, even =
 * the last input is the alternate result (a value, so a measure there is not taken for a column). Exact lists
 * for up to 20 pairs, then an open-ended list. Checked in Power BI Desktop: it ignores every filter in effect.
 */
function lookupValue(): FunctionSpec {
  const pair = [p('search column', 'column'), p('search value', 'scalar')];
  const pairs = (n: number) => Array.from({ length: n }, () => pair).flat();
  const head = [p('result column', 'column')];
  const alternate = p('alternate result', 'scalar');
  return {
    name: 'LOOKUPVALUE',
    category: 'lookup',
    returns: 'scalar',
    summary: 'Finds the value of a column in the row where other columns have the given values, searching the whole table (the filters in effect do not apply).',
    overloads: [
      ...Array.from({ length: 20 }, (_, i) => [[...head, ...pairs(i + 1)], [...head, ...pairs(i + 1), alternate]]).flat(),
      [...head, ...pair, p('search column', 'column', { repeating: true }), p('search value', 'scalar', { repeating: true })],
    ],
  };
}

/**
 * SUMMARIZE(table, group-by column…, [name, expression]…). The group-by columns (or ROLLUP(…)) come first and
 * the extra columns are written as a text name and an expression, so the inputs are told apart by what is
 * written. Checked in Power BI Desktop: each extra column is worked out once per group, with a current row
 * holding only the group's columns, and with the table filtered to the group's rows.
 */
function summarize(): FunctionSpec {
  return grouping('SUMMARIZE', 'Groups the rows of a table by some columns, with optional extra columns worked out once per group.');
}

/**
 * GROUPBY(table, group-by column…, [name, expression]…): written like SUMMARIZE. Checked in Power BI Desktop:
 * each extra column must be one SUMX, AVERAGEX, MINX, MAXX, COUNTX, COUNTAX or PRODUCTX over CURRENTGROUP(),
 * nothing is filtered per group, and CALCULATE or measures aren't allowed.
 */
function groupBy(): FunctionSpec {
  return grouping('GROUPBY', 'Groups the rows of a table by some columns; extra columns add up each group’s rows with SUMX(CURRENTGROUP(), …) and the like.');
}

/**
 * LINEST(y column, x column…, [with intercept]) and LINESTX(table, y, x…, [with intercept]): the inputs end with
 * an optional TRUE/FALSE, told apart by what is written. LINEST's columns must be from one table (checked).
 */
function linest(name: 'LINEST' | 'LINESTX'): FunctionSpec {
  const isX = name === 'LINESTX';
  const value = isX ? p('y', 'rowExpression') : p('y column', 'column');
  const x = isX ? p('x', 'rowExpression') : p('x column', 'column');
  const intercept = p('with intercept', 'scalar');
  const table = p('table', 'table');
  const isConstant = (a: { kind: string; name?: string }) =>
    a.kind === 'BooleanLiteral' || (a.kind === 'FunctionCall' && ['TRUE', 'FALSE'].includes((a.name ?? '').toUpperCase()));
  return {
    name,
    category: isX ? 'iterator' : 'statistical',
    returns: 'table',
    summary: isX
      ? 'Goes through a table row by row and fits a straight line through the values worked out for each row (least squares); returns one row of results such as [Slope1] and [Intercept].'
      : 'Fits a straight line through the values of columns of one table, under the filters here (least squares); returns one row of results such as [Slope1] and [Intercept].',
    overloads: [isX ? [table, value, x, p('x or with intercept', 'scalar', { optional: true, repeating: true })] : [value, x, p('x column or with intercept', 'column', { optional: true, repeating: true })]],
    ...(isX ? { iteratesArgument: 0 } : {}),
    paramsFor: (args) => {
      const start = isX ? 1 : 0;
      if (args.length < start + 2) return null;
      const last = args[args.length - 1] as { kind: string; name?: string };
      const withConstant = args.length > start + 2 && isConstant(last);
      const params: ParamSpec[] = isX ? [table] : [];
      for (let i = start; i < args.length - (withConstant ? 1 : 0); i++) params.push(i === start ? value : x);
      return withConstant ? [...params, intercept] : params;
    },
  };
}

/** Whether an input is one of these keywords, written bare (ASC, DEFAULT, …). */
function isKeyword(a: { kind: string }, words: readonly string[]): boolean {
  const ref = a as { kind: string; name?: string; quoted?: boolean };
  return ref.kind === 'TableRef' && !ref.quoted && words.includes((ref.name ?? '').toUpperCase());
}

const isCallTo = (a: { kind: string }, name: string) => a.kind === 'FunctionCall' && ((a as { name?: string }).name ?? '').toUpperCase() === name;

/** The window functions: OFFSET, INDEX, WINDOW, RANK and ROWNUMBER. */
export const WINDOW_FUNCTIONS: ReadonlySet<string> = new Set(['OFFSET', 'INDEX', 'WINDOW', 'RANK', 'ROWNUMBER']);

/**
 * OFFSET(delta, [relation], [ORDERBY], [blanks], [PARTITIONBY], [MATCHBY], [reset]) and the others: after their own
 * first inputs, the inputs are told apart by what is written (an ORDERBY(…) call, a keyword, the table).
 * Checked in Power BI Desktop: WINDOW's ABS/REL are optional (REL unless ABS); blanks takes DEFAULT, KEEP, FIRST or
 * LAST; RESET can't be used with ORDERBY or PARTITIONBY.
 */
function windowFunction(name: string, summary: string): FunctionSpec {
  const kind = p('ABS or REL', 'keyword', { keywords: ['ABS', 'REL'] });
  const leading: Record<string, ParamSpec[]> = {
    OFFSET: [p('rows to move', 'scalar')],
    INDEX: [p('position', 'scalar')],
    WINDOW: [p('from', 'scalar'), kind, p('to', 'scalar'), kind],
    RANK: [p('ties', 'keyword', { keywords: ['SKIP', 'DENSE'] })],
    ROWNUMBER: [],
  };
  const rest = [
    p('relation', 'table'),
    p('order by', 'scalar'),
    p('blanks', 'keyword', { keywords: ['DEFAULT', 'KEEP', 'FIRST', 'LAST'] }),
    p('partition by', 'scalar'),
    p('match by', 'scalar'),
    p('reset', 'scalar'),
  ];
  const optional = (list: ParamSpec[]) => list.map((x) => ({ ...x, optional: true }));
  const overloads: ParamSpec[][] = {
    OFFSET: [[leading.OFFSET[0], ...optional(rest)]],
    INDEX: [[leading.INDEX[0], ...optional(rest)]],
    WINDOW: [
      [leading.WINDOW[0], leading.WINDOW[2], ...optional(rest)],
      [leading.WINDOW[0], kind, leading.WINDOW[2], kind, ...optional(rest)],
    ],
    // Power BI allows any number of inputs for RANK.
    RANK: [[{ ...leading.RANK[0], optional: true }, { ...rest[0], optional: true }, p('more', 'scalar', { optional: true, repeating: true })]],
    ROWNUMBER: [optional(rest)],
  }[name]!;
  return {
    name,
    category: 'other',
    returns: name === 'RANK' || name === 'ROWNUMBER' ? 'scalar' : 'table',
    summary,
    overloads,
    paramsFor: (args) => {
      const params: ParamSpec[] = [];
      let i = 0;
      const take = (param: ParamSpec) => {
        params.push(param);
        i++;
      };
      if (name === 'OFFSET' || name === 'INDEX') take(leading[name][0]);
      if (name === 'WINDOW') {
        for (const part of [leading.WINDOW[0], leading.WINDOW[2]]) {
          if (i >= args.length) return null;
          take(part);
          if (args[i] && isKeyword(args[i], ['ABS', 'REL'])) take(kind);
        }
      }
      if (name === 'RANK' && args[0] && (isKeyword(args[0], ['SKIP', 'DENSE']) || args[0].kind === 'Omitted')) take(leading.RANK[0]);
      // The table comes next, unless it is left out (then ORDERBY or PARTITIONBY comes straight away).
      const isPart = (a: { kind: string }) => ['ORDERBY', 'PARTITIONBY', 'MATCHBY'].some((n) => isCallTo(a, n));
      // (Left out with a comma, it is still the table's place.)
      const isOption = (a: { kind: string }) => isKeyword(a, ['DEFAULT', 'KEEP', 'FIRST', 'LAST', 'NONE', 'LOWESTPARENT', 'HIGHESTPARENT']);
      if (args[i] && !isPart(args[i]) && !isOption(args[i])) take(rest[0]);
      for (; i < args.length; i++) {
        const a = args[i];
        if (isCallTo(a, 'ORDERBY')) params.push(rest[1]);
        else if (isCallTo(a, 'PARTITIONBY')) params.push(rest[3]);
        else if (isCallTo(a, 'MATCHBY')) params.push(rest[4]);
        else if (isKeyword(a, ['DEFAULT', 'KEEP', 'FIRST', 'LAST'])) params.push(rest[2]);
        else if (isKeyword(a, ['NONE', 'LOWESTPARENT', 'HIGHESTPARENT'])) params.push(p('reset', 'keyword', { keywords: ['NONE', 'LOWESTPARENT', 'HIGHESTPARENT'] }));
        else if (a.kind === 'Omitted') params.push(p('left out', 'scalar', { optional: true }));
        else params.push(rest[5]);
      }
      return params;
    },
  };
}

/** A window function's table (relation), or null when none is written (then it is ALLSELECTED of its columns). */
export function windowRelation(params: readonly ParamSpec[] | null, args: readonly { kind: string }[]): number {
  if (!params) return -1;
  const i = params.findIndex((x) => x.name === 'relation');
  return i !== -1 && args[i] && args[i].kind !== 'Omitted' ? i : -1;
}

/**
 * The columns of LINEST's or LINESTX's one-row result, or null when they can't be told. Checked in Power BI
 * Desktop with one x: Slope1, Intercept, StandardErrorSlope1, StandardErrorIntercept, CoefficientOfDetermination,
 * StandardError, FStatistic, DegreesOfFreedom, RegressionSumOfSquares, ResidualSumOfSquares; with FALSE, there is
 * no Intercept (what else changes isn't checked, so then null). Slope2… for more x values (documentation).
 */
export function linestColumnNames(params: readonly ParamSpec[] | null, args: readonly { kind: string; value?: unknown; name?: string; args?: unknown[] }[]): string[] | null {
  if (!params) return null;
  const intercept = params.findIndex((p) => p.name === 'with intercept');
  if (intercept !== -1) {
    const a = args[intercept];
    const isTrue = (a?.kind === 'BooleanLiteral' && a.value === true) || (a?.kind === 'FunctionCall' && a.name?.toUpperCase() === 'TRUE' && a.args?.length === 0);
    if (!isTrue) return null;
  }
  const count = params.filter((p) => p.name === 'x' || p.name === 'x column').length;
  const each = (prefix: string) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
  return [
    ...each('Slope'),
    'Intercept',
    ...each('StandardErrorSlope'),
    'StandardErrorIntercept',
    'CoefficientOfDetermination',
    'StandardError',
    'FStatistic',
    'DegreesOfFreedom',
    'RegressionSumOfSquares',
    'ResidualSumOfSquares',
  ];
}

/** ISAFTER / ISONORAFTER(value, start, [ASC|DESC], …): groups of a value, a starting value and an optional order. */
function startAt(name: string, summary: string): FunctionSpec {
  const value = p('value', 'scalar');
  const start = p('starting value', 'scalar');
  const order = p('order', 'keyword', { keywords: ['ASC', 'DESC'] });
  return {
    name,
    category: 'logical',
    returns: 'scalar',
    summary,
    overloads: [[value, start, p('order, value, starting value', 'scalar', { optional: true, repeating: true })]],
    paramsFor: (args) => {
      const params: ParamSpec[] = [];
      let i = 0;
      while (i < args.length) {
        if (i + 1 >= args.length) return null;
        params.push(value, start);
        i += 2;
        const a = args[i] as { kind: string; name?: string; quoted?: boolean } | undefined;
        if (a?.kind === 'TableRef' && !a.quoted && ['ASC', 'DESC'].includes((a.name ?? '').toUpperCase())) {
          params.push(order);
          i++;
        }
      }
      return params;
    },
  };
}

/**
 * DATATABLE(name, type, …, {{values}, …}): name/type pairs, then the rows. Checked in Power BI Desktop: the
 * values must be written out (even 1+1 is an error).
 */
function dataTable(): FunctionSpec {
  const name = p('name', 'scalar');
  const type = p('type', 'keyword', { keywords: ['INTEGER', 'DOUBLE', 'STRING', 'BOOLEAN', 'CURRENCY', 'DATETIME'] });
  const data = p('rows', 'table');
  return {
    name: 'DATATABLE',
    category: 'table',
    returns: 'table',
    summary: 'A table typed out in the code: column names and types, then the rows of values.',
    overloads: [[name, type, data, p('more names, types and rows', 'scalar', { optional: true, repeating: true })]],
    paramsFor: (args) => {
      if (args.length < 3 || (args.length - 1) % 2 !== 0) return null;
      const params: ParamSpec[] = [];
      for (let i = 0; i < args.length - 1; i += 2) params.push(name, type);
      return [...params, data];
    },
  };
}

/** SUMMARIZE and GROUPBY: group-by columns until the first text name, then name/expression pairs. */
function grouping(name: string, summary: string): FunctionSpec {
  const table = p('table', 'table');
  const groupByColumn = p('group by column', 'column');
  const columnName = p('name', 'scalar');
  const expression = p('expression', 'rowExpression');
  return {
    name,
    category: 'table',
    returns: 'table',
    summary,
    overloads: [[table, groupByColumn, p('group by column, or name', 'column', { optional: true, repeating: true })]],
    iteratesArgument: 0,
    paramsFor: (args) => {
      if (args.length < 2) return null;
      const params = [table];
      let i = 1;
      for (; i < args.length && args[i].kind !== 'StringLiteral'; i++) params.push(groupByColumn);
      if ((args.length - i) % 2 !== 0) return null;
      for (; i < args.length; i += 2) params.push(columnName, expression);
      return params;
    },
  };
}

/** Time-intelligence functions. Each returns a table of dates from the date column it is given. */
function timeIntelligence(): FunctionSpec[] {
  // WEEK only works with a calendar (calendar-based time intelligence) that has weeks.
  const interval = p('interval', 'keyword', { keywords: ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] });
  // A date column, or the name of a calendar (calendar-based time intelligence): 'Date'[Date] or 'Fiscal Calendar'.
  const dates = p('dates', 'column');
  const spec = (name: string, summary: string, params: ParamSpec[], returns: 'table' | 'scalar' = 'table'): FunctionSpec => ({
    name,
    category: 'time intelligence',
    returns,
    summary,
    overloads: [params],
  });
  const yearEnd = p('year end date', 'scalar', { optional: true });
  // Only the year-based functions take a year end (checked against Power BI Desktop: see powerBiArity.ts).
  const withYearEnd = (period: string) => (period === 'year' ? [dates, yearEnd] : [dates]);
  const toDate = (name: string, period: string) =>
    spec(name, `The dates from the start of the ${period} up to the last date in the current filter.`, withYearEnd(period));
  const total = (name: string, period: string) =>
    spec(
      name,
      `Calculates an expression for the ${period} to date: CALCULATE(expression, DATES${name.slice(5)}(dates), filter).`,
      [p('expression', 'scalar'), dates, p('filter', 'filter', { optional: true }), ...(period === 'year' ? [yearEnd] : [])],
      'scalar',
    );
  const around = (name: string, which: 'before' | 'after', period: string) =>
    spec(name, `The whole ${period} ${which} the ${which === 'before' ? 'first' : 'last'} date in the current filter.`, withYearEnd(period));
  // Checked in Power BI Desktop: STARTOF… uses the first date in the filter, ENDOF… the last one.
  const startOf = (period: string) =>
    spec(`STARTOF${period.toUpperCase()}`, `The first date of the ${period} of the first date in the current filter.`, withYearEnd(period));
  const endOf = (period: string) =>
    spec(`ENDOF${period.toUpperCase()}`, `The last date of the ${period} of the last date in the current filter.`, withYearEnd(period));
  // Checked in Power BI Desktop: CLOSINGBALANCEMONTH(x, dates) = CALCULATE(x, ENDOFMONTH(dates)) and
  // OPENINGBALANCEMONTH(x, dates) = CALCULATE(x, PREVIOUSDAY(STARTOFMONTH(dates))).
  const balance = (which: 'OPENING' | 'CLOSING', period: string) =>
    spec(
      `${which}BALANCE${period.toUpperCase()}`,
      which === 'CLOSING'
        ? `Calculates an expression on the last date of the ${period}: CALCULATE(expression, ENDOF${period.toUpperCase()}(dates), filter).`
        : `Calculates an expression on the day before the ${period} starts: CALCULATE(expression, PREVIOUSDAY(STARTOF${period.toUpperCase()}(dates)), filter).`,
      [p('expression', 'scalar'), dates, p('filter', 'filter', { optional: true }), ...(period === 'year' ? [yearEnd] : [])],
      'scalar',
    );
  // DATEADD and DATESINPERIOD: the options for calendars (Microsoft's calendar-based time intelligence page).
  const extension = p('extension', 'keyword', { optional: true, keywords: ['PRECISE', 'EXTENDED', 'ENDALIGNED'] });
  const truncation = p('truncation', 'keyword', { optional: true, keywords: ['ANCHORED', 'BLANK'] });
  const endBehavior = p('end behavior', 'keyword', { optional: true, keywords: ['PRECISE', 'ENDALIGNED'] });
  const periods = ['week', 'month', 'quarter', 'year'];
  return [
    toDate('DATESYTD', 'year'),
    toDate('DATESQTD', 'quarter'),
    toDate('DATESMTD', 'month'),
    total('TOTALYTD', 'year'),
    total('TOTALQTD', 'quarter'),
    total('TOTALMTD', 'month'),
    // The week functions need a calendar with weeks.
    toDate('DATESWTD', 'week'),
    total('TOTALWTD', 'week'),
    around('PREVIOUSWEEK', 'before', 'week'),
    around('NEXTWEEK', 'after', 'week'),
    spec('SAMEPERIODLASTYEAR', 'The same dates as the current filter, one year earlier.', [dates]),
    spec('DATEADD', 'The dates in the current filter, moved by a number of days, months, quarters or years.', [dates, p('number of intervals', 'scalar'), interval, extension, truncation]),
    spec('PARALLELPERIOD', 'The whole months, quarters or years in the current filter, moved by a number of them.', [dates, p('number of intervals', 'scalar'), interval]),
    spec('DATESBETWEEN', 'The dates from a start date to an end date.', [dates, p('start date', 'scalar'), p('end date', 'scalar')]),
    spec('DATESINPERIOD', 'The dates in a period of a number of days, months, quarters or years, from a start date.', [dates, p('start date', 'scalar'), p('number of intervals', 'scalar'), interval, endBehavior]),
    around('PREVIOUSDAY', 'before', 'day'),
    around('PREVIOUSMONTH', 'before', 'month'),
    around('PREVIOUSQUARTER', 'before', 'quarter'),
    around('PREVIOUSYEAR', 'before', 'year'),
    around('NEXTDAY', 'after', 'day'),
    around('NEXTMONTH', 'after', 'month'),
    around('NEXTQUARTER', 'after', 'quarter'),
    around('NEXTYEAR', 'after', 'year'),
    spec('FIRSTDATE', 'The first date in the current filter.', [dates]),
    spec('LASTDATE', 'The last date in the current filter.', [dates]),
    ...periods.map(startOf),
    ...periods.map(endOf),
    ...periods.flatMap((period) => [balance('OPENING', period), balance('CLOSING', period)]),
  ];
}
