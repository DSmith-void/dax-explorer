import type { ReactNode } from 'react';
import type { ContextAnalysis } from '../engine/context/model';
import type { TimelineEntry, TimelineKind } from '../engine/context/timeline';
import type { AstNode } from '../engine/parser/ast';
import { findNode } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import type { DetailLevel } from './ContextInspectorPanel';
import { ContextView } from './ContextView';
import { Icon, type IconName } from './Icons';
import { OperationList } from './OperationList';

interface StepPanelProps {
  entries: readonly TimelineEntry[];
  index: number;
  onStep: (index: number) => void;
  analysis: ContextAnalysis | null;
  root: AstNode | null;
  source: string;
  detail: DetailLevel;
  onSelectNode: (node: AstNode) => void;
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
export function StepPanel({ entries, index, onStep, analysis, root, source, detail, onSelectNode }: StepPanelProps) {
  const current = entries[index];
  if (!current) {
    return <p className="empty-note">Nothing to step through yet. Pick a measure, or write your own DAX and press Explain.</p>;
  }
  const lineAt = createLineMap(source);
  const notes = detail === 'detailed' && current.nodeId !== null && HAS_NOTES.has(current.kind)
    ? (analysis?.steps.get(current.nodeId)?.notes ?? []).filter((n) => n !== current.summary)
    : [];
  const changed = current.innerContext !== undefined && current.operations.length > 0;
  const variables = entries.slice(0, index + 1).filter((e) => e.kind === 'variable');
  const node = current.nodeId !== null ? findNode(root, current.nodeId) : null;

  return (
    <div className="step-grid">
      <Box title="This step" icon="steps" className="step-box-current">
        <p className="step-kind">
          <span className="kind-badge">{KIND_LABEL[current.kind]}</span>
          {node && current.kind !== 'start' && current.kind !== 'result' && (
            <span className="step-where">line {lineAt(node.span.start).line}</span>
          )}
        </p>
        <h4 className="step-title">{current.title}</h4>
        <p className="step-summary">{current.summary}</p>
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

      <Box title="Variables" icon="variable" count={variables.length}>
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

      <Box title="The story so far" icon="steps" count={index + 1} className="step-box-story">
        <ol className="story-list">
          {entries.map((e) => (
            <li
              key={e.index}
              className={[e.index === index ? 'is-current' : '', e.index > index ? 'is-future' : ''].filter(Boolean).join(' ')}
              style={{ paddingInlineStart: `${0.5 + e.depth * 0.9}rem` }}
            >
              <button type="button" onClick={() => onStep(e.index)} aria-current={e.index === index ? 'step' : undefined}>
                <span className="story-number">{e.index + 1}</span>
                {e.title}
              </button>
            </li>
          ))}
        </ol>
      </Box>
    </div>
  );
}
