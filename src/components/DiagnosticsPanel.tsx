import type { AnalysisResult } from '../app/analysis';
import { PROBLEM_LABEL, type Problem, type ProblemKind } from '../app/problems';
import { findNode, type AstNode } from '../engine/parser/ast';
import { Panel } from './Panel';

interface DiagnosticsPanelProps {
  result: AnalysisResult | null;
  problems: readonly Problem[];
  inputChangedSinceAnalysis: boolean;
  onSelectNode: (node: AstNode) => void;
}

const INTRO: Record<ProblemKind, string> = {
  error: "The DAX can't be read as written.",
  warning: 'It reads, but something looks wrong.',
  unchecked: "Beyond what the app can work out yet; it says so instead of guessing.",
  assumed: 'Taken from how the name is written; set it in the Expression tree if that is wrong.',
};

/** Problems: what is wrong, or what the app couldn't be sure of. Things worth knowing are on the Hints tab. */
export function DiagnosticsPanel({ result, problems, inputChangedSinceAnalysis, onSelectNode }: DiagnosticsPanelProps) {
  const root = result?.parse?.root ?? null;
  const kinds = (['error', 'warning', 'unchecked', 'assumed'] as const).filter((k) => problems.some((p) => p.kind === k));
  return (
    <Panel id="diagnostics" title="Problems">
      <div aria-live="polite" className="hints-body">
        {result === null ? (
          <p className="placeholder-lead">Choose a measure, or write your own DAX and press Explain.</p>
        ) : problems.length === 0 ? (
          <p className="problems-none">No problems: the DAX reads cleanly and every name is understood.</p>
        ) : (
          <>
            {!problems.some((p) => p.kind !== 'assumed') && <p className="problems-none">No problems: the DAX reads cleanly.</p>}
            {kinds.map((kind) => (
              <section key={kind} className="hint-group">
                <h3 className="hint-group-title">
                  <span className={`hint-kind problem-kind-${kind}`}>{PROBLEM_LABEL[kind]}</span>
                  <span className="muted">{INTRO[kind]}</span>
                </h3>
                <ul className="hint-list">
                  {problems
                    .filter((p) => p.kind === kind)
                    .map((p, i) => {
                      const node = p.nodeId !== null ? findNode(root, p.nodeId) : null;
                      return (
                        <li key={i} className={`hint problem-${kind}`}>
                          <span className="problem-row">
                            {node ? (
                              <button type="button" className="link-button hint-title" onClick={() => onSelectNode(node)} title="Show this in the code">
                                {p.title}
                              </button>
                            ) : (
                              <span className="hint-title">{p.title}</span>
                            )}
                            <span className="muted problem-line">line {p.line}</span>
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </>
        )}
        {inputChangedSinceAnalysis && <p className="notice-meta">The DAX has changed since you pressed Explain.</p>}
      </div>
    </Panel>
  );
}
