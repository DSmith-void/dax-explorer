import { childrenOf, type AstNode, type ChildEntry } from '../engine/parser/ast';
import { presentNode } from './astPresentation';

interface ExpressionTreeProps {
  root: AstNode;
  source: string;
  selectedId: number | null;
  onSelect: (node: AstNode) => void;
}

export function ExpressionTree({ root, source, selectedId, onSelect }: ExpressionTreeProps) {
  return (
    <ul className="ast-tree" aria-label="Expression tree">
      <TreeNode entry={{ node: root }} source={source} selectedId={selectedId} onSelect={onSelect} />
    </ul>
  );
}

interface TreeNodeProps {
  entry: ChildEntry;
  source: string;
  selectedId: number | null;
  onSelect: (node: AstNode) => void;
}

function TreeNode({ entry, source, selectedId, onSelect }: TreeNodeProps) {
  const { node, label: role } = entry;
  const presentation = presentNode(node, source);
  const children = childrenOf(node);
  const isSelected = node.id === selectedId;

  return (
    <li>
      <button
        type="button"
        className={`ast-node category-${presentation.category}${isSelected ? ' is-selected' : ''}`}
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => onSelect(node)}
      >
        {role && <span className="ast-role">{role}</span>}
        <span className="ast-label">{presentation.label}</span>
        <span className="ast-kind">{presentation.kind}</span>
      </button>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TreeNode key={child.node.id} entry={child} source={source} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
