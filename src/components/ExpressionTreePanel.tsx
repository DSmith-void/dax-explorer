import type { CSSProperties } from 'react';
import type { AnalysisResult } from '../app/analysis';
import { Panel } from './Panel';
import { TokenTable } from './TokenTable';

/** Static illustration of a future tree for the default sample. Not produced by a parser. */
const EXAMPLE_NODES: { depth: number; text: string; kind: string }[] = [
  { depth: 0, text: 'DIVIDE', kind: 'scalar' },
  { depth: 1, text: '[Total Sales]', kind: 'measure ref' },
  { depth: 1, text: 'CALCULATE', kind: 'scalar' },
  { depth: 2, text: '[Total Sales]', kind: 'measure ref' },
  { depth: 2, text: 'REMOVEFILTERS', kind: 'filter modifier' },
  { depth: 3, text: 'Product[Category]', kind: 'column ref' },
];

interface ExpressionTreePanelProps {
  result: AnalysisResult | null;
}

export function ExpressionTreePanel({ result }: ExpressionTreePanelProps) {
  if (result) {
    return (
      <Panel id="expression-tree" title="Expression Tree" status="Tokens only">
        <p className="placeholder-lead">
          The parser is not built yet, so this shows the <strong>tokens</strong> the lexer produced. The
          tree view arrives in the next milestone.
        </p>
        <TokenTable source={result.text} tokens={result.lex.tokens} />
      </Panel>
    );
  }

  return (
    <Panel id="expression-tree" title="Expression Tree" status="Planned">
      <p className="placeholder-lead">
        The parsed expression will appear here as a tree of function calls, references, variables,
        and operators.
      </p>
      <ul className="placeholder-example" aria-label="Example of a future expression tree">
        {EXAMPLE_NODES.map((node, index) => (
          <li key={index} style={{ '--depth': node.depth } as CSSProperties}>
            <span className="node-text">{node.text}</span>
            <span className="node-kind">{node.kind}</span>
          </li>
        ))}
      </ul>
      <p className="placeholder-note">Illustration only. Press Analyze DAX to see real tokens.</p>
    </Panel>
  );
}
