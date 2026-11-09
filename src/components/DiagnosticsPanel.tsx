import { Panel } from './Panel';

/** What the user submitted the last time they pressed Analyze. */
export interface AnalysisRequest {
  text: string;
  characterCount: number;
  lineCount: number;
}

interface DiagnosticsPanelProps {
  lastRequest: AnalysisRequest | null;
  inputChangedSinceRequest: boolean;
}

export function DiagnosticsPanel({ lastRequest, inputChangedSinceRequest }: DiagnosticsPanelProps) {
  return (
    <Panel id="diagnostics" title="Diagnostics & Explanation" status="Planned">
      <div aria-live="polite">
        {lastRequest === null ? (
          <p className="placeholder-lead">
            Press <strong>Analyze DAX</strong> to analyze the expression. Results will separate what
            is known for certain from what needs model metadata, query context, or data.
          </p>
        ) : (
          <div className="notice notice-unsupported" role="status">
            <p className="notice-title">Analysis unavailable</p>
            <p>
              Received {lastRequest.characterCount.toLocaleString()} characters on{' '}
              {lastRequest.lineCount.toLocaleString()} {lastRequest.lineCount === 1 ? 'line' : 'lines'}.
              The DAX analyzer is not built yet, so <strong>nothing has been analyzed</strong>.
            </p>
            {inputChangedSinceRequest && (
              <p className="notice-meta">The expression has changed since you pressed Analyze.</p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
