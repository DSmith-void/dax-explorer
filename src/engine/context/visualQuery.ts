/**
 * Reads the DAX query a Power BI visual sends to the engine (Performance analyzer → Copy query):
 * which columns it groups by, which filters it applies (slicers, page and report filters,
 * cross-highlighting) and which measures it shows.
 *
 * Only the parts needed to reproduce one place in the visual are read. Anything else is reported in
 * `notes`, never guessed.
 */
import { tokenize } from '../lexer/lexer';
import type { Token } from '../lexer/tokens';
import { childrenOf, type AstNode, type Expr, type FunctionCall } from '../parser/ast';
import { parse } from '../parser/parser';
import type { ColumnName } from './model';
import { columnDax, daxLiteral, type FilterValue, type ReportFilter } from './reportFilters';

export interface VisualMeasure {
  /** The name the visual gives the value (e.g. "Total_Sales"). */
  label: string;
  /** The DAX the visual uses for it, usually a measure reference such as 'Sales'[Total Sales]. */
  dax: string;
  /** The measure's name when the DAX is just a measure reference. */
  measureName: string | null;
}

export interface VisualQuery {
  /** Columns the visual groups by (its rows and columns). Empty for a card. */
  groupBy: ColumnName[];
  /** The filters the visual applies. */
  filters: ReportFilter[];
  measures: VisualMeasure[];
  /** Things in the query that were not used, in plain words. */
  notes: string[];
}

export type VisualQueryResult = { ok: true; visual: VisualQuery } | { ok: false; error: string };

const BOUNDARY = new Set(['DEFINE', 'VAR', 'MEASURE', 'TABLE', 'COLUMN', 'FUNCTION', 'EVALUATE', 'ORDER', 'START']);

interface Segment {
  kind: 'var' | 'measure' | 'evaluate' | 'other';
  name: string;
  tokens: Token[];
}

/** Splits a query into its DEFINE items and EVALUATE statements (at the outer level only). */
function segments(tokens: readonly Token[]): Segment[] {
  const result: Segment[] = [];
  let current: Segment | null = null;
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === 'EndOfInput') break;
    if (token.kind === 'Comment') continue;
    const word = token.kind === 'Identifier' || token.kind === 'Keyword' ? token.text.toUpperCase() : null;
    if (depth === 0 && word && BOUNDARY.has(word)) {
      if (word === 'DEFINE') {
        current = null;
        continue;
      }
      if (word === 'VAR' && tokens[i + 1]?.kind === 'Identifier' && tokens[i + 2]?.text === '=') {
        current = { kind: 'var', name: tokens[i + 1].text, tokens: [] };
        i += 2;
      } else if (word === 'MEASURE') {
        // MEASURE 'Table'[Name] = expression
        let j = i + 1;
        while (j < tokens.length && tokens[j].text !== '=' && tokens[j].kind !== 'EndOfInput') j++;
        const nameToken = tokens.slice(i + 1, j).find((t) => t.kind === 'BracketedName');
        current = { kind: 'measure', name: nameToken?.kind === 'BracketedName' ? nameToken.value : '', tokens: [] };
        i = j;
      } else if (word === 'EVALUATE') {
        current = { kind: 'evaluate', name: '', tokens: [] };
      } else {
        current = { kind: 'other', name: word, tokens: [] };
      }
      result.push(current);
      continue;
    }
    if (token.text === '(' || token.text === '{') depth++;
    if (token.text === ')' || token.text === '}') depth = Math.max(0, depth - 1);
    current?.tokens.push(token);
  }
  return result;
}

function parseTokens(tokens: Token[], source: string): { expr: Expr; text: string } | null {
  if (tokens.length === 0) return null;
  const end = tokens[tokens.length - 1].span.end;
  const { root, diagnostics } = parse([...tokens, { kind: 'EndOfInput', text: '', span: { start: end, end } }]);
  if (!root || diagnostics.length > 0) return null;
  return { expr: root, text: source.slice(tokens[0].span.start, end) };
}

const isCall = (node: AstNode, ...names: string[]): node is FunctionCall =>
  node.kind === 'FunctionCall' && names.includes(node.name.toUpperCase());

