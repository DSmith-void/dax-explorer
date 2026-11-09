import type { CSSProperties } from 'react';
import { Panel } from './Panel';

/** Static illustration of a future tree for the default sample. Not produced by a parser. */
const EXAMPLE_NODES: { depth: number; text: string; kind: string }[] = [
  { depth: 0, text: 'DIVIDE', kind: 'scalar' },
  { depth: 1, text: '[Total Sales]', kind: 'measure ref' },
  { depth: 1, text: 'CALCULATE', kind: 'scalar' },
  { depth: 2, text: '[Total Sales]', kind: 'measure ref' },
  { depth: 2, text: 'REMOVEFILTERS', kind: 'filter modifier' },
  { depth: 3, text: 'Product[Category]', kind: 'column ref' },
];

export function ExpressionTreePanel() {
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
      <p className="placeholder-note">Illustration only. No parsing has happened.</p>
    </Panel>
  );
}
