/**
 * Function catalog: what each supported DAX function expects in each argument position.
 *
 * This is deliberately small and curated. A function that is not listed here is
 * still parsed and shown, but nothing is concluded from its arguments.
 *
 * Sources: Microsoft DAX function reference (learn.microsoft.com/dax). Each entry
 * describes argument roles only; evaluation semantics are added in later milestones.
 */

/** What an argument position accepts. */
export type ArgRole =
  /** A scalar expression evaluated in the current context. */
  | 'scalar'
  /** A table expression. */
  | 'table'
  /** Must be a column reference. */
  | 'column'
  /** A table or a column reference (e.g. ALL, VALUES). A bracketed [X] here must be a column. */
  | 'tableOrColumn'
  /** A CALCULATE filter argument: boolean filter, table filter, or modifier (ALL, KEEPFILTERS, ...). */
  | 'filter'
  /** Evaluated once per row of the iterated table, in a row context. */
  | 'rowExpression'
  /** A keyword such as ASC/DESC or BOTH; see `keywords`. */
  | 'keyword';

export interface ParamSpec {
  name: string;
  role: ArgRole;
  optional?: boolean;
  /** The last parameter may repeat any number of times (e.g. the filters of CALCULATE). */
  repeating?: boolean;
  /** Allowed values for role 'keyword'. */
  keywords?: readonly string[];
}

export type FunctionCategory =
  | 'aggregation'
  | 'iterator'
  | 'filter modification'
  | 'table'
  | 'scope and filter inspection'
  | 'relationship'
  | 'logical'
  | 'math';

export interface FunctionSpec {
  name: string;
  category: FunctionCategory;
  returns: 'scalar' | 'table';
  /** One-line description shown in the UI. */
  summary: string;
  /** Alternative parameter lists; the first one whose arity fits is used. */
  overloads: readonly (readonly ParamSpec[])[];
  /**
   * For iterators: index of the table argument whose rows are iterated.
   * Arguments with role 'rowExpression' are evaluated in that row context.
   */
  iteratesArgument?: number;
}

const p = (name: string, role: ArgRole, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, role, ...extra });

const aggregation = (name: string, summary: string): FunctionSpec => ({
  name,
  category: 'aggregation',
  returns: 'scalar',
  summary,
  overloads: [[p('column', 'column')]],
});

const iterator = (name: string, summary: string): FunctionSpec => ({
  name,
  category: 'iterator',
  returns: 'scalar',
  summary,
  overloads: [[p('table', 'table'), p('expression', 'rowExpression')]],
  iteratesArgument: 0,
});

const columnInspection = (name: string, summary: string): FunctionSpec => ({
  name,
  category: 'scope and filter inspection',
  returns: 'scalar',
  summary,
  overloads: [[p('column', 'column')]],
});

