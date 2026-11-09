import type { AnalysisResult } from '../app/analysis';
import { findNode, type AstNode } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import { presentNode } from './astPresentation';
import { Panel } from './Panel';

const PLANNED_SECTIONS = [
  'Incoming filter context',
  'Incoming row context',
  'Filters added, replaced, retained, removed',
  'Context transition',
  'Resulting evaluation context',
];

interface ContextInspectorPanelProps {
  result: AnalysisResult | null;
  selectedId: number | null;
  onSelectNode: (node: AstNode) => void;
}

export function ContextInspectorPanel({ result, selectedId, onSelectNode }: ContextInspectorPanelProps) {
  const root = result?.parse?.root ?? null;
  const node = selectedId !== null ? findNode(root, selectedId) : null;

  return (
    <Panel id="context-inspector" title="Context Inspector" status={node ? 'Syntax only' : 'Planned'}>
      {result && node ? (
        <SelectedNodeDetails node={node} result={result} onSelectNode={onSelectNode} />
      ) : (
        <>
          <p className="placeholder-lead">
            {result ? 'Select a node in the expression tree.' : 'After analyzing, select a node in the expression tree.'} The
            inspector will eventually show how that node changes the evaluation context:
          </p>
          <ul className="placeholder-list">
            {PLANNED_SECTIONS.map((section) => (
              <li key={section}>{section}</li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function SelectedNodeDetails({
  node,
  result,
  onSelectNode,
}: {
  node: AstNode;
  result: AnalysisResult;
  onSelectNode: (node: AstNode) => void;
}) {
  const presentation = presentNode(node, result.text);
  const positionAt = createLineMap(result.text);
  const from = positionAt(node.span.start);
  const to = positionAt(node.span.end);
  const text = result.text.slice(node.span.start, node.span.end);
  const declaration = node.kind === 'VariableRef' ? findNode(result.parse?.root ?? null, node.declarationId) : null;

  return (
    <div className="inspector">
      <dl className="inspector-facts">
        <dt>Selected</dt>
        <dd>
          <strong className="inspector-label">{presentation.label}</strong>{' '}
          <span className="ast-kind">{presentation.kind}</span>
        </dd>
        <dt>Position</dt>
        <dd>
          Line {from.line}, col {from.column} → line {to.line}, col {to.column}
        </dd>
      </dl>
      {text.trim() !== '' && <pre className="inspector-source">{text}</pre>}

      {node.kind === 'BracketRef' && (
        <p className="notice notice-unsupported">
          <span>
            <strong>[{node.name}]</strong> could be a measure or a column. Telling them apart requires model metadata, and
            the difference matters: a measure reference triggers context transition, a column reference does not.
          </span>
        </p>
      )}
      {declaration && (
        <p className="inspector-note">
          Refers to the variable defined at{' '}
          <button type="button" className="link-button" onClick={() => onSelectNode(declaration)}>
            VAR {node.kind === 'VariableRef' ? node.name : ''} (line {positionAt(declaration.span.start).line})
          </button>
          .
        </p>
      )}

      <p className="inspector-note">
        <strong>Context analysis is not available yet.</strong> This node's effect on filter and row context will appear
        here in a later milestone.
      </p>
    </div>
  );
}
