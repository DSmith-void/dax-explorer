/**
 * The DAX that calculates the value at one step of the timeline.
 *
 * Built from the user's own text, not from the symbolic explanation: the step's expression is wrapped
 * in exactly what surrounds it in the measure, from the inside out:
 *  - CALCULATE / CALCULATETABLE around it → the same CALCULATE, with its filter arguments as written;
 *  - VARs in scope → the same VAR definitions, at the same place;
 *  - an iterator going row by row → the row the user picked (found by its column values);
 *  - finally the report filters F → CALCULATE(…, TREATAS(…)).
 * The engine then does all the filtering itself, so the value is what DAX really calculates there.
 * When that can't be reproduced exactly, the result says why instead of guessing.
 */
import type { BindResult } from '../binder/binder';
import { childrenOf, findNode, type AstNode, type Expr } from '../parser/ast';
import type { ColumnName } from './model';
import { columnDax, daxLiteral, reportFilterDax, type FilterValue, type ReportFilter } from './reportFilters';
import type { TimelineEntry } from './timeline';

/** The row of an iterator the user is looking at: its columns (as the engine names them) and values. */
export interface RowChoice {
  columns: string[];
  values: FilterValue[];
}

/** Name of the per-row value column added to an iterator's rows. */
export const ROW_VALUE_COLUMN = '@DaxExplorerValue';

export type StepQuery =
  /** One value. */
  /**
   * One value. With `visual`, `dax` is a one-row table (the visual's own query, filtered to the chosen
   * row) whose last column is the value.
   */
  | { kind: 'scalar'; dax: string; visual?: true }
  /** A table: its first rows (`dax`) and how many rows it has (`countDax`). */
  | { kind: 'table'; dax: string; countDax: string }
  /** An iterator's rows, each with the value its per-row expression has there (column ROW_VALUE_COLUMN). */
  | { kind: 'rows'; dax: string; countDax: string; iteratorName: string }
  /** The value depends on which row of an iterator is meant; the user picks one at that iterator's step. */
  | { kind: 'needs-row'; frameKey: string; iteratorNodeId: number; iteratorName: string }
  /** No value to show here (with a plain reason). */
  | { kind: 'none'; reason: string };

/** A measure that calls the measure being explained (stepped into), with where it calls it. */
export interface CallerFrame {
  /** Identifies the measure's place in the chain of calls (for picked rows). */
  key: string;
  root: Expr;
  binding: BindResult;
  source: string;
  /** The node in the caller that calls the inner measure. */
  callNodeId: number;
}

export interface StepQueryOptions {
  root: Expr | null;
  binding: BindResult;
  source: string;
  reportFilters: readonly ReportFilter[];
  /** Picked rows, by rowKey(frame key, iterator node id). */
  rows: ReadonlyMap<string, RowChoice>;
  /** Calculate this DAX instead of the step's own expression (it is still wrapped in everything around it). */
  replace?: { nodeId: number; dax: string };
  /** This measure's key in the chain of calls; '' for the measure being explained. */
  frameKey?: string;
  /** When stepped into from other measures: the callers, innermost first. */
  callers?: readonly CallerFrame[];
}

/** The key of a picked row: node ids are only unique within one measure. */
export const rowKey = (frameKey: string, iteratorNodeId: number) => `${frameKey}#${iteratorNodeId}`;

/** Functions whose result depends on how the visual's query is built, which a CALCULATE can't reproduce. */
const DEPENDS_ON_VISUAL = new Set(['ALLSELECTED', 'ISINSCOPE', 'SELECTEDMEASURE', 'SELECTEDMEASURENAME', 'SELECTEDMEASUREFORMATSTRING', 'ISSELECTEDMEASURE']);

/** Of those, the ones a rebuilt copy of the visual's query reproduces (the others need calculation groups). */
const VISUAL_REPRODUCES = new Set(['ALLSELECTED', 'ISINSCOPE']);

/** Name of the value column in a rebuilt visual query. */
const VISUAL_VALUE_COLUMN = '@DaxExplorerValue';

/**
 * The visual the report filters came from, when every one of them did ("From a visual"): its own row
 * and column filters (one value each: the chosen row) and its filters from outside (slicers, filter pane).
 */
