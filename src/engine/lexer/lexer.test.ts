import { describe, expect, it } from 'vitest';
import { SAMPLE_MEASURES } from '../../samples/sampleMeasures';
import { createLineMap } from '../source';
import { tokenize } from './lexer';
import type { Token } from './tokens';

/** Tokens without the trailing EndOfInput, for compact assertions. */
function lex(source: string): Token[] {
  const { tokens } = tokenize(source);
  expect(tokens.at(-1)?.kind).toBe('EndOfInput');
  return tokens.slice(0, -1);
}

/** [kind, text] pairs: the most readable way to assert a token sequence. */
function pairs(source: string): [string, string][] {
  return lex(source).map((t) => [t.kind, t.text]);
}

function diagnosticCodes(source: string): string[] {
  return tokenize(source).diagnostics.map((d) => d.code);
}

describe('empty and whitespace input', () => {
  it('produces only EndOfInput for empty input', () => {
    const { tokens, diagnostics } = tokenize('');
    expect(tokens).toEqual([{ kind: 'EndOfInput', text: '', span: { start: 0, end: 0 } }]);
    expect(diagnostics).toEqual([]);
  });

  it('skips spaces, tabs and all line-break styles', () => {
    expect(lex('  \t\n\r\n\r  ')).toEqual([]);
  });

  it('places EndOfInput at the end of the source', () => {
    const { tokens } = tokenize('  1  ');
    expect(tokens.at(-1)?.span).toEqual({ start: 5, end: 5 });
  });
});

describe('identifiers and keywords', () => {
  it('lexes plain identifiers', () => {
    expect(pairs('Sales SUM _x Plant01')).toEqual([
      ['Identifier', 'Sales'],
      ['Identifier', 'SUM'],
      ['Identifier', '_x'],
      ['Identifier', 'Plant01'],
    ]);
  });

  it('keeps dots inside function names such as PERCENTILE.INC and NORM.S.DIST', () => {
    expect(pairs('PERCENTILE.INC NORM.S.DIST')).toEqual([
      ['Identifier', 'PERCENTILE.INC'],
      ['Identifier', 'NORM.S.DIST'],
    ]);
  });

  it('accepts non-ASCII letters in unquoted names', () => {
    expect(pairs('Größe Ventes')).toEqual([
      ['Identifier', 'Größe'],
      ['Identifier', 'Ventes'],
    ]);
  });

  it('recognizes keywords case-insensitively and normalizes their value', () => {
    const tokens = lex('VAR var Return in Not');
    expect(tokens.map((t) => t.kind)).toEqual(['Keyword', 'Keyword', 'Keyword', 'Keyword', 'Keyword']);
    expect(tokens.map((t) => (t.kind === 'Keyword' ? t.value : null))).toEqual(['VAR', 'VAR', 'RETURN', 'IN', 'NOT']);
    expect(tokens[1].text).toBe('var'); // original text is preserved
  });

  it('does not treat words that merely contain a keyword as keywords', () => {
    expect(pairs('VARIANCE INFO RETURNS')).toEqual([
      ['Identifier', 'VARIANCE'],
      ['Identifier', 'INFO'],
      ['Identifier', 'RETURNS'],
    ]);
  });

  it('lexes query keywords such as EVALUATE as identifiers (not supported yet)', () => {
    expect(pairs('EVALUATE')).toEqual([['Identifier', 'EVALUATE']]);
  });
});

describe('table and column references', () => {
  it('lexes Table[Column] as an identifier followed by a bracketed name', () => {
    const tokens = lex('Product[Category]');
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([
      ['Identifier', 'Product'],
      ['BracketedName', '[Category]'],
    ]);
    expect(tokens[1]).toMatchObject({ value: 'Category', span: { start: 7, end: 17 } });
  });

  it('lexes a quoted table name with spaces', () => {
    const [table, column] = lex("'Sales Order'[Net Price]");
    expect(table).toMatchObject({ kind: 'QuotedTableName', text: "'Sales Order'", value: 'Sales Order' });
    expect(column).toMatchObject({ kind: 'BracketedName', value: 'Net Price' });
  });

  it("unescapes '' inside quoted table names", () => {
    expect(lex("'Bob''s Plant'")[0]).toMatchObject({ kind: 'QuotedTableName', value: "Bob's Plant" });
  });

  it('lexes a measure reference with spaces', () => {
    expect(lex('[Total Sales]')[0]).toMatchObject({ kind: 'BracketedName', value: 'Total Sales' });
  });

  it('unescapes ]] inside bracketed names', () => {
    expect(lex('[Sales [EUR]]]')[0]).toMatchObject({ kind: 'BracketedName', value: 'Sales [EUR]' });
  });

  it('allows an empty bracketed name (the parser will judge it)', () => {
    expect(lex('[]')[0]).toMatchObject({ kind: 'BracketedName', value: '' });
  });
});

