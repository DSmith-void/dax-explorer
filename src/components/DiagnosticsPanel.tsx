import type { AnalysisResult } from '../app/analysis';
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
            <LexSummary result={result} />
            <div className="notice notice-unsupported" role="status">
              <p className="notice-title">Semantic analysis unavailable</p>
              <p>
                Only tokenization has run. Parsing and context analysis are not built yet, so{' '}
                <strong>nothing about this expression's meaning has been analyzed</strong>.
              </p>
            </div>
            {inputChangedSinceAnalysis && (
              <p className="notice-meta">The expression has changed since you pressed Analyze.</p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function LexSummary({ result }: { result: AnalysisResult }) {
  const { tokens, diagnostics } = result.lex;
  const tokenCount = tokens.filter((t) => t.kind !== 'EndOfInput').length;
  const lineSummary = `${result.lineCount.toLocaleString()} ${result.lineCount === 1 ? 'line' : 'lines'}`;

  if (diagnostics.length === 0) {
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

  const positionAt = createLineMap(result.text);
  return (
    <div className="notice notice-error">
      <p className="notice-title">
        {diagnostics.length} lexical {diagnostics.length === 1 ? 'error' : 'errors'}
      </p>
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
