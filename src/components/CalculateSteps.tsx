import type { ReactNode } from 'react';
import { entryText, incomingText, removalText, relationshipChangeText } from '../engine/context/describe';
import type { EvalContext, Step } from '../engine/context/model';
import { findNode, type AstNode, type FunctionCall } from '../engine/parser/ast';

interface CalculateStepsProps {
  node: FunctionCall;
  step: Step;
  source: string;
  onSelectNode: (node: AstNode) => void;
}

/** Short summary of a context for use inside a sentence, or null when it is too long to read inline. */
function summary(context: EvalContext): string | null {
  if (context.filter.entries.length > 0) return null;
  const text = incomingText(context.filter.removals);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();

/**
 * "How this CALCULATE works": DAX's fixed CALCULATE order, written out in plain
 * language for this specific call. Only the steps that actually apply are listed.
 */
export function CalculateSteps({ node, step, source, onSelectNode }: CalculateStepsProps) {
  const name = node.name.toUpperCase();
  const code = (n: AstNode | null, fallback: string) => {
    if (!n) return <code>{fallback}</code>;
    const text = source.slice(n.span.start, n.span.end).replace(/\s+/g, ' ').trim();
    return (
      <button type="button" className="link-button" onClick={() => onSelectNode(n)}>
        {text.length > 50 ? `${text.slice(0, 49)}…` : text}
      </button>
    );
  };
  const items: ReactNode[] = [];

  const starting = summary(step.context);
  items.push(
    <>
      Start with the filters already in effect here: <strong>{starting ?? 'see "Filters in effect here" above'}</strong>.
    </>,
  );

  const filterCount = step.operations.filter((op) => op.kind === 'add-filter').length;
  if (filterCount > 0) {
    items.push(
      <>
        Check the filter {filterCount === 1 ? 'condition' : 'conditions'} using those starting filters, before anything below
        changes them.
      </>,
    );
  }

  const transition = step.operations.find((op) => op.kind === 'context-transition');
  items.push(
    transition && transition.kind === 'context-transition' ? (
      <>
        {transition.rows.map((r) => r.functionName).join(' and ')} is going row by row, so the current row is added as a filter
        (context transition): <code>{transition.added.map(entryText).join(', ')}</code>.
      </>
    ) : (
      <>Nothing here is going row by row, so no row is added as a filter.</>
    ),
  );

  for (const op of step.operations) {
    const argNode = 'nodeId' in op ? findNode(node, op.nodeId) : null;
    if (op.kind === 'remove-filters' && op.because) {
      items.push(
        <>
          DAX also removes every other filter on <strong>{removalText(op.removal)}</strong>, by itself, because {op.because}.
        </>,
      );
    } else if (op.kind === 'remove-filters') {
      items.push(
        <>
          {code(argNode, op.functionName)} removes any filter on <strong>{removalText(op.removal)}</strong>.
        </>,
      );
    } else if (op.kind === 'add-filter') {
      const argText = argNode ? source.slice(argNode.span.start, argNode.span.end) : '';
      // Say what the filter does only when it differs from what is written (e.g. FILTER(...) or KEEPFILTERS(...)).
      const effect = normalize(argText) === normalize(entryText(op.entry)) ? null : <strong>{entryText(op.entry)}</strong>;
      const replaces = op.replacesIncoming || op.replaced.length > 0;
      items.push(
        op.entry.mode === 'intersect' ? (
          <>
            Add the filter {code(argNode, 'filter')}
            {effect ? <> ({effect})</> : null} on top of the existing filters. Because of KEEPFILTERS, only rows that pass both
            are included.
          </>
        ) : (
          <>
            Apply the filter {code(argNode, 'filter')}
            {effect ? <> ({effect})</> : null}
            {replaces ? '. It replaces any filter already on that column' : ''}.
          </>
        ),
      );
    } else if (op.kind === 'relationship') {
      items.push(
        <>
          {code(argNode, op.change.functionName)}: {relationshipChangeText(op.change).replace(/^./, (c) => c.toLowerCase())}, for the calculation inside.
        </>,
      );
    } else if (op.kind === 'not-modeled') {
      items.push(
        <>
          {code(argNode, 'This part')}: not checked. {op.description.charAt(0).toUpperCase() + op.description.slice(1)}.
        </>,
      );
    }
  }

  const first = node.args[0] ?? null;
  if (step.innerContext) {
    const result = summary(step.innerContext);
    items.push(
      result ? (
        <>
          Calculate {code(first, 'the first input')} using <strong>{result}</strong>.
        </>
      ) : (
        <>Calculate {code(first, 'the first input')} using the filters listed below.</>
      ),
    );
  }

  return (
    <section className="inspector-section">
      <h3>How this {name} works, step by step</h3>
      <ol className="calculate-steps">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
      {step.operations.some((op) => op.kind === 'remove-filters') && step.operations.some((op) => op.kind === 'add-filter') && (
        <p className="inspector-detail">DAX always removes filters before adding new ones, no matter the order they are written in.</p>
      )}
    </section>
  );
}
