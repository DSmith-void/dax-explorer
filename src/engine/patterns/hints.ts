/**
 * Pattern checks ("hints"): common mistakes, slow patterns, and things DAX does silently.
 *
 * Every hint is found from the code and from what the context analysis already knows (filters, rows,
 * relationships). Nothing is guessed: a hint that depends on the data model is only given when the model
 * is known, and a suggested rewrite says when it is not exactly the same.
 */
import type { BindResult } from '../binder/binder';
import type { ColumnName, ContextAnalysis, Operation, Step } from '../context/model';
import { columnDax, reportFilterColumns, reportFilterStatus, reportFilterText, type ReportFilter } from '../context/reportFilters';
import { expandedTables, type RelationshipModel } from '../context/relationships';
import { childrenOf, findNode, type AstNode, type Expr, type FunctionCall } from '../parser/ast';

/**
 * warning: probably not what was meant; check it. cost: slower than it needs to be. note: worth knowing,
 * can be fine. silent: DAX does this without it being written.
 */
export type HintKind = 'warning' | 'cost' | 'note' | 'silent';

export const HINT_KIND_LABEL: Record<HintKind, string> = {
  warning: 'Check this',
  cost: 'Slow',
  note: 'Worth knowing',
  silent: 'Done silently',
};

export interface Hint {
  /** Which check found it (stable; tests assert on it). */
  check: string;
  kind: HintKind;
  /** The code it is about. */
  nodeId: number;
  /** One short sentence: what it is. */
  title: string;
  /** One short line: why it matters (shown with the title). */
  short: string;
  /** The code it is about, as written (shown once, on one line). */
  code?: string;
  /** The full explanation, in plain words (jargon in brackets): shown on request. */
  why: string;
  /** A rewrite, with what to keep in mind about it. */
  suggestion?: { dax: string; note: string };
}

export interface HintInput {
  root: Expr | null;
  binding: BindResult | null;
  analysis: ContextAnalysis | null;
  source: string;
  /** The report filters F, when given (typed in or taken from a visual). */
  reportFilters?: readonly ReportFilter[];
  /** The relationships between tables, when known. */
  model?: RelationshipModel | null;
}

const ORDER: HintKind[] = ['warning', 'cost', 'note', 'silent'];
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameColumn = (a: ColumnName, b: ColumnName) => same(a.table, b.table) && same(a.column, b.column);
const columnText = (c: ColumnName) => `${c.table}[${c.column}]`;

/** Words for the badge's breakdown, by kind. */
const BADGE_WORDS: Record<HintKind, string> = { warning: 'to check', cost: 'slow', note: 'worth knowing', silent: 'done silently' };

/**
 * The Hints tab's badge: every hint counts; the colour is the most important kind present (check this,
 * then slow, then worth knowing, then done silently), and the breakdown is for the hover text.
 */
export function hintBadge(hints: readonly Hint[]): { count: number; kind: HintKind; breakdown: string } | null {
  if (hints.length === 0) return null;
  const kind = ORDER.find((k) => hints.some((h) => h.kind === k))!;
  const breakdown = ORDER.filter((k) => hints.some((h) => h.kind === k))
    .map((k) => `${hints.filter((h) => h.kind === k).length} ${BADGE_WORDS[k]}`)
    .join(', ');
  return { count: hints.length, kind, breakdown };
}

