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
import { daxLiteral, reportFilterDax, type FilterValue, type ReportFilter } from './reportFilters';
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
  | { kind: 'scalar'; dax: string }
  /** A table: its first rows (`dax`) and how many rows it has (`countDax`). */
  | { kind: 'table'; dax: string; countDax: string }
  /** An iterator's rows, each with the value its per-row expression has there (column ROW_VALUE_COLUMN). */
  | { kind: 'rows'; dax: string; countDax: string; iteratorName: string }
  /** The value depends on which row of an iterator is meant; the user picks one at that iterator's step. */
  | { kind: 'needs-row'; iteratorNodeId: number; iteratorName: string }
  /** No value to show here (with a plain reason). */
  | { kind: 'none'; reason: string };

export interface StepQueryOptions {
  root: Expr | null;
  binding: BindResult;
  source: string;
  reportFilters: readonly ReportFilter[];
  /** Picked rows, by iterator node id. */
  rows: ReadonlyMap<number, RowChoice>;
}

/** Functions whose result depends on how the visual's query is built, which a CALCULATE can't reproduce. */
const DEPENDS_ON_VISUAL = new Set(['ALLSELECTED', 'ISINSCOPE', 'SELECTEDMEASURE', 'SELECTEDMEASURENAME', 'SELECTEDMEASUREFORMATSTRING', 'ISSELECTEDMEASURE']);

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

  /** Wraps `dax` (the text of `node`, possibly already changed) in everything around `node`, then in F. */
  const inContext = (node: AstNode, dax: string, table: boolean): string => {
    const path = pathTo(root, node.id);
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
      if ((name === 'CALCULATE' || name === 'CALCULATETABLE') && argIndex === 0) {
        const filters = parent.args.slice(1).filter((a) => a.kind !== 'Omitted').map(text);
        if (filters.length > 0) expr = `${table ? 'CALCULATETABLE' : 'CALCULATE'}(\n${expr},\n${filters.join(',\n')}\n)`;
        continue;
      }
      if (call.spec.iteratesArgument !== undefined && call.params[argIndex]?.role === 'rowExpression') {
        const choice = options.rows.get(parent.id);
        if (!choice) throw new NeedsRow(parent.id, call.spec.name);
        if (table) throw new Unsupported(`A table calculated for one row of ${call.spec.name} is not shown yet.`);
        const tableArg = parent.args[call.spec.iteratesArgument];
        expr = pickRow(text(tableArg), choice, expr);
      }
    }
    if (options.reportFilters.length > 0) {
      expr = `${table ? 'CALCULATETABLE' : 'CALCULATE'}(\n${expr},\n${options.reportFilters.map(reportFilterDax).join(',\n')}\n)`;
    }
    return expr;
  };

  const valueOf = (node: AstNode): StepQuery => {
    const table = isTable(node);
    const dax = inContext(node, text(node), table);
    return table ? { kind: 'table', dax, countDax: `COUNTROWS(${dax})` } : { kind: 'scalar', dax };
  };

  try {
    // Values that depend on the visual's layout can't be reproduced with filters alone.
    const used = functionNames(root);
    const blocking = [...used].find((name) => DEPENDS_ON_VISUAL.has(name));
    if (blocking) {
      return { kind: 'none', reason: `This measure uses ${blocking}, whose result depends on how the visual is built; a value here could be wrong, so none is shown.` };
    }

    const node = entry.nodeId === null ? null : findNode(root, entry.nodeId);
    switch (entry.kind) {
      case 'start':
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
    if (e instanceof NeedsRow) return { kind: 'needs-row', iteratorNodeId: e.iteratorNodeId, iteratorName: e.iteratorName };
    if (e instanceof Unsupported) return { kind: 'none', reason: e.message };
    throw e;
  }
}

class NeedsRow extends Error {
  readonly iteratorNodeId: number;
  readonly iteratorName: string;
  constructor(iteratorNodeId: number, iteratorName: string) {
    super('needs a row');
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
