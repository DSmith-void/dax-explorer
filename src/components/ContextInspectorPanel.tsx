import type { AnalysisResult } from '../app/analysis';
import type { BindResult } from '../engine/binder/binder';
import type { ArgRole } from '../engine/catalog/functions';
import type { ContextAnalysis, Step } from '../engine/context/model';
import { findNode, type AstNode, type FunctionCall } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import { presentNode, resolutionTag } from './astPresentation';
import { ContextView } from './ContextView';
import { DiffList } from './DiffList';
import { stepParts } from '../engine/context/stepParts';
import { Panel } from './Panel';

const ROLE_TEXT: Record<ArgRole, string> = {
  scalar: 'calculated once',
  table: 'a table',
  column: 'must be a column',
  tableOrColumn: 'a table or a column',
  filter: 'a filter (or a filter remover such as ALL)',
  rowExpression: 'calculated for each row',
  keyword: 'an option word',
};

interface ContextInspectorPanelProps {
  result: AnalysisResult | null;
  binding: BindResult | null;
  analysis: ContextAnalysis | null;
  selectedId: number | null;
  onSelectNode: (node: AstNode) => void;
  /** Opens a measure from the connected model in the editor. */
  onOpenMeasure: (name: string, expression: string) => void;
}

export function ContextInspectorPanel({
  result,
  binding,
  analysis,
  selectedId,
  onSelectNode,
  onOpenMeasure,
}: ContextInspectorPanelProps) {
  const root = result?.parse?.root ?? null;
  const node = selectedId !== null ? findNode(root, selectedId) : null;

  return (
    <Panel id="context-inspector" title="Selected part">
      {result && node ? (
        <SelectedNodeDetails
          node={node}
          result={result}
          binding={binding}
          analysis={analysis}
          step={analysis?.steps.get(node.id) ?? null}
          onSelectNode={onSelectNode}
          onOpenMeasure={onOpenMeasure}
        />
      ) : (
        <p className="placeholder-lead">
          Click any part of the code or the expression tree to see what it changes and which filters apply there.
        </p>
      )}
      <Glossary />
    </Panel>
  );
}

/** Plain-language definitions of the few terms the explanations rely on. */
function Glossary() {
  return (
    <details className="glossary">
      <summary>New to these terms?</summary>
      <dl>
        <dt>The report's filters</dt>
        <dd>
          Everything that limits which data a number in a report includes: slicers, the filters pane, and the row and column
          the number sits in. This app doesn't see your report, so it just calls them "the report's filters".
        </dd>
        <dt>Filters (filter context)</dt>
        <dd>The set of rules, at any point in a calculation, that decide which rows of data are included.</dd>
        <dt>Going row by row (row context)</dt>
        <dd>
          Functions such as SUMX, AVERAGEX, FILTER and TOPN look at a table one row at a time. While they do, there is a
          "current row" you can read values from. This does not filter anything on its own.
        </dd>
        <dt>The current row becomes a filter (context transition)</dt>
        <dd>
          When a measure or CALCULATE is used while going row by row, DAX turns the current row into a filter. The calculation
          then only includes data for that row: for example, only that customer's sales.
        </dd>
        <dt>Variables (VAR)</dt>
        <dd>Calculated once, where they are written, and then reused unchanged, even if the filters change later.</dd>
      </dl>
    </details>
  );
}

function innerHeading(node: AstNode, binding: BindResult | null, source: string): string {
  if (node.kind === 'FunctionCall') {
    const spec = binding?.calls.get(node.id)?.spec;
    if (spec?.iteratesArgument !== undefined) return 'Inside, for each row';
    const first = node.args[0];
    const label = first ? source.slice(first.span.start, first.span.end).replace(/\s+/g, ' ').trim() : '';
    return label && label.length <= 40 ? `Filters used to calculate ${label}` : 'Filters used for the calculation inside';
  }
  return 'Filters used to calculate this measure';
}

interface DetailsProps {
  node: AstNode;
  result: AnalysisResult;
  binding: BindResult | null;
  analysis: ContextAnalysis | null;
  step: Step | null;
  onSelectNode: (node: AstNode) => void;
  onOpenMeasure: (name: string, expression: string) => void;
}

