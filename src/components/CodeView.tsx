import { useEffect, useMemo, useRef } from 'react';
import { scrollWithin } from './scrollWithin';
import type { Token } from '../engine/lexer/tokens';
import type { AstNode } from '../engine/parser/ast';
import type { Span } from '../engine/source';
import { codeLines, isInside, nodeAt } from './codeSegments';

interface CodeViewProps {
  text: string;
  tokens: readonly Token[];
  /** Where the DAX starts (after "Name =" in a measure definition). */
  expressionStart: number;
  root: AstNode | null;
  /** The code of the current step, highlighted. */
  highlight: Span | null;
  onSelectNode: (node: AstNode) => void;
}

/**
 * The DAX, read-only, with line numbers and colors. The current step's code is highlighted;
 * clicking a piece of code selects the smallest expression there.
 */
export function CodeView({ text, tokens, expressionStart, root, highlight, onSelectNode }: CodeViewProps) {
  const lines = useMemo(() => codeLines(text, tokens, expressionStart), [text, tokens, expressionStart]);
  const container = useRef<HTMLDivElement>(null);

  // Keep the highlighted code in view while stepping.
  useEffect(() => {
    scrollWithin(container.current, container.current?.querySelector('.is-current'));
  }, [highlight]);

  return (
    <div className="code-view" ref={container} role="region" aria-label="DAX code">
      <ol className="code-lines">
        {lines.map((segments, i) => (
          <li key={i} className={segments.some((s) => isInside(s, highlight)) ? 'has-current' : undefined}>
            <span className="code-gutter" aria-hidden="true">
              {i + 1}
            </span>
            <span className="code-text">
              {segments.length === 0
                ? '​'
                : segments.map((segment) => {
                    // Only the code itself is marked; indentation stays plain (the line band shows the block).
                    const current = isInside(segment, highlight) && segment.kind !== 'measure-name' && segment.text.trim() !== '';
                    return (
                      <span
                        key={segment.start}
                        className={`syn-${segment.kind}${current ? ' is-current' : ''}`}
                        onClick={() => {
                          const node = nodeAt(root, segment.start);
                          if (node) onSelectNode(node);
                        }}
                      >
                        {segment.text}
                      </span>
                    );
                  })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
