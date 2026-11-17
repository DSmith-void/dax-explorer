import type { FunctionSpec } from './catalog/spec';
import { readUserFunction, userFunctionSpec } from './userFunctions';

/**
 * What the engine knows about a connected semantic model (tables, columns, measures).
 *
 * Independent of where it came from (Power BI Desktop today; maybe model files later),
 * so the engine never depends on the helper or the UI.
 */
export interface ModelSnapshot {
  tables: readonly string[];
  columns: readonly { table: string; name: string }[];
  measures: readonly { table: string; name: string; expression: string }[];
  /** Calendar names (calendar-based time intelligence); time-intelligence functions accept them like tables. */
  calendars?: readonly string[];
  /** The model's own functions (DAX's FUNCTION), with their code. */
  functions?: readonly { name: string; expression: string; description?: string | null }[];
}

export interface ModelMeasure {
  table: string;
  name: string;
  expression: string;
}

/** Fast, case-insensitive lookups (DAX names are case-insensitive). */
export interface ModelIndex {
  measure(name: string): ModelMeasure | undefined;
  hasColumn(table: string, column: string): boolean;
  /** Tables that have a column with this name. */
  tablesWithColumn(column: string): string[];
  hasTable(table: string): boolean;
  hasCalendar(name: string): boolean;
  /** A function defined in the model, as a catalog entry; undefined when there is none, or its inputs can't be read. */
  userFunction(name: string): FunctionSpec | undefined;
}

const key = (name: string) => name.toLowerCase();

export function createModelIndex(snapshot: ModelSnapshot): ModelIndex {
  const measures = new Map(snapshot.measures.map((m) => [key(m.name), m]));
  const columns = new Set(snapshot.columns.map((c) => `${key(c.table)}[${key(c.name)}]`));
  const tablesByColumn = new Map<string, string[]>();
  for (const c of snapshot.columns) {
    const list = tablesByColumn.get(key(c.name)) ?? [];
    list.push(c.table);
    tablesByColumn.set(key(c.name), list);
  }
  const tables = new Set(snapshot.tables.map(key));
  const calendars = new Set((snapshot.calendars ?? []).map(key));
  const functions = new Map((snapshot.functions ?? []).map((f) => [key(f.name), f]));
  const specs = new Map<string, FunctionSpec | undefined>();
  return {
    userFunction: (name) => {
      const k = key(name);
      if (!specs.has(k)) {
        const fn = functions.get(k);
        specs.set(k, fn ? userFunctionSpec(readUserFunction(fn.name, fn.expression, fn.description ?? null)) : undefined);
      }
      return specs.get(k);
    },
    hasCalendar: (name) => calendars.has(key(name)),
    measure: (name) => measures.get(key(name)),
    hasColumn: (table, column) => columns.has(`${key(table)}[${key(column)}]`),
    tablesWithColumn: (column) => tablesByColumn.get(key(column)) ?? [],
    hasTable: (table) => tables.has(key(table)),
  };
}
