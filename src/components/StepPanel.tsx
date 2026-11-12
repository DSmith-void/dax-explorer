import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { summarizeTimings, timingRequest, type TimingResult } from '../app/timings';
import { HINT_KIND_LABEL, type Hint } from '../engine/patterns/hints';
import { scrollWithin } from './scrollWithin';
import { moveBorder, type Layout } from '../app/layout';
import { CollapseButton, PaneStrip, Splitter } from './Splitter';
import { framePath, frameTables, frameTint, type FlatEntry, type StepInto } from '../app/frames';
import { TablesReached } from './TablesReached';
import { DateStrip } from './DateStrip';
import { useFilterReach } from './relationshipContext';
import { pathText } from '../engine/context/relationships';
import type { ValueState } from '../app/useStepValues';
import { evaluateText, rowKey, type RowChoice, type StepQuery } from '../engine/context/stepQuery';
import { technicalContext, technicalOperation } from '../engine/context/technical';
import type { TimelineKind } from '../engine/context/timeline';
import type { AstNode } from '../engine/parser/ast';
import { findNode } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import { ContextView } from './ContextView';
import { Icon, type IconName } from './Icons';
import { stepParts, type StepParts } from '../engine/context/stepParts';
import { DiffList } from './DiffList';
import { pillLabel } from './pillLabel';
import { useReportFilters } from './reportFiltersContext';
import { StepValue } from './StepValue';
import { formatQueryValue } from './valueFormat';

interface StepPanelProps {
  entries: readonly FlatEntry[];
  index: number;
  onStep: (index: number) => void;
  onSelectNode: (node: AstNode) => void;
  /** Real values from the connected report. */
  values: StepValues;
  connected: boolean;
  /** Whether the measure called at a step can be stepped into. */
  stepInto: (entry: FlatEntry) => StepInto | null;
  isExpanded: (key: string) => boolean;
  onExpand: (key: string, expanded: boolean) => void;
  /** Pattern checks about this step's code. */
  hintsAt: (entry: FlatEntry) => readonly Hint[];
  onShowHints: () => void;
  /** Column widths and folded sections (adjustable, like Power BI's panes). */
  layout: Layout;
  onLayout: (change: Partial<Layout> | ((current: Layout) => Partial<Layout>)) => void;
  /** "Run with timings" on the connected report; null when not connected. */
  runTimings: ((kind: 'scalar' | 'table', dax: string, clearCache: boolean) => Promise<TimingResult>) | null;
}

/** What StepPanel needs from useStepValues. */
export interface StepValues {
  queryFor: (entry: FlatEntry) => StepQuery;
  stateOf: (query: StepQuery) => ValueState;
  rows: ReadonlyMap<string, RowChoice>;
  pickRow: (frameKey: string, iteratorNodeId: number, choice: RowChoice) => void;
  /** For a step that changes a date filter: its date-range queries. */
  dateRangeFor: (entry: FlatEntry) => ComponentProps<typeof DateStrip>['range'];
}

const KIND_LABEL: Record<TimelineKind, string> = {
  start: 'Start',
  variable: 'Variable stored',
  'variable-use': 'Variable used',
  measure: 'Measure',
  reference: 'Measure or column',
  column: 'Read a column',
  'filter-input': 'Filter prepared',
  calculate: 'Filters change',
  iterate: 'Row by row',
  'iterate-done': 'Rows combined',
  function: 'Function',
  unknown: 'Not followed',
  result: 'Result',
  enter: 'Measure starts',
  return: 'Measure done',
};

/** Kinds whose analyzer notes add to the summary (the others have no notes of their own). */
const HAS_NOTES = new Set<TimelineKind>(['variable', 'variable-use', 'measure', 'reference', 'column', 'filter-input', 'iterate', 'function', 'unknown']);

function Box({
  title,
  icon,
  count,
  className,
  children,
  open = true,
  onToggle,
  actions,
}: {
  title: string;
  icon: IconName;
  count?: number;
  className?: string;
  children: ReactNode;
  /** With onToggle: the box can be folded to its header. */
  open?: boolean;
  onToggle?: () => void;
  /** Buttons at the end of the header (hide the column). */
  actions?: ReactNode;
}) {
  return (
    <section className={['step-box', className, open ? '' : 'is-folded'].filter(Boolean).join(' ')}>
      <header className="step-box-header">
        {onToggle ? (
          <button type="button" className="box-toggle" aria-expanded={open} onClick={onToggle} title={open ? `Fold ${title}` : `Unfold ${title}`}>
            <span className="box-caret" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            <Icon name={icon} />
            <h3>{title}</h3>
          </button>
        ) : (
          <>
            <Icon name={icon} />
            <h3>{title}</h3>
          </>
        )}
        {count !== undefined && <span className="count-badge">{count}</span>}
        {actions}
      </header>
      {open && <div className="step-box-body">{children}</div>}
    </section>
  );
}

