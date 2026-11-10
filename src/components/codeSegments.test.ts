import { describe, expect, it } from 'vitest';
import { splitMeasureDefinition } from '../engine/definition';
import { tokenize } from '../engine/lexer/lexer';
import { parse } from '../engine/parser/parser';
import { codeLines, isInside, nodeAt } from './codeSegments';

function lines(text: string) {
  const start = splitMeasureDefinition(text).header!.expressionStart;
  return { start, lines: codeLines(text, tokenize(text, start).tokens, start) };
}

describe('codeLines', () => {
  it('reproduces the text exactly, line by line, with offsets', () => {
    const text = 'Total =\r\nVAR x = 1 -- note\n\tRETURN  SUM(Sales[Amount]) & "a""b"\n';
    const { lines: result } = lines(text);
    expect(result.map((line) => line.map((s) => s.text).join(''))).toEqual(text.split(/\r\n|\n/));
    for (const segment of result.flat()) expect(text.slice(segment.start, segment.start + segment.text.length)).toBe(segment.text);
  });

  it('colors the name, keywords, functions, tables, names in brackets, strings, numbers and comments', () => {
    const { lines: result } = lines('M = VAR x = 1 -- c\nRETURN SUM(Sales[Amount]) & "t"');
    const kinds = Object.fromEntries(result.flat().filter((s) => s.text.trim()).map((s) => [s.text, s.kind]));
    expect(kinds).toMatchObject({
      'M =': 'measure-name',
      VAR: 'keyword',
      '1': 'number',
      '-- c': 'comment',
      SUM: 'function',
      Sales: 'table',
      '[Amount]': 'bracketed',
      '"t"': 'string',
      '&': 'operator',
    });
  });
});

describe('nodeAt', () => {
  const text = 'DIVIDE([A], CALCULATE([B], ALL(T)))';
  const { root } = parse(tokenize(text, 0).tokens);

  it('finds the smallest expression at a position', () => {
    expect(nodeAt(root, text.indexOf('[B]'))?.kind).toBe('BracketRef');
    expect(nodeAt(root, text.indexOf('CALCULATE'))).toMatchObject({ kind: 'FunctionCall', name: 'CALCULATE' });
    expect(nodeAt(root, 0)).toMatchObject({ kind: 'FunctionCall', name: 'DIVIDE' });
  });

  it('returns null outside the expression', () => {
    expect(nodeAt(root, text.length + 5)).toBeNull();
    expect(nodeAt(null, 0)).toBeNull();
  });
});

describe('isInside', () => {
  it('is true only for pieces entirely inside the span', () => {
    expect(isInside({ text: 'ab', kind: 'plain', start: 2 }, { start: 2, end: 4 })).toBe(true);
    expect(isInside({ text: 'ab', kind: 'plain', start: 3 }, { start: 2, end: 4 })).toBe(false);
    expect(isInside({ text: 'ab', kind: 'plain', start: 2 }, null)).toBe(false);
  });
});
