import { useState } from 'react';
import { HINT_KIND_LABEL, type Hint, type HintKind } from '../engine/patterns/hints';
import { findNode, type AstNode, type Expr } from '../engine/parser/ast';
import { Panel } from './Panel';

interface HintsPanelProps {
  hints: readonly Hint[];
  root: Expr | null;
  /** The measure these hints are about, when it is one that was stepped into. */
  measureName: string | null;
  onSelectNode: (node: AstNode) => void;
}

const GROUPS: { kind: HintKind; intro: string }[] = [
  { kind: 'warning', intro: 'Probably not what was meant. Worth a second look.' },
  { kind: 'cost', intro: 'Gives the right result, but slower than it needs to be.' },
  { kind: 'note', intro: 'Can be fine; good to know about.' },
  { kind: 'silent', intro: "Things DAX does here without it being written in the code." },
];

/** Pattern checks: common mistakes, slow patterns, and what DAX does silently. */
export function HintsPanel({ hints, root, measureName, onSelectNode }: HintsPanelProps) {
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
                    <HintItem key={`${hint.check}-${hint.nodeId}-${i}`} hint={hint} root={root} onSelectNode={onSelectNode} />
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

function HintItem({ hint, root, onSelectNode }: { hint: Hint; root: Expr | null; onSelectNode: (node: AstNode) => void }) {
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
  // One line says why; the full explanation and the note on the rewrite fold away under "More".
  const more = [hint.why, hint.suggestion?.note ?? ''].filter(Boolean);
  // Only a rewrite that works as it is can be copied (not "(leave …)" or "<a column …>").
  const copyable = hint.suggestion !== undefined && !/^\(|<|…/.test(hint.suggestion.dax);
  return (
    <li className={`hint hint-${hint.kind}`}>
      <span className="hint-title">{hint.title}</span>
      {hint.code && (
        <button type="button" className="hint-code" title={hint.code} onClick={() => node && onSelectNode(node)}>
          {oneLine(hint.code)}
        </button>
      )}
      <p className="hint-why">{hint.short}</p>
      {hint.suggestion && (
        <div className="hint-code-row">
          <span className="field-label">Instead</span>
          <code title={hint.suggestion.dax}>{shape(hint.suggestion.dax)}</code>
          {copyable && (
            <button type="button" className="link-button" onClick={() => void copy(hint.suggestion!.dax)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}
      {more.length > 0 && (
        <details className="hint-more">
          <summary>More</summary>
          {more.map((text, i) => (
            <p key={i} className="hint-why">
              {text}
            </p>
          ))}
        </details>
      )}
    </li>
  );
}


/** Code on one line (spaces collapsed); the hover shows it in full. */
function oneLine(code: string): string {
  return code.replace(/\s+/g, ' ').trim();
}

/** A rewrite by its shape when it is long: "KEEPFILTERS(…)". Copy still copies it in full. */
function shape(dax: string): string {
  const flat = oneLine(dax);
  if (flat.length <= 48) return flat;
  const call = /^([A-Z][A-Z0-9.]*)\(/.exec(flat);
  return call ? `${call[1]}(…)` : `${flat.slice(0, 47)}…`;
}
