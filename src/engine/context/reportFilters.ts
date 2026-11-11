/**
 * Report filters: a concrete stand-in for "F", the filters coming from the report.
 *
 * Symbolically, F is unknown. To calculate real values, the user chooses a place in the report:
 * filters typed in by hand, or the filters of a visual (from its query). This module holds that
 * choice as structured data, turns it into DAX, and works out which of these filters a step removes.
 */
import { columnText } from './describe';
import type { ColumnName, Removal } from './model';
import { expandedCovers, type RelationshipModel } from './relationships';

/** A value a column can be filtered to. `null` is BLANK; dates are ISO strings ("2024-01-31" or "2024-01-31T08:00:00"). */
export type FilterValue = string | number | boolean | null | { date: string };

export type ReportFilter =
  /** The column is limited to these values (one value: "= value"). */
  | { kind: 'values'; column: ColumnName; values: FilterValue[]; source?: ReportFilterSource }
  /**
   * A filter table taken as-is from a visual's query (for example a "Top 5" or a date range).
   * `dax` is a table expression; `columns` are the columns it filters.
   */
  | { kind: 'table'; columns: ColumnName[]; dax: string; description: string; source?: ReportFilterSource };

/**
 * Where a report filter comes from, when it was taken from a visual: one of the visual's own rows or
 * columns ("Use this row"), or a filter from outside the visual (a slicer, the filter pane). Unknown for
 * filters typed in by hand. ALLSELECTED treats the two differently.
 */
export type ReportFilterSource = 'visual-row' | 'visual-filter';

/** Does an ALLSELECTED removal cover this column? */
export function visualRemovalCovers(removal: Extract<Removal, { kind: 'visual' }>, column: ColumnName): boolean {
  if (removal.columns) return removal.columns.some((c) => sameColumn(c, column));
  if (removal.table !== null) return same(removal.table, column.table);
  return true;
}

/** How a report filter stands at some step. */
export type ReportFilterStatus = 'applies' | 'removed' | 'maybe-removed';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameColumn = (a: ColumnName, b: ColumnName) => same(a.table, b.table) && same(a.column, b.column);

/** A column reference that is always valid DAX: 'Table'[Column], with quotes and brackets escaped. */
export function columnDax(column: ColumnName): string {
  if (column.table === '') throw new Error(`Report filters need a table name: [${column.column}]`);
  return `'${column.table.replace(/'/g, "''")}'[${column.column.replace(/]/g, ']]')}]`;
}

/** A DAX literal for a filter value. */
export function daxLiteral(value: FilterValue): string {
  if (value === null) return 'BLANK()';
  if (typeof value === 'boolean') return value ? 'TRUE()' : 'FALSE()';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Not a usable number: ${value}`);
    return String(value);
  }
  if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.date);
  if (!match) throw new Error(`Not a date: ${value.date}`);
  const [, y, mo, d, h, mi, s] = match;
  const date = `DATE(${Number(y)}, ${Number(mo)}, ${Number(d)})`;
  return h === undefined ? date : `${date} + TIME(${Number(h)}, ${Number(mi)}, ${Number(s ?? 0)})`;
}

/** The filter as a DAX table expression, ready to be a CALCULATE filter argument. */
export function reportFilterDax(filter: ReportFilter): string {
  if (filter.kind === 'table') return filter.dax;
  return `TREATAS({${filter.values.map(daxLiteral).join(', ')}}, ${columnDax(filter.column)})`;
}

/** How a value is shown to people. */
export function valueText(value: FilterValue): string {
  if (value === null) return '(Blank)';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value}"`;
  return value.date.replace('T', ' ');
}

/** Plain text, e.g. `Product[Category] = "Widgets"` or `Product[Category] is one of "A", "B"`. */
export function reportFilterText(filter: ReportFilter): string {
  if (filter.kind === 'table') return filter.description;
  if (filter.values.length === 1) return `${columnText(filter.column)} = ${valueText(filter.values[0])}`;
  if (filter.values.length === 0) return `${columnText(filter.column)} has no values selected`;
  return `${columnText(filter.column)} is one of ${filter.values.map(valueText).join(', ')}`;
}

export function reportFilterColumns(filter: ReportFilter): ColumnName[] {
  return filter.kind === 'values' ? [filter.column] : filter.columns;
}

/**
 * Whether a report filter still applies after these removals.
 *
 * A removal on the filter's own column or table removes it. Removing a whole table can also remove
 * filters on related tables (through relationships); that isn't checked here, so filters on other
 * tables are then "maybe-removed" rather than guessed either way.
 */
/**
 * @param model when known, a removal from a whole table is certain to cover (or not) a filter on another
 *   table: it covers the tables in its expanded table. Without it, that stays "maybe".
 */
export function reportFilterStatus(filter: ReportFilter, removals: readonly Removal[], model?: RelationshipModel | null): ReportFilterStatus {
  const columns = reportFilterColumns(filter);
  // In order: a later ALLSELECTED can bring back a slicer filter that an earlier ALL removed.
  let status: ReportFilterStatus = 'applies';
  const removed = () => {
    status = 'removed';
  };
  for (const removal of removals) {
    if (removal.kind === 'visual') {
      if (!columns.some((c) => visualRemovalCovers(removal, c))) continue;
      status = filter.source === 'visual-row' ? 'removed' : filter.source === 'visual-filter' ? 'applies' : 'maybe-removed';
      continue;
    }
    if (removal.kind === 'all') {
      removed();
      continue;
    }
    if (removal.kind === 'column') {
      if (columns.some((c) => sameColumn(c, removal.column))) removed();
      continue;
    }
    const inTable = columns.filter((c) => same(c.table, removal.table));
    if (inTable.length > 0) {
      if (inTable.every((c) => !removal.except.some((kept) => sameColumn(kept, c)))) removed();
    } else if (model) {
      if (columns.some((c) => c.table !== '' && expandedCovers(model, removal.table, c.table))) removed();
    } else if (status === 'applies') {
      status = 'maybe-removed';
    }
  }
  return status;
}