/** The "Step" tab: what happens at the current step, the filters, the variables, and the story so far. */
/** The Step tab's columns: open ones share the width as set; folded ones are a strip; borders between open ones. */
function columnsTemplate(layout: Layout): string {
  const col = (i: number) => (layout.colsOpen[i] ? `minmax(0, ${layout.cols[i]}fr)` : 'var(--strip-width)');
  const border = (i: number) => (layout.colsOpen[i] && layout.colsOpen[i + 1] ? 'var(--splitter-width)' : '0px');
  return `${col(0)} ${border(0)} ${col(1)} ${border(1)} ${col(2)}`;
}

/** The draggable border between two Step columns (only when both are open). */
function ColumnBorder({ left, layout, onLayout, grid }: { left: number; layout: Layout; onLayout: StepPanelProps['onLayout']; grid: RefObject<HTMLDivElement | null> }) {
  if (!layout.colsOpen[left] || !layout.colsOpen[left + 1]) return <span aria-hidden="true" />;
  return (
    <Splitter
      orientation="vertical"
      label="Border between columns"
      onDrag={(px) => {
        const width = grid.current?.clientWidth ?? 1000;
        onLayout((l) => {
          const open = l.cols.reduce((sum, c, i) => sum + (l.colsOpen[i] ? c : 0), 0);
          return { cols: moveBorder(l.cols, left, (px / width) * open) };
        });
      }}
      onReset={() => onLayout({ cols: [36, 33, 31] })}
    />
  );
}

