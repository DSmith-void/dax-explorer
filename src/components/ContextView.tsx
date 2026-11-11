import { entryText, incomingText, originText, rowContextText } from '../engine/context/describe';
import type { EvalContext } from '../engine/context/model';
import { reportFilterStatus, reportFilterText, type ReportFilterStatus } from '../engine/context/reportFilters';
import { useRelationships } from './relationshipContext';
import { useReportFilters } from './reportFiltersContext';

const STATUS_TEXT: Record<ReportFilterStatus, string> = {
  applies: 'applies',
  removed: 'removed here',
  'maybe-removed': 'may be removed through a relationship (not checked)',
};

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
        {reportFilters.length > 0 && (
          <ul className="report-filter-list" aria-label="The report's filters at this point">
            {reportFilters.map((filter, i) => {
              const status = reportFilterStatus(filter, context.filter.removals, model);
              return (
                <li key={i} className={`report-filter is-${status}`}>
                  <code>{reportFilterText(filter)}</code> <span className="context-origin">{STATUS_TEXT[status]}</span>
                </li>
              );
            })}
          </ul>
        )}
      </li>
      {context.filter.entries.map((entry, i) => {
        const isNew = compareTo !== undefined && !previousEntries.has(`${entryText(entry)}|${originText(entry)}`);
        return (
          <li key={i} className={`context-filter${isNew ? ' is-changed' : ''}`}>
            <code>{entryText(entry)}</code> <span className="context-origin">{originText(entry)}</span>
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
