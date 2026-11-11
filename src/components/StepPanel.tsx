import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { scrollWithin } from './scrollWithin';
import { frameTint, type FlatEntry, type StepInto } from '../app/frames';
import type { ValueState } from '../app/useStepValues';
import { evaluateText, rowKey, type RowChoice, type StepQuery } from '../engine/context/stepQuery';
import { technicalContext, technicalOperation } from '../engine/context/technical';
import type { TimelineKind } from '../engine/context/timeline';
import type { AstNode } from '../engine/parser/ast';
import { findNode } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import type { DetailLevel } from './ContextInspectorPanel';
import { ContextView } from './ContextView';
import { Icon, type IconName } from './Icons';
import { OperationList } from './OperationList';
import { StepValue } from './StepValue';
import { formatQueryValue } from './valueFormat';

interface StepPanelProps {
  entries: readonly FlatEntry[];
  index: number;
  onStep: (index: number) => void;
  detail: DetailLevel;
  onSelectNode: (node: AstNode) => void;
  /** Real values from the connected report. */
  values: StepValues;
  connected: boolean;
  /** Whether the measure called at a step can be stepped into. */
  stepInto: (entry: FlatEntry) => StepInto | null;
  isExpanded: (key: string) => boolean;
  onExpand: (key: string, expanded: boolean) => void;
}

/** What StepPanel needs from useStepValues. */
export interface StepValues {
  queryFor: (entry: FlatEntry) => StepQuery;
  stateOf: (query: StepQuery) => ValueState;
  rows: ReadonlyMap<string, RowChoice>;
  pickRow: (frameKey: string, iteratorNodeId: number, choice: RowChoice) => void;
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

function Box({ title, icon, count, className, children }: { title: string; icon: IconName; count?: number; className?: string; children: ReactNode }) {
  return (
    <section className={['step-box', className].filter(Boolean).join(' ')}>
      <header className="step-box-header">
        <Icon name={icon} />
        <h3>{title}</h3>
        {count !== undefined && <span className="count-badge">{count}</span>}
      </header>
      <div className="step-box-body">{children}</div>
    </section>
  );
}

/** The "Step" tab: what happens at the current step, the filters, the variables, and the story so far. */
export function StepPanel({ entries, index, onStep, detail, onSelectNode, values, connected, stepInto, isExpanded, onExpand }: StepPanelProps) {
  const current = entries[index];
  if (!current) {
    return <p className="empty-note">Nothing to step through yet. Pick a measure, or write your own DAX and press Explain.</p>;
  }
  const { frame } = current;
  const root = frame.result.parse?.root ?? null;
  const source = frame.result.text;
  const lineAt = createLineMap(source);
  const notes = detail !== 'brief' && current.nodeId !== null && HAS_NOTES.has(current.kind)
    ? (frame.analysis?.steps.get(current.nodeId)?.notes ?? []).filter((n) => n !== current.summary)
    : [];
  const changed = current.innerContext !== undefined && current.operations.length > 0;
  // Variables belong to one measure: only this measure's, stored so far.
  const variables = entries.slice(0, index + 1).filter((e) => e.kind === 'variable' && e.frame === frame);
  const node = current.nodeId !== null ? findNode(root, current.nodeId) : null;
  const query = values.queryFor(current);
  const target = stepInto(current);
  const tint = frameTint(frame.level);

  return (
    <div className="step-grid">
      <div className="step-col">
      <Box title="This step" icon="steps" className={`step-box-current${tint ? ` frame-tint-${tint}` : ''}`}>
        <p className="step-kind">
          <span className="kind-badge">{KIND_LABEL[current.kind]}</span>
          {frame.level > 0 && <span className="frame-badge">in {frame.name}</span>}
          {node && current.kind !== 'start' && current.kind !== 'result' && current.kind !== 'return' && (
            <span className="step-where">line {lineAt(node.span.start).line}</span>
          )}
        </p>
        <h4 className="step-title">{current.title}</h4>
        <p className="step-summary">{current.summary}</p>
        <StepValue
          entry={current}
          query={query}
          state={values.stateOf(query)}
          connected={connected}
          rowFor={(id) => values.rows.get(rowKey(frame.key, id))}
          onPickRow={(id, choice) => values.pickRow(frame.key, id, choice)}
        />
        {target && <StepIntoControl target={target} isExpanded={isExpanded} onExpand={onExpand} />}
        {current.kind === 'start' && entries.length > 1 && (
          <p className="step-hint">
            Press <strong>Next</strong> (or the <kbd>→</kbd> key) to go through the calculation one step at a time.
          </p>
        )}
        {notes.map((note, i) => (
          <p key={i} className="step-note">
            {note}
          </p>
        ))}
        {changed && (
          <>
            <h5 className="step-subheading">What changes, in order</h5>
            <OperationList operations={current.operations} root={root} source={source} onSelectNode={onSelectNode} />
          </>
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

      <div className="step-col">
      <Box title={changed ? 'Filters: before → after' : 'Filters at this step'} icon="filter">
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
      </Box>

      {detail !== 'brief' && <TechnicalBox entry={current} query={query} />}

      <Box title={frame.level > 0 ? `Variables in ${frame.name}` : 'Variables'} icon="variable" count={variables.length}>
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
    </div>
  );
}

interface StoryListProps {
  entries: readonly FlatEntry[];
  index: number;
  onStep: (index: number) => void;
  values: StepValues;
  connected: boolean;
}

/** Every step, in order, with the measures stepped into in tinted bands: the way to jump around. */
export function StoryList({ entries, index, onStep, values, connected }: StoryListProps) {
  // Keep the current step in view while stepping through a long measure.
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    scrollWithin(pane.current, pane.current?.querySelector('li.is-current'), 40);
  }, [index, entries]);
  return (
    <section className="story-pane" aria-label="The story so far" ref={pane}>
      <header className="step-box-header">
        <Icon name="steps" />
        <h3>The story so far</h3>
        <span className="count-badge">{entries.length === 0 ? 0 : `${index + 1} / ${entries.length}`}</span>
      </header>
      <ol className="story-list">
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
      </ol>
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
function TechnicalBox({ entry, query }: { entry: FlatEntry; query: StepQuery }) {
  const [copied, setCopied] = useState<string | null>(null);
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
    <Box title="Technical" icon="logo" className="step-box-technical">
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
      </dl>
    </Box>
  );
}

/** A step's value in the story list, once it has been calculated (single values only). */
function StoryValue({ query, state }: { query: StepQuery; state: ValueState }) {
  if (query.kind !== 'scalar' || state.status !== 'ready') return null;
  return <span className="story-value">{formatQueryValue(state.result.rows[0]?.[0] ?? null)}</span>;
}
