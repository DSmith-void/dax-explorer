import type { Diagnostic } from '../diagnostics';
import { KEYWORDS, type Keyword, type LexResult, type Token } from './tokens';

/** Longest operators first so "<=" wins over "<" followed by "=". */
const MULTI_CHAR_OPERATORS = ['==', '<>', '<=', '>=', '&&', '||', ':='] as const;
const SINGLE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '^', '&', '=', '<', '>']);
const PUNCTUATION = new Set(['(', ')', '{', '}', ',']);

/**
 * Only ordinary ASCII whitespace is skipped. Other space-like characters
 * (for example a non-breaking space pasted from a web page) are reported
 * instead of silently accepted, because we have not verified how the DAX
 * engine treats them.
 */
function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

const IDENTIFIER_START = /[\p{L}_]/u;
const IDENTIFIER_PART = /[\p{L}\p{N}_.]/u;

function isIdentifierStart(ch: string | undefined): boolean {
  return ch !== undefined && IDENTIFIER_START.test(ch);
}

function isIdentifierPart(ch: string | undefined): boolean {
  return ch !== undefined && IDENTIFIER_PART.test(ch);
}

/**
 * Converts DAX source text into tokens.
 *
 * The lexer never throws. Text it cannot tokenize becomes an `Error` token
 * plus a `Diagnostic`, and lexing continues after it, so later stages can
 * still report as much as possible.
 *
 * `startOffset` lets the caller lex only part of the text (for example the
 * expression after a measure header) while every span still refers to
 * positions in the full source.
 */