const SPECS: FunctionSpec[] = [
  // --- Aggregations over a column ---
  aggregation('SUM', 'Adds up the values of a column in the current filter context.'),
  aggregation('AVERAGE', 'Averages the values of a column in the current filter context.'),
  aggregation('COUNT', 'Counts non-blank numeric/date values in a column.'),
  aggregation('COUNTA', 'Counts non-blank values in a column.'),
  aggregation('COUNTBLANK', 'Counts blank values in a column.'),
  aggregation('DISTINCTCOUNT', 'Counts distinct values in a column.'),
  {
    name: 'MIN',
    category: 'aggregation',
    returns: 'scalar',
    summary: 'Smallest value of a column, or the smaller of two values.',
    overloads: [[p('column', 'column')], [p('value1', 'scalar'), p('value2', 'scalar')]],
  },
  {
    name: 'MAX',
    category: 'aggregation',
    returns: 'scalar',
    summary: 'Largest value of a column, or the larger of two values.',
    overloads: [[p('column', 'column')], [p('value1', 'scalar'), p('value2', 'scalar')]],
  },
  {
    name: 'COUNTROWS',
    category: 'aggregation',
    returns: 'scalar',
    summary: 'Counts the rows of a table in the current filter context.',
    overloads: [[p('table', 'table', { optional: true })]],
  },

  // --- Iterators ---
  iterator('SUMX', 'For each row of a table, evaluates an expression (row context) and adds up the results.'),
  iterator('AVERAGEX', 'For each row of a table, evaluates an expression (row context) and averages the results.'),
  iterator('MINX', 'For each row of a table, evaluates an expression (row context) and returns the smallest result.'),
  iterator('MAXX', 'For each row of a table, evaluates an expression (row context) and returns the largest result.'),
  iterator('COUNTX', 'For each row of a table, evaluates an expression (row context) and counts non-blank results.'),
  {
    name: 'FILTER',
    category: 'iterator',
    returns: 'table',
    summary: 'Returns the rows of a table for which a condition, evaluated per row (row context), is true.',
    overloads: [[p('table', 'table'), p('condition', 'rowExpression')]],
    iteratesArgument: 0,
  },
  {
    name: 'ADDCOLUMNS',
    category: 'iterator',
    returns: 'table',
    summary: 'Adds calculated columns to a table; each expression is evaluated per row (row context).',
    // Further name/expression pairs alternate roles, which this catalog cannot express exactly; they are
    // all marked 'rowExpression'. Harmless: the names are string literals, not references.
    overloads: [[p('table', 'table'), p('name', 'scalar'), p('expression', 'rowExpression'), p('more names and expressions', 'rowExpression', { optional: true, repeating: true })]],
    iteratesArgument: 0,
  },
  {
    name: 'RANKX',
    category: 'iterator',
    returns: 'scalar',
    summary: 'Ranks a value against an expression evaluated for each row of a table.',
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
    summary: 'Evaluates an expression in a modified filter context (and performs context transition).',
    overloads: [[p('expression', 'scalar'), p('filter', 'filter', { optional: true, repeating: true })]],
  },
  {
    name: 'CALCULATETABLE',
    category: 'filter modification',
    returns: 'table',
    summary: 'Evaluates a table expression in a modified filter context (and performs context transition).',
    overloads: [[p('table', 'table'), p('filter', 'filter', { optional: true, repeating: true })]],
  },
  {
    name: 'ALL',
    category: 'filter modification',
    returns: 'table',
    summary: 'Removes filters from a table or columns (as a CALCULATE modifier), or returns all their rows.',
    overloads: [[p('table or column', 'tableOrColumn', { optional: true }), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    name: 'REMOVEFILTERS',
    category: 'filter modification',
    returns: 'table',
    summary: 'Removes filters from a table or columns. Only valid as a CALCULATE modifier.',
    overloads: [[p('table or column', 'tableOrColumn', { optional: true }), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    name: 'ALLEXCEPT',
    category: 'filter modification',
    returns: 'table',
    summary: 'Removes all filters from a table except those on the listed columns.',
    overloads: [[p('table', 'table'), p('column', 'column', { repeating: true })]],
  },
  {
    name: 'ALLSELECTED',
    category: 'filter modification',
    returns: 'table',
    summary: 'Restores the filters that were applied outside the current visual (shadow filter context).',
    overloads: [[p('table or column', 'tableOrColumn', { optional: true }), p('column', 'column', { optional: true, repeating: true })]],
  },
  {
    name: 'KEEPFILTERS',
    category: 'filter modification',
    returns: 'table',
    summary: 'Makes a CALCULATE filter intersect with existing filters instead of replacing them.',
    overloads: [[p('filter', 'filter')]],
  },

  // --- Table functions ---
  {
    name: 'VALUES',
    category: 'table',
    returns: 'table',
    summary: 'Distinct values of a column (or rows of a table) visible in the current filter context.',
    overloads: [[p('table or column', 'tableOrColumn')]],
  },
  {
    name: 'DISTINCT',
    category: 'table',
    returns: 'table',
    summary: 'Distinct values of a column (or rows of a table) in the current filter context.',
    overloads: [[p('table or column', 'tableOrColumn')]],
  },

  // --- Scope and filter inspection ---
  {
    name: 'SELECTEDVALUE',
    category: 'scope and filter inspection',
    returns: 'scalar',
    summary: 'The value of a column when exactly one value is visible, otherwise the alternate result (BLANK by default).',
    overloads: [[p('column', 'column'), p('alternate result', 'scalar', { optional: true })]],
  },
  columnInspection('HASONEVALUE', 'TRUE when exactly one distinct value of the column is visible in the filter context.'),
  columnInspection('HASONEFILTER', 'TRUE when the column is directly filtered to exactly one value.'),
  columnInspection('ISINSCOPE', 'TRUE when the column is a grouping level of the current visual cell.'),
  {
    name: 'ISFILTERED',
    category: 'scope and filter inspection',
    returns: 'scalar',
    summary: 'TRUE when the table or column is directly filtered.',
    overloads: [[p('table or column', 'tableOrColumn')]],
  },
  {
    name: 'ISCROSSFILTERED',
    category: 'scope and filter inspection',
    returns: 'scalar',
    summary: 'TRUE when the table or column is filtered directly or through relationships.',
    overloads: [[p('table or column', 'tableOrColumn')]],
  },

  // --- Relationships ---
  {
    name: 'RELATED',
    category: 'relationship',
    returns: 'scalar',
    summary: 'In a row context, returns a column value from the related "one" side table.',
    overloads: [[p('column', 'column')]],
  },
  {
    name: 'USERELATIONSHIP',
    category: 'relationship',
    returns: 'table',
    summary: 'Activates an inactive relationship for this CALCULATE.',
    overloads: [[p('column 1', 'column'), p('column 2', 'column')]],
  },
  {
    name: 'CROSSFILTER',
    category: 'relationship',
    returns: 'table',
    summary: 'Changes the filter direction of a relationship for this CALCULATE.',
    overloads: [[p('column 1', 'column'), p('column 2', 'column'), p('direction', 'keyword', { keywords: ['NONE', 'ONEWAY', 'BOTH', 'ONEWAY_LEFTFILTERSRIGHT', 'ONEWAY_RIGHTFILTERSLEFT'] })]],
  },

  // --- Logical and math ---
  {
    name: 'IF',
    category: 'logical',
    returns: 'scalar',
    summary: 'Returns one value when a condition is TRUE and another (BLANK by default) when it is FALSE.',
    overloads: [[p('condition', 'scalar'), p('value if true', 'scalar'), p('value if false', 'scalar', { optional: true })]],
  },
  {
    name: 'COALESCE',
    category: 'logical',
    returns: 'scalar',
    summary: 'Returns the first argument that is not BLANK.',
    overloads: [[p('value', 'scalar'), p('value', 'scalar', { repeating: true })]],
  },
  {
    name: 'DIVIDE',
    category: 'math',
    returns: 'scalar',
    summary: 'Divides, returning the alternate result (BLANK by default) instead of an error when dividing by zero.',
    overloads: [[p('numerator', 'scalar'), p('denominator', 'scalar'), p('alternate result', 'scalar', { optional: true })]],
  },
  { name: 'BLANK', category: 'logical', returns: 'scalar', summary: 'Returns BLANK.', overloads: [[]] },
  { name: 'TRUE', category: 'logical', returns: 'scalar', summary: 'Returns TRUE.', overloads: [[]] },
  { name: 'FALSE', category: 'logical', returns: 'scalar', summary: 'Returns FALSE.', overloads: [[]] },
];

const BY_NAME: ReadonlyMap<string, FunctionSpec> = new Map(SPECS.map((spec) => [spec.name, spec]));

/** All catalog entries (for documentation and tests). */
export const FUNCTION_CATALOG: readonly FunctionSpec[] = SPECS;

/** Case-insensitive lookup. Returns undefined for functions not in the catalog. */
export function lookupFunction(name: string): FunctionSpec | undefined {
  return BY_NAME.get(name.toUpperCase());
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
    const result: ParamSpec[] = [];
    for (let i = 0; i < argumentCount; i++) {
      result.push(i < params.length ? params[i] : params[params.length - 1]);
    }
    return result;
  }
  return null;
}
