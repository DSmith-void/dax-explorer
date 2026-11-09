import { describe, expect, it } from 'vitest';
import { SAMPLE_MEASURES } from '../samples/sampleMeasures';
import { analyze } from './analysis';

describe('analyze: measure-definition mode', () => {
  it('does not lex the measure name, so symbols in names are accepted', () => {
    const result = analyze('Sales | Plant % = [Total Sales]', 'measure-definition');
    expect(result.diagnostics).toEqual([]);
    expect(result.header?.name).toBe('Sales | Plant %');
    expect(result.lex?.tokens.map((t) => t.kind)).toEqual(['BracketedName', 'EndOfInput']);
  });

  it('keeps token spans relative to the full text', () => {
    const text = 'A | B = 1 + 2';
    const tokens = analyze(text, 'measure-definition').lex?.tokens ?? [];
    for (const token of tokens) {
      expect(text.slice(token.span.start, token.span.end)).toBe(token.text);
    }
    expect(tokens[0]).toMatchObject({ kind: 'Number', span: { start: 8, end: 9 } });
  });

  it('does not lex at all when the header is missing', () => {
    const result = analyze('SUM(Sales[Amount])', 'measure-definition');
    expect(result.header).toBeNull();
    expect(result.lex).toBeNull();
    expect(result.diagnostics).toMatchObject([{ code: 'missing-measure-header' }]);
  });

  it('combines header warnings and lexical errors in source order', () => {
    const result = analyze('[X] = 1 @', 'measure-definition');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['suspicious-measure-name', 'unexpected-character']);
  });

  it.each(SAMPLE_MEASURES.map((s) => [s.id, s]))('analyzes sample "%s" with no diagnostics', (_id, sample) => {
    const result = analyze(sample.expression, 'measure-definition');
    expect(result.diagnostics).toEqual([]);
    expect(result.header?.name).toBe(sample.title.replace(' (with variables)', ''));
  });
});

describe('analyze: expression mode', () => {
  it('lexes the whole text and has no header', () => {
    const result = analyze('[Total Sales] = 0', 'expression');
    expect(result.header).toBeNull();
    expect(result.diagnostics).toEqual([]);
    expect(result.lex?.tokens.map((t) => t.kind)).toEqual(['BracketedName', 'Operator', 'Number', 'EndOfInput']);
  });

  it('still reports symbols outside brackets (lexer), then the stray text after them (parser)', () => {
    expect(analyze('Sales | Plant', 'expression').diagnostics.map((d) => d.code)).toEqual([
      'unexpected-character',
      'unexpected-trailing-input',
    ]);
  });

  it('parses the expression into a tree', () => {
    expect(analyze('[Total Sales] = 0', 'expression').parse?.root).toMatchObject({ kind: 'BinaryOp', operator: '=' });
  });
});

describe('analyze: diagnostics from all stages', () => {
  it('reports a parser error with header-relative positions', () => {
    const result = analyze('Bad = DIVIDE([A] [B])', 'measure-definition');
    expect(result.diagnostics).toMatchObject([{ code: 'expected-comma-or-paren', span: { start: 17, end: 20 } }]);
  });

  it('does not report a lexer error twice', () => {
    expect(analyze('X = 1 @', 'measure-definition').diagnostics.map((d) => d.code)).toEqual(['unexpected-character']);
  });
});
