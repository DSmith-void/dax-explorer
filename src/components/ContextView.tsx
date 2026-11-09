import { entryText, incomingText, originText, rowContextText } from '../engine/context/describe';
import type { EvalContext } from '../engine/context/model';

interface ContextViewProps {
  context: EvalContext;
  /** When given, filters not present in this context are highlighted as new. */
  compareTo?: EvalContext;
}

/** Structured rendering of a symbolic evaluation context. */
export function ContextView({ context, compareTo }: ContextViewProps) {
  if (context.unknownReason) {
    return (
      <ul className="context-view">
        <li className="context-unknown">Unknown: {context.unknownReason}</li>
      </ul>
    );
  }
  const previousEntries = new Set(compareTo?.filter.entries.map((e) => `${entryText(e)}|${originText(e)}`) ?? []);
  const previousIncoming = compareTo ? incomingText(compareTo.filter.removals) : null;
  const previousRows = new Set(compareTo?.rows.map((r) => r.nodeId) ?? []);
  const incoming = incomingText(context.filter.removals);

  return (
    <ul className="context-view">
      <li className={`context-incoming${previousIncoming !== null && previousIncoming !== incoming ? ' is-changed' : ''}`}>
        {incoming}
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