export function findHints(input: HintInput): Hint[] {
  const { root, binding, analysis, source } = input;
  if (!root) return [];
  const text = (node: AstNode) => source.slice(node.span.start, node.span.end);
  const nodes = allNodes(root);
  const calls = nodes.filter((n): n is FunctionCall => n.kind === 'FunctionCall');
  const named = (call: FunctionCall, ...names: string[]) => names.includes(call.name.toUpperCase());
  const isMeasure = (node: AstNode) => (node.kind === 'BracketRef' || node.kind === 'ColumnRef') && binding?.references.get(node.id)?.type === 'measure';
  const hints: Hint[] = [];

  // --- 1. FILTER over a whole table, used as a CALCULATE filter.
  for (const call of calls.filter((c) => named(c, 'CALCULATE', 'CALCULATETABLE'))) {
    for (const arg of call.args.slice(1)) {
      const filter = unwrap(arg, 'KEEPFILTERS');
      if (filter.kind !== 'FunctionCall' || !named(filter, 'FILTER') || filter.args.length !== 2) continue;
      const [table, condition] = filter.args;
      if (table.kind !== 'TableRef') continue;
      const inside = allNodes(condition);
      if (inside.some(isMeasure)) continue; // a measure per row: check 2 is about that
      const columns = inside.filter((n) => n.kind === 'ColumnRef');
      if (columns.length === 0 || inside.some((n) => n.kind === 'BracketRef')) continue;
      if (!columns.every((c) => c.kind === 'ColumnRef' && same(c.table, table.name))) continue;
      hints.push({
        check: 'filter-whole-table',
        short: `Checks every row of ${table.name}; a filter on the column is faster.`,
        kind: 'cost',
        nodeId: filter.id,
        title: `FILTER over the whole ${table.name} table`,
        code: text(filter),
        why:
          `${text(filter)} is checked row by row over the whole ${table.name} table, and the result filters the whole table, ` +
          `including the tables ${table.name} is related to (its expanded table). A filter on the column itself is faster ` +
          `and only touches that column.`,
        suggestion: {
          dax: `KEEPFILTERS(${text(condition)})`,
          note:
            `Usually gives the same result (KEEPFILTERS keeps the filters already there, as FILTER does). It can differ ` +
            `when the same ${call.name.toUpperCase()} also removes filters from a related table (for example ALL or ` +
            `REMOVEFILTERS on a table ${table.name} is related to): FILTER(${table.name}, …) keeps only the rows that were ` +
            `visible before, which brings those filters back.`,
        },
      });
    }
  }

  // --- 2. A measure inside an iterator over a whole fact table (context transition on every row).
  const transitions = analysis ? operationsOf(analysis, 'context-transition') : [];
  const perRowMeasure = new Set<number>();
  if (input.model) {
    for (const call of calls) {
      const spec = binding?.calls.get(call.id)?.spec;
      if (spec?.iteratesArgument === undefined) continue;
      const table = call.args[spec.iteratesArgument];
      if (table?.kind !== 'TableRef' || !isFactTable(input.model, table.name)) continue;
      const measures = transitions.filter((t) => t.op.rows.some((r) => r.nodeId === call.id) && t.op.rows[t.op.rows.length - 1].nodeId === call.id);
      if (measures.length === 0) continue;
      const first = findNode(root, measures[0].nodeId);
      measures.forEach((m) => perRowMeasure.add(m.nodeId));
      hints.push({
        check: 'measure-over-table',
        short: `One calculation per row of ${table.name}: slow, and identical rows count twice.`,
        kind: 'cost',
        nodeId: call.id,
        title: `${first ? text(first) : 'A measure'} runs once per row of ${table.name}`,
        code: text(call),
        why:
          `${call.name.toUpperCase()} goes through every row of ${table.name}, and for each row the measure turns that ` +
          `row into filters (context transition). On a large table that is slow. It can also be wrong: if ${table.name} ` +
          `has two identical rows, each of them is filtered to both, so they are counted twice each.`,
        suggestion: {
          dax: `${call.name.toUpperCase()}(VALUES(<a column that identifies a row>), …)`,
          note:
            `Go through a column instead (for example VALUES of a key column), or use the columns of ${table.name} ` +
            `directly instead of a measure.`,
        },
      });
    }
  }

  // --- 3. Turning BLANK into 0 in the measure's result.
  for (const result of resultExpressions(root)) {
    const zero = blankToZero(result);
    if (!zero) continue;
    hints.push({
      check: 'blank-to-zero',
      short: 'Visuals then show a row for every combination, even with no data.',
      kind: 'cost',
      nodeId: result.id,
      title: `${zero} turns BLANK into 0`,
      code: text(result),
      why:
        `Power BI leaves out rows whose measures are all BLANK. With a 0 instead, a visual shows a row for every ` +
        `combination of its fields (every product for every day, say), even where there is no data: slower, and ` +
        `harder to read.`,
      suggestion: {
        dax: '(leave the result BLANK)',
        note: `If a 0 is needed, show it in that one visual (for example "Show items with no data", or a separate measure for it).`,
      },
    });
  }

  // --- 4. "/" where the divisor can be 0 or BLANK.
  for (const node of nodes) {
    if (node.kind !== 'BinaryOp' || node.operator !== '/') continue;
    if (isNonZeroNumber(node.right)) continue;
    if (insideCall(root, node.id, ['DIVIDE', 'IFERROR', 'IF'])) continue;
    hints.push({
      check: 'divide-operator',
      short: 'DIVIDE gives BLANK instead.',
      kind: 'note',
      nodeId: node.id,
      title: `Dividing with "/" can give infinity (∞)`,
      code: text(node),
      why: `When ${text(node.right)} is 0 or BLANK, "/" returns infinity (∞), or NaN when both sides are 0, and a visual shows that. DIVIDE returns BLANK instead.`,
      suggestion: {
        dax: `DIVIDE(${text(node.left)}, ${text(node.right)})`,
        note: `"/" is fine, and a little faster, when ${text(node.right)} can never be 0 or BLANK.`,
      },
    });
  }

  // --- 5. IFERROR / ISERROR.
  for (const call of calls.filter((c) => named(c, 'IFERROR', 'ISERROR'))) {
    const [value, alternate] = call.args;
    const division = value?.kind === 'BinaryOp' && value.operator === '/' ? value : null;
    hints.push({
      check: 'iferror',
      short: 'Catching errors is slow and hides real problems.',
      kind: 'cost',
      nodeId: call.id,
      title: `${call.name.toUpperCase()} catches errors after they happen`,
      code: text(call),
      why: `Catching errors is slow (the engine can't work on many rows at once), and it hides real problems too. Avoid the error instead.`,
      suggestion: division
        ? {
            dax: `DIVIDE(${text(division.left)}, ${text(division.right)}${alternate && !isBlankCall(alternate) ? `, ${text(alternate)}` : ''})`,
            note: `DIVIDE handles 0 and BLANK without an error.`,
          }
        : undefined,
    });
  }

  // --- 6. The variable trap (found by the context analysis).
  for (const insight of analysis?.insights ?? []) {
    if (insight.kind !== 'variable-fixed') continue;
    hints.push({ check: 'variable-fixed', kind: 'warning', nodeId: insight.nodeId, title: insight.summary, short: 'A variable keeps the value it got where it was stored.', why: insight.message });
  }

  // --- 7. A CALCULATE filter replaces the report's filter on the same column.
  if (analysis) {
    for (const { op, step } of operationsOf(analysis, 'add-filter')) {
      const entry = op.entry;
      if (entry.origin.kind !== 'calculate' || entry.mode !== 'replace' || entry.dates || entry.treatAsFrom) continue;
      const arg = findNode(root, op.nodeId);
      if (!arg || !replacesOnPurpose(arg)) continue;
      const columns = entry.target.kind === 'columns' ? entry.target.columns.filter((c) => c.table !== '') : [];
      const table = entry.target.kind === 'table' ? entry.target.table : null;
      if (columns.length === 0 && !table) continue;
      const on = (f: ReportFilter) => reportFilterColumns(f).some((c) => (table ? same(c.table, table) : columns.some((t) => sameColumn(t, c))));
      // The report filters still there when this filter is applied: CALCULATE removes filters (ALL, …) first.
      const removals = [...step.context.filter.removals, ...step.operations.flatMap((o) => (o.kind === 'remove-filters' ? [o.removal] : []))];
      const replaced = (input.reportFilters ?? []).filter((f) => on(f) && reportFilterStatus(f, removals, input.model) === 'applies');
      const what = table ? `the ${table} table` : columns.map(columnText).join(', ');
      const shortWhat = table ? `the ${table} table` : [...new Set(columns.map((c) => c.column))].join(', ');
      const others = table ? '' : ` Filters on other columns${columns.length === 1 ? ` of ${columns[0].table}` : ''} still apply.`;
      const keep = { dax: `KEEPFILTERS(${text(arg)})`, note: `Keeps the report's filter and adds this one on top: only rows that pass both are included.` };
      // How DAX reads a condition on columns: FILTER(ALL(the columns), the condition). Not needed for FILTER(ALL(…)), which is already that.
      const readsAs =
        columns.length > 0 && !(arg.kind === 'FunctionCall' && arg.name.toUpperCase() === 'FILTER')
          ? ` (DAX reads it as FILTER(ALL(${columns.map(columnDax).join(', ')}), ${oneLine(text(arg))}).)`
          : '';
      if (replaced.length > 0) {
        hints.push({
          check: 'replaces-report-filter',
          short: 'So that report filter has no effect inside this CALCULATE.',
          kind: 'warning',
          nodeId: arg.id,
          title: `Replaces your filter ${replaced.map(reportFilterText).join(', ')}`,
          code: text(arg),
          why: `DAX first removes any filter on ${what}, then applies this one, so ${replaced.map(reportFilterText).join(', ')} from the report has no effect here.${others}${readsAs}`,
          suggestion: keep,
        });
      } else {
        hints.push({
          check: 'replaces-filter',
          short: 'A slicer or report filter on these columns is ignored here.',
          kind: 'silent',
          nodeId: arg.id,
          title: `Replaces any filter on ${shortWhat}`,
          code: text(arg),
          why: `DAX first removes any filter on ${what}, then applies this one.${others}${readsAs}`,
          suggestion: keep,
        });
      }
    }
  }

  // --- 7b. A filter on a column that is sorted by another column: the sort-by column's filter stays.
  if (analysis && input.model?.sortBy?.length) {
    for (const { op, step } of operationsOf(analysis, 'add-filter')) {
      const entry = op.entry;
      if (entry.origin.kind !== 'calculate' || entry.mode !== 'replace' || entry.target.kind !== 'columns') continue;
      const arg = findNode(root, op.nodeId);
      if (!arg) continue;
      // Filters and removals in the same CALCULATE that already take care of the sort-by column.
      const handled = (by: ColumnName) =>
        step.operations.some(
          (o) =>
            (o.kind === 'remove-filters' &&
              ((o.removal.kind === 'all') ||
                (o.removal.kind === 'table' && same(o.removal.table, by.table)) ||
                (o.removal.kind === 'column' && sameColumn(o.removal.column, by)))) ||
            (o.kind === 'add-filter' && o.entry.target.kind === 'columns' && o.entry.target.columns.some((c) => sameColumn(c, by))) ||
            (o.kind === 'add-filter' && o.entry.target.kind === 'table' && same(o.entry.target.table, by.table)),
        );
      for (const column of entry.target.columns) {
        const sort = input.model.sortBy.find((s) => sameColumn(s.column, column));
        if (!sort || handled(sort.by)) continue;
        hints.push({
          check: 'sort-by-column',
          short: `In a visual by ${sort.column.column}, only the matching row keeps a value.`,
          kind: 'warning',
          nodeId: arg.id,
          title: `Leaves the ${sort.by.column} filter in place`,
          code: text(arg),
          why:
            `In Power BI, ${columnText(sort.column)} is sorted by ${columnText(sort.by)}, so a visual that shows ` +
            `${sort.column.column} also groups by ${sort.by.column}, and filters both. ${text(arg)} replaces the filter on ` +
            `${sort.column.column} only; the one on ${sort.by.column} stays. In a visual by ${sort.column.column}, only the ` +
            `row that matches both keeps a value; the others are BLANK.`,
          suggestion: {
            dax: `REMOVEFILTERS(${columnDax(sort.by)})`,
            note: `Add it as another filter of the same CALCULATE, so the filter on ${sort.by.column} goes too.`,
          },
        });
      }
    }
  }

  // --- 8. Context transition (found by the context analysis), unless check 2 already covers it.
  for (const insight of analysis?.insights ?? []) {
    if (insight.kind !== 'context-transition' || perRowMeasure.has(insight.nodeId)) continue;
    hints.push({ check: 'context-transition', kind: 'silent', nodeId: insight.nodeId, title: insight.summary, short: "The current row becomes a filter, so only that row's data counts.", why: insight.message });
  }

  // --- 9. A filter on a whole table also filters the tables it is related to (its expanded table).
  if (analysis && input.model) {
    for (const { op } of operationsOf(analysis, 'add-filter')) {
      if (op.entry.target.kind !== 'table' || op.entry.origin.kind !== 'calculate') continue;
      const table = op.entry.target.table;
      const reached = expandedTables(input.model, table).slice(1);
      if (reached.length === 0) continue;
      const arg = findNode(root, op.nodeId);
      hints.push({
        check: 'expanded-table',
        short: `Related tables are filtered to the rows ${table} still refers to.`,
        kind: 'silent',
        nodeId: op.nodeId,
        title: `Filtering ${table} also filters ${listText(reached)}`,
        code: arg ? text(arg) : undefined,
        why:
          `${arg ? text(arg) : 'This filter'} filters ${table} as a whole table. A whole table includes the tables it ` +
          `looks up through relationships (its expanded table: ${listText(reached)}), so those are filtered too, to the ` +
          `rows ${table} still refers to. The map in the Filters box shows it.`,
      });
    }
  }

  // --- 10. Filters removed automatically from a date table.
  if (analysis) {
    for (const { op } of operationsOf(analysis, 'remove-filters')) {
      if (!op.because) continue;
      const table = op.removal.kind === 'table' ? op.removal.table : 'the table';
      const arg = findNode(root, op.nodeId);
      hints.push({
        check: 'date-table-filters-removed',
        short: `So filters on its month or year columns don't get in the way.`,
        kind: 'silent',
        nodeId: op.nodeId,
        title: `Other filters on ${table} are removed automatically`,
        code: arg ? text(arg) : undefined,
        why:
          `${arg ? text(arg) : 'This filter'} filters a date column, and ${op.because}. In that case DAX also removes ` +
          `every other filter on ${table} (as if REMOVEFILTERS(${table}) were written), so filters on its month or year ` +
          `columns don't get in the way.`,
      });
    }
  }

  // --- 11. ALLSELECTED depends on the visual.
  for (const call of calls.filter((c) => named(c, 'ALLSELECTED'))) {
    hints.push({
      check: 'allselected',
      short: 'The same measure can give different results in different visuals.',
      kind: 'silent',
      nodeId: call.id,
      title: 'Depends on the visual it is in',
      code: text(call),
      why:
        `ALLSELECTED removes the visual's own rows and columns but keeps the filters from outside it (slicers, the ` +
        `filter pane). So the same measure can give different results in different visuals.`,
    });
  }

  // --- 12. A calendar moves single days by their place in it, not by date (checked in Power BI Desktop:
  //     SAMEPERIODLASTYEAR and DATEADD by YEAR or MONTH, with and without a Month unit in the calendar).
  if (analysis) {
    for (const { op } of operationsOf(analysis, 'add-filter')) {
      const dates = op.entry.dates;
      if (!dates?.calendar) continue;
      const call = findNode(root, op.nodeId);
      const interval = call?.kind === 'FunctionCall' && call.args[2] ? text(call.args[2]).toUpperCase() : '';
      const isDateAdd = dates.functionName === 'DATEADD';
      if (dates.functionName !== 'SAMEPERIODLASTYEAR' && !(isDateAdd && (interval === 'YEAR' || interval === 'MONTH'))) continue;
      const classic = dates.column ? `${dates.functionName}(${columnDax(dates.column)}${isDateAdd && call?.kind === 'FunctionCall' ? `, ${call.args.slice(1).map(text).join(', ')}` : ''})` : null;
      hints.push({
        check: 'calendar-shift',
        short: 'Whole months shift as expected; single days can land a day off.',
        kind: 'note',
        nodeId: op.nodeId,
        title: 'Moves days by their place in the calendar, not by date',
        code: call ? text(call) : undefined,
        why:
          `With a calendar ('${dates.calendar}'), ${dates.functionName} moves what is selected by its position in the calendar. ` +
          `Whole months and years shift as you would expect. But single days move by their place in the year: across a ` +
          `leap year, 15 March 2025 becomes 14 March 2024, and 1–31 March 2025 becomes 29 February – 30 March 2024.` +
          (isDateAdd && interval === 'MONTH' ? ` By MONTH, a day the other month doesn't have (31 December back to November) gives no dates at all.` : '') +
          (classic ? ` With the date column instead, ${classic} keeps the dates: 15 March stays 15 March.` : ''),
      });
    }
  }

  return hints.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || position(root, a.nodeId) - position(root, b.nodeId));
}