describe('numbers', () => {
  it.each([
    ['0', 0],
    ['42', 42],
    ['1.5', 1.5],
    ['.5', 0.5],
    ['1.5E3', 1500],
    ['2e-3', 0.002],
    ['7E+2', 700],
  ])('lexes %s as %d', (text, value) => {
    expect(lex(text)).toEqual([{ kind: 'Number', text, value, span: { start: 0, end: text.length } }]);
  });

  it('lexes a leading minus as an operator, not part of the number', () => {
    expect(pairs('-1')).toEqual([
      ['Operator', '-'],
      ['Number', '1'],
    ]);
  });

  it.each(['2x', '1E', '1.2.3', '3Sales'])('reports %s as an invalid number', (text) => {
    const { tokens, diagnostics } = tokenize(text);
    expect(tokens[0]).toMatchObject({ kind: 'Error', text });
    expect(diagnostics).toMatchObject([{ code: 'invalid-number', span: { start: 0, end: text.length } }]);
  });
});

describe('strings', () => {
  it('lexes a simple string and exposes its content as value', () => {
    expect(lex('"Widgets"')[0]).toMatchObject({ kind: 'String', text: '"Widgets"', value: 'Widgets' });
  });

  it('lexes an empty string', () => {
    expect(lex('""')[0]).toMatchObject({ kind: 'String', value: '' });
  });

  it('unescapes doubled quotes', () => {
    expect(lex('"say ""hi"""')[0]).toMatchObject({ kind: 'String', value: 'say "hi"' });
  });

  it('allows a string to span lines', () => {
    expect(lex('"a\nb"')[0]).toMatchObject({ kind: 'String', value: 'a\nb' });
  });

  it('keeps comment-like text inside strings', () => {
    expect(pairs('"--not a comment"')).toEqual([['String', '"--not a comment"']]);
  });
});

describe('operators and punctuation', () => {
  it('lexes every operator, preferring the longest match', () => {
    const operators = ['+', '-', '*', '/', '^', '&', '=', '==', '<>', '<', '<=', '>', '>=', '&&', '||', ':='];
    expect(pairs(operators.join(' '))).toEqual(operators.map((op) => ['Operator', op]));
  });

  it('splits adjacent operators correctly without spaces', () => {
    expect(pairs('a<=b<>c')).toEqual([
      ['Identifier', 'a'],
      ['Operator', '<='],
      ['Identifier', 'b'],
      ['Operator', '<>'],
      ['Identifier', 'c'],
    ]);
  });

  it('lexes punctuation, including table constructors', () => {
    expect(pairs('( ) { } ,').map(([kind]) => kind)).toEqual(Array(5).fill('Punctuation'));
  });
});

describe('comments', () => {
  it('lexes // line comments up to the line break', () => {
    expect(pairs('1 // note\n2')).toEqual([
      ['Number', '1'],
      ['Comment', '// note'],
      ['Number', '2'],
    ]);
  });

  it('treats -- as a line comment, even directly after an expression', () => {
    expect(pairs('1--2\n3')).toEqual([
      ['Number', '1'],
      ['Comment', '--2'],
      ['Number', '3'],
    ]);
  });

  it('lexes multi-line block comments', () => {
    expect(pairs('1 /* a\nb */ 2')).toEqual([
      ['Number', '1'],
      ['Comment', '/* a\nb */'],
      ['Number', '2'],
    ]);
  });

  it('handles a line comment at the end of input without a line break', () => {
    expect(pairs('1 // end')).toEqual([
      ['Number', '1'],
      ['Comment', '// end'],
    ]);
  });

  it('stops a line comment at a Windows line break', () => {
    expect(pairs('// a\r\nb')).toEqual([
      ['Comment', '// a'],
      ['Identifier', 'b'],
    ]);
  });
});

describe('errors', () => {
  it('reports an unterminated string and covers the rest of the input', () => {
    const { tokens, diagnostics } = tokenize('"abc');
    expect(tokens[0]).toMatchObject({ kind: 'Error', text: '"abc' });
    expect(diagnostics).toMatchObject([{ severity: 'error', code: 'unterminated-string' }]);
  });

  it('reports an unterminated block comment', () => {
    expect(diagnosticCodes('1 /* never closed')).toEqual(['unterminated-comment']);
  });

  it('stops an unterminated bracketed name at the line break and continues lexing', () => {
    const { tokens, diagnostics } = tokenize('[Total Sales\n+ 1');
    expect(diagnostics).toMatchObject([{ code: 'unterminated-bracket', span: { start: 0, end: 12 } }]);
    expect(tokens.map((t) => t.kind)).toEqual(['Error', 'Operator', 'Number', 'EndOfInput']);
  });

  it('reports an unterminated quoted table name', () => {
    expect(diagnosticCodes("'Sales[Amount]")).toEqual(['unterminated-quoted-name']);
  });

  it('reports semicolon separators as unsupported rather than guessing', () => {
    expect(diagnosticCodes('DIVIDE(1; 2)')).toEqual(['unsupported-separator']);
  });

  it('reports unexpected characters and keeps going', () => {
    const { tokens, diagnostics } = tokenize('1 @ 2 # 3');
    expect(diagnostics.map((d) => d.code)).toEqual(['unexpected-character', 'unexpected-character']);
    expect(tokens.map((t) => t.kind)).toEqual(['Number', 'Error', 'Number', 'Error', 'Number', 'EndOfInput']);
  });

  it('reports a lone colon as unexpected', () => {
    expect(diagnosticCodes('a : b')).toEqual(['unexpected-character']);
  });

  it('names a non-breaking space explicitly', () => {
    const { diagnostics } = tokenize('1 + 2');
    expect(diagnostics[0].message).toContain('non-breaking space');
  });

  it('keeps surrogate-pair characters intact in error tokens', () => {
    const { tokens } = tokenize('😀');
    expect(tokens[0]).toMatchObject({ kind: 'Error', text: '😀', span: { start: 0, end: 2 } });
  });
});

