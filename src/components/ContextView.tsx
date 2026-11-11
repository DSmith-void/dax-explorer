import { entryText, incomingText, originText, rowContextText, relationshipChangeText } from '../engine/context/describe';
import type { EvalContext } from '../engine/context/model';
import { reportFilterStatus, reportFilterText, type ReportFilter, type ReportFilterStatus } from '../engine/context/reportFilters';
import { useRelationships } from './relationshipContext';
import { useReportFilters } from './reportFiltersContext';

const STATUS_TEXT: Record<ReportFilterStatus, string> = {
  applies: 'applies',
  removed: 'removed here',
  'maybe-removed': 'may be removed here (not checked: it depends on the data model, or on whether it comes from the visual)',
};

/** The report's filters, by where they come from (only shown as groups when some came from a visual). */
const GROUPS: { heading: string; test: (f: ReportFilter) => boolean }[] = [
  { heading: "From the visual's own rows and columns", test: (f) => f.source === 'visual-row' },
  { heading: 'From slicers and the filter pane', test: (f) => f.source === 'visual-filter' },
  { heading: 'Added by hand', test: (f) => !f.source },
];

interface ContextViewProps {
  context: EvalContext;
  /** When given, filters not present in this context are highlighted as new. */
  compareTo?: EvalContext;
}

/** Structured rendering of a symbolic evaluation context. */
export function ContextView({ context, compareTo }: ContextViewProps) {
  const reportFilters = useReportFilters();
  const model = useRelationships();
  if (context.unknownReason) {
    return (
      <ul className="context-view">
        <li className="context-unknown">Unknown: {context.unknownReason}</li>
      </ul>
    );
  }
  const previousEntries = new Set(compareTo?.filter.entries.map((e) => `${entryText(e)}|${originText(e)}`) ?? []);
  const previousIncoming = compareTo ? incomingText(compareTo.filter.removals, model) : null;
  const previousRows = new Set(compareTo?.rows.map((r) => r.nodeId) ?? []);
  const incoming = incomingText(context.filter.removals, model);

  return (
    <ul className="context-view">
      <li className={`context-incoming${previousIncoming !== null && previousIncoming !== incoming ? ' is-changed' : ''}`}>
        {incoming}
        {GROUPS.map(({ heading, test }) => {
          const group = reportFilters.filter(test);
          if (group.length === 0) return null;
          // Grouped only when some filters came from a visual (ALLSELECTED treats the groups differently).
          const grouped = reportFilters.some((f) => f.source);
          return (
            <div key={heading} className="report-filter-group">
              {grouped && <span className="report-filter-heading">{heading}</span>}
              <ul className="report-filter-list" aria-label={grouped ? heading : "The report's filters at this point"}>
                {group.map((filter, i) => {
                  const status = reportFilterStatus(filter, context.filter.removals, model);
                  return (
                    <li key={i} className={`report-filter is-${status}`}>
                      <code>{reportFilterText(filter)}</code> <span className="context-origin">{STATUS_TEXT[status]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </li>
      {context.filter.entries.map((entry, i) => {
        const isNew = compareTo !== undefined && !previousEntries.has(`${entryText(entry)}|${originText(entry)}`);
        return (
          <li key={i} className={`context-filter${isNew ? ' is-changed' : ''}`}>
            <code>{entryText(entry)}</code> <span className="context-origin">{originText(entry)}</span>
          </li>
        );
      })}
      {context.filter.relationships.map((change, i) => {
        const isNew = compareTo !== undefined && !compareTo.filter.relationships.includes(change);
        return (
          <li key={`rel${i}`} className={`context-relationship${isNew ? ' is-changed' : ''}`}>
            {relationshipChangeText(change)} <span className="context-origin">{change.functionName}</span>
          </li>
        );
      })}
      {context.filter.caveats.map((caveat, i) => (
        <li key={`c${i}`} className="context-caveat">
          Not checked: {caveat}
        </li>
      ))}
      {context.rows.map((row) => (
        <li key={`r${row.nodeId}`} className={`context-row${compareTo !== undefined && !previousRows.has(row.nodeId) ? ' is-changed' : ''}`}>
          {rowContextText(row)}
        </li>
      ))}
    </ul>
  );
}
