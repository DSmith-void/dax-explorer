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
export function parametersForCall(spec: FunctionSpec, argumentCount: number): ParamSpec[] | null {
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
