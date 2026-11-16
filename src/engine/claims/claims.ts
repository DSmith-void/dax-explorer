/**
 * The claim checker's claims: what a step's explanation says, as questions Power BI can answer at that exact
 * point. Each claim carries a query (the step's situation, with the step's code swapped for the question) and
 * the answer the explanation implies. A script asks Power BI (src/devtools) and reports every disagreement.
 *
 * Kept deliberately conservative: a claim is only made where the explanation is definite. Where the engine
 * itself says "not checked", or where a filter is on a whole table (whose effect on ISFILTERED isn't a rule
 * the engine states), no claim is made rather than a guessed one.
 */
import type { BindResult } from '../binder/binder';
import type { ColumnName, EvalContext, InsightKind, ContextAnalysis } from '../context/model';
import { columnDax, reportFilterColumns, reportFilterStatus, type ReportFilter } from '../context/reportFilters';
import { expandedTables, type RelationshipModel } from '../context/relationships';
import { buildStepQuery, type StepQuery, type StepQueryOptions } from '../context/stepQuery';
import type { TimelineEntry } from '../context/timeline';
import { childrenOf, findNode, type AstNode, type Expr } from '../parser/ast';

export interface Claim {
  /** Stable across runs: the step's position and title, and what is claimed. */
  id: string;
  /** The step, as titled in the app. */
  step: string;
  /** The claim in plain words, e.g. "Product[Category] is filtered here". */
  says: string;
  /** What Power BI should answer: TRUE/FALSE for a question, 'error' when the step should fail. */
  expect: boolean | 'error';
  /** The query to run; null when it needs a picked row that isn't given. */
  query: string | null;
}

const ERROR_KINDS: readonly InsightKind[] = ['dax-error', 'column-without-row-context'];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameColumn = (a: ColumnName, b: ColumnName) => same(a.table, b.table) && same(a.column, b.column);
const columnText = (c: ColumnName) => `${c.table}[${c.column}]`;

function allNodes(node: AstNode): AstNode[] {
  return [node, ...childrenOf(node).flatMap((c) => allNodes(c.node))];
}

/**
 * The model columns written in the expression (Table[Column]), plus those of the report filters. With a binding,
 * a measure written with its table name (Table[Measure], which DAX allows) is left out.
 */
export function candidateColumns(root: Expr | null, reportFilters: readonly ReportFilter[], binding?: BindResult): ColumnName[] {
  const columns: ColumnName[] = [];
  const add = (c: ColumnName) => {
    if (c.table !== '' && !columns.some((x) => sameColumn(x, c))) columns.push(c);
  };
  if (root) {
    for (const n of allNodes(root)) {
      if (n.kind === 'ColumnRef' && binding?.references.get(n.id)?.type !== 'measure') add({ table: n.table, column: n.column });
    }
  }
  for (const f of reportFilters) reportFilterColumns(f).forEach(add);
  return columns;
}

/**
 * Whether the explanation says this column is filtered (directly) in this context: true, false, or null when
 * it doesn't say for certain (a filter on its whole table, a report filter that may or may not be removed).
 */
export function saysFiltered(context: EvalContext, column: ColumnName, reportFilters: readonly ReportFilter[], model: RelationshipModel | null): boolean | null {
  const entries = context.filter.entries;
  // A filter on a whole table also covers the tables it reaches (its expanded table): checked in Power BI Desktop,
  // ALLNOBLANKROW(Sales) as a filter left ISFILTERED('Product'[Category]) TRUE. Without the model, any table filter may.
  // So "not filtered" is uncertain there; "filtered" stays certain.
  if (entries.some((e) => e.target.kind === 'table' && same(e.target.table, column.table))) return null;
  const reaches = entries.some((e) => e.target.kind === 'table' && (!model || expandedTables(model, e.target.table).some((t) => same(t, column.table))));
  if (entries.some((e) => e.target.kind === 'unknown')) return null;
  const inTarget = entries.filter((e) => e.target.kind === 'columns' && e.target.columns.some((c) => sameColumn(c, column)));
  if (inTarget.some((e) => !e.someOfTarget)) return true;
  // A calendar function's dates land on some of its columns, depending on the filters coming in: not claimed.
  if (inTarget.length > 0) return null;
  let result = false;
  for (const f of reportFilters) {
    if (!reportFilterColumns(f).some((c) => sameColumn(c, column))) continue;
    const status = reportFilterStatus(f, context.filter.removals, model);
    if (status === 'maybe-removed') return null;
    if (status === 'applies') result = true;
  }
  return !result && reaches ? null : result;
}