export function StepPanel({ entries, index, onStep, onSelectNode, values, connected, stepInto, isExpanded, onExpand, hintsAt, onShowHints, runTimings, layout, onLayout }: StepPanelProps) {
  const current = entries[index];
  const grid = useRef<HTMLDivElement>(null);
  if (!current) {
    return <p className="empty-note">Nothing to step through yet. Pick a measure, or write your own DAX and press Explain.</p>;
  }
  const { frame } = current;
  const root = frame.result.parse?.root ?? null;
  const source = frame.result.text;
  const lineAt = createLineMap(source);
  const notes = current.nodeId !== null && HAS_NOTES.has(current.kind)
    ? (frame.analysis?.steps.get(current.nodeId)?.notes ?? []).filter((n) => n !== current.summary)
    : [];
  const changed = current.innerContext !== undefined && current.operations.length > 0;
  const parts = stepParts(current, root, frame.binding, frame.analysis, source);
  // Variables belong to one measure: only this measure's, stored so far.
  const variables = entries.slice(0, index + 1).filter((e) => e.kind === 'variable' && e.frame === frame);
  const node = current.nodeId !== null ? findNode(root, current.nodeId) : null;
  const query = values.queryFor(current);
  const target = stepInto(current);
  const tint = frameTint(frame.level);

  return (
    <div className="step-grid" ref={grid} style={{ '--step-cols': columnsTemplate(layout) } as CSSProperties}>
      {layout.colsOpen[0] ? (
      <div className="step-col">
      <Box title="This step" icon="steps" className={`step-box-current tone-step${tint ? ` frame-tint-${tint}` : ''}`} actions={<CollapseButton title="the This step column" onClick={() => onLayout((l) => ({ colsOpen: l.colsOpen.map((o, j) => (j === 0 ? false : o)) as Layout['colsOpen'] }))} />}>
        <Where entry={current} parts={parts} rowFor={(id) => values.rows.get(rowKey(frame.key, id))} onSelectNode={onSelectNode} root={root} />
        <p className="step-kind">
          <span className="kind-badge">{KIND_LABEL[current.kind]}</span>
          {node && current.kind !== 'start' && current.kind !== 'result' && current.kind !== 'return' && (
            <span className="step-where">line {lineAt(node.span.start).line}</span>
          )}
        </p>
        <h4 className="step-title">{current.title}</h4>
        <Diff entry={current} parts={parts} root={root} onSelectNode={onSelectNode} />
        {hintsAt(current).length > 0 && (
          <ul className="step-hints">
            {hintsAt(current).map((hint, i) => (
              <li key={i}>
                <button type="button" className={`hint-chip hint-chip-${hint.kind}`} onClick={onShowHints} title="Open the Hints tab">
                  <span className={`hint-kind hint-kind-${hint.kind}`}>{HINT_KIND_LABEL[hint.kind]}</span> {hint.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <StepValue
          entry={current}
          query={query}
          state={values.stateOf(query)}
          connected={connected}
          rowFor={(id) => values.rows.get(rowKey(frame.key, id))}
          onPickRow={(id, choice) => values.pickRow(frame.key, id, choice)}
        />
        {target && <StepIntoControl target={target} isExpanded={isExpanded} onExpand={onExpand} />}
        {/* Why: the step's sentence when there is no change to show (otherwise "what changes" says it), then
            the notes, for what the changes don't say. */}
        {parts.diff.length === 0 && <p className="step-why">{current.summary}</p>}
        {notes.map((note, i) => (
          <p key={i} className="step-note">
            {note}
          </p>
        ))}
        {current.kind === 'start' && entries.length > 1 && (
          <p className="step-hint">
            Press <strong>Next</strong> (or the <kbd>→</kbd> key) to go through the calculation one step at a time.
          </p>
        )}
        <nav className="step-nav" aria-label="Steps">
          <button type="button" className="secondary-button" onClick={() => onStep(index - 1)} disabled={index <= 0}>
            <Icon name="prev" /> Previous
          </button>
          <span className="muted">
            Step {index + 1} of {entries.length}
          </span>
          <button type="button" className="secondary-button" onClick={() => onStep(index + 1)} disabled={index >= entries.length - 1}>
            Next <Icon name="next" />
          </button>
        </nav>
      </Box>
      </div>
      ) : (
        <PaneStrip title="This step" icon="steps" tone="accent" onOpen={() => onLayout((l) => ({ colsOpen: l.colsOpen.map((o, j) => (j === 0 ? true : o)) as Layout['colsOpen'] }))} />
      )}
      <ColumnBorder left={0} layout={layout} onLayout={onLayout} grid={grid} />
      {layout.colsOpen[1] ? (
      <div className="step-col">
      <Box title={changed ? 'Filters: before → after' : 'Filters at this step'} icon="filter" className="tone-filter" actions={<CollapseButton title="the Filters column" onClick={() => onLayout((l) => ({ colsOpen: l.colsOpen.map((o, j) => (j === 1 ? false : o)) as Layout['colsOpen'] }))} />}>
        {changed ? (
          <div className="filters-compare">
            <div>
              <h5 className="step-subheading">Before</h5>
              <ContextView context={current.context} />
            </div>
            <div>
              <h5 className="step-subheading">After (what the inside sees)</h5>
              <ContextView context={current.innerContext!} compareTo={current.context} />
            </div>
          </div>
        ) : (
          <ContextView context={current.context} />
        )}
        <DateStrip entry={current} range={values.dateRangeFor(current)} stateOf={values.stateOf} connected={connected} />
        <TablesReached context={current.innerContext ?? current.context} usedTables={frameTables(frame)} folded={false} />
      </Box>
      </div>
      ) : (
        <PaneStrip title="Filters" icon="filter" tone="filter" onOpen={() => onLayout((l) => ({ colsOpen: l.colsOpen.map((o, j) => (j === 1 ? true : o)) as Layout['colsOpen'] }))} />
      )}
      <ColumnBorder left={1} layout={layout} onLayout={onLayout} grid={grid} />
      {layout.colsOpen[2] ? (
      <div className="step-col">
              <TechnicalBox
          entry={current}
          query={query}
          runTimings={runTimings}
          open={layout.technicalOpen}
          onToggle={() => onLayout((l) => ({ technicalOpen: !l.technicalOpen }))}
          actions={<CollapseButton title="the Technical and Variables column" onClick={() => onLayout((l) => ({ colsOpen: l.colsOpen.map((o, j) => (j === 2 ? false : o)) as Layout['colsOpen'] }))} />}
        />

      <Box title={frame.level > 0 ? `Variables in ${frame.name}` : 'Variables'} icon="variable" count={variables.length} className="tone-variable" open={layout.variablesOpen} onToggle={() => onLayout((l) => ({ variablesOpen: !l.variablesOpen }))}>
        {variables.length === 0 ? (
          <p className="empty-note">No variables stored yet.</p>
        ) : (
          <ul className="variable-list">
            {variables.map((v) => (
              <li key={v.index}>
                <button type="button" className="link-button" onClick={() => onStep(v.index)}>
                  {v.title.replace(/^VAR | is stored$/g, '')}
                </button>{' '}
                <span className="muted">stored at step {v.index + 1}; keeps this value from now on</span>
              </li>
            ))}
          </ul>
        )}
      </Box>

      </div>
      ) : (
        <PaneStrip title="Technical and Variables" icon="logo" tone="technical" onOpen={() => onLayout((l) => ({ colsOpen: l.colsOpen.map((o, j) => (j === 2 ? true : o)) as Layout['colsOpen'] }))} />
      )}
    </div>
  );
}

interface StoryListProps {
  entries: readonly FlatEntry[];
  index: number;
  onStep: (index: number) => void;
  values: StepValues;
  connected: boolean;
  open: boolean;
  onToggle: () => void;
}

/** Every step, in order, with the measures stepped into in tinted bands: the way to jump around. */
export function StoryList({ entries, index, onStep, values, connected, open, onToggle }: StoryListProps) {
  // Keep the current step in view while stepping through a long measure.
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    scrollWithin(pane.current, pane.current?.querySelector('li.is-current'), 40);
  }, [index, entries]);
  return (
    <section className="story-pane" aria-label="The story so far" ref={pane}>
      <header className="step-box-header">
        <button type="button" className="box-toggle" aria-expanded={open} onClick={onToggle} title={open ? 'Fold the story so far' : 'Unfold the story so far'}>
          <span className="box-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <Icon name="steps" />
          <h3>The story so far</h3>
        </button>
        <span className="count-badge">{entries.length === 0 ? 0 : `${index + 1} / ${entries.length}`}</span>
      </header>
      {open && (<ol className="story-list">
        {entries.map((e) => {
          const eTint = frameTint(e.frame.level);
          return (
            <li
              key={e.index}
              className={[
                e.index === index ? 'is-current' : '',
                e.index > index ? 'is-future' : '',
                eTint ? `in-frame frame-tint-${eTint}` : '',
                e.kind === 'enter' || e.kind === 'return' ? 'is-boundary' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ paddingInlineStart: `${0.5 + e.depth * 0.9}rem` } as CSSProperties}
            >
              <button type="button" onClick={() => onStep(e.index)} aria-current={e.index === index ? 'step' : undefined}>
                <span className="story-number">{e.index + 1}</span>
                <span className="story-title">{e.title}</span>
                {connected && <StoryValue query={values.queryFor(e)} state={values.stateOf(values.queryFor(e))} />}
              </button>
            </li>
          );
        })}
      </ol>)}
    </section>
  );
}

/** "Step into [Measure]" on a step that calls a measure, or why it can't be stepped into. */
function StepIntoControl({ target, isExpanded, onExpand }: { target: StepInto; isExpanded: (key: string) => boolean; onExpand: (key: string, expanded: boolean) => void }) {
  if (target.kind === 'unavailable') return <p className="value-note">Step into: {target.reason}</p>;
  const name = `[${target.definition.name}]`;
  if (isExpanded(target.key)) {
    return (
      <p className="step-into">
        <span className="muted">The steps inside {name} come next. Press Next to go in.</span>
        <button type="button" className="secondary-button" onClick={() => onExpand(target.key, false)}>
          Hide the steps inside {name}
        </button>
      </p>
    );
  }
  return (
    <p className="step-into">
      <button type="button" className="primary-button" onClick={() => onExpand(target.key, true)} title={`Show the steps inside ${name}, right after this one`}>
        Step into {name} <Icon name="next" />
      </button>
      <span className="muted">or press Next to step over it.</span>
    </p>
  );
}

/** For experienced users: the context in DAX's own terms, and the exact query behind the value. */
function TechnicalBox({
  entry,
  query,
  runTimings,
  open,
  onToggle,
  actions,
}: {
  entry: FlatEntry;
  query: StepQuery;
  runTimings: StepPanelProps['runTimings'];
  open: boolean;
  onToggle: () => void;
  actions: ReactNode;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const reach = useFilterReach(entry.innerContext ?? entry.context)?.reach;
  const reached = reach?.tables.filter((t) => t.state === 'reached') ?? [];
  // The filter context the inside sees (after CALCULATE or context transition); the row context where the step runs.
  const context = { filter: technicalContext(entry.innerContext ?? entry.context).filter, rows: technicalContext(entry.context).rows };
  const noQuery =
    query.kind === 'needs-row'
      ? `The value depends on which row of ${query.iteratorName} is meant: connect to a report and pick one at the "${query.iteratorName} goes row by row" step.`
      : query.kind === 'none' && query.reason
        ? query.reason
        : 'No value is calculated at this step.';
  const dax = query.kind === 'scalar' || query.kind === 'table' || query.kind === 'rows' ? evaluateText(query) : null;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setCopied(null);
    }
  };
  return (
    <Box title="Technical" icon="logo" className="step-box-technical tone-technical" open={open} onToggle={onToggle} actions={actions}>
      <dl className="technical-list">
        <dt>Filter context{entry.innerContext ? ' (inside)' : ''}</dt>
        <dd>
          <ul>
            {context.filter.map((line, i) => (
              <li key={i}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
        </dd>
        <dt>Row context (at this step)</dt>
        <dd>
          {context.rows.length === 0 ? (
            <span className="muted">none</span>
          ) : (
            <ul>
              {context.rows.map((line, i) => (
                <li key={i}>
                  <code>{line}</code>
                </li>
              ))}
            </ul>
          )}
        </dd>
        {reach && (
          <>
            <dt>Filter propagation</dt>
            <dd>
              {reached.length === 0 ? (
                <span className="muted">no relationship carries a filter here</span>
              ) : (
                <ul>
                  {reached.map((t) => (
                    <li key={t.table}>
                      <code>{pathText(t)}</code>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </>
        )}
        {entry.operations.length > 0 && (
          <>
            <dt>Operations</dt>
            <dd>
              <ol>
                {entry.operations.map((op, i) => (
                  <li key={i}>{technicalOperation(op)}</li>
                ))}
              </ol>
            </dd>
          </>
        )}
        <dt>Query for this value</dt>
        <dd>
          {dax ? (
            <>
              <p className="technical-copy">
                <button type="button" className="secondary-button" onClick={() => void copy(dax)}>
                  {copied === dax ? 'Copied' : 'Copy query'}
                </button>
                <span className="muted">to run it in DAX Studio or a DAX query view.</span>
              </p>
              <details className="technical-details">
                <summary>Show the query</summary>
                <pre className="technical-query">{dax}</pre>
              </details>
            </>
          ) : (
            <span className="muted">{noQuery}</span>
          )}
        </dd>
        {dax && (
          <>
            <dt>Timings</dt>
            <dd>
              <Timings key={dax} query={query} runTimings={runTimings} />
            </dd>
          </>
        )}
      </dl>
    </Box>
  );
}

/** "Run with timings": where the time of this step's query goes, as the engine reports it. */
function Timings({ query, runTimings }: { query: StepQuery; runTimings: StepPanelProps['runTimings'] }) {
  const [clearCache, setClearCache] = useState(false);
  const [state, setState] = useState<{ status: 'idle' } | { status: 'running' } | { status: 'done'; result: TimingResult } | { status: 'error'; message: string }>({
    status: 'idle',
  });
  const request = timingRequest(query);
  if (!request) return null;
  if (!runTimings) return <span className="muted">Connect to a report to time this query.</span>;
  const run = async () => {
    setState({ status: 'running' });
    try {
      setState({ status: 'done', result: await runTimings(request.kind, request.dax, clearCache) });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'The timings could not be collected.' });
    }
  };
  const summary = state.status === 'done' ? summarizeTimings(state.result) : null;
  return (
    <div className="timings">
      <p className="technical-copy">
        <button type="button" className="secondary-button" onClick={() => void run()} disabled={state.status === 'running'}>
          {state.status === 'running' ? 'Running…' : 'Run with timings'}
        </button>
        <label className="timings-cold">
          <input type="checkbox" checked={clearCache} onChange={(e) => setClearCache(e.target.checked)} /> Clear cache first
        </label>
      </p>
      {state.status === 'running' && <p className="muted">Timing takes a few seconds: the engine reports its timings a moment after the query ends.</p>}
      {state.status === 'error' && <p className="data-bar-error">{state.message}</p>}
      {summary && state.status === 'done' && (
        <>
          <p className="timings-total">
            <strong>{summary.totalMs} ms</strong> in total{state.result.clearedCache ? ', from a cold start' : ''}
          </p>
          {summary.totalMs > 0 && (
            <div className="timings-bar" aria-hidden="true">
              <span className="timings-bar-storage" style={{ width: `${(summary.storageMs / summary.totalMs) * 100}%` }} />
              <span className="timings-bar-formula" style={{ width: `${(summary.formulaMs / summary.totalMs) * 100}%` }} />
            </div>
          )}
          <ul className="timings-split">
            <li>
              <span className="timings-key timings-key-storage" /> Reading data (storage engine): <strong>{summary.storageMs} ms</strong>, {summary.scans}{' '}
              {summary.scans === 1 ? 'scan' : 'scans'}
              {summary.cacheHits > 0 ? `, ${summary.cacheHits} from memory` : ''}
            </li>
            <li>
              <span className="timings-key timings-key-formula" /> Calculating (formula engine): <strong>{summary.formulaMs} ms</strong>{' '}
              <span className="muted">(the rest of the total)</span>
            </li>
          </ul>
          <p>{summary.verdict}</p>
          {summary.notes.map((note, i) => (
            <p key={i} className="muted">
              {note}
            </p>
          ))}
          {state.result.scans.length > 0 && (
            <details className="technical-details">
              <summary>Show the scans ({state.result.scans.length})</summary>
              <ol className="timings-scans">
                {state.result.scans.map((s, i) => (
                  <li key={i}>
                    <span className="muted">{s.fromCache ? 'from memory' : `${s.durationMs ?? '?'} ms`}</span>
                    <pre className="technical-query">{s.text.trim()}</pre>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Where the step runs: the report's filters (F), the measures stepped into, then the loops (with the row
 * picked, if any) and CALCULATEs around it. Clicking one goes to its step.
 */
function Where({ entry, parts, rowFor, onSelectNode, root }: { entry: FlatEntry; parts: StepParts; rowFor: (iteratorNodeId: number) => RowChoice | undefined; onSelectNode: (node: AstNode) => void; root: AstNode | null }) {
  const filters = useReportFilters();
  const measures = framePath(entry.frame).slice(1);
  const go = (nodeId: number) => {
    const node = findNode(root, nodeId);
    if (node) onSelectNode(node);
  };
  return (
    <p className="step-crumbs" aria-label="Where this step runs">
      <span className="crumb crumb-report" title="The report's filters (F)">F: {pillLabel(filters)}</span>
      {measures.map((m) => (
        <span key={m.key} className="crumb-item">
          <span className="crumb-sep" aria-hidden="true">▸</span>
          <span className="crumb crumb-measure">{m.name}</span>
        </span>
      ))}
      {parts.where.map((c) => {
        const row = c.kind === 'loop' ? rowFor(c.nodeId) : undefined;
        return (
          <span key={c.nodeId} className="crumb-item">
            <span className="crumb-sep" aria-hidden="true">▸</span>
            <button type="button" className={`crumb crumb-${c.kind}`} onClick={() => go(c.nodeId)}>
              {c.text}
            </button>
            {row && (
              <>
                <span className="crumb-sep" aria-hidden="true">▸</span>
                <span className="crumb crumb-row" title={row.columns.map((c, i) => `${c} = ${formatQueryValue(row.values[i] ?? null)}`).join(', ')}>
                  row: {row.values.map((v) => formatQueryValue(v)).join(' · ')}
                </span>
              </>
            )}
          </span>
        );
      })}
    </p>
  );
}

/** What changes at this step: one line per change, in the order DAX makes them. */
function Diff({ entry, parts, root, onSelectNode }: { entry: FlatEntry; parts: StepParts; root: AstNode | null; onSelectNode: (node: AstNode) => void }) {
  if (entry.kind === 'start' || entry.kind === 'result' || entry.kind === 'enter' || entry.kind === 'return') return null;
  return <DiffList lines={parts.diff} context={entry.context} root={root} onSelectNode={onSelectNode} />;
}


/** A step's value in the story list, once it has been calculated (single values only). */
function StoryValue({ query, state }: { query: StepQuery; state: ValueState }) {
  if (query.kind !== 'scalar' || state.status !== 'ready') return null;
  return <span className="story-value">{formatQueryValue(state.result.rows[0]?.[0] ?? null)}</span>;
}
