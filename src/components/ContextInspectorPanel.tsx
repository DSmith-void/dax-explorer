import type { AnalysisResult } from '../app/analysis';
import type { BindResult } from '../engine/binder/binder';
import type { ArgRole } from '../engine/catalog/functions';
import { findNode, type AstNode, type FunctionCall } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import { presentNode, resolutionTag } from './astPresentation';
import { Panel } from './Panel';

const PLANNED_SECTIONS = [
  'Incoming filter context',
  'Incoming row context',
  'Filters added, replaced, retained, removed',
  'Context transition',
  'Resulting evaluation context',
];

const ROLE_TEXT: Record<ArgRole, string> = {
  scalar: 'value',
  table: 'table',
  column: 'column (required)',
  tableOrColumn: 'table or column',
  filter: 'filter / modifier',
  rowExpression: 'evaluated per row (row context)',
  keyword: 'keyword',
};

interface ContextInspectorPanelProps {
  result: AnalysisResult | null;
  binding: BindResult | null;
  selectedId: number | null;
  onSelectNode: (node: AstNode) => void;
}

export function ContextInspectorPanel({ result, binding, selectedId, onSelectNode }: ContextInspectorPanelProps) {
  const root = result?.parse?.root ?? null;
  const node = selectedId !== null ? findNode(root, selectedId) : null;

  return (
    <Panel id="context-inspector" title="Context Inspector" status={node ? 'Syntax + references' : 'Planned'}>
      {result && node ? (
        <SelectedNodeDetails node={node} result={result} binding={binding} onSelectNode={onSelectNode} />
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

interface DetailsProps {
  node: AstNode;
  result: AnalysisResult;
  binding: BindResult | null;
  onSelectNode: (node: AstNode) => void;
}

function SelectedNodeDetails({ node, result, binding, onSelectNode }: DetailsProps) {
  const presentation = presentNode(node, result.text, binding);
  const positionAt = createLineMap(result.text);
  const from = positionAt(node.span.start);
  const to = positionAt(node.span.end);
  const text = result.text.slice(node.span.start, node.span.end);
  const declaration = node.kind === 'VariableRef' ? findNode(result.parse?.root ?? null, node.declarationId) : null;
  const resolution = binding?.references.get(node.id);

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
        {resolution && (
          <>
            <dt>Type</dt>
            <dd>
              <strong>{resolution.type ?? 'unknown'}</strong>{' '}
              <span className={`certainty-tag tone-${resolutionTag(resolution).tone}`}>{resolutionTag(resolution).text}</span>
              <div className="inspector-detail">{resolution.detail}</div>
            </dd>
          </>
        )}
      </dl>
      {text.trim() !== '' && <pre className="inspector-source">{text}</pre>}

      {resolution && resolution.type !== 'column' && (
        <p className="inspector-note">
          Why it matters: a <strong>measure</strong> reference triggers <strong>context transition</strong> when it is
          evaluated in a row context; a <strong>column</strong> reference does not.
        </p>
      )}

      {node.kind === 'FunctionCall' && <FunctionDetails node={node} result={result} binding={binding} onSelectNode={onSelectNode} />}

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

/** The argument's own source text (shortened), which reads better in a list than a tree label like ">". */
function argumentText(arg: AstNode, source: string, binding: BindResult | null): string {
  const text = source.slice(arg.span.start, arg.span.end).replace(/\s+/g, ' ').trim();
  if (text === '') return presentNode(arg, source, binding).label; // skipped or missing argument
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

function FunctionDetails({
  node,
  result,
  binding,
  onSelectNode,
}: {
  node: FunctionCall;
  result: AnalysisResult;
  binding: BindResult | null;
  onSelectNode: (node: AstNode) => void;
}) {
  const call = binding?.calls.get(node.id);
  if (!call?.spec) {
    return (
      <p className="notice notice-unsupported">
        <span>
          <strong>{node.name}</strong> is not in the function catalog yet. Its arguments are shown, but nothing is
          concluded from them.
        </span>
      </p>
    );
  }

  return (
    <div className="function-details">
      <p>{call.spec.summary}</p>
      {node.args.length > 0 && (
        <ol className="argument-list">
          {node.args.map((arg, index) => {
            const param = call.params?.[index];
            return (
              <li key={arg.id}>
                <button type="button" className="link-button" onClick={() => onSelectNode(arg)}>
                  {argumentText(arg, result.text, binding)}
                </button>{' '}
                <span className="ast-kind">
                  {param ? `${param.name}: ${ROLE_TEXT[param.role]}` : 'argument does not match the catalog signature'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
