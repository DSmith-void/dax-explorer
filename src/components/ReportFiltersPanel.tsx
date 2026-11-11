import { useEffect, useMemo, useState } from 'react';
import type { HelperClient, ModelMetadata, QueryValue } from '../app/helperClient';
import type { DesktopVisuals } from '../app/useDesktopVisuals';
import { captureLabel } from './captureLabel';
import { columnText } from '../engine/context/describe';
import type { ColumnName } from '../engine/context/model';
import { columnDax, reportFilterText, valueText, type FilterValue, type ReportFilter } from '../engine/context/reportFilters';
import { readVisualQuery, visualRowsDax, type VisualQuery } from '../engine/context/visualQuery';
import { usePopover } from './usePopover';

interface ReportFiltersPanelProps {
  client: HelperClient;
  /** The connected model; report filters need one (values come from it). */
  model: ModelMetadata | null;
  filters: readonly ReportFilter[];
  onChange: (filters: ReportFilter[]) => void;
  /** Loads a measure from the connected model by name; false when it isn't in the model. */
  onExplainMeasure: (name: string) => boolean;
  /** Visual queries from Power BI Desktop. */
  desktop: DesktopVisuals;
  listen: boolean;
  onListenChange: (listen: boolean) => void;
}

const MAX_VALUES = 500;
const MAX_VISUAL_ROWS = 200;

const sameColumn = (a: ColumnName, b: ColumnName) =>
  a.table.toLowerCase() === b.table.toLowerCase() && a.column.toLowerCase() === b.column.toLowerCase();

/** A value as shown in lists and tables: numbers with separators, text without quotes. */
function formatValue(value: QueryValue): string {
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (typeof value === 'string') return value === '' ? '(empty text)' : value;
  return valueText(value);
}

/**
 * The report filters ("F"): the place in the report to calculate values for. Chosen by hand
 * (column and values) or taken from a visual's query plus one of its rows.
 */
