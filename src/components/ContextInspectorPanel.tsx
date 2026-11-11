import type { AnalysisResult } from '../app/analysis';
import type { BindResult } from '../engine/binder/binder';
import type { ArgRole } from '../engine/catalog/functions';
import type { ContextAnalysis, Step } from '../engine/context/model';
import { findNode, type AstNode, type FunctionCall } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import { presentNode, resolutionTag } from './astPresentation';
import { CalculateSteps } from './CalculateSteps';
import { ContextView } from './ContextView';
import { OperationList } from './OperationList';
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

/** Brief: short. Detailed: full plain-language explanations, plus the technical view (DAX's own terms and the queries). */
export type DetailLevel = 'brief' | 'detailed';

interface ContextInspectorPanelProps {
  result: AnalysisResult | null;
  binding: BindResult | null;
  analysis: ContextAnalysis | null;
  selectedId: number | null;
  detail: DetailLevel;
  onSelectNode: (node: AstNode) => void;
  /** Opens a measure from the connected model in the editor. */
  onOpenMeasure: (name: string, expression: string) => void;
}

export function ContextInspectorPanel({
  result,
  binding,
  analysis,
  selectedId,
  detail,
  onSelectNode,
  onOpenMeasure,
}: ContextInspectorPanelProps) {
  const root = result?.parse?.root ?? null;
  const node = selectedId !== null ? findNode(root, selectedId) : null;

  return (
    <Panel id="context-inspector" title="Context Inspector" status={result ? 'Symbolic' : 'Planned'}>
      {result && node ? (
        <SelectedNodeDetails
          node={node}
          result={result}
          binding={binding}
          step={analysis?.steps.get(node.id) ?? null}
          detail={detail}
          onSelectNode={onSelectNode}
          onOpenMeasure={onOpenMeasure}
        />
      ) : (
        <p className="placeholder-lead">
          {result ? 'Click any part of the expression tree' : 'After analyzing, click any part of the expression tree'} to see
          which filters are in effect at that point, whether DAX is going row by row, and what that part changes.
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
  step: Step | null;
  detail: DetailLevel;
  onSelectNode: (node: AstNode) => void;
  onOpenMeasure: (name: string, expression: string) => void;
}

/** In Brief mode: just the resulting filters, as one box. */
function BriefFilters({ node, step, binding, source }: { node: AstNode; step: Step; binding: BindResult | null; source: string }) {
  const showInner = step.innerContext && step.operations.length > 0;
  return (
    <section className="inspector-section">
      <h3>{showInner ? innerHeading(node, binding, source) : 'Filters in effect here'}</h3>
      {showInner ? <ContextView context={step.innerContext!} compareTo={step.context} /> : <ContextView context={step.context} />}
    </section>
  );
}

function SelectedNodeDetails({ node, result, binding, step, detail, onSelectNode, onOpenMeasure }: DetailsProps) {
  const root = result.parse?.root ?? null;
  const presentation = presentNode(node, result.text, binding);
  const positionAt = createLineMap(result.text);
  const from = positionAt(node.span.start);
  const to = positionAt(node.span.end);
  const text = result.text.slice(node.span.start, node.span.end);
  const declaration = node.kind === 'VariableRef' ? findNode(root, node.declarationId) : null;
  const resolution = binding?.references.get(node.id);

  return (
    <div className="inspector">
      <dl className="inspector-facts">
        <dt>Selected</dt>
        <dd>
          <strong className="inspector-label">{presentation.label}</strong> <span className="ast-kind">{presentation.kind}</span>
        </dd>
        {detail !== 'brief' && (
          <>
            <dt>Position</dt>
            <dd>
              Line {from.line}, col {from.column} → line {to.line}, col {to.column}
            </dd>
          </>
        )}
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

      {step?.summary && <p className="inspector-summary">{step.summary}</p>}

      {resolution?.definition && (
        <section className="inspector-section">
          <h3>How [{resolution.definition.name}] is defined in your model</h3>
          <pre className="inspector-source">{resolution.definition.expression.trim()}</pre>
          <div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onOpenMeasure(resolution.definition!.name, resolution.definition!.expression)}
            >
              Open [{resolution.definition.name}] in the editor
            </button>
          </div>
        </section>
      )}

      {detail === 'brief' ? (
        <>
          {step && <BriefFilters node={node} step={step} binding={binding} source={result.text} />}
          <details className="more-details">
            <summary>Show the full explanation</summary>
            <div className="inspector">{renderFull()}</div>
          </details>
        </>
      ) : (
        renderFull()
      )}
    </div>
  );

  function renderFull() {
    return (
      <>
      {step && (
        <>
          <section className="inspector-section">
            <h3>Filters in effect here</h3>
            <ContextView context={step.context} />
          </section>

          {isCalculate(node, binding) ? (
            <CalculateSteps node={node} step={step} source={result.text} onSelectNode={onSelectNode} />
          ) : (
            step.operations.length > 0 && (
              <section className="inspector-section">
                <h3>What this changes</h3>
                <OperationList operations={step.operations} root={root} source={result.text} onSelectNode={onSelectNode} />
              </section>
            )
          )}

          {step.innerContext && step.operations.length > 0 && (
            <section className="inspector-section">
              <h3>{innerHeading(node, binding, result.text)}</h3>
              <ContextView context={step.innerContext} compareTo={step.context} />
            </section>
          )}

          {step.notes.length > 0 && (
            <ul className="inspector-notes">
              {step.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          {step.alternatives && (
            <div className="alternatives">
              <section className="alternative">
                <h3>If {presentation.label} is a measure</h3>
                {step.alternatives.ifMeasure.operations.length > 0 ? (
                  <>
                    <OperationList operations={step.alternatives.ifMeasure.operations} root={root} source={result.text} onSelectNode={onSelectNode} />
                    <ContextView context={step.alternatives.ifMeasure.innerContext} compareTo={step.context} />
                  </>
                ) : null}
                <p>{step.alternatives.ifMeasure.notes.join(' ')}</p>
              </section>
              <section className="alternative">
                <h3>If {presentation.label} is a column</h3>
                <p>{step.alternatives.ifColumn.notes.join(' ')}</p>
              </section>
            </div>
          )}
        </>
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
      </>
    );
  }
}

function isCalculate(node: AstNode, binding: BindResult | null): node is FunctionCall {
  const name = node.kind === 'FunctionCall' ? binding?.calls.get(node.id)?.spec?.name : undefined;
  return name === 'CALCULATE' || name === 'CALCULATETABLE';
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