export function tokenize(source: string, startOffset = 0): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  const length = source.length;
  let pos = Math.max(0, Math.min(startOffset, length));

  const slice = (start: number, end: number) => source.slice(start, end);

  function pushSimple(
    kind: 'Identifier' | 'Operator' | 'Punctuation' | 'Comment' | 'Error' | 'EndOfInput',
    start: number,
    end: number,
  ) {
    tokens.push({ kind, text: slice(start, end), span: { start, end } });
  }

  function pushError(code: string, message: string, start: number, end: number) {
    diagnostics.push({ severity: 'error', code, message, span: { start, end } });
    pushSimple('Error', start, end);
  }

  /** Index of the next line break at or after `from`, or end of input. */
  function lineEnd(from: number): number {
    let i = from;
    while (i < length && source[i] !== '\n' && source[i] !== '\r') i++;
    return i;
  }

  /**
   * Reads text between `open` (at pos) and `close`, where a doubled `close`
   * is an escaped literal. Returns the end offset and the unescaped value,
   * or `terminated: false` if the closing character was never found.
   */
  function readDelimited(close: string, stopAtLineBreak: boolean) {
    let i = pos + 1;
    let value = '';
    while (i < length) {
      const ch = source[i];
      if (ch === close) {
        if (source[i + 1] === close) {
          value += close;
          i += 2;
          continue;
        }
        return { terminated: true as const, end: i + 1, value };
      }
      if (stopAtLineBreak && (ch === '\n' || ch === '\r')) {
        return { terminated: false as const, end: i };
      }
      value += ch;
      i++;
    }
    return { terminated: false as const, end: length };
  }

  while (pos < length) {
    const ch = source[pos];
    const next = source[pos + 1];
    const start = pos;

    if (isWhitespace(ch)) {
      pos++;
      continue;
    }

    // --- Comments (checked before operators: "--" is a comment, not two minus signs) ---
    if ((ch === '/' && next === '/') || (ch === '-' && next === '-')) {
      pos = lineEnd(pos + 2);
      pushSimple('Comment', start, pos);
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', pos + 2);
      if (close === -1) {
        pos = length;
        pushError('unterminated-comment', 'Block comment is not closed: expected "*/".', start, pos);
      } else {
        pos = close + 2;
        pushSimple('Comment', start, pos);
      }
      continue;
    }

    // --- String literal: "text", with "" as an escaped quote. May span lines. ---
    if (ch === '"') {
      const result = readDelimited('"', false);
      pos = result.end;
      if (result.terminated) {
        tokens.push({ kind: 'String', text: slice(start, pos), span: { start, end: pos }, value: result.value });
      } else {
        pushError('unterminated-string', 'String is not closed: expected a closing ".', start, pos);
      }
      continue;
    }

    // --- Quoted table name: 'Table Name', with '' as an escaped quote. ---
    if (ch === "'") {
      const result = readDelimited("'", true);
      pos = result.end;
      if (result.terminated) {
        tokens.push({ kind: 'QuotedTableName', text: slice(start, pos), span: { start, end: pos }, value: result.value });
      } else {
        pushError('unterminated-quoted-name', "Quoted table name is not closed: expected a closing '.", start, pos);
      }
      continue;
    }

    // --- Bracketed name: [Column] or [Measure], with ]] as an escaped bracket. ---
    if (ch === '[') {
      const result = readDelimited(']', true);
      pos = result.end;
      if (result.terminated) {
        tokens.push({ kind: 'BracketedName', text: slice(start, pos), span: { start, end: pos }, value: result.value });
      } else {
        pushError('unterminated-bracket', 'Bracketed name is not closed: expected "]".', start, pos);
      }
      continue;
    }

    // --- Number: 12, 1.5, .5, 1.5E3, 2e-3 ---
    if (isDigit(ch) || (ch === '.' && isDigit(next))) {
      while (isDigit(source[pos])) pos++;
      if (source[pos] === '.' && isDigit(source[pos + 1])) {
        pos++;
        while (isDigit(source[pos])) pos++;
      }
      const e = source[pos];
      if (e === 'e' || e === 'E') {
        const sign = source[pos + 1];
        if (isDigit(sign)) {
          pos += 1;
        } else if ((sign === '+' || sign === '-') && isDigit(source[pos + 2])) {
          pos += 2;
        }
        while (isDigit(source[pos])) pos++;
      }
      // A number running straight into name characters ("2x", "1E", "1.2.3") is malformed.
      if (isIdentifierPart(source[pos])) {
        while (isIdentifierPart(source[pos])) pos++;
        pushError('invalid-number', `"${slice(start, pos)}" is not a valid number.`, start, pos);
        continue;
      }
      const text = slice(start, pos);
      tokens.push({ kind: 'Number', text, span: { start, end: pos }, value: Number(text) });
      continue;
    }

    // --- Identifier or keyword: Sales, PERCENTILE.INC, VAR ---
    if (isIdentifierStart(ch)) {
      while (isIdentifierPart(source[pos])) pos++;
      const text = slice(start, pos);
      const upper = text.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ kind: 'Keyword', text, span: { start, end: pos }, value: upper as Keyword });
      } else {
        pushSimple('Identifier', start, pos);
      }
      continue;
    }

    // --- Operators and punctuation ---
    const twoChars = source.slice(pos, pos + 2);
    if ((MULTI_CHAR_OPERATORS as readonly string[]).includes(twoChars)) {
      pos += 2;
      pushSimple('Operator', start, pos);
      continue;
    }
    if (SINGLE_CHAR_OPERATORS.has(ch)) {
      pos++;
      pushSimple('Operator', start, pos);
      continue;
    }
    if (PUNCTUATION.has(ch)) {
      pos++;
      pushSimple('Punctuation', start, pos);
      continue;
    }

    // --- Known-unsupported and unexpected characters ---
    if (ch === ';') {
      pos++;
      pushError(
        'unsupported-separator',
        'Semicolon list separators (used with some regional settings) are not supported yet. Use commas.',
        start,
        pos,
      );
      continue;
    }

    // Consume a whole code point so emoji and other surrogate pairs stay intact.
    const codePoint = source.codePointAt(pos) ?? 0;
    pos += codePoint > 0xffff ? 2 : 1;
    const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
    const description = codePoint === 0xa0 ? 'non-breaking space (often introduced by copy/paste)' : `"${slice(start, pos)}"`;
    pushError('unexpected-character', `Unexpected character: ${description} (U+${hex}).`, start, pos);
  }

  tokens.push({ kind: 'EndOfInput', text: '', span: { start: length, end: length } });
  return { tokens, diagnostics };
}