/**
 * Window functions, where the explanation says the current row comes from the filters, and the table is
 * ALL(one column) sorted by that column (or by anything, for RANK and ROWNUMBER). The expected answer is worked
 * out separately, in plain DAX, from what the explanation says:
 *  - RANK and ROWNUMBER give BLANK exactly when the filters leave more than one value of the column;
 *  - OFFSET(n) works from each value left and returns the rows it finds together: one for each value that has a
 *    row n away;
 *  - INDEX(n) picks one row by position, whatever the current row is.
 */
function windowClaims(entry: TimelineEntry, node: AstNode, options: StepQueryOptions, analysis: ContextAnalysis, prefix: string): Claim[] {
  if (node.kind !== 'FunctionCall') return [];
  const name = node.name.toUpperCase();
  if (!['RANK', 'ROWNUMBER', 'OFFSET', 'INDEX'].includes(name)) return [];
  const notes = analysis.steps.get(node.id)?.notes ?? [];
  const fromFilters = notes.some((n) => n.startsWith('The current row comes from the filters') || n.startsWith('It picks by position'));
  if (!fromFilters) return [];
  const text = (n: AstNode) => options.source.slice(n.span.start, n.span.end);
  const isCall = (a: Expr, fn: string) => a.kind === 'FunctionCall' && a.name.toUpperCase() === fn;
  // The table: ALL(one Table[Column]); nothing else written but ORDERBY.
  const relation = node.args.find((a) => isCall(a, 'ALL'));
  const column = relation?.kind === 'FunctionCall' && relation.args.length === 1 && relation.args[0].kind === 'ColumnRef' ? relation.args[0] : null;
  if (!column) return [];
  const orderBy = node.args.find((a) => isCall(a, 'ORDERBY'));
  const others = node.args.filter((a) => a !== relation && a !== orderBy && a !== node.args[0]);
  const c = text(column);
  const ask = (id: string, says: string, condition: string): Claim | null => {
    const q = buildStepQuery({ ...entry, kind: 'function', nodeId: node.id }, { ...options, replace: { nodeId: node.id, dax: `IF(${condition}, 1, 0)` } });
    if (q.kind !== 'scalar' && q.kind !== 'needs-row') return null;
    return { id: `${prefix}|${id}`, step: entry.title, says, expect: true, query: q.kind === 'scalar' ? q.dax : null };
  };
  if (name === 'RANK' || name === 'ROWNUMBER') {
    // RANK's first input may be SKIP/DENSE; nothing else but the table and ORDERBY.
    if (others.some((a) => !(a.kind === 'TableRef' && ['SKIP', 'DENSE'].includes(a.name.toUpperCase())))) return [];
    const claim = ask('window:blank-on-several', `${name} is BLANK exactly when the filters leave more than one value of ${c}`, `ISBLANK(${text(node)}) = (COUNTROWS(VALUES(${c})) > 1)`);
    return claim ? [claim] : [];
  }
  // OFFSET and INDEX: a whole-number position, sorted by the column itself (or by the table's own column).
  const position = node.args[0];
  const n = position?.kind === 'NumberLiteral' ? position.value : position?.kind === 'UnaryOp' && position.operator === '-' && position.operand.kind === 'NumberLiteral' ? -position.operand.value : null;
  if (n === null || !Number.isInteger(n) || others.length > 0) return [];
  if (orderBy && !(orderBy.kind === 'FunctionCall' && orderBy.args.length >= 1 && text(orderBy.args[0]) === c && orderBy.args.slice(1).every((a) => a.kind === 'TableRef' && a.name.toUpperCase() === 'ASC'))) return [];
  const count = `COUNTROWS(${text(node)}) + 0`;
  const claim =
    name === 'OFFSET'
      ? ask(
          'window:rows-from-each',
          `OFFSET works from each value of ${c} the filters leave and returns the rows ${n} away together`,
          `${count} = COUNTROWS(FILTER(VALUES(${c}), VAR p = COUNTROWS(FILTER(ALL(${c}), ${c} <= EARLIER(${c}))) + (${n}) RETURN p >= 1 && p <= COUNTROWS(ALL(${c})))) + 0`,
        )
      : ask('window:one-row', `INDEX picks one row by position, whatever the filters leave`, `${count} = IF(COUNTROWS(VALUES(${c})) > 0 && ABS(${n}) <= COUNTROWS(ALL(${c})) && ${n} <> 0, 1, 0)`);
  return claim ? [claim] : [];
}

