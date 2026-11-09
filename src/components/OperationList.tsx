import { entryText, removalText, rowContextText } from '../engine/context/describe';
import type { Operation } from '../engine/context/model';
import { findNode, type AstNode } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';

interface OperationListProps {
  operations: readonly Operation[];
  root: AstNode | null;
  source: string;
  onSelectNode: (node: AstNode) => void;
}

/** "What this changes", in the order DAX does it, with links to the part responsible. */
export function OperationList({ operations, root, source, onSelectNode }: OperationListProps) {
  const positionAt = createLineMap(source);
  const link = (nodeId: number, text: string) => {
    const node = findNode(root, nodeId);
    if (!node) return <>{text}</>;
    return (
      <button type="button" className="link-button" onClick={() => onSelectNode(node)}>
        {text} (line {positionAt(node.span.start).line})
      </button>
    );
  };

  return (
    <ol className="operation-list">
      {operations.map((op, i) => {
        switch (op.kind) {
          case 'context-transition':
            return (
              <li key={i} className="op-transition">
                The current row of {op.rows.map((r) => r.functionName).join(' and ')} becomes a filter (context transition):{' '}
                {op.added.map((e) => (
                  <code key={entryText(e)}>{entryText(e)}</code>
                ))}
              </li>
            );
          case 'remove-filters':
            return (
              <li key={i} className="op-remove">
                {link(op.nodeId, op.functionName)} removes any filter on <code>{removalText(op.removal)}</code>
                {op.removedEntries.length > 0 && <> (including {op.removedEntries.map((e) => entryText(e)).join(', ')})</>}.
              </li>
            );
          case 'add-filter':
            return (
              <li key={i} className="op-add">
                {link(op.nodeId, 'This filter')} {op.entry.mode === 'intersect' ? 'is added on top of the existing filters:' : 'is applied:'}{' '}
                <code>{entryText(op.entry)}</code>
                {op.entry.mode === 'replace' && (op.replacesIncoming || op.replaced.length > 0) && (
                  <span className="op-detail"> It replaces any filter already on that column.</span>
                )}
              </li>
            );
          case 'row-context':
            return (
              <li key={i} className="op-row">
                {rowContextText(op.row)} (row context).
              </li>
            );
          case 'not-modeled':
            return (
              <li key={i} className="op-unknown">
                Not checked: {op.description} — {link(op.nodeId, 'see the part')}
              </li>
            );
        }
      })}
    </ol>
  );
}
