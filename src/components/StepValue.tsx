import type { QueryValue } from '../app/helperClient';
import type { ValueState } from '../app/useStepValues';
import type { FilterValue } from '../engine/context/reportFilters';
import { rowColumns, type RowChoice, type StepQuery } from '../engine/context/stepQuery';
import type { TimelineEntry } from '../engine/context/timeline';
import { columnLabel, formatQueryValue, rowText } from './valueFormat';

const sameRow = (choice: RowChoice | undefined, columns: string[], values: QueryValue[]) =>
  choice !== undefined &&
  choice.columns.length === columns.length &&
  choice.columns.every((c, i) => c === columns[i]) &&
  choice.values.every((v, i) => JSON.stringify(v) === JSON.stringify(values[i]));

interface StepValueProps {
  entry: TimelineEntry;
  query: StepQuery;
  state: ValueState;
  connected: boolean;
  /** The picked row of an iterator of this measure, by its node id. */
  rowFor: (iteratorNodeId: number) => RowChoice | undefined;
  onPickRow: (iteratorNodeId: number, choice: RowChoice) => void;
  /** The value is a part of a date (a year): shown without a thousands separator. */
  asWritten?: boolean;
}

/** The real value at a step, from the connected report. */
export function StepValue({ entry, query, state, connected, rowFor, onPickRow, asWritten = false }: StepValueProps) {
  if (!connected) {
    return entry.kind === 'start' ? (
      <p className="value-note">Connect to a report (the data button) to see real values at each step.</p>
    ) : null;
  }
  if (query.kind === 'none') return query.reason ? <p className="value-note">No value here: {query.reason}</p> : null;

  // Which rows of the iterators around this step the value is for.
  const forRows = entry.context.rows
    .map((r) => ({ name: r.functionName, choice: rowFor(r.nodeId) }))
    .filter((r): r is { name: string; choice: RowChoice } => r.choice !== undefined);
  const forText = forRows.length > 0 && (
    <p className="value-for">
      For one row: {forRows.map((r) => `${r.name} at ${rowText(r.choice)}`).join('; ')}
    </p>
  );

  if (query.kind === 'needs-row' || state.status === 'loading') {
    return <p className="value-note" aria-live="polite">Calculating…</p>;
  }
  if (state.status === 'off') return null;
  if (state.status === 'error') return <p className="value-error">The engine could not calculate this: {state.message}</p>;

  const { result, count } = state;
  if (query.kind === 'scalar') {
    return (
      <div className="value-block">
        <p className="value-number">{formatQueryValue(result.rows[0]?.[0] ?? null, asWritten)}</p>
        {forText}
      </div>
    );
  }

  const { indexes, valueIndex } = query.kind === 'rows' ? rowColumns(result.columns) : { indexes: result.columns.map((_, i) => i), valueIndex: -1 };
  const iteratorNodeId = entry.nodeId;
  const picked = query.kind === 'rows' && iteratorNodeId !== null ? rowFor(iteratorNodeId) : undefined;
  const shown = count ?? result.rows.length;
  return (
    <div className="value-block">
      <p className="value-caption">
        {query.kind === 'rows'
          ? `${query.iteratorName} goes through ${shown.toLocaleString()} ${shown === 1 ? 'row' : 'rows'}. Each row's value:`
          : `A table with ${shown.toLocaleString()} ${shown === 1 ? 'row' : 'rows'}:`}
      </p>
      <div className="table-scroll value-table">
        <table className="token-table">
          <thead>
            <tr>
              {query.kind === 'rows' && <th className="pick-cell" aria-label="Picked row" />}
              {indexes.map((i) => (
                <th key={i}>{columnLabel(result.columns[i])}</th>
              ))}
              {valueIndex >= 0 && <th className="num">Value</th>}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, r) => {
              const columns = indexes.map((i) => result.columns[i]);
              const values = indexes.map((i) => row[i]);
              const isPicked = sameRow(picked, columns, values);
              const pick = () => iteratorNodeId !== null && onPickRow(iteratorNodeId, { columns, values: values as FilterValue[] });
              return (
                <tr key={r} className={isPicked ? 'is-picked' : undefined} onClick={query.kind === 'rows' ? pick : undefined}>
                  {query.kind === 'rows' && (
                    <td className="pick-cell">
                      <input type="radio" name={`rows-${iteratorNodeId}`} checked={isPicked} onChange={pick} aria-label={`Use row ${r + 1} for the steps inside`} />
                    </td>
                  )}
                  {indexes.map((i) => (
                    <td key={i}>{formatQueryValue(row[i])}</td>
                  ))}
                  {valueIndex >= 0 && <td className="num">{formatQueryValue(row[valueIndex])}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.truncated && <p className="value-note">Showing the first {result.rows.length} rows.</p>}
      {query.kind === 'rows' && (
        <p className="value-note">The steps inside {query.iteratorName} show values for the picked row. Pick another to see it change.</p>
      )}
      {forText}
    </div>
  );
}