/** The claims for one step; `analysis` gives the errors the explanation states. */
export function claimsForStep(
  entry: TimelineEntry,
  options: StepQueryOptions,
  analysis: ContextAnalysis,
  columns: readonly ColumnName[],
  model: RelationshipModel | null,
): Claim[] {
  const { root } = options;
  if (!root || entry.nodeId === null) return [];
  const node = findNode(root, entry.nodeId);
  if (!node) return [];
  const prefix = `${entry.index}:${entry.title}`;
  const claims: Claim[] = [];
  const queryOf = (q: StepQuery) => (q.kind === 'scalar' ? q.dax : null);

  // 1. Errors the explanation states: the step's own value should fail in Power BI.
  const stated = analysis.insights.find((i) => i.nodeId === entry.nodeId && ERROR_KINDS.includes(i.kind));
  if (stated && entry.kind !== 'filter-input') {
    const q = buildStepQuery(entry, options);
    // A table is asked through its row count: COUNTROWS fails when the table does.
    const query = q.kind === 'table' ? q.countDax : queryOf(q);
    if (q.kind === 'scalar' || q.kind === 'needs-row' || q.kind === 'table') {
      claims.push({ id: `${prefix}|error`, step: entry.title, says: `this is an error in DAX (${stated.summary})`, expect: 'error', query });
    }
  }

  // 1b. What a window function's explanation says about its current rows (see windowClaims).
  claims.push(...windowClaims(entry, node, options, analysis, prefix));

  // 2. Which columns are filtered: asked where the step's calculation happens (inside CALCULATE: its first input).
  if (['start', 'enter', 'return', 'result', 'filter-input', 'unknown', 'iterate-done'].includes(entry.kind)) return claims;
  const inside = entry.kind === 'calculate' && entry.innerContext && node.kind === 'FunctionCall' && node.args[0];
  const context = inside ? entry.innerContext! : entry.context;
  const at = inside ? node.args[0] : node;
  if (context.unknownReason || context.filter.caveats.length > 0) return claims;
  for (const column of columns) {
    const filtered = saysFiltered(context, column, options.reportFilters, model);
    if (filtered === null) continue;
    // As 1/0: a step inside a loop is read through MAXX, which can't take TRUE/FALSE.
    const q = buildStepQuery({ ...entry, kind: 'function', nodeId: at.id }, { ...options, replace: { nodeId: at.id, dax: `IF(ISFILTERED(${columnDax(column)}), 1, 0)` } });
    if (q.kind !== 'scalar' && q.kind !== 'needs-row') continue;
    claims.push({
      id: `${prefix}|filtered:${columnText(column)}`,
      step: entry.title,
      says: `${columnText(column)} is ${filtered ? '' : 'not '}filtered ${inside ? 'inside it' : 'here'}`,
      expect: filtered,
      query: queryOf(q),
    });
  }
  return claims;
}
