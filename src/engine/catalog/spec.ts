/**
 * The shape of a catalog entry: what a DAX function expects in each argument position.
 * Shared by the curated entries (functions.ts) and the plain-function list (plainFunctions.ts).
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
  /**
   * Trailing parameters marked `repeating` form a group that may repeat any number of times,
   * e.g. the filters of CALCULATE (group of 1) or TOPN's "order by, ASC/DESC" pairs (group of 2).
   */
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
  | 'lookup'
  | 'time intelligence'
  | 'date and time'
  | 'logical'
  | 'information'
  | 'math'
  | 'statistical'
  | 'financial'
  | 'parent and child'
  | 'text'
  | 'other';

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

export const p = (name: string, role: ArgRole, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, role, ...extra });

/**
 * A parameter list written like dax.guide's syntax, so entries stay short and easy to check against it:
 *   "number, [digits]"                    → [digits] is optional
 *   "col column"                          → must be a column reference
 *   "table holidays", "row expression"    → a table; evaluated per row of the iterated table
 *   "kw:ASC/DESC order"                   → a keyword from the list
 *   "value, value*"                       → value* repeats (with the parameters after it, as one group)
 */
export function params(signature: string): ParamSpec[] {
  if (signature.trim() === '') return [];
  return signature.split(',').map((raw) => {
    let text = raw.trim();
    const optional = text.startsWith('[') && text.endsWith(']');
    if (optional) text = text.slice(1, -1).trim();
    const repeating = text.endsWith('*');
    if (repeating) text = text.slice(0, -1).trim();
    let role: ArgRole = 'scalar';
    let keywords: string[] | undefined;
    const prefix = /^(col|table|row|kw:([A-Z0-9_/]+))\s+/.exec(text);
    if (prefix) {
      text = text.slice(prefix[0].length);
      if (prefix[1] === 'col') role = 'column';
      else if (prefix[1] === 'table') role = 'table';
      else if (prefix[1] === 'row') role = 'rowExpression';
      else {
        role = 'keyword';
        keywords = prefix[2].split('/');
      }
    }
    return p(text, role, { ...(optional ? { optional } : {}), ...(repeating ? { repeating } : {}), ...(keywords ? { keywords } : {}) });
  });
}