function SelectedNodeDetails({ node, result, binding, analysis, step, onSelectNode, onOpenMeasure }: DetailsProps) {
  const root = result.parse?.root ?? null;
  const presentation = presentNode(node, result.text, binding);
  const positionAt = createLineMap(result.text);
  const declaration = node.kind === 'VariableRef' ? findNode(root, node.declarationId) : null;
  const resolution = binding?.references.get(node.id);
  const tag = resolution ? resolutionTag(resolution) : null;
  // The same "what changes" as the Step tab. A filter argument's change belongs to its CALCULATE, which
  // stepParts finds when the part is treated as a filter argument.
  const parts =
    step && root
      ? stepParts(
          { index: 0, kind: step.operations.length > 0 ? 'function' : 'filter-input', nodeId: node.id, title: '', summary: step.summary ?? '', context: step.context, innerContext: step.innerContext, operations: step.operations, depth: 0 },
          root,
          binding,
          analysis,
          result.text,
        )
      : null;
  const notes = step ? step.notes.filter((n) => n !== step.summary) : [];
  const filters = step ? (step.innerContext && step.operations.length > 0 ? step.innerContext : step.context) : null;

  return (
    <div className="inspector">
      <p className="step-kind">
        <span className="kind-badge">{presentation.kind}</span>
        <span className="step-where">line {positionAt(node.span.start).line}</span>
        {resolution && tag && tag.tone !== 'certain' && (
          <span className={`certainty-tag tone-${tag.tone}`} title={resolution.detail}>
            {resolution.type ?? 'measure or column?'}: {tag.text}
          </span>
        )}
      </p>
      <h4 className="step-title">{presentation.label}</h4>

      {parts && <DiffList lines={parts.diff} context={step!.context} root={root} onSelectNode={onSelectNode} />}
      {step?.summary && (parts?.diff.length ?? 0) === 0 && <p className="step-why">{step.summary}</p>}
      {notes.map((note) => (
        <p key={note} className="step-note">
          {note}
        </p>
      ))}

      {filters && (
        <section className="inspector-section">
          <h3>{step?.innerContext && step.operations.length > 0 ? innerHeading(node, binding, result.text) : 'Filters here'}</h3>
          <ContextView context={filters} compareTo={filters === step?.innerContext ? step.context : undefined} />
        </section>
      )}

      {step?.alternatives && (
        <div className="alternatives">
          <section className="alternative">
            <h3>If {presentation.label} is a measure</h3>
            <p>{step.alternatives.ifMeasure.notes.join(' ')}</p>
          </section>
          <section className="alternative">
            <h3>If {presentation.label} is a column</h3>
            <p>{step.alternatives.ifColumn.notes.join(' ')}</p>
          </section>
        </div>
      )}

      {resolution?.definition && (
        <section className="inspector-section">
          <h3>[{resolution.definition.name}] in your model</h3>
          <pre className="inspector-source">{resolution.definition.expression.trim()}</pre>
          <div>
            <button type="button" className="secondary-button" onClick={() => onOpenMeasure(resolution.definition!.name, resolution.definition!.expression)}>
              Explain [{resolution.definition.name}]
            </button>
          </div>
        </section>
      )}

      {node.kind === 'FunctionCall' && <FunctionDetails node={node} result={result} binding={binding} onSelectNode={onSelectNode} />}

      {declaration && (
        <p className="inspector-note">
          Stored at{' '}
          <button type="button" className="link-button" onClick={() => onSelectNode(declaration)}>
            VAR {node.kind === 'VariableRef' ? node.name : ''} (line {positionAt(declaration.span.start).line})
          </button>
          .
        </p>
      )}
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
          <strong>{node.name}</strong> isn't in this app's list of known functions yet. Its inputs are shown in the tree, but
          the app can't tell how they are calculated.
        </span>
      </p>
    );
  }

  return (
    <section className="inspector-section function-details">
      <h3>About {call.spec.name} and its inputs</h3>
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
                  {param ? `${param.name} — ${ROLE_TEXT[param.role]}` : 'this input doesn\'t match what the app expects for this function'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
