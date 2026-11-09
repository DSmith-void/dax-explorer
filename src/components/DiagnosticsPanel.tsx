import type { AnalysisResult } from '../app/analysis';
import type { Diagnostic } from '../engine/diagnostics';
import { createLineMap } from '../engine/source';
import { Panel } from './Panel';

interface DiagnosticsPanelProps {
  result: AnalysisResult | null;
  inputChangedSinceAnalysis: boolean;
}

export function DiagnosticsPanel({ result, inputChangedSinceAnalysis }: DiagnosticsPanelProps) {
  return (
    <Panel id="diagnostics" title="Diagnostics & Explanation" status={result ? 'Lexing only' : 'Planned'}>
      <div aria-live="polite" className="diagnostics-body">
        {result === null ? (
          <p className="placeholder-lead">
            Press <strong>Analyze DAX</strong> to analyze the expression. Results will separate what is
            known for certain from what needs model metadata, query context, or data.
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
            <ProblemsSummary result={result} />
            <div className="notice notice-unsupported" role="status">
              <p className="notice-title">Semantic analysis unavailable</p>
              <p>
                Only tokenization has run. Parsing and context analysis are not built yet, so{' '}
                <strong>nothing about this expression's meaning has been analyzed</strong>.
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

function ProblemsSummary({ result }: { result: AnalysisResult }) {
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');

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
      {errors.length === 0 && result.lex && <LexSuccess result={result} />}
    </>
  );
}

function LexSuccess({ result }: { result: AnalysisResult }) {
  const tokenCount = result.lex?.tokens.filter((t) => t.kind !== 'EndOfInput').length ?? 0;
  const lineSummary = `${result.lineCount.toLocaleString()} ${result.lineCount === 1 ? 'line' : 'lines'}`;
  return (
    <div className="notice notice-success">
      <p className="notice-title">Tokenized successfully</p>
      <p>
        {tokenCount.toLocaleString()} tokens from {result.characterCount.toLocaleString()} characters on{' '}
        {lineSummary}. No lexical errors.
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
