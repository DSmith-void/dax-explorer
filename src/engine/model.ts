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
  return {
    measure: (name) => measures.get(key(name)),
    hasColumn: (table, column) => columns.has(`${key(table)}[${key(column)}]`),
    tablesWithColumn: (column) => tablesByColumn.get(key(column)) ?? [],
    hasTable: (table) => tables.has(key(table)),
  };
}