// ------------------------------------------------------------------ helpers

function allNodes(root: AstNode): AstNode[] {
  const out: AstNode[] = [];
  const walk = (node: AstNode) => {
    out.push(node);
    for (const child of childrenOf(node)) walk(child.node);
  };
  walk(root);
  return out;
}

function position(root: Expr, nodeId: number): number {
  return findNode(root, nodeId)?.span.start ?? 0;
}

function unwrap(node: Expr, name: string): Expr {
  return node.kind === 'FunctionCall' && node.name.toUpperCase() === name && node.args.length === 1 ? node.args[0] : node;
}

type OperationOf<K extends Operation['kind']> = Extract<Operation, { kind: K }>;

/** Every operation of one kind, with the step (and so the context before it) it belongs to. */
function operationsOf<K extends Operation['kind']>(analysis: ContextAnalysis, kind: K) {
  const out: { op: OperationOf<K>; nodeId: number; step: Step }[] = [];
  for (const step of analysis.steps.values()) {
    for (const op of step.operations) if (op.kind === kind) out.push({ op: op as OperationOf<K>, nodeId: step.nodeId, step });
  }
  return out;
}

/** A table on the many side of a relationship and on the one side of none: a fact table, like Sales. */
function isFactTable(model: RelationshipModel, table: string): boolean {
  const rels = model.relationships;
  const many = rels.some((r) => (same(r.fromTable, table) && r.fromMany) || (same(r.toTable, table) && r.toMany));
  const one = rels.some((r) => (same(r.fromTable, table) && !r.fromMany) || (same(r.toTable, table) && !r.toMany));
  return many && !one;
}

