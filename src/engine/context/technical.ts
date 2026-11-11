/**
 * Compact, technical rendering of a context and of what a step does, for the "Technical" explanation
 * level (experienced users). Uses DAX's own terms: filter context, row context, context transition,
 * KEEPFILTERS, overwrite. The plain-language wording stays in describe.ts.
 */
import { columnText, entryText, removalText } from './describe';
import type { EvalContext, FilterEntry, Operation } from './model';

export interface TechnicalContext {
  /** The filter context, one line per part: what is left of F, then each filter added. */
  filter: string[];
  /** The row contexts, outermost first. */
  rows: string[];
}

function entryTechnical(entry: FilterEntry): string {
  const how = entry.origin.kind === 'context-transition'
    ? `context transition from ${entry.origin.iteratorName}`
    : `${entry.origin.functionName}, ${entry.mode === 'intersect' ? 'KEEPFILTERS (intersect)' : 'overwrite'}`;
  return `${entryText(entry)}  [${how}]`;
}

export function technicalContext(context: EvalContext): TechnicalContext {
  if (context.unknownReason) return { filter: [`unknown: ${context.unknownReason}`], rows: [] };
  const { removals, entries, caveats } = context.filter;
  const incoming = removals.some((r) => r.kind === 'all')
    ? 'F: removed (ALL)'
    : removals.length === 0
      ? 'F'
      : `F − filters on ${removals.map(removalText).join(', ')}`;
  const relationships = context.filter.relationships.map((r) => `${r.functionName}(${r.columns.map(columnText).join(', ')}${r.direction ? `, ${r.direction.toUpperCase()}` : ''})`);
  return {
    filter: [incoming, ...entries.map(entryTechnical), ...relationships, ...caveats.map((c) => `not modeled: ${c}`)],
    rows: context.rows.map((r) => `${r.table.description}  [${r.functionName}]`),
  };
}

export function technicalOperation(op: Operation): string {
  switch (op.kind) {
    case 'context-transition': {
      const iterators = op.rows.map((r) => r.functionName).join(', ');
      const added = op.added.map((e) => (e.target.kind === 'columns' ? e.target.columns.map(columnText).join(', ') : entryText(e)));
      return `Context transition: the row context of ${iterators} becomes filter context${added.length > 0 ? ` (${added.join('; ')})` : ''}`;
    }
    case 'remove-filters':
      return `${op.functionName}: removes filters on ${removalText(op.removal)}`;
    case 'add-filter':
      return `Filter ${entryText(op.entry)}: ${op.entry.mode === 'intersect' ? 'KEEPFILTERS, intersected with the existing filters' : 'overwrites existing filters on the same columns'}`;
    case 'relationship': {
      const [a, b] = op.change.columns.map(columnText);
      if (op.change.kind === 'use') return `USERELATIONSHIP: ${a} – ${b} becomes the active relationship`;
      const keyword = { none: 'NONE', oneway: 'ONEWAY', both: 'BOTH', 'left-filters-right': 'ONEWAY_LEFTFILTERSRIGHT', 'right-filters-left': 'ONEWAY_RIGHTFILTERSLEFT' }[op.change.direction ?? 'oneway'];
      return `CROSSFILTER: ${a} – ${b} set to ${keyword}`;
    }
    case 'row-context':
      return `${op.row.functionName}: new row context over ${op.row.table.description}`;
    case 'not-modeled':
      return `Not modeled: ${op.description}`;
  }
}
