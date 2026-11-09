import type { BindResult, ReferenceResolution, ReferenceType } from '../engine/binder/binder';
import { childrenOf, type AstNode, type ChildEntry } from '../engine/parser/ast';
import { presentNode } from './astPresentation';

interface ExpressionTreeProps {
  root: AstNode;
  source: string;
  binding: BindResult | null;
  selectedId: number | null;
  onSelect: (node: AstNode) => void;
  /** Called with null to clear the user's choice for that reference. */
  onChooseReferenceType: (key: string, type: ReferenceType | null) => void;
}

export function ExpressionTree(props: ExpressionTreeProps) {
  return (
    <ul className="ast-tree" aria-label="Expression tree">
      <TreeNode {...props} entry={{ node: props.root }} />
    </ul>
  );
}

interface TreeNodeProps extends ExpressionTreeProps {
  entry: ChildEntry;
}

function TreeNode(props: TreeNodeProps) {
  const { entry, source, binding, selectedId, onSelect, onChooseReferenceType } = props;
  const { node, label: role } = entry;
  const presentation = presentNode(node, source, binding);
  const children = childrenOf(node);
  const isSelected = node.id === selectedId;
  const resolution = binding?.references.get(node.id);

  return (
    <li>
      <div className="ast-row">
        <button
          type="button"
          className={`ast-node category-${presentation.category}${isSelected ? ' is-selected' : ''}`}
          aria-current={isSelected ? 'true' : undefined}
          onClick={() => onSelect(node)}
        >
          {role && <span className="ast-role">{role}</span>}
          <span className="ast-label">{presentation.label}</span>
          <span className="ast-kind">{presentation.kind}</span>
          {presentation.tag && (
            <span className={`certainty-tag tone-${presentation.tag.tone}`} title={presentation.tag.title}>
              {presentation.tag.text}
            </span>
          )}
        </button>
        {resolution && !resolution.locked && (
          <ReferenceTypeChoice resolution={resolution} onChoose={onChooseReferenceType} />
        )}
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TreeNode key={child.node.id} {...props} entry={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

const TYPES: ReferenceType[] = ['measure', 'column'];

/** Small measure/column switch. Clicking the active user choice clears it. */
function ReferenceTypeChoice({
  resolution,
  onChoose,
}: {
  resolution: ReferenceResolution;
  onChoose: (key: string, type: ReferenceType | null) => void;
}) {
  const userChoice = resolution.source === 'user' ? resolution.type : null;
  return (
    <div className="ref-choice" role="group" aria-label="Measure or column">
      {TYPES.map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={userChoice === type}
          className={userChoice === type ? 'is-active' : undefined}
          title={userChoice === type ? 'Click again to clear your choice' : `Treat this name as a ${type} everywhere`}
          onClick={() => onChoose(resolution.key, userChoice === type ? null : type)}
        >
          {type}
        </button>
      ))}
    </div>
  );
}
