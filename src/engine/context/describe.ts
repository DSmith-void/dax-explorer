import type { ColumnName, EvalContext, FilterEntry, FilterTarget, RelationshipChange, Removal, RowContext } from './model';
import { expandedTables, type RelationshipModel } from './relationships';

/**
 * Plain-language rendering of symbolic contexts. Used by the UI and by tests.
 *
 * Wording rules (the audience includes people brand new to Power BI):
 *  - "the report's filters" rather than "F" or "filter context" in sentences;
 *  - "going row by row" rather than "row context";
 *  - "not checked" rather than "not modeled";
 *  - technical terms only in brackets after the plain description.
 */

export function columnText(column: ColumnName): string {
  if (column.table === '') return `[${column.column}]`;
  return `${tableText(column.table)}[${column.column}]`;
}

export function tableText(table: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(table) ? table : `'${table}'`;
}

export function targetText(target: FilterTarget): string {
  switch (target.kind) {
    case 'columns':
      return target.columns.map(columnText).join(', ');
    case 'table':
      return `table ${tableText(target.table)}`;
    case 'unknown':
      return target.description;
  }
}

export function removalText(removal: Removal): string {
  switch (removal.kind) {
    case 'all':
      return 'all filters';
    case 'column':
      return columnText(removal.column);
    case 'table':
      return removal.except.length === 0
        ? `table ${tableText(removal.table)}`
        : `table ${tableText(removal.table)} (but keeping ${removal.except.map(columnText).join(', ')})`;
  }
}

export function entryText(entry: FilterEntry): string {
  return `${targetText(entry.target)} ${entry.condition}`;
}

export function originText(entry: FilterEntry): string {
  const origin = entry.origin;
  if (origin.kind === 'context-transition') return `the current row of ${origin.iteratorName}, turned into a filter`;
  return entry.mode === 'intersect'
    ? `added by ${origin.functionName}, on top of existing filters (KEEPFILTERS)`
    : `added by ${origin.functionName}`;
}

/**
 * One line describing what is left of the report's filters. With the relationships known, a removal from a
 * whole table names the tables it looks up too (its expanded table), since their filters go as well.
 */
export function incomingText(removals: readonly Removal[], model?: RelationshipModel | null): string {
  if (removals.some((r) => r.kind === 'all')) return "None of the report's filters (all removed)";
  if (removals.length === 0) return "All of the report's filters";
  const text = (removal: Removal) => {
    if (removal.kind !== 'table' || !model) return removalText(removal);
    const looksUp = expandedTables(model, removal.table).slice(1);
    return looksUp.length === 0 ? removalText(removal) : `${removalText(removal)} and the tables it looks up (${looksUp.map(tableText).join(', ')})`;
  };
  return `The report's filters, except any filter on ${removals.map(text).join('; ')}`;
}

/** "Uses the relationship Sales[Ship Date] – 'Date'[Date]" (or, mid-sentence, "using …"). */
export function relationshipChangeText(change: RelationshipChange, midSentence = false): string {
  const [a, b] = change.columns.map(columnText);
  if (change.kind === 'use') return `${midSentence ? 'using' : 'Uses'} the relationship ${a} – ${b}`;
  const how = {
    none: 'carrying no filter at all',
    oneway: 'filtering one way (from the one side)',
    both: 'filtering both ways',
    'left-filters-right': `filtering only from ${change.columns[0].table} to ${change.columns[1].table}`,
    'right-filters-left': `filtering only from ${change.columns[1].table} to ${change.columns[0].table}`,
  }[change.direction ?? 'oneway'];
  return `${midSentence ? 'with' : 'Sets'} the relationship ${a} – ${b} ${how}`;
}

export function rowContextText(row: RowContext): string {
  return `${row.functionName} is going through ${row.table.description} one row at a time`;
}

/** Full multi-line description of a context. */
export function describeContext(context: EvalContext): string[] {
  if (context.unknownReason) return [`Unknown: ${context.unknownReason}`];
  const lines = [incomingText(context.filter.removals)];
  for (const entry of context.filter.entries) lines.push(`${entryText(entry)}  (${originText(entry)})`);
  for (const change of context.filter.relationships) lines.push(`${relationshipChangeText(change)}  (${change.functionName})`);
  for (const caveat of context.filter.caveats) lines.push(`Not checked: ${caveat}`);
  for (const row of context.rows) lines.push(rowContextText(row));
  return lines;
}

/** Compact identity of a context's filters (row contexts excluded), for comparing two points. */
export function filterSignature(context: EvalContext): string {
  if (context.unknownReason) return `unknown:${context.unknownReason}`;
  return JSON.stringify([context.filter.removals, context.filter.entries.map(entryText), context.filter.caveats]);
}
