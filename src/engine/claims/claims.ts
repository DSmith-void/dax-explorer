/**
 * The claim checker's claims: what a step's explanation says, as questions Power BI can answer at that exact
 * point. Each claim carries a query (the step's situation, with the step's code swapped for the question) and
 * the answer the explanation implies. A script asks Power BI (src/devtools) and reports every disagreement.
 *
 * Kept deliberately conservative: a claim is only made where the explanation is definite. Where the engine
 * itself says "not checked", or where a filter is on a whole table (whose effect on ISFILTERED isn't a rule
 * the engine states), no claim is made rather than a guessed one.
 */
import type { ColumnName, EvalContext, InsightKind, ContextAnalysis } from '../context/model';
import { columnDax, reportFilterColumns, reportFilterStatus, type ReportFilter } from '../context/reportFilters';
import type { RelationshipModel } from '../context/relationships';
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

/** The model columns written in the expression (Table[Column]), plus those of the report filters. */
export function candidateColumns(root: Expr | null, reportFilters: readonly ReportFilter[]): ColumnName[] {
  const columns: ColumnName[] = [];
  const add = (c: ColumnName) => {
    if (c.table !== '' && !columns.some((x) => sameColumn(x, c))) columns.push(c);
  };
  if (root) for (const n of allNodes(root)) if (n.kind === 'ColumnRef') add({ table: n.table, column: n.column });
  for (const f of reportFilters) reportFilterColumns(f).forEach(add);
  return columns;
}

/**
 * Whether the explanation says this column is filtered (directly) in this context: true, false, or null when
 * it doesn't say for certain (a filter on its whole table, a report filter that may or may not be removed).
 */
export function saysFiltered(context: EvalContext, column: ColumnName, reportFilters: readonly ReportFilter[], model: RelationshipModel | null): boolean | null {
  const entries = context.filter.entries;
  if (entries.some((e) => e.target.kind === 'table' && same(e.target.table, column.table))) return null;
  if (entries.some((e) => e.target.kind === 'unknown')) return null;
  if (entries.some((e) => e.target.kind === 'columns' && e.target.columns.some((c) => sameColumn(c, column)))) return true;
  let result = false;
  for (const f of reportFilters) {
    if (!reportFilterColumns(f).some((c) => sameColumn(c, column))) continue;
    const status = reportFilterStatus(f, context.filter.removals, model);
    if (status === 'maybe-removed') return null;
    if (status === 'applies') result = true;
  }
  return result;
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
