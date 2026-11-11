/**
 * Relationships between tables, and how filters travel along them.
 *
 * DAX rules used here (no guessing beyond them):
 *  - A filter flows along an ACTIVE relationship from the "one" side to the "many" side
 *    (Product → Sales), and also back when the relationship filters in both directions.
 *    One-to-one relationships always filter both ways.
 *  - Inactive relationships don't carry filters (USERELATIONSHIP can switch one on; see Part B).
 *  - Many-to-many relationships filtering in one direction are not followed: which side filters
 *    which isn't in the metadata the app reads, so it says so instead.
 *  - A table's "expanded table" is the table plus every table it looks up through many-to-one
 *    (and one-to-one) active relationships, repeatedly. Removing filters from a whole table
 *    (ALL(Sales), REMOVEFILTERS(Sales)) removes them from its expanded table too.
 */
import type { ColumnName, EvalContext } from './model';

export interface Relationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  /** True when the "from" side is a many side. */
  fromMany: boolean;
  /** True when the "to" side is a many side. */
  toMany: boolean;
  active: boolean;
  bothDirections: boolean;
}

export interface RelationshipModel {
  tables: readonly string[];
  relationships: readonly Relationship[];
  /** Where it comes from: the connected report, or the built-in example model. */
  source: 'report' | 'example';
}

const key = (name: string) => name.toLowerCase();
const same = (a: string, b: string) => key(a) === key(b);

/** The helper's relationship fields ("Many"/"One", "OneDirection"/"BothDirections"/"Automatic") → Relationship. */
export function relationshipFromInfo(info: {
  fromTable: string;
  fromColumn: string;
  fromCardinality: string;
  toTable: string;
  toColumn: string;
  toCardinality: string;
  isActive: boolean;
  crossFilteringBehavior: string;
}): Relationship {
  return {
    fromTable: info.fromTable,
    fromColumn: info.fromColumn,
    toTable: info.toTable,
    toColumn: info.toColumn,
    fromMany: info.fromCardinality.toLowerCase() !== 'one',
    toMany: info.toCardinality.toLowerCase() === 'many',
    active: info.isActive,
    bothDirections: info.crossFilteringBehavior.toLowerCase() === 'bothdirections',
  };
}

/** The table on the other end of a relationship, or null when `table` isn't on it. */
export function otherEnd(r: Relationship, table: string): string | null {
  if (same(r.fromTable, table)) return r.toTable;
  if (same(r.toTable, table)) return r.fromTable;
  return null;
}

export type Flow =
  /** A filter on `table` reaches the other end. */
  | { kind: 'flows'; to: string }
  /** It doesn't (wrong direction, or inactive). */
  | { kind: 'blocked' }
  /** The app can't tell (many-to-many in one direction). */
  | { kind: 'unknown' };

/** Whether a filter on `table` travels through relationship `r` (only active relationships carry filters). */
export function flowFrom(r: Relationship, table: string): Flow {
  const to = otherEnd(r, table);
  if (to === null || !r.active) return { kind: 'blocked' };
  if (r.bothDirections || (!r.fromMany && !r.toMany)) return { kind: 'flows', to };
  if (r.fromMany && r.toMany) return { kind: 'unknown' };
  // One-to-many: from the one side to the many side.
  const fromIsOne = !r.fromMany;
  const tableIsFrom = same(r.fromTable, table);
  return tableIsFrom === fromIsOne ? { kind: 'flows', to } : { kind: 'blocked' };
}

/** The tables in `table`'s expanded table (itself first), following active many-to-one and one-to-one relationships. */
export function expandedTables(model: RelationshipModel, table: string): string[] {
  return expandedPaths(model, table).map((p) => p.table);
}

/** Each table in `table`'s expanded table, with the relationships that lead to it from `table`. */
export function expandedPaths(model: RelationshipModel, table: string): { table: string; path: Relationship[] }[] {
  const result = [{ table, path: [] as Relationship[] }];
  for (let i = 0; i < result.length; i++) {
    for (const r of model.relationships) {
      if (!r.active) continue;
      let next: string | null = null;
      if (same(r.fromTable, result[i].table) && !r.toMany) next = r.toTable; // looks up the one side
      else if (same(r.toTable, result[i].table) && !r.fromMany && !r.toMany) next = r.fromTable; // one-to-one
      if (next && !result.some((t) => same(t.table, next))) result.push({ table: next, path: [...result[i].path, r] });
    }
  }
  return result;
}

/** True when a removal of filters from `removedTable` also covers `table` (it is in the expanded table). */
export function expandedCovers(model: RelationshipModel, removedTable: string, table: string): boolean {
  return expandedTables(model, removedTable).some((t) => same(t, table));
}

export type TableState =
  /** A filter is on this table's own columns. */
  | 'filtered'
  /** Filtered through relationships, from a filtered table. */
  | 'reached'
  | 'not-reached';

export interface TableReach {
  table: string;
  state: TableState;
  /** The filters on this table's own columns, as text. */
  filters: string[];
  /** For 'reached': the relationships the filter came through, from the filtered table to this one. */
  path: Relationship[];
  /** For 'reached': the filtered table it started from. */
  source: string | null;
  /**
   * For 'reached': true when it is reached because a filter is on the WHOLE source table, which filters
   * that table's expanded table: the tables it looks up are limited to the rows that have matching rows
   * (against the usual direction of the relationships).
   */
  expanded: boolean;
  /** Filters removed from this table here (any report filter on these goes): column names, or "all". */
  removed: string[];
}

