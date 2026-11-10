import type { Token } from '../engine/lexer/tokens';
import { childrenOf, type AstNode } from '../engine/parser/ast';
import type { Span } from '../engine/source';

/** How a piece of code is colored. */
export type SegmentKind =
  | 'plain'
  | 'measure-name'
  | 'keyword'
  | 'function'
  | 'table'
  | 'bracketed'
  | 'string'
  | 'number'
  | 'operator'
  | 'punctuation'
  | 'comment'
  | 'error';

export interface CodeSegment {
  text: string;
  kind: SegmentKind;
  /** Offset of the first character in the whole text. */
  start: number;
}

/**
 * Splits the text into colored pieces, line by line. Every character appears exactly once
 * (whitespace included), so the code view shows the text exactly as written.
 *
 * @param expressionStart where the DAX starts; the text before it is the measure's name ("Name =").
 */
export function codeLines(text: string, tokens: readonly Token[], expressionStart: number): CodeSegment[][] {
  const segments: CodeSegment[] = [];
  let position = 0;
  const pushGap = (end: number) => {
    if (end <= position) return;
    if (position < expressionStart) {
      const headerEnd = Math.min(end, expressionStart);
      segments.push({ text: text.slice(position, headerEnd), kind: 'measure-name', start: position });
      position = headerEnd;
    }
    if (end > position) segments.push({ text: text.slice(position, end), kind: 'plain', start: position });
    position = end;
  };
  tokens.forEach((token, i) => {
    if (token.kind === 'EndOfInput') return;
    pushGap(token.span.start);
    segments.push({ text: token.text, kind: kindOf(token, tokens[i + 1]), start: token.span.start });
    position = token.span.end;
  });
  pushGap(text.length);

  // Split at line breaks, keeping offsets.
  const lines: CodeSegment[][] = [[]];
  for (const segment of segments) {
    const parts = segment.text.split(/(\r\n|\r|\n)/);
    let offset = segment.start;
    for (const part of parts) {
      if (/^(\r\n|\r|\n)$/.test(part)) lines.push([]);
      else if (part) lines[lines.length - 1].push({ ...segment, text: part, start: offset });
      offset += part.length;
    }
  }
  return lines;
}

function kindOf(token: Token, next: Token | undefined): SegmentKind {
  switch (token.kind) {
    case 'Keyword':
      return 'keyword';
    case 'Identifier':
      return next?.kind === 'Punctuation' && next.text === '(' ? 'function' : 'table';
    case 'QuotedTableName':
      return 'table';
    case 'BracketedName':
      return 'bracketed';
    case 'String':
      return 'string';
    case 'Number':
      return 'number';
    case 'Operator':
      return 'operator';
    case 'Punctuation':
      return 'punctuation';
    case 'Comment':
      return 'comment';
    case 'Error':
      return 'error';
    default:
      return 'plain';
  }
}

/** The smallest node whose text contains the offset, or null. */
export function nodeAt(root: AstNode | null, offset: number): AstNode | null {
  if (!root || offset < root.span.start || offset >= root.span.end) return null;
  for (const child of childrenOf(root)) {
    const inner = nodeAt(child.node, offset);
    if (inner) return inner;
  }
  return root;
}

/** True when a piece of code lies inside the span. */
export function isInside(segment: CodeSegment, span: Span | null): boolean {
  return span !== null && segment.start >= span.start && segment.start + segment.text.length <= span.end;
}