/** The expressions whose value is the measure's result: through VAR … RETURN and returned variables. */
function resultExpressions(root: Expr): Expr[] {
  const out: Expr[] = [];
  let node: Expr | null = root;
  const seen = new Set<number>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    out.push(node);
    if (node.kind === 'VarBlock') node = node.body;
    else if (node.kind === 'VariableRef') {
      const declaration = findNode(root, node.declarationId);
      node = declaration?.kind === 'VarDeclaration' ? declaration.value : null;
    } else node = null;
  }
  return out.filter((n) => n.kind !== 'VarBlock' && n.kind !== 'VariableRef');
}

const isZero = (node: Expr) => node.kind === 'NumberLiteral' && node.value === 0;

/** The way BLANK is turned into 0 ("+ 0", COALESCE(…, 0), IF(ISBLANK(…), 0, …)), or null. */
function blankToZero(node: Expr): string | null {
  if (node.kind === 'BinaryOp' && node.operator === '+' && (isZero(node.left) || isZero(node.right))) return 'Adding 0';
  if (node.kind !== 'FunctionCall') return null;
  const name = node.name.toUpperCase();
  if (name === 'COALESCE' && node.args.length >= 2 && isZero(node.args[node.args.length - 1])) return 'COALESCE(…, 0)';
  if (name === 'IF' && node.args.length >= 2) {
    const [test, then, otherwise] = node.args;
    const blankTest = test.kind === 'FunctionCall' && test.name.toUpperCase() === 'ISBLANK';
    if (blankTest && (isZero(then) || (otherwise && isZero(otherwise)))) return 'IF(ISBLANK(…), 0, …)';
  }
  return null;
}

