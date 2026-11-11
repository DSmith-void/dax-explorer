/**
 * The evaluation timeline: the meaningful moments of a DAX expression, in the LOGICAL order DAX
 * defines (not the physical order the Power BI engine happens to run its queries in, which this
 * app cannot see).
 *
 * The order follows DAX's rules:
 *  - a function's inputs are calculated before the function itself;
 *  - VAR values are calculated where they are written, in order, before RETURN;
 *  - CALCULATE first works out its filter inputs (using the filters from outside), then applies
 *    them (context transition, then removals, then new filters), then calculates its first input;
 *  - an iterator first works out the table it goes through, then calculates its per-row inputs once
 *    for each row, then combines the results.
 *
 * Only moments a learner needs are included: literals, operators and plain column inputs
 * (such as Sales[Amount] in SUM) are skipped. Each moment reuses the analyzer's step for the
 * filters in effect and its wording.
 */
import type { BindResult } from '../binder/binder';
import type { ArgRole, FunctionSpec } from '../catalog/functions';
import { childrenOf, type AstNode, type Expr, type FunctionCall } from '../parser/ast';
import { INITIAL_CONTEXT, type ContextAnalysis, type EvalContext, type Operation } from './model';

export type TimelineKind =
  /** Before anything is calculated: the report's filters. */
  | 'start'
  /** A VAR value has just been calculated. */
  | 'variable'
  /** A variable's stored value is used. */
  | 'variable-use'
  /** A measure is calculated. */
  | 'measure'
  /** A reference that could be a measure or a column. */
  | 'reference'
  /** A column value is read from the current row. */
  | 'column'
  /** A CALCULATE filter input has been worked out (it is applied in the next 'calculate' moment). */
  | 'filter-input'
  /** CALCULATE (or CALCULATETABLE, RELATEDTABLE) applies its filters; its first input sees the result. */
  | 'calculate'
  /** An iterator starts going through its table row by row. */
  | 'iterate'
  /** An iterator has been through every row and combines the results. */
  | 'iterate-done'
  /** Any other function is calculated. */
  | 'function'
  /** A function the app doesn't know: nothing inside it is followed. */
  | 'unknown'
  /** The whole expression's result goes back to the report. */
  | 'result'
  /** A measure called by another measure starts, with the filters its caller passes in (replaces 'start'). */
  | 'enter'
  /** A called measure's value goes back to the measure that called it (replaces 'result'). */
  | 'return';

export interface TimelineEntry {
  /** Position in the timeline, starting at 0. */
  index: number;
  kind: TimelineKind;
  /** The node this moment belongs to (its code is highlighted), or null for the start. */
  nodeId: number | null;
  /** A short label, e.g. "CALCULATE applies its filters". */
  title: string;
  /** One plain sentence: what happens at this moment. */
  summary: string;
  /** The filters and rows in effect at this moment. */
  context: EvalContext;
  /** For CALCULATE, measures and iterators: what the calculation inside sees. */
  innerContext?: EvalContext;
  /** What changes here (CALCULATE, measures and iterators). */
  operations: Operation[];
  /** How deeply nested this moment is (inside CALCULATE, an iterator's rows, or a VAR). */
  depth: number;
}

/** What each iterator does with the results of its rows. */
const COMBINES: Record<string, string> = {
  SUMX: 'adds up the results from every row',
  AVERAGEX: 'averages the results from every row',
  MINX: 'keeps the smallest result',
  MAXX: 'keeps the largest result',
  COUNTX: 'counts the rows whose result is not blank',
  COUNTAX: 'counts the rows whose result is not blank',
  PRODUCTX: 'multiplies the results from every row',
  CONCATENATEX: 'joins the results from every row into one piece of text',
  FILTER: 'keeps only the rows where the condition was true',
  TOPN: 'keeps the top rows, ranked by the results',
  RANKX: 'ranks the current value among the results',
  ADDCOLUMNS: 'adds the results as new columns',
  SELECTCOLUMNS: 'returns the results as a new table',
  GENERATE: 'combines each row with the rows calculated for it',
  SUMMARIZE: 'returns the results as a new table',
};