function visualOf(reportFilters: readonly ReportFilter[]): { row: Extract<ReportFilter, { kind: 'values' }>[]; outside: ReportFilter[] } | null {
  if (reportFilters.some((f) => !f.source)) return null;
  const row = reportFilters.filter((f): f is Extract<ReportFilter, { kind: 'values' }> => f.source === 'visual-row' && f.kind === 'values');
  if (row.length !== reportFilters.filter((f) => f.source === 'visual-row').length) return null;
  return { row, outside: reportFilters.filter((f) => f.source === 'visual-filter') };
}

/**
 * `expr` calculated the way the visual does: inside SUMMARIZECOLUMNS with the visual's row columns and its
 * outside filters, then filtered to the chosen row. ALLSELECTED and ISINSCOPE see exactly what they see
 * in the report. (A row whose value is BLANK isn't returned, which reads as BLANK.)
 */
function visualQuery(visual: NonNullable<ReturnType<typeof visualOf>>, expr: string): string {
  const args = [
    ...visual.row.map((f) => columnDax(f.column)),
    ...visual.outside.map(reportFilterDax),
    `${daxLiteral(VISUAL_VALUE_COLUMN)},\n${expr}`,
  ];
  const summarize = `SUMMARIZECOLUMNS(\n${args.join(',\n')}\n)`;
  if (visual.row.length === 0) return summarize;
  const conditions = visual.row.map((f) => {
    const value = f.values[0] ?? null;
    return value === null ? `ISBLANK(${columnDax(f.column)})` : `${columnDax(f.column)} == ${daxLiteral(value)}`;
  });
  return `FILTER(\n${summarize},\n${conditions.join(' && ')}\n)`;
}

/**
 * An engine column name as DAX: Plant[Plant Name] and [@Value] are used as they are; a table name the
 * engine didn't quote (Product Line[Name]) is quoted. Null when the name isn't a column reference.
 */
