import type { FlatEntry } from '../app/frames';
import type { ValueState } from '../app/useStepValues';
import { columnText } from '../engine/context/describe';
import type { StepQuery } from '../engine/context/stepQuery';

interface DateStripProps {
  entry: FlatEntry;
  /** The date-range queries of a step that changes a date filter, or null. */
  range: { column: { table: string; column: string }; functionName: string; before: StepQuery; after: StepQuery; all: StepQuery } | null;
  stateOf: (query: StepQuery) => ValueState;
  connected: boolean;
}

interface Span {
  first: number;
  last: number;
  count: number;
}

const DAY = 86_400_000;

/** "2025-03-01|2025-03-31|31" → a span (or null for no dates). */
function parseSpan(state: ValueState): Span | null | 'pending' | 'error' {
  if (state.status === 'loading' || state.status === 'off') return 'pending';
  if (state.status === 'error') return 'error';
  const text = state.result.rows[0]?.[0];
  if (typeof text !== 'string') return null;
  const [first, last, count] = text.split('|');
  if (!first || !last) return null;
  return { first: Date.parse(`${first}T00:00:00Z`), last: Date.parse(`${last}T00:00:00Z`), count: Number(count) || 0 };
}

const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function spanText(span: Span): string {
  const days = Math.round((span.last - span.first) / DAY) + 1;
  const gaps = span.count < days ? ` (${span.count.toLocaleString()} of the ${days.toLocaleString()} days in between)` : '';
  return `${dateText(span.first)} – ${dateText(span.last)} · ${span.count.toLocaleString()} ${span.count === 1 ? 'day' : 'days'}${gaps}`;
}

/**
 * "Dates": for a step that changes a date filter (DATESYTD, SAMEPERIODLASTYEAR, TOTALYTD, ...), the dates
 * before it and the dates the inside sees, from the connected report, drawn on one time line.
 */
export function DateStrip({ entry, range, stateOf, connected }: DateStripProps) {
  if (!range) return null;
  const rule = entry.operations.find((op) => op.kind === 'add-filter' && op.entry.dates);
  const ruleText = rule?.kind === 'add-filter' ? rule.entry.condition.replace(/^= /, '') : '';
  const header = (
    <p className="date-strip-rule">
      <strong>{range.functionName}</strong> on <code>{columnText(range.column)}</code>: {ruleText}.
    </p>
  );
  if (!connected) {
    return (
      <section className="date-strip">
        <h5 className="step-subheading">Dates</h5>
        {header}
        <p className="value-note">Connect to a report to see which dates these are.</p>
      </section>
    );
  }
  if (range.before.kind === 'needs-row' || range.after.kind === 'needs-row') {
    const name = range.before.kind === 'needs-row' ? range.before.iteratorName : range.after.kind === 'needs-row' ? range.after.iteratorName : '';
    return (
      <section className="date-strip">
        <h5 className="step-subheading">Dates</h5>
        {header}
        <p className="value-note">The dates depend on which row of {name} is meant: pick one at its step.</p>
      </section>
    );
  }
  if (range.before.kind !== 'scalar' || range.after.kind !== 'scalar') {
    return (
      <section className="date-strip">
        <h5 className="step-subheading">Dates</h5>
        {header}
        {range.before.kind === 'none' && range.before.reason && <p className="value-note">{range.before.reason}</p>}
      </section>
    );
  }
  const before = parseSpan(stateOf(range.before));
  const after = parseSpan(stateOf(range.after));
  const all = stateOf(range.all);
  const allText = all.status === 'ready' && typeof all.result.rows[0]?.[0] === 'string' ? (all.result.rows[0][0] as string) : null;
  const [allFirst, allLast] = allText ? allText.split('|').map((d) => Date.parse(`${d}T00:00:00Z`)) : [NaN, NaN];
  const scale = Number.isFinite(allFirst) && Number.isFinite(allLast) && allLast > allFirst;
  const at = (ms: number) => (scale ? Math.min(100, Math.max(0, ((ms - allFirst) / (allLast - allFirst + DAY)) * 100)) : 0);
  const years: number[] = [];
  if (scale) for (let y = new Date(allFirst).getUTCFullYear(); y <= new Date(allLast).getUTCFullYear(); y++) years.push(y);

  const row = (label: string, span: ReturnType<typeof parseSpan>, className: string) => (
    <div className={`date-strip-row ${className}`}>
      <span className="date-strip-label">{label}</span>
      <div className="date-strip-track" aria-hidden="true">
        {scale && span && typeof span === 'object' && (
          <span className="date-strip-bar" style={{ left: `${at(span.first)}%`, width: `${Math.max(0.6, at(span.last + DAY) - at(span.first))}%` }} />
        )}
      </div>
      <span className="date-strip-text">
        {span === 'pending' ? 'Working it out…' : span === 'error' ? 'Could not be worked out.' : span === null ? 'no dates' : spanText(span)}
      </span>
    </div>
  );

  return (
    <section className="date-strip">
      <h5 className="step-subheading">Dates</h5>
      {header}
      {row('Before', before, 'is-before')}
      {row('Inside', after, 'is-after')}
      {scale && (
        <div className="date-strip-axis" aria-hidden="true">
          {years.map((y) => (
            <span key={y} style={{ left: `${at(Date.UTC(y, 0, 1))}%` }}>
              {y}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
