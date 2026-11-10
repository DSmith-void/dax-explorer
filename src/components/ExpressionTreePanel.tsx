import type { CSSProperties } from 'react';
import type { AnalysisResult } from '../app/analysis';
import type { BindResult, ReferenceType, ResolutionMode } from '../engine/binder/binder';
import type { ContextAnalysis } from '../engine/context/model';
import type { AstNode } from '../engine/parser/ast';
import { ExpressionTree } from './ExpressionTree';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';
import { TokenTable } from './TokenTable';

/** Static illustration shown before the first analysis. */
const EXAMPLE_NODES: { depth: number; text: string; kind: string }[] = [
  { depth: 0, text: 'DIVIDE', kind: 'function' },
  { depth: 1, text: '[Total Sales]', kind: "measure · all the report's filters" },
  { depth: 1, text: 'CALCULATE', kind: 'function · changes filters' },
  { depth: 2, text: '[Total Sales]', kind: 'measure · without the Category filter' },
  { depth: 2, text: 'REMOVEFILTERS', kind: 'function' },
  { depth: 3, text: 'Product[Category]', kind: 'column' },
];

const MODE_OPTIONS: { value: ResolutionMode; label: string; title: string }[] = [
  {
    value: 'convention',
    label: 'Naming convention',
    title: '[Name] is assumed to be a measure and Table[Name] a column, unless known otherwise. Assumptions are labeled.',
  },
  { value: 'strict', label: 'Strict', title: 'Nothing is assumed. Unknown references stay unknown until you choose.' },
];

const MODE_HINTS: Record<ResolutionMode, string> = {
  convention: 'Names like [Total Sales] are assumed to be measures, and names like Sales[Amount] columns, unless the DAX proves otherwise.',
  strict: 'Nothing is assumed: a name stays "unknown" until the DAX proves what it is or you choose.',
};

interface ExpressionTreePanelProps {
  result: AnalysisResult | null;
  binding: BindResult | null;
  analysis: ContextAnalysis | null;
  selectedId: number | null;
  onSelectNode: (node: AstNode) => void;
  referenceMode: ResolutionMode;
  onReferenceModeChange: (mode: ResolutionMode) => void;
  onChooseReferenceType: (key: string, type: ReferenceType | null) => void;
  userChoiceCount: number;
  onClearChoices: () => void;
  /** Name of the connected Power BI report, or null when not connected. */
  connectedReport: string | null;
}

export function ExpressionTreePanel(props: ExpressionTreePanelProps) {
  const { result, binding, selectedId, onSelectNode, referenceMode, onReferenceModeChange } = props;

  const modeSwitch = (
    <div className="panel-setting">
      <span className="field-label" aria-hidden="true">
        Reference types
      </span>
      <SegmentedControl label="Reference types" options={MODE_OPTIONS} value={referenceMode} onChange={onReferenceModeChange} />
    </div>
  );

  if (!result) {
    return (
      <Panel id="expression-tree" title="Expression Tree" status="Syntax + references" actions={modeSwitch}>
        <p className="placeholder-lead">
          Press <strong>Analyze DAX</strong> to see the structure of the expression: function calls, references,
          variables and operators.
        </p>
        <ul className="placeholder-example" aria-label="Example of an expression tree">
          {EXAMPLE_NODES.map((node, index) => (
            <li key={index} style={{ '--depth': node.depth } as CSSProperties}>
              <span className="node-text">{node.text}</span>
              <span className="node-kind">{node.kind}</span>
            </li>
          ))}
        </ul>
        <p className="placeholder-note">Illustration only.</p>
      </Panel>
    );
  }

  const root = result.parse?.root ?? null;
  const tokenCount = result.lex ? result.lex.tokens.filter((t) => t.kind !== 'EndOfInput').length : 0;

  return (
    <Panel id="expression-tree" title="Expression Tree" status="Syntax + references" actions={modeSwitch}>
      {root ? (
        <>
          <p className="placeholder-lead">
            Click any part to highlight it in the editor and see its details below.{' '}
            {props.connectedReport ? (
              <>
                Names are checked against your connected report (<strong>{props.connectedReport}</strong>), so measures and
                columns it knows are certain.
              </>
            ) : (
              <>
                {MODE_HINTS[referenceMode]} Use the <em>measure</em> / <em>column</em> buttons to set a name yourself.
              </>
            )}
          </p>
          <ExpressionTree
            root={root}
            source={result.text}
            binding={binding}
            analysis={props.analysis}
            selectedId={selectedId}
            onSelect={onSelectNode}
            onChooseReferenceType={props.onChooseReferenceType}
          />
          {props.userChoiceCount > 0 && (
            <p className="hint">
              {props.userChoiceCount} remembered {props.userChoiceCount === 1 ? 'choice' : 'choices'} (stored in this
              browser only).{' '}
              <button type="button" className="link-button" onClick={props.onClearChoices}>
                Forget all
              </button>
            </p>
          )}
        </>
      ) : (
        <p className="placeholder-lead">
          {result.lex
            ? 'There is no expression to show. See Diagnostics below.'
            : 'Nothing was parsed because the measure header could not be found. See Diagnostics below.'}
        </p>
      )}
      {result.lex && tokenCount > 0 && (
        <details className="token-details">
          <summary>Tokens ({tokenCount})</summary>
          <TokenTable source={result.text} tokens={result.lex.tokens} />
        </details>
      )}
    </Panel>
  );
}