export function columnNameDax(name: string): string | null {
  const match = /^(.*?)(\[(?:[^\]]|\]\])+\])$/u.exec(name);
  if (!match) return null;
  const [, table, column] = match;
  if (table === '' || /^'(?:[^']|'')+'$/.test(table) || /^[\p{L}_][\p{L}\p{N}_]*$/u.test(table)) return table + column;
  if (/['[\]]/.test(table)) return null;
  return `'${table}'${column}`;
}

class Unsupported extends Error {}

export function buildStepQuery(entry: TimelineEntry, options: StepQueryOptions): StepQuery {
  const { root, binding, source } = options;
  if (!root) return { kind: 'none', reason: 'There is no expression.' };
  const text = (node: AstNode) => source.slice(node.span.start, node.span.end);
  const spec = (node: AstNode) => (node.kind === 'FunctionCall' ? binding.calls.get(node.id) : undefined);
  const own: CallerFrame = { key: options.frameKey ?? '', root, binding, source, callNodeId: -1 };
  /** Set when the value depends on the visual: steps are then calculated inside the visual's own query. */
  let visualMode: ReturnType<typeof visualOf> = null;
  const callers = options.callers ?? [];

  const isTable = (node: AstNode): boolean => {
    switch (node.kind) {
      case 'FunctionCall':
        return spec(node)?.spec?.returns === 'table';
      case 'TableRef':
      case 'TableConstructor':
        return true;
      case 'VarBlock':
        return isTable(node.body);
      case 'VariableRef': {
        const declaration = findNode(root, node.declarationId);
        return declaration?.kind === 'VarDeclaration' ? isTable(declaration.value) : false;
      }
      default:
        return false;
    }
  };

  /**
   * Wraps `dax` (the text of `node`, possibly already changed) in everything around `node`; then, for each
   * caller, in CALCULATE (a measure reference is exactly CALCULATE of its code) and everything around the
   * call; then in F.
   */
  const inContext = (node: AstNode, dax: string, table: boolean): string => {
    let expr = wrap(own, node.id, dax, table);
    for (const caller of callers) {
      expr = wrap(caller, caller.callNodeId, `${table ? 'CALCULATETABLE' : 'CALCULATE'}(\n${expr}\n)`, table);
    }
    // F: as filters, or (for ALLSELECTED and ISINSCOPE) as the visual's own query, added by valueOf.
    if (options.reportFilters.length > 0 && !visualMode) {
      expr = `${table ? 'CALCULATETABLE' : 'CALCULATE'}(\n${expr},\n${options.reportFilters.map(reportFilterDax).join(',\n')}\n)`;
    }
    return expr;
  };

  /** Wraps `dax` in everything around the node `nodeId` of one measure (its CALCULATEs, VARs and iterator rows). */
  function wrap(frame: CallerFrame, nodeId: number, dax: string, table: boolean): string {
    const text = (node: AstNode) => frame.source.slice(node.span.start, node.span.end);
    const spec = (node: AstNode) => (node.kind === 'FunctionCall' ? frame.binding.calls.get(node.id) : undefined);
    const path = pathTo(frame.root, nodeId);
    if (!path) throw new Unsupported('This part could not be found in the expression.');
    let expr = dax;
    for (let i = path.length - 2; i >= 0; i--) {
      const parent: AstNode = path[i];
      const child: AstNode = path[i + 1];
      if (parent.kind === 'VarBlock') {
        const before = child.kind === 'VarDeclaration' ? parent.declarations.slice(0, parent.declarations.indexOf(child)) : parent.declarations;
        if (before.length > 0) expr = `VAR ${before.map((d) => `${d.name} =\n${text(d.value)}`).join('\nVAR ')}\nRETURN\n${expr}`;
        continue;
      }
      if (parent.kind !== 'FunctionCall') continue;
      const call = spec(parent);
      const name = call?.spec?.name;
      if (!call?.spec || !call.params) throw new Unsupported(`${parent.name} isn't known to the app, so what happens inside it can't be reproduced.`);
      const argIndex = parent.args.indexOf(child as Expr);
      if (name === 'RELATEDTABLE') throw new Unsupported('Values inside RELATEDTABLE are not shown yet.');
      // TOTALYTD(expression, dates, [filter], [year end]) is CALCULATE(expression, DATESYTD(dates[, year end]), filter).
      const total = name ? TOTALS[name] : undefined;
      if (total && argIndex === 0) {
        const [, dates, ...rest] = parent.args;
        const yearEnd = rest.find((a) => a.kind === 'StringLiteral');
        const filter = rest.find((a) => a.kind !== 'StringLiteral' && a.kind !== 'Omitted');
        if (!dates) throw new Unsupported(`${name} has no dates argument.`);
        const datesDax = `${total}(${text(dates)}${yearEnd ? `, ${text(yearEnd)}` : ''})`;
        expr = `${table ? 'CALCULATETABLE' : 'CALCULATE'}(\n${expr},\n${datesDax}${filter ? `,\n${text(filter)}` : ''}\n)`;
        continue;
      }
      if ((name === 'CALCULATE' || name === 'CALCULATETABLE') && argIndex === 0) {
        const filters = parent.args.slice(1).filter((a) => a.kind !== 'Omitted').map(text);
        if (filters.length > 0) expr = `${table ? 'CALCULATETABLE' : 'CALCULATE'}(\n${expr},\n${filters.join(',\n')}\n)`;
        continue;
      }
      if (call.spec.iteratesArgument !== undefined && call.params[argIndex]?.role === 'rowExpression') {
        const choice = options.rows.get(rowKey(frame.key, parent.id));
        if (!choice) throw new NeedsRow(frame.key, parent.id, call.spec.name);
        if (table) throw new Unsupported(`A table calculated for one row of ${call.spec.name} is not shown yet.`);
        const tableArg = parent.args[call.spec.iteratesArgument];
        expr = pickRow(text(tableArg), choice, expr);
      }
    }
    return expr;
  }

  const valueOf = (node: AstNode): StepQuery => {
    if (visualMode) {
      if (isTable(node) && options.replace?.nodeId !== node.id) throw new Unsupported('Tables at steps that depend on the visual are not shown yet.');
      const expr = inContext(node, options.replace?.nodeId === node.id ? options.replace.dax : text(node), false);
      return { kind: 'scalar', dax: visualQuery(visualMode, expr), visual: true };
    }
    if (options.replace?.nodeId === node.id) return { kind: 'scalar', dax: inContext(node, options.replace.dax, false) };
    const table = isTable(node);
    const dax = inContext(node, text(node), table);
    return table ? { kind: 'table', dax, countDax: `COUNTROWS(${dax})` } : { kind: 'scalar', dax };
  };

  try {
    // Values that depend on the visual's layout can't be reproduced with filters alone.
    // Values that depend on the visual (ALLSELECTED, ISINSCOPE) are calculated inside the visual's own
    // query, rebuilt from the report filters, when they all came from a visual.
    for (const frame of [own, ...callers]) {
      const blocking = [...functionNames(frame.root)].filter((name) => DEPENDS_ON_VISUAL.has(name));
      if (blocking.length === 0) continue;
      const who = frame === own ? 'This measure uses' : 'A measure that calls this one uses';
      const cannot = blocking.find((name) => !VISUAL_REPRODUCES.has(name));
      if (cannot) {
        return { kind: 'none', reason: `${who} ${cannot}, which belongs to calculation groups; values here are not shown yet.` };
      }
      const visual = visualOf(options.reportFilters);
      if (!visual) {
        return {
          kind: 'none',
          reason: `${who} ${blocking[0]}, whose result depends on how the visual is built. Take the report filters from a visual (F → From a visual) to see real values here.`,
        };
      }
      visualMode = visual;
    }

    const node = entry.nodeId === null ? null : findNode(root, entry.nodeId);
    switch (entry.kind) {
      case 'start':
      case 'enter':
        return { kind: 'none', reason: '' };
      case 'filter-input':
        return { kind: 'none', reason: 'This is a filter for CALCULATE, not a value.' };
      case 'unknown':
        return { kind: 'none', reason: "The app doesn't know this function yet." };
      case 'variable':
        if (node?.kind !== 'VarDeclaration') return { kind: 'none', reason: '' };
        return valueOf(node.value);
      case 'iterate': {
        if (node?.kind !== 'FunctionCall') return { kind: 'none', reason: '' };
        const call = spec(node);
        if (!call?.spec || call.spec.iteratesArgument === undefined || !call.params) return { kind: 'none', reason: '' };
        const rowArg = node.args.find((_, i) => call.params![i]?.role === 'rowExpression');
        const tableArg = node.args[call.spec.iteratesArgument];
        if (!rowArg || !tableArg) return { kind: 'none', reason: '' };
        if (isTable(rowArg)) return { kind: 'none', reason: `The tables ${call.spec.name} makes for each row are not shown yet.` };
        const rows = inContext(node, `ADDCOLUMNS(\n${text(tableArg)},\n${daxLiteral(ROW_VALUE_COLUMN)},\n${text(rowArg)}\n)`, true);
        const count = inContext(node, `COUNTROWS(${text(tableArg)})`, false);
        return { kind: 'rows', dax: rows, countDax: count, iteratorName: call.spec.name };
      }
      default:
        return node ? valueOf(node) : { kind: 'none', reason: '' };
    }
  } catch (e) {
    if (e instanceof NeedsRow) return { kind: 'needs-row', frameKey: e.frameKey, iteratorNodeId: e.iteratorNodeId, iteratorName: e.iteratorName };
    if (e instanceof Unsupported) return { kind: 'none', reason: e.message };
    throw e;
  }
}

/** TOTALYTD and friends: CALCULATE with the matching DATES…TD filter. */
const TOTALS: Record<string, string | undefined> = { TOTALYTD: 'DATESYTD', TOTALQTD: 'DATESQTD', TOTALMTD: 'DATESMTD' };

/** The first date, last date and number of dates of a date column, separated by "|". */
export function dateRangeProbe(column: ColumnName): string {
  const c = columnDax(column);
  return `FORMAT(MIN(${c}), "yyyy-mm-dd") & "|" & FORMAT(MAX(${c}), "yyyy-mm-dd") & "|" & COUNTROWS(VALUES(${c}))`;
}

/**
 * For a step that changes a date filter (a time-intelligence function in CALCULATE, or TOTALYTD): queries
 * for the dates before it (where the CALCULATE is) and inside it (what its first input sees), plus the
 * whole date range, each as "first|last|count". Null for other steps.
 */
export function dateRangeQueries(
  entry: TimelineEntry,
  options: StepQueryOptions,
): { column: ColumnName; functionName: string; before: StepQuery; after: StepQuery; all: string } | null {
  if (entry.kind !== 'calculate' || entry.nodeId === null || !options.root) return null;
  const dated = entry.operations.find((op) => op.kind === 'add-filter' && op.entry.dates);
  const dates = dated?.kind === 'add-filter' ? dated.entry.dates : undefined;
  const node = findNode(options.root, entry.nodeId);
  if (!dates || node?.kind !== 'FunctionCall' || !node.args[0]) return null;
  const probe = dateRangeProbe(dates.column);
  const at = (nodeId: number): StepQuery =>
    buildStepQuery({ ...entry, kind: 'function', nodeId }, { ...options, replace: { nodeId, dax: probe } });
  const c = columnDax(dates.column);
  return {
    column: dates.column,
    functionName: dates.functionName,
    before: at(node.id),
    after: at(node.args[0].id),
    all: `FORMAT(CALCULATE(MIN(${c}), REMOVEFILTERS()), "yyyy-mm-dd") & "|" & FORMAT(CALCULATE(MAX(${c}), REMOVEFILTERS()), "yyyy-mm-dd")`,
  };
}

class NeedsRow extends Error {
  readonly frameKey: string;
  readonly iteratorNodeId: number;
  readonly iteratorName: string;
  constructor(frameKey: string, iteratorNodeId: number, iteratorName: string) {
    super('needs a row');
    this.frameKey = frameKey;
    this.iteratorNodeId = iteratorNodeId;
    this.iteratorName = iteratorName;
  }
}

/**
 * The value of `expr` on one row of `table`: the row is found by its column values, and a missing
 * row is an error rather than a silent BLANK. Identical rows give identical results, so any match works.
 */
function pickRow(table: string, choice: RowChoice, expr: string): string {
  if (choice.columns.length === 0 || choice.columns.length !== choice.values.length) {
    throw new Unsupported('The picked row has no columns to find it by.');
  }
  const conditions = choice.columns.map((column, i) => {
    const ref = columnNameDax(column);
    if (!ref) throw new Unsupported(`The column ${column} can't be used to find the picked row.`);
    const value = choice.values[i];
    return value === null ? `ISBLANK(${ref})` : `${ref} == ${daxLiteral(value)}`;
  });
  return `VAR __DaxExplorerRow =\nFILTER(\n${table},\n${conditions.join(' && ')}\n)\nRETURN\nIF(\nCOUNTROWS(__DaxExplorerRow) = 0,\nERROR("The picked row is no longer there; pick it again."),\nMAXX(__DaxExplorerRow,\n${expr}\n)\n)`;
}

/** The nodes from the root down to the node with this id, or null. */
function pathTo(root: AstNode, id: number): AstNode[] | null {
  if (root.id === id) return [root];
  for (const child of childrenOf(root)) {
    const rest = pathTo(child.node, id);
    if (rest) return [root, ...rest];
  }
  return null;
}

function functionNames(root: AstNode): Set<string> {
  const names = new Set<string>();
  const visit = (n: AstNode) => {
    if (n.kind === 'FunctionCall') names.add(n.name.toUpperCase());
    for (const child of childrenOf(n)) visit(child.node);
  };
  visit(root);
  return names;
}

/** Engine column names in a rows result that belong to the iterated table (everything but the value column). */
export function rowColumns(columns: readonly string[]): { indexes: number[]; valueIndex: number } {
  const valueIndex = columns.findIndex((c) => c === `[${ROW_VALUE_COLUMN}]` || c.endsWith(`[${ROW_VALUE_COLUMN}]`));
  return { indexes: columns.map((_, i) => i).filter((i) => i !== valueIndex), valueIndex };
}

/**
 * A step's query as a complete DAX query (EVALUATE …), ready to paste into DAX Studio or a DAX query view.
 * Matches what the helper runs, without its row limit.
 */
export function evaluateText(query: Extract<StepQuery, { dax: string }>): string {
  if (query.kind === 'scalar' && query.visual) return `EVALUATE\n${query.dax}`;
  return query.kind === 'scalar' ? `EVALUATE\nROW("value",\n${query.dax}\n)` : `EVALUATE\n${query.dax}`;
}
