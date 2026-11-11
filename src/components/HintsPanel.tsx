import { useState } from 'react';
import { HINT_KIND_LABEL, type Hint, type HintKind } from '../engine/patterns/hints';
import { findNode, type AstNode, type Expr } from '../engine/parser/ast';
import type { DetailLevel } from './ContextInspectorPanel';
import { Panel } from './Panel';

interface HintsPanelProps {
  hints: readonly Hint[];
  root: Expr | null;
  /** The measure these hints are about, when it is one that was stepped into. */
  measureName: string | null;
  detail: DetailLevel;
  onSelectNode: (node: AstNode) => void;
}

const GROUPS: { kind: HintKind; intro: string }[] = [
  { kind: 'warning', intro: 'Probably not what was meant. Worth a second look.' },
  { kind: 'cost', intro: 'Gives the right result, but slower than it needs to be.' },
  { kind: 'note', intro: 'Can be fine; good to know about.' },
  { kind: 'silent', intro: "Things DAX does here without it being written in the code." },
];

/** Pattern checks: common mistakes, slow patterns, and what DAX does silently. */
export function HintsPanel({ hints, root, measureName, detail, onSelectNode }: HintsPanelProps) {
  return (
    <Panel id="hints" title={measureName ? `Hints for ${measureName}` : 'Hints'}>
      <div className="hints-body">
        {hints.length === 0 ? (
          <p className="placeholder-lead">No hints for this measure.</p>
        ) : (
          GROUPS.map(({ kind, intro }) => {
            const group = hints.filter((h) => h.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} className="hint-group">
                <h3 className="hint-group-title">
                  <span className={`hint-kind hint-kind-${kind}`}>{HINT_KIND_LABEL[kind]}</span>
                  <span className="muted">{intro}</span>
                </h3>
                <ul className="hint-list">
                  {group.map((hint, i) => (
                    <HintItem key={`${hint.check}-${hint.nodeId}-${i}`} hint={hint} root={root} detail={detail} onSelectNode={onSelectNode} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </Panel>
  );
}

function HintItem({ hint, root, detail, onSelectNode }: { hint: Hint; root: Expr | null; detail: DetailLevel; onSelectNode: (node: AstNode) => void }) {
  const [copied, setCopied] = useState(false);
  const node = findNode(root, hint.nodeId);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <li className={`hint hint-${hint.kind}`}>
      <button type="button" className="link-button hint-title" onClick={() => node && onSelectNode(node)} title="Show this in the code">
        {hint.title}
      </button>
      {detail === 'detailed' && (
        <>
          <p className="hint-why">{hint.why}</p>
          {hint.suggestion && (
            <div className="hint-suggestion">
              <p className="field-label">Instead</p>
              <div className="hint-code-row">
                <code>{hint.suggestion.dax}</code>
                {/* Only a rewrite that works as it is can be copied (not "(leave …)" or "<a column …>"). */}
                {!/^\(|<|…/.test(hint.suggestion.dax) && (
                  <button type="button" className="secondary-button" onClick={() => void copy(hint.suggestion!.dax)}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              <p className="hint-why">{hint.suggestion.note}</p>
            </div>
          )}
        </>
      )}
    </li>
  );
}