describe('whole expressions', () => {
  it('tokenizes a CALCULATE expression into the expected sequence', () => {
    expect(pairs('CALCULATE([Total Sales], REMOVEFILTERS(Product[Category]))')).toEqual([
      ['Identifier', 'CALCULATE'],
      ['Punctuation', '('],
      ['BracketedName', '[Total Sales]'],
      ['Punctuation', ','],
      ['Identifier', 'REMOVEFILTERS'],
      ['Punctuation', '('],
      ['Identifier', 'Product'],
      ['BracketedName', '[Category]'],
      ['Punctuation', ')'],
      ['Punctuation', ')'],
    ]);
  });

  it('tokenizes VAR / RETURN blocks', () => {
    expect(pairs('VAR x = 1 RETURN x * 2').map(([kind]) => kind)).toEqual([
      'Keyword',
      'Identifier',
      'Operator',
      'Number',
      'Keyword',
      'Identifier',
      'Operator',
      'Number',
    ]);
  });

  it('lexes words separated by spaces as separate identifiers (measure headers are split off before lexing)', () => {
    expect(pairs('Sales Percent of Total =')).toEqual([
      ['Identifier', 'Sales'],
      ['Identifier', 'Percent'],
      ['Identifier', 'of'],
      ['Identifier', 'Total'],
      ['Operator', '='],
    ]);
  });

  it.each(SAMPLE_MEASURES.map((s) => [s.id, s.expression]))(
    'tokenizes built-in sample "%s" without diagnostics',
    (_id, expression) => {
      expect(tokenize(expression).diagnostics).toEqual([]);
    },
  );
});

describe('span invariants', () => {
  const inputs = [
    ...SAMPLE_MEASURES.map((s) => s.expression),
    '1 @ "unterminated',
    "'Bob''s'[A]]B] -- tail",
    'x /* c */ <= .5E2 && y',
  ];

  it.each(inputs)('every token text equals its source slice, in order, without overlap: %#', (source) => {
    const { tokens } = tokenize(source);
    let previousEnd = 0;
    for (const token of tokens) {
      expect(token.text).toBe(source.slice(token.span.start, token.span.end));
      expect(token.span.start).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = token.span.end;
    }
  });

  it.each(inputs)('only whitespace lies between tokens: %#', (source) => {
    const { tokens } = tokenize(source);
    let previousEnd = 0;
    for (const token of tokens) {
      expect(source.slice(previousEnd, token.span.start)).toMatch(/^\s*$/);
      previousEnd = token.span.end;
    }
  });
});

describe('startOffset', () => {
  it('starts lexing at the given offset and keeps spans relative to the full source', () => {
    const { tokens, diagnostics } = tokenize('Name | X = 1 + [A]', 10);
    expect(diagnostics).toEqual([]);
    expect(tokens.map((t) => [t.kind, t.text, t.span.start])).toEqual([
      ['Number', '1', 11],
      ['Operator', '+', 13],
      ['BracketedName', '[A]', 15],
      ['EndOfInput', '', 18],
    ]);
  });

  it('clamps an offset beyond the end of the source', () => {
    expect(tokenize('abc', 99).tokens).toEqual([{ kind: 'EndOfInput', text: '', span: { start: 3, end: 3 } }]);
  });
});

describe('createLineMap', () => {
  it('converts offsets to 1-based line and column for all line-break styles', () => {
    const source = 'ab\ncd\r\nef\rgh';
    const positionAt = createLineMap(source);
    expect(positionAt(0)).toEqual({ line: 1, column: 1 });
    expect(positionAt(1)).toEqual({ line: 1, column: 2 });
    expect(positionAt(3)).toEqual({ line: 2, column: 1 });
    expect(positionAt(7)).toEqual({ line: 3, column: 1 });
    expect(positionAt(10)).toEqual({ line: 4, column: 1 });
    expect(positionAt(source.length)).toEqual({ line: 4, column: 3 });
  });
});
