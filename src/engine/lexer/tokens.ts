import type { Diagnostic } from '../diagnostics';
import type { Span } from '../source';

/**
 * Reserved words recognized by the lexer (case-insensitive in DAX).
 * Query-only keywords (DEFINE, EVALUATE, ...) are deliberately not included yet;
 * they lex as identifiers and the parser will report them as unsupported.
 */
export type Keyword = 'VAR' | 'RETURN' | 'IN' | 'NOT';

export const KEYWORDS: ReadonlySet<string> = new Set<Keyword>(['VAR', 'RETURN', 'IN', 'NOT']);

interface TokenBase {
  /** The exact source text of the token. */
  text: string;
  span: Span;
}

/**
 * A lexical token.
 *
 * The lexer does NOT decide what a name means. For example `Sales[Amount]`
 * produces an Identifier followed by a BracketedName; whether `[Amount]`
 * is a column or a measure is decided much later, using model metadata.
 */
export type Token =
  | (TokenBase & { kind: 'Number'; value: number })
  /** "text" with "" escapes; value is the unescaped content. */
  | (TokenBase & { kind: 'String'; value: string })
  /** 'Table Name' with '' escapes; value is the unescaped name. */
  | (TokenBase & { kind: 'QuotedTableName'; value: string })
  /** [Name] with ]] escapes; value is the unescaped name. */
  | (TokenBase & { kind: 'BracketedName'; value: string })
  /** value is the upper-case keyword. */
  | (TokenBase & { kind: 'Keyword'; value: Keyword })
  | (TokenBase & {
      kind:
        | 'Identifier' // unquoted table or function name, may contain dots: PERCENTILE.INC
        | 'Operator' // + - * / ^ & = == <> < <= > >= && || :=
        | 'Punctuation' // ( ) { } ,
        | 'Comment' // // ..., -- ..., /* ... */
        | 'Error' // text the lexer could not tokenize; see the matching Diagnostic
        | 'EndOfInput';
    });

export type TokenKind = Token['kind'];

export interface LexResult {
  /** Always ends with exactly one EndOfInput token. Whitespace is not emitted. */
  tokens: Token[];
  diagnostics: Diagnostic[];
}