function isNonZeroNumber(node: Expr): boolean {
  if (node.kind === 'NumberLiteral') return node.value !== 0;
  if (node.kind === 'UnaryOp' && (node.operator === '-' || node.operator === '+')) return isNonZeroNumber(node.operand);
  return false;
}

function isBlankCall(node: Expr): boolean {
  return node.kind === 'FunctionCall' && node.name.toUpperCase() === 'BLANK' && node.args.length === 0;
}

/** True when `nodeId` sits inside a call to one of these functions (the division is then probably guarded). */
function insideCall(root: Expr, nodeId: number, names: string[]): boolean {
  const path: AstNode[] = [];
  const walk = (node: AstNode): boolean => {
    if (node.id === nodeId) return true;
    path.push(node);
    for (const child of childrenOf(node)) if (walk(child.node)) return true;
    path.pop();
    return false;
  };
  walk(root);
  return path.some((n) => n.kind === 'FunctionCall' && names.includes(n.name.toUpperCase()));
}

/**
 * Filters that replace what was there on purpose: a condition on a column ('Product'[Color] = "Blue"), or
 * FILTER over ALL(…). FILTER over a table as it is (FILTER(Sales, …)) keeps only rows already visible, so
 * replacing changes nothing there.
 */
function replacesOnPurpose(arg: AstNode): boolean {
  if (arg.kind === 'BinaryOp' || arg.kind === 'UnaryOp') return true;
  if (arg.kind !== 'FunctionCall') return false;
  const name = arg.name.toUpperCase();
  if (['NOT', 'AND', 'OR', 'CONTAINSROW'].includes(name)) return true;
  if (name === 'FILTER') {
    const table = arg.args[0];
    return table?.kind === 'FunctionCall' && ['ALL', 'ALLNOBLANKROW', 'REMOVEFILTERS'].includes(table.name.toUpperCase());
  }
  return false;
}

/** Code on one line (spaces collapsed). */
function oneLine(code: string): string {
  return code.replace(/\s+/g, ' ').trim();
}

function listText(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
