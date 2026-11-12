import type { AnalysisResult } from '../app/analysis';
import type { BindResult } from '../engine/binder/binder';
import type { ContextAnalysis, InsightKind } from '../engine/context/model';
import type { Diagnostic } from '../engine/diagnostics';
import { childrenOf, findNode, type AstNode } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import { Panel } from './Panel';

interface DiagnosticsPanelProps {
  result: AnalysisResult | null;
  binding: BindResult | null;
  analysis: ContextAnalysis | null;
  inputChangedSinceAnalysis: boolean;
  onSelectNode: (node: AstNode) => void;
}

const INSIGHT_LABEL: Record<InsightKind, string> = {
  'context-transition': 'A row becomes a filter',
  'variable-fixed': 'Variable is not recalculated',
  'column-without-row-context': 'Column has no current row',
  'not-modeled': 'Not checked',
  'unknown-function': 'Unknown function',
};

export function DiagnosticsPanel({ result, binding, analysis, inputChangedSinceAnalysis, onSelectNode }: DiagnosticsPanelProps) {
  const diagnostics = result
    ? [...result.diagnostics, ...(binding?.diagnostics ?? [])].sort((a, b) => a.span.start - b.span.start)
    : [];

  return (
    <Panel id="diagnostics" title="Diagnostics & Explanation" status={result ? 'Symbolic' : 'Planned'}>
      <div aria-live="polite" className="diagnostics-body">
        {result === null ? (
          <p className="placeholder-lead">
            Press <strong>Analyze DAX</strong> to analyze the expression. The results separate what the app knows for
            certain from what depends on your data model, your report, or your data.
          </p>
        ) : (
          <>
            {result.header && (
              <div className="notice notice-info">
                <p>
                  <span className="notice-label">Measure name</span>{' '}
                  <strong className="measure-name">{result.header.name}</strong>
                </p>
                <p className="notice-meta">
                  Text before the first "{result.header.operator}" on the first line. Read as plain text, not as DAX.
                </p>
              </div>
            )}
            <ProblemsSummary result={result} diagnostics={diagnostics} />
            {binding && <ReferenceSummary binding={binding} />}
            {binding && binding.unknownFunctions.length > 0 && (
              <div className="notice notice-info">
                <p className="notice-title">Not in the function catalog</p>
                <p>
                  {binding.unknownFunctions.join(', ')}: shown in the tree, but nothing is concluded from{' '}
                  {binding.unknownFunctions.length === 1 ? 'its' : 'their'} arguments.
                </p>
              </div>
            )}
            {analysis && result.parse?.root && (
              <Explanation
                analysis={analysis}
                root={result.parse.root}
                source={result.text}
                onSelectNode={onSelectNode}
              />
            )}
            <div className="notice notice-unsupported" role="status">
              <p className="notice-title">About these explanations</p>
              <p>
                The app doesn't see your report, data or data model. "The report's filters" means whatever filters apply
                where the measure is used (slicers, the visual's rows and columns, and so on). No numbers are calculated.
                Anything marked <strong>not checked</strong> is beyond what the app can work out yet; it says so rather
                than guess.
              </p>
            </div>
            {inputChangedSinceAnalysis && (
              <p className="notice-meta">The expression or input type has changed since you pressed Analyze.</p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function Explanation({
  analysis,
  root,
  source,
  onSelectNode,
}: {
  analysis: ContextAnalysis;
  root: AstNode;
  source: string;
  onSelectNode: (node: AstNode) => void;
}) {
  if (analysis.insights.length === 0) {
    return (
      <div className="notice notice-info">
        <p className="notice-title">What to notice</p>
        <p>
          Nothing unusual here: no row-by-row steps, no reused variables, nothing the app couldn't check. Click parts of the
          tree to see which filters apply where.
        </p>
      </div>
    );
  }
  const positionAt = createLineMap(source);
  return (
    <div className="notice notice-info explanation">
      <p className="notice-title">What to notice (in the order DAX calculates)</p>
      <ol className="insight-list">
        {analysis.insights.map((insight, i) => {
          const node = findNode(root, insight.nodeId);
          return (
            <li key={i} className={`insight insight-${insight.kind}`}>
              <span className="insight-kind">{INSIGHT_LABEL[insight.kind]}</span>
              {node && (
                <button type="button" className="link-button" onClick={() => onSelectNode(node)}>
                  line {positionAt(node.span.start).line}
                </button>
              )}
              <span className="insight-summary">{insight.summary}</span>
              <span className="insight-message">{insight.message}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ReferenceSummary({ binding }: { binding: BindResult }) {
  const all = [...binding.references.values()];
  if (all.length === 0) return null;
  const count = (predicate: (r: (typeof all)[number]) => boolean) => all.filter(predicate).length;
  const parts = [
    { n: count((r) => r.source === 'model'), text: 'from your model' },
    { n: count((r) => r.source === 'function-signature'), text: 'required by a function' },
    { n: count((r) => r.source === 'user'), text: 'set by you' },
    { n: count((r) => r.source === 'convention' || r.source === 'other-occurrence'), text: 'assumed' },
    { n: count((r) => r.source === 'unresolved'), text: 'unknown' },
  ].filter((part) => part.n > 0);

  return (
    <div className="notice notice-info">
      <p className="notice-title">
        {all.length} measure/column {all.length === 1 ? 'reference' : 'references'}
      </p>
      <p>{parts.map((part) => `${part.n} ${part.text}`).join(' · ')}</p>
    </div>
  );
}

function ProblemsSummary({ result, diagnostics }: { result: AnalysisResult; diagnostics: Diagnostic[] }) {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  return (
    <>
      {errors.length > 0 && (
        <DiagnosticList
          className="notice-error"
          title={`${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`}
          source={result.text}
          diagnostics={errors}
        />
      )}
      {warnings.length > 0 && (
        <DiagnosticList
          className="notice-unsupported"
          title={`${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`}
          source={result.text}
          diagnostics={warnings}
        />
      )}
      {errors.length === 0 && result.parse?.root && <ParseSuccess result={result} />}
    </>
  );
}

function countNodes(node: AstNode): number {
  return 1 + childrenOf(node).reduce((sum, child) => sum + countNodes(child.node), 0);
}

function ParseSuccess({ result }: { result: AnalysisResult }) {
  const root = result.parse?.root;
  const nodeCount = root ? countNodes(root) : 0;
  const tokenCount = result.lex?.tokens.filter((t) => t.kind !== 'EndOfInput').length ?? 0;
  const lineSummary = `${result.lineCount.toLocaleString()} ${result.lineCount === 1 ? 'line' : 'lines'}`;
  return (
    <div className="notice notice-success">
      <p className="notice-title">Parsed successfully</p>
      <p>
        {nodeCount.toLocaleString()} tree nodes from {tokenCount.toLocaleString()} tokens on {lineSummary}. No syntax
        errors.
      </p>
    </div>
  );
}

interface DiagnosticListProps {
  className: string;
  title: string;
  source: string;
  diagnostics: readonly Diagnostic[];
}

function DiagnosticList({ className, title, source, diagnostics }: DiagnosticListProps) {
  const positionAt = createLineMap(source);
  return (
    <div className={`notice ${className}`}>
      <p className="notice-title">{title}</p>
      <ul className="diagnostic-list">
        {diagnostics.map((d) => {
          const { line, column } = positionAt(d.span.start);
          return (
            <li key={`${d.span.start}-${d.code}`}>
              <span className="diagnostic-position">
                Line {line}, col {column}
              </span>{' '}
              {d.message}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