export function ReportFiltersPanel({ client, model, filters, onChange, onExplainMeasure, desktop, listen, onListenChange }: ReportFiltersPanelProps) {
  const { open, setOpen, container } = usePopover<HTMLDivElement>();
  const [mode, setMode] = useState<'manual' | 'visual'>('manual');
  const label = filters.length === 0 ? 'none (grand total)' : filters.length === 1 ? reportFilterText(filters[0]) : `${filters.length} filters`;

  return (
    <div className="data-source" ref={container}>
      <button
        type="button"
        className={`data-pill${filters.length > 0 ? ' is-filtered' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        title="The report's filters (F): which place in the report values are calculated for"
      >
        <span className="data-pill-f" aria-hidden="true">
          F
        </span>
        <span className="data-pill-label">
          <span className="visually-hidden">Report filters: </span>
          {label}
        </span>
        <span className="data-pill-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="data-panel report-filters-panel" role="dialog" aria-label="Report filters">
          <section className="data-panel-section">
            <h3 className="data-panel-title">Report filters (F)</h3>
            <p className="data-bar-muted">
              A measure's value depends on where it is shown in the report. Choose that place here: these filters stand in for F.
              With none, values are for the whole model (the grand total).
            </p>
            {filters.length > 0 && (
              <>
                <ul className="filter-chips">
                  {filters.map((f, i) => (
                    <li key={i}>
                      <code>{reportFilterText(f)}</code>
                      <button
                        type="button"
                        className="chip-remove"
                        onClick={() => onChange(filters.filter((_, j) => j !== i))}
                        title="Remove this filter"
                      >
                        <span aria-hidden="true">✕</span>
                        <span className="visually-hidden">Remove {reportFilterText(f)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div>
                  <button type="button" className="secondary-button" onClick={() => onChange([])}>
                    Clear all
                  </button>
                </div>
              </>
            )}
          </section>

          {!model ? (
            <section className="data-panel-section">
              <p>Connect to a report first (the data button), so the filters can use its columns and values.</p>
            </section>
          ) : (
            <>
              <div className="panel-tabs" role="tablist" aria-label="How to choose filters">
                <button type="button" role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'is-active' : undefined} onClick={() => setMode('manual')}>
                  Add a filter
                </button>
                <button type="button" role="tab" aria-selected={mode === 'visual'} className={mode === 'visual' ? 'is-active' : undefined} onClick={() => setMode('visual')}>
                  From a visual
                </button>
              </div>
              {mode === 'manual' ? (
                <ManualFilter client={client} model={model} filters={filters} onChange={onChange} />
              ) : (
                <FromVisual
                  client={client}
                  onChange={(f) => {
                    onChange(f);
                    setOpen(false);
                  }}
                  onExplainMeasure={onExplainMeasure}
                  desktop={desktop}
                  listen={listen}
                  onListenChange={onListenChange}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ add a filter by hand

function ManualFilter({ client, model, filters, onChange }: { client: HelperClient; model: ModelMetadata; filters: readonly ReportFilter[]; onChange: (f: ReportFilter[]) => void }) {
  const columns = useMemo(
    () =>
      model.columns
        .filter((c) => !c.isHidden && !/^RowNumber/i.test(c.name))
        .map((c) => ({ table: c.table, column: c.name }))
        .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column)),
    [model],
  );
  const [columnKey, setColumnKey] = useState('');
  const [values, setValues] = useState<{ list: FilterValue[]; truncated: boolean } | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const column = columns.find((c) => `${c.table}\u0000${c.column}` === columnKey) ?? null;

  async function chooseColumn(key: string) {
    setColumnKey(key);
    setValues(null);
    setChosen(new Set());
    setSearch('');
    setError(null);
    const c = columns.find((x) => `${x.table}\u0000${x.column}` === key);
    if (!c) return;
    setBusy(true);
    try {
      const ref = columnDax(c);
      const result = await client.evaluate('table', `TOPN(${MAX_VALUES + 1}, VALUES(${ref}), ${ref}, ASC)`, MAX_VALUES);
      setValues({ list: result.rows.map((r) => r[0] as FilterValue), truncated: result.truncated });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the values.');
    } finally {
      setBusy(false);
    }
  }

  const shown = values?.list.map((v, i) => ({ v, i })).filter(({ v }) => formatValue(v).toLowerCase().includes(search.toLowerCase())) ?? [];

  function add() {
    if (!column || !values || chosen.size === 0) return;
    const filter: ReportFilter = { kind: 'values', column, values: [...chosen].sort((a, b) => a - b).map((i) => values.list[i]) };
    // A new filter on the same column replaces the old one, like choosing again in a slicer.
    onChange([...filters.filter((f) => !(f.kind === 'values' && sameColumn(f.column, column))), filter]);
    setChosen(new Set());
  }

  return (
    <section className="data-panel-section">
      <label className="stacked-field">
        <span className="field-label">Column</span>
        <select value={columnKey} onChange={(e) => void chooseColumn(e.target.value)}>
          <option value="">Choose a column…</option>
          {[...new Set(columns.map((c) => c.table))].map((table) => (
            <optgroup key={table} label={table}>
              {columns
                .filter((c) => c.table === table)
                .map((c) => (
                  <option key={c.column} value={`${c.table}\u0000${c.column}`}>
                    {c.column}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {busy && <p className="data-bar-muted">Reading the values…</p>}
      {values && (
        <>
          <input type="search" className="text-input" placeholder="Search values" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search values" />
          <ul className="value-list">
            {shown.map(({ v, i }) => (
              <li key={i}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(i)}
                    onChange={() => {
                      const next = new Set(chosen);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      setChosen(next);
                    }}
                  />{' '}
                  {formatValue(v)}
                </label>
              </li>
            ))}
          </ul>
          {values.truncated && <p className="data-bar-muted">Showing the first {MAX_VALUES} values.</p>}
          <div>
            <button type="button" className="primary-button" disabled={chosen.size === 0} onClick={add}>
              Add filter{chosen.size > 1 ? ` (${chosen.size} values)` : ''}
            </button>
          </div>
        </>
      )}
      {error && <p className="data-bar-error">{error}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ from a visual's query

function FromVisual({
  client,
  onChange,
  onExplainMeasure,
  desktop,
  listen,
  onListenChange,
}: {
  client: HelperClient;
  onChange: (f: ReportFilter[]) => void;
  onExplainMeasure: (name: string) => boolean;
  desktop: DesktopVisuals;
  listen: boolean;
  onListenChange: (listen: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [visual, setVisual] = useState<VisualQuery | null>(null);
  const [rows, setRows] = useState<{ cells: QueryValue[][]; truncated: boolean } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  async function read(source: string = text) {
    setError(null);
    setVisual(null);
    setRows(null);
    setPicked(null);
    const result = readVisualQuery(source);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setVisual(result.visual);
    setBusy(true);
    try {
      const data = await client.evaluate('table', visualRowsDax(result.visual, MAX_VISUAL_ROWS), MAX_VISUAL_ROWS);
      setRows({ cells: data.rows, truncated: data.truncated });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list the visual's rows.");
    } finally {
      setBusy(false);
    }
  }

  /** Sets F to the visual's filters, plus the picked row's group-by values when `withRow`. */
  function use(withRow: boolean) {
    if (!visual || !rows) return;
    const row = withRow && picked !== null ? rows.cells[picked] : undefined;
    // Remember where each filter comes from: ALLSELECTED drops the visual's own rows and columns but keeps
    // the filters from outside it (slicers, the filter pane).
    const fromRow: ReportFilter[] = row
      ? visual.groupBy.map((column, i) => ({ kind: 'values', column, values: [row[i] as FilterValue], source: 'visual-row' }))
      : [];
    onChange([...visual.filters.map((f): ReportFilter => ({ ...f, source: 'visual-filter' })), ...fromRow]);
  }

  return (
    <section className="data-panel-section">
      <DesktopVisualsSection
        desktop={desktop}
        listen={listen}
        onListenChange={onListenChange}
        onPick={(query) => {
          setText(query);
          void read(query);
        }}
      />
      <h4 className="paste-heading">Or paste a query</h4>
      <p className="data-bar-muted">
        In Power BI Desktop: <strong>Optimize → Performance analyzer → Start recording</strong>, refresh or click the visual, open
        its entry and choose <strong>Copy query</strong>. Paste it here.
      </p>
      <textarea
        className="text-input query-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="// DAX Query&#10;DEFINE …&#10;EVALUATE …"
        spellCheck={false}
        aria-label="The visual's query"
      />
      <div>
        <button type="button" className="primary-button" disabled={!text.trim() || busy} onClick={() => void read()}>
          {busy ? 'Reading…' : 'Read query'}
        </button>
      </div>
      {error && <p className="data-bar-error">{error}</p>}

      {visual && (
        <div className="visual-summary">
          <p>
            {visual.groupBy.length > 0 ? (
              <>
                Groups by <code>{visual.groupBy.map(columnText).join(', ')}</code>
              </>
            ) : (
              'A single value (like a card)'
            )}
            {visual.filters.length > 0 && (
              <>
                {' '}
                · filtered by{' '}
                {visual.filters.map((f, i) => (
                  <code key={i}>{reportFilterText(f)}</code>
                ))}
              </>
            )}
          </p>
          {visual.measures.length > 0 && (
            <p className="visual-measures">
              Measures:{' '}
              {visual.measures.map((m) =>
                m.measureName ? (
                  <button
                    key={m.label}
                    type="button"
                    className="link-button"
                    title="Explain this measure"
                    onClick={() => setMissing(onExplainMeasure(m.measureName!) ? null : m.measureName)}
                  >
                    [{m.measureName}]
                  </button>
                ) : (
                  <code key={m.label}>{m.label}</code>
                ),
              )}
            </p>
          )}
          {missing && <p className="data-bar-muted">[{missing}] isn't a measure in the connected model.</p>}
          {visual.notes.map((n, i) => (
            <p key={i} className="data-bar-muted">
              Note: {n}
            </p>
          ))}
          <ReadDetails visual={visual} />
        </div>
      )}

      {visual && rows && (
        <>
          {rows.cells.length === 0 ? (
            <p className="visual-empty">
              This visual shows no rows with these filters (for example, a slicer may select dates without data). You can still use
              its filters.
            </p>
          ) : (
            <>
          <p className="field-label">{visual.groupBy.length > 0 ? 'Pick the row you are looking at (in a chart: one row per bar or point):' : 'The value:'}</p>
          <div className="table-scroll visual-rows">
            <table className="token-table">
              <thead>
                <tr>
                  {visual.groupBy.length > 0 && <th aria-label="Pick" />}
                  {visual.groupBy.map((c) => (
                    <th key={columnText(c)}>{c.column}</th>
                  ))}
                  {visual.measures.map((m) => (
                    <th key={m.label} className="num">
                      {m.measureName ?? m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.cells.map((row, r) => (
                  <tr key={r} className={picked === r ? 'is-picked' : undefined} onClick={() => setPicked(r)}>
                    {visual.groupBy.length > 0 && (
                      <td>
                        <input type="radio" name="visual-row" checked={picked === r} onChange={() => setPicked(r)} aria-label={`Row ${r + 1}`} />
                      </td>
                    )}
                    {row.map((cell, c) => (
                      <td key={c} className={c >= visual.groupBy.length ? 'num' : undefined}>
                        {formatValue(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.truncated && <p className="data-bar-muted">Showing the first {MAX_VISUAL_ROWS} rows.</p>}
            </>
          )}
          <div className="data-panel-actions">
            {visual.groupBy.length > 0 && rows.cells.length > 0 && (
              <button type="button" className="primary-button" disabled={picked === null} onClick={() => use(true)}>
                Use this row
              </button>
            )}
            <button
              type="button"
              className={visual.groupBy.length > 0 && rows.cells.length > 0 ? 'secondary-button' : 'primary-button'}
              onClick={() => use(false)}
              title="The filters from outside the visual (slicers, filter pane), without the visual's own fields"
            >
              {visual.groupBy.length > 0 ? 'Measure on its own' : "Use the visual's filters"}
            </button>
          </div>
          {visual.groupBy.length > 0 && (
            <p className="data-bar-muted">
              <strong>Measure on its own</strong>: with the slicers and filter pane, without{' '}
              {visual.groupBy.map((c, i) => (
                <span key={columnText(c)}>
                  {i > 0 && ', '}
                  <code>{c.column}</code>
                </span>
              ))}
              . The same number a card with just the measure would show.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * "What DAX Explorer read": every SUMMARIZECOLUMNS in the query and which one was used, plus the query run
 * for the rows. For checking the reader's choice when a visual misbehaves; shows names, not data.
 */
function ReadDetails({ visual }: { visual: VisualQuery }) {
  const [copied, setCopied] = useState(false);
  const rowsDax = visualRowsDax(visual, MAX_VISUAL_ROWS);
  return (
    <details className="read-details">
      <summary>What DAX Explorer read</summary>
      <p className="data-bar-muted">
        The query has {visual.parts.length} {visual.parts.length === 1 ? 'part' : 'parts'} that build a table of values
        (SUMMARIZECOLUMNS). The visual's own part is used; the others are usually helpers, such as a Top N filter.
      </p>
      <ul className="read-parts">
        {visual.parts.map((part, i) => (
          <li key={i} className={part.used ? 'is-used' : undefined}>
            <strong>{part.used ? 'Used' : 'Not used'}</strong> · <code>{part.where}</code> · groups by{' '}
            {part.groupBy.length > 0 ? <code>{part.groupBy.map(columnText).join(', ')}</code> : 'nothing'}
            {part.labels.length > 0 && (
              <>
                {' '}
                · values <code>{part.labels.join(', ')}</code>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="field-label">The query DAX Explorer ran for the rows (you can try it in DAX Studio):</p>
      <pre className="read-query">{`EVALUATE
${rowsDax}`}</pre>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          void navigator.clipboard.writeText(`EVALUATE
${rowsDax}`).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copied' : 'Copy this query'}
      </button>
    </details>
  );
}

const timeText = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

interface DesktopVisualsSectionProps {
  desktop: DesktopVisuals;
  listen: boolean;
  onListenChange: (listen: boolean) => void;
  onPick: (query: string) => void;
}

/**
 * Visuals in Power BI Desktop: the last visual Desktop calculated (read when this opens, and on "Check again"),
 * plus, with "listen while connected" on, every visual query since connecting.
 */
function DesktopVisualsSection({ desktop, listen, onListenChange, onPick }: DesktopVisualsSectionProps) {
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const { visuals, listening, checking, error, checkLast } = desktop;

  // Read the last visual whenever this section opens.
  useEffect(() => {
    void checkLast();
    // Runs once per opening; checkLast changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="capture">
      <div className="capture-start">
        <h4 className="visuals-heading">Visuals in Power BI Desktop</h4>
        <button type="button" className="secondary-button" disabled={checking} onClick={() => void checkLast()}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <p className="data-bar-muted">
        Shows the visual Power BI Desktop calculated last (the one you just added, changed or filtered). To see another,
        change something in it (or a slicer), then press Check again.
      </p>
      <label className="listen-setting">
        <input type="checkbox" checked={listen} onChange={(e) => onListenChange(e.target.checked)} /> Listen to Power BI Desktop while
        connected
        <span className="data-bar-muted"> (collects every visual you change from now on; stops when you disconnect)</span>
      </label>
      {listening && (
        <div className="capture-status" aria-live="polite">
          <span className="capture-dot" aria-hidden="true" />
          <span>Listening: visuals you change in Power BI Desktop appear here.</span>
        </div>
      )}
      {visuals.length > 0 ? (
        <ul className="capture-list" aria-label="Visual queries from Power BI Desktop, newest first">
          {visuals.map((v) => {
            const label = captureLabel(v.text);
            return (
              <li key={v.key}>
                <button
                  type="button"
                  className={pickedKey === v.key ? 'is-picked' : undefined}
                  disabled={!label.ok}
                  title={label.ok ? 'Use this visual' : label.error}
                  onClick={() => {
                    setPickedKey(v.key);
                    onPick(v.text);
                  }}
                >
                  <span className="capture-time">{timeText(v.at)}</span>
                  <span>{label.ok ? label.label : `Not usable: ${label.error}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        !checking && <p className="data-bar-muted">No visual query found yet. Add, change or filter a visual in Power BI Desktop, then press Check again.</p>
      )}
      {error && <p className="data-bar-error">{error}</p>}
    </div>
  );
}