function columnOf(node: AstNode): ColumnName | null {
  return node.kind === 'ColumnRef' ? { table: node.table, column: node.column } : null;
}

function columnsIn(node: AstNode): ColumnName[] {
  const found: ColumnName[] = [];
  const visit = (n: AstNode) => {
    const column = columnOf(n);
    if (column) {
      if (!found.some((c) => c.table.toLowerCase() === column.table.toLowerCase() && c.column.toLowerCase() === column.column.toLowerCase())) {
        found.push(column);
      }
      return;
    }
    for (const child of childrenOf(n)) visit(child.node);
  };
  visit(node);
  return found;
}

/** A literal value, or undefined when the node isn't one. */
function literalOf(node: AstNode): FilterValue | undefined {
  switch (node.kind) {
    case 'StringLiteral':
      return node.value;
    case 'NumberLiteral':
      return node.value;
    case 'BooleanLiteral':
      return node.value;
    case 'UnaryOp':
      if (node.operator === '-' && node.operand.kind === 'NumberLiteral') return -node.operand.value;
      return undefined;
    case 'FunctionCall': {
      const name = node.name.toUpperCase();
      if (name === 'BLANK' && node.args.length === 0) return null;
      if ((name === 'TRUE' || name === 'FALSE') && node.args.length === 0) return name === 'TRUE';
      if (name === 'DATE' && node.args.length === 3 && node.args.every((a) => a.kind === 'NumberLiteral')) {
        const [y, m, d] = node.args.map((a) => (a.kind === 'NumberLiteral' ? a.value : 0));
        return { date: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** TREATAS({literals}, 'T'[C]) on one column becomes a plain "column is one of these values" filter. */
function valuesFilter(node: AstNode): ReportFilter | null {
  if (!isCall(node, 'TREATAS') || node.args.length !== 2) return null;
  const [list, target] = node.args;
  const column = columnOf(target);
  if (!column || list.kind !== 'TableConstructor') return null;
  const values: FilterValue[] = [];
  for (const row of list.items) {
    const value = literalOf(row.kind === 'Tuple' && row.items.length === 1 ? row.items[0] : row);
    if (value === undefined) return null;
    values.push(value);
  }
  return { kind: 'values', column, values };
}

/** Reads a visual's query. */
export function readVisualQuery(source: string): VisualQueryResult {
  const { tokens } = tokenize(source, 0);
  const parts = segments(tokens);
  const evaluate = parts.find((p) => p.kind === 'evaluate');
  if (!evaluate) {
    return { ok: false, error: "This doesn't look like a visual's query: it has no EVALUATE. In Performance analyzer, use “Copy query” on the visual." };
  }

  const vars = new Map<string, { expr: Expr; text: string }>();
  const notes: string[] = [];
  for (const part of parts) {
    if (part.kind === 'var') {
      const parsed = parseTokens(part.tokens, source);
      if (parsed) vars.set(part.name.toLowerCase(), parsed);
      else notes.push(`The part named ${part.name} couldn't be read, so it isn't used.`);
    } else if (part.kind === 'measure') {
      notes.push(`The query defines its own measure [${part.name}] (for example a visual calculation); it isn't explained here.`);
    }
  }
  const main = parseTokens(evaluate.tokens, source);
  if (!main) return { ok: false, error: "The EVALUATE part of this query couldn't be read." };

  // Find SUMMARIZECOLUMNS, following references to the query's VARs, and remember CALCULATETABLE filters around it.
  const seen = new Set<string>();
  const find = (node: AstNode, around: Expr[]): { call: FunctionCall; around: Expr[] } | null => {
    if (node.kind === 'FunctionCall' && node.name.toUpperCase() === 'SUMMARIZECOLUMNS') return { call: node, around };
    if (node.kind === 'TableRef') {
      const key = node.name.toLowerCase();
      const target = vars.get(key);
      if (!target || seen.has(key)) return null;
      seen.add(key);
      return find(target.expr, around);
    }
    if (node.kind === 'FunctionCall' && node.name.toUpperCase() === 'CALCULATETABLE' && node.args.length > 0) {
      return find(node.args[0], [...around, ...node.args.slice(1)]);
    }
    for (const child of childrenOf(node)) {
      const found = find(child.node, around);
      if (found) return found;
    }
    return null;
  };
  const found = find(main.expr, []);
  if (!found) {
    return { ok: false, error: "No SUMMARIZECOLUMNS found: this doesn't look like the query of a table, matrix, chart or card visual." };
  }

  const groupBy: ColumnName[] = [];
  const filters: ReportFilter[] = [];
  const measures: VisualMeasure[] = [];
  const addGroupBy = (column: ColumnName) => {
    if (!groupBy.some((c) => c.table === column.table && c.column === column.column)) groupBy.push(column);
  };
  const textOf = (node: AstNode) => {
    // Inside the main statement, or inside a VAR's text.
    const owner = [main, ...vars.values()].find((v) => node.span.start >= v.expr.span.start && node.span.end <= v.expr.span.end);
    return owner ? source.slice(node.span.start, node.span.end) : '';
  };
  const addFilter = (node: Expr) => {
    let target: AstNode = node;
    let dax = textOf(node);
    if (node.kind === 'TableRef' && vars.has(node.name.toLowerCase())) {
      const v = vars.get(node.name.toLowerCase())!;
      target = v.expr;
      dax = v.text;
    }
    if (isCall(target, 'NONVISUAL') && target.args.length === 1) {
      target = target.args[0];
      dax = textOf(target);
    }
    // A filter that refers to other parts of the query can't be used on its own.
    const refersToVars = (n: AstNode): boolean =>
      (n.kind === 'TableRef' && vars.has(n.name.toLowerCase())) || childrenOf(n).some((c) => refersToVars(c.node));
    if (refersToVars(target)) {
      notes.push(`A filter that depends on other parts of the query wasn't used: ${dax.replace(/\s+/g, ' ').slice(0, 80)}`);
      return;
    }
    const columns = columnsIn(target);
    const simple = valuesFilter(target);
    if (simple) filters.push(simple);
    else filters.push({ kind: 'table', columns, dax, description: describeFilter(dax, columns) });
  };

  const args = found.call.args;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const column = columnOf(arg);
    if (column) {
      addGroupBy(column);
    } else if (arg.kind === 'StringLiteral') {
      const expr = args[i + 1];
      if (expr) {
        const inner = isCall(expr, 'IGNORE') && expr.args.length === 1 ? expr.args[0] : expr;
        measures.push({
          label: arg.value,
          dax: textOf(inner),
          measureName: inner.kind === 'ColumnRef' ? inner.column : inner.kind === 'BracketRef' ? inner.name : null,
        });
      }
      i++;
    } else if (isCall(arg, 'ROLLUPADDISSUBTOTAL', 'ROLLUPGROUP')) {
      for (const c of columnsIn(arg)) addGroupBy(c);
    } else if (arg.kind !== 'Omitted') {
      addFilter(arg);
    }
  }
  for (const extra of found.around) addFilter(extra);

  return { ok: true, visual: { groupBy, filters, measures, notes } };
}

function describeFilter(dax: string, columns: ColumnName[]): string {
  const names = columns.map((c) => `${c.table}[${c.column}]`).join(', ');
  const short = dax.replace(/\s+/g, ' ').trim();
  return names ? `Filter on ${names}: ${short.length > 90 ? `${short.slice(0, 89)}…` : short}` : short;
}

/**
 * A table expression listing the visual's rows: its group-by columns and measures, under its filters,
 * sorted by the group-by columns. At most `top` rows.
 */
export function visualRowsDax(visual: VisualQuery, top: number): string {
  const parts = [
    ...visual.groupBy.map(columnDax),
    ...visual.filters.map((f) => (f.kind === 'values' ? `TREATAS({${f.values.map(daxLiteral).join(', ')}}, ${columnDax(f.column)})` : f.dax)),
    ...visual.measures.map((m) => `${daxLiteral(m.label)}, ${m.dax}`),
  ];
  const summarize = `SUMMARIZECOLUMNS(\n    ${parts.join(',\n    ')}\n)`;
  if (visual.groupBy.length === 0) return summarize;
  return `TOPN(${top}, ${summarize}, ${visual.groupBy.map((c) => `${columnDax(c)}, ASC`).join(', ')})`;
}