/** For a measure stepped into from another measure. */
export interface TimelineCaller {
  /** The measure being stepped into, e.g. "[Total Sales]". */
  measure: string;
  /** The measure that calls it, e.g. "[Profit %]". */
  caller: string;
  /** The filters the caller passes in (what the measure's code starts with). */
  context: EvalContext;
}

export function buildTimeline(
  root: Expr | null,
  binding: BindResult,
  analysis: ContextAnalysis,
  source: string,
  caller?: TimelineCaller,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  if (!root) return entries;

  const snippet = (node: AstNode, max = 40): string => {
    const text = source
      .slice(node.span.start, node.span.end)
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
      .trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  const add = (entry: Omit<TimelineEntry, 'index' | 'context' | 'operations'> & { context?: EvalContext; operations?: Operation[] }) => {
    const step = entry.nodeId === null ? undefined : analysis.steps.get(entry.nodeId);
    entries.push({
      ...entry,
      index: entries.length,
      context: entry.context ?? step?.context ?? INITIAL_CONTEXT,
      operations: entry.operations ?? [],
    });
  };

  const stepOf = (node: AstNode) => analysis.steps.get(node.id);
  const specOf = (node: FunctionCall): FunctionSpec | undefined => binding.calls.get(node.id)?.spec;

  if (caller) {
    add({
      kind: 'enter',
      nodeId: null,
      title: `Enter ${caller.measure}`,
      summary: `Now inside ${caller.measure}, called by ${caller.caller}. Its code starts with the filters ${caller.caller} has at that point, including any current row turned into a filter (context transition).`,
      context: caller.context,
      depth: 0,
    });
  } else {
    add({
      kind: 'start',
      nodeId: null,
      title: "Start with the report's filters",
      summary:
        "The calculation starts with the filters from wherever the measure is shown in the report (for example, one row of a table visual, plus any slicers). These are shown as F.",
      depth: 0,
    });
  }

  /**
   * @param inFilterInput inside a CALCULATE filter input: only measures, variables, CALCULATE and
   *   iterators are worth a moment there; the input as a whole gets one 'filter-input' moment.
   */
  function walk(node: AstNode, depth: number, role: ArgRole | null, inFilterInput: boolean): void {
    const step = stepOf(node);
    switch (node.kind) {
      case 'VarBlock': {
        for (const declaration of node.declarations) {
          walk(declaration.value, depth + 1, null, inFilterInput);
          add({
            kind: 'variable',
            nodeId: declaration.id,
            title: `VAR ${declaration.name} is stored`,
            summary: stepOf(declaration)?.summary ?? `${declaration.name} is calculated once, here.`,
            depth,
          });
        }
        walk(node.body, depth, null, inFilterInput);
        return;
      }
      case 'VariableRef':
        add({
          kind: 'variable-use',
          nodeId: node.id,
          title: `Use ${node.name}`,
          summary: step?.summary ?? `Reuses ${node.name}.`,
          depth,
        });
        return;
      case 'BracketRef':
      case 'ColumnRef': {
        if (role === 'column' || role === 'tableOrColumn') return; // the column itself is handed to a function
        const type = binding.references.get(node.id)?.type ?? null;
        if (type === 'measure') {
          add({
            kind: 'measure',
            nodeId: node.id,
            title: `Calculate ${snippet(node, 32)}`,
            summary: step?.summary ?? `${snippet(node)} is calculated.`,
            innerContext: step?.innerContext,
            operations: step?.operations,
            depth,
          });
        } else if (type === 'column') {
          // In a filter condition it is just the value being checked. Without a current row it is an
          // error, which the Problems list explains.
          if (inFilterInput || !step || step.context.rows.length === 0) return;
          add({
            kind: 'column',
            nodeId: node.id,
            title: `Read ${snippet(node, 32)}`,
            summary: step?.summary ?? `Reads ${snippet(node)}.`,
            depth,
          });
        } else {
          add({
            kind: 'reference',
            nodeId: node.id,
            title: `${snippet(node, 32)}: measure or column?`,
            summary: step?.summary ?? `${snippet(node)} could be a measure or a column.`,
            depth,
          });
        }
        return;
      }
      case 'FunctionCall':
        walkCall(node, depth, inFilterInput);
        return;
      case 'Omitted':
      case 'Error':
      case 'NumberLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
      case 'TableRef':
        return;
      default: {
        // Operators, table constructors and the like: only their parts can be worth a moment.
        for (const child of childrenOf(node)) walk(child.node, depth, null, inFilterInput);
      }
    }
  }

  function walkCall(node: FunctionCall, depth: number, inFilterInput: boolean) {
    const step = stepOf(node);
    const call = binding.calls.get(node.id);
    const spec = specOf(node);
    if (!spec || !call?.params) {
      add({ kind: 'unknown', nodeId: node.id, title: `${node.name}: not followed`, summary: step?.summary ?? '', depth });
      return;
    }
    const params = call.params;

    if (spec.name === 'CALCULATE' || spec.name === 'CALCULATETABLE' || spec.name === 'RELATEDTABLE') {
      const [first, ...filterInputs] = node.args;
      if (spec.name !== 'RELATEDTABLE') {
        for (const input of filterInputs) {
          if (input.kind === 'Omitted') continue;
          walk(input, depth + 1, 'filter', true);
          add({
            kind: 'filter-input',
            nodeId: input.id,
            title: `Prepare filter: ${snippet(input, 32)}`,
            summary: stepOf(input)?.summary ?? `${snippet(input)} is worked out, using the filters from outside the ${spec.name}.`,
            depth: depth + 1,
          });
        }
      }
      add({
        kind: 'calculate',
        nodeId: node.id,
        title: `${spec.name} applies its filters`,
        summary: step?.summary ?? `${spec.name} changes the filters.`,
        innerContext: step?.innerContext,
        operations: step?.operations,
        depth,
      });
      if (first) walk(first, depth + 1, spec.returns === 'table' ? 'table' : 'scalar', false);
      return;
    }

    if (spec.iteratesArgument !== undefined) {
      node.args.forEach((arg, i) => {
        if (params[i]?.role !== 'rowExpression') walk(arg, depth + 1, params[i]?.role ?? null, inFilterInput);
      });
      add({
        kind: 'iterate',
        nodeId: node.id,
        title: `${spec.name} goes row by row`,
        // Worded from the row context itself: when the iterator is also a CALCULATE filter input,
        // its step's summary describes that role instead.
        summary: `${spec.name} goes through ${rowTable(step?.operations) ?? 'a table'} one row at a time.`,
        innerContext: step?.innerContext,
        operations: step?.operations,
        depth,
      });
      node.args.forEach((arg, i) => {
        if (params[i]?.role === 'rowExpression') walk(arg, depth + 1, 'rowExpression', false);
      });
      add({
        kind: 'iterate-done',
        nodeId: node.id,
        title: `${spec.name}: after the last row`,
        summary: `After the last row, ${spec.name} ${COMBINES[spec.name] ?? 'finishes going through the rows'}.`,
        depth,
      });
      return;
    }

    node.args.forEach((arg, i) => walk(arg, depth + 1, params[i]?.role ?? null, inFilterInput));
    // Inside a filter input, the input as a whole gets one moment (added by the caller).
    if (inFilterInput) return;
    add({
      kind: 'function',
      nodeId: node.id,
      title: spec.name,
      summary: step?.summary || spec.summary,
      depth,
    });
  }

  walk(root, 0, null, false);

  if (caller) {
    add({
      kind: 'return',
      nodeId: root.id,
      title: `Back in ${caller.caller}`,
      summary: `${caller.measure} is done: its value goes back to ${caller.caller}, which carries on from where it called it.`,
      context: caller.context,
      depth: 0,
    });
    return entries;
  }
  add({
    kind: 'result',
    nodeId: root.id,
    title: 'The result goes back to the report',
    summary: 'The value of the whole expression is returned to the report, for this one place in the visual. The report repeats all of this for every place the measure is shown.',
    context: INITIAL_CONTEXT,
    depth: 0,
  });
  return entries;
}

/** The table an iterator goes through, from its row-context operation. */
function rowTable(operations: Operation[] | undefined): string | null {
  const op = operations?.find((o) => o.kind === 'row-context');
  return op?.kind === 'row-context' ? op.row.table.description : null;
}
