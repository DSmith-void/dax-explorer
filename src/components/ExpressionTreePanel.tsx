import type { CSSProperties } from 'react';
import type { AnalysisResult } from '../app/analysis';
import type { AstNode } from '../engine/parser/ast';
import { ExpressionTree } from './ExpressionTree';
import { Panel } from './Panel';
import { TokenTable } from './TokenTable';

/** Static illustration shown before the first analysis. */
const EXAMPLE_NODES: { depth: number; text: string; kind: string }[] = [
  { depth: 0, text: 'DIVIDE', kind: 'function call' },
  { depth: 1, text: '[Total Sales]', kind: 'measure or column?' },
  { depth: 1, text: 'CALCULATE', kind: 'function call' },
  { depth: 2, text: '[Total Sales]', kind: 'measure or column?' },
  { depth: 2, text: 'REMOVEFILTERS', kind: 'function call' },
  { depth: 3, text: 'Product[Category]', kind: 'column reference' },
];

interface ExpressionTreePanelProps {
  result: AnalysisResult | null;
  selectedId: number | null;
  onSelectNode: (node: AstNode) => void;
}

export function ExpressionTreePanel({ result, selectedId, onSelectNode }: ExpressionTreePanelProps) {
  if (!result) {
    return (
      <Panel id="expression-tree" title="Expression Tree" status="Syntax only">
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
    <Panel id="expression-tree" title="Expression Tree" status="Syntax only">
      {root ? (
        <>
          <p className="placeholder-lead">
            How the expression is put together{result.header ? ' (after the measure name)' : ''}. Click a node to
            highlight its text in the editor. Meaning (filters, context) is not analyzed yet.
          </p>
          <ExpressionTree root={root} source={result.text} selectedId={selectedId} onSelect={onSelectNode} />
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