export interface FilterReach {
  tables: TableReach[];
  /** Relationships a filter travels through at this point. */
  flowing: Relationship[];
  /** Of those, the ones it travels against their usual direction (a filter on a whole table, to the tables it looks up). */
  against: Relationship[];
  /** Filters whose table can't be told (shown as a note). */
  unknown: string[];
  /** Relationships whose direction isn't checked. */
  unchecked: Relationship[];
}

/**
 * Which tables the filters at this point reach. The filters are the report's filters (the concrete F,
 * those still in effect) plus the filters the expression added.
 */
export function filterReach(
  context: EvalContext,
  reportFilters: readonly { columns: readonly ColumnName[]; text: string; applies: boolean }[],
  model: RelationshipModel,
): FilterReach {
  const reach = new Map<string, TableReach>();
  const tableName = (name: string) => model.tables.find((t) => same(t, name)) ?? name;
  for (const t of model.tables) reach.set(key(t), { table: t, state: 'not-reached', filters: [], path: [], source: null, removed: [], expanded: false });
  const unknown: string[] = [];
  const seed = (table: string, text: string) => {
    if (table === '') {
      unknown.push(text);
      return;
    }
    const k = key(table);
    const entry = reach.get(k) ?? { table: tableName(table), state: 'not-reached' as TableState, filters: [], path: [], source: null, removed: [] as string[], expanded: false };
    entry.state = 'filtered';
    entry.path = [];
    entry.source = null;
    if (!entry.filters.includes(text)) entry.filters.push(text);
    reach.set(k, entry);
  };

  for (const f of reportFilters) {
    if (!f.applies) continue;
    for (const column of f.columns) seed(column.table, f.text);
  }
  if (!context.unknownReason) {
    // What is removed: a column; a whole table, with the tables it looks up; or everything.
    const markRemoved = (table: string, what: string) => {
      const t = reach.get(key(table));
      if (t && !t.removed.includes(what)) t.removed.push(what);
    };
    // A column that gets a new filter at the same time was replaced (overwritten), not just removed.
    const replaced = (table: string, column: string) =>
      context.filter.entries.some((e) => (e.target.kind === 'columns' && e.target.columns.some((c) => same(c.table, table) && same(c.column, column))) || (e.target.kind === 'table' && same(e.target.table, table)));
    for (const removal of context.filter.removals) {
      if (removal.kind === 'all') for (const t of reach.values()) markRemoved(t.table, 'all');
      else if (removal.kind === 'column') {
        if (!replaced(removal.column.table, removal.column.column)) markRemoved(removal.column.table, removal.column.column);
      } else if (context.filter.entries.some((e) => e.target.kind === 'table' && same(e.target.table, removal.table))) continue;
      else for (const t of expandedTables(model, removal.table)) markRemoved(t, removal.except.length > 0 && same(t, removal.table) ? `all but ${removal.except.map((c) => c.column).join(', ')}` : 'all');
    }
    for (const entry of context.filter.entries) {
      const text = `${entry.target.kind === 'columns' ? entry.target.columns.map((c) => `${c.table}[${c.column}]`).join(', ') : entry.target.kind === 'table' ? entry.target.table : entry.target.description} ${entry.condition}`;
      if (entry.target.kind === 'columns') for (const c of entry.target.columns) seed(c.table, text);
      else if (entry.target.kind === 'table') seed(entry.target.table, text);
      else unknown.push(text);
    }
  }

  // A filter on a whole table filters its expanded table: the tables it looks up keep only matching rows.
  const flowing = new Set<Relationship>();
  const against = new Set<Relationship>();
  if (!context.unknownReason) {
    for (const entry of context.filter.entries) {
      if (entry.target.kind !== 'table') continue;
      for (const { table, path } of expandedPaths(model, entry.target.table).slice(1)) {
        for (const r of path) {
          flowing.add(r);
          against.add(r);
        }
        const target = reach.get(key(table));
        if (!target || target.state !== 'not-reached') continue;
        target.state = 'reached';
        target.path = path;
        target.source = tableName(entry.target.table);
        target.expanded = true;
      }
    }
  }

  // Breadth-first from every filtered table: the first path found is a shortest one.
  const unchecked = new Set<Relationship>();
  const queue = [...reach.values()].filter((r) => r.state !== 'not-reached').map((r) => r.table);
  for (let i = 0; i < queue.length; i++) {
    const table = queue[i];
    const from = reach.get(key(table))!;
    for (const r of model.relationships) {
      const flow = flowFrom(r, table);
      if (flow.kind === 'unknown') unchecked.add(r);
      if (flow.kind !== 'flows') continue;
      flowing.add(r);
      const target = reach.get(key(flow.to));
      if (!target || target.state !== 'not-reached') continue;
      target.state = 'reached';
      target.path = [...from.path, r];
      target.source = from.source ?? from.table;
      queue.push(target.table);
    }
  }
  return { tables: [...reach.values()], flowing: [...flowing], against: [...against], unknown, unchecked: [...unchecked] };
}

/** "Product → Sales (through Sales[Product Key] → Product[Product Key])" for a reached table. */
export function pathText(reach: TableReach): string {
  if (reach.state !== 'reached' || !reach.source) return '';
  const steps = [reach.source];
  let at = reach.source;
  for (const r of reach.path) {
    at = otherEnd(r, at) ?? at;
    steps.push(at);
  }
  const through = reach.path.map((r) => `${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]`).join(', then ');
  if (reach.expanded) {
    return `${steps.join(' → ')} (the filter is on the whole ${reach.source} table, which also covers the tables it looks up: only ${reach.table} rows with matching ${reach.source} rows are kept, through ${through})`;
  }
  return `${steps.join(' → ')} (through ${through})`;
}
