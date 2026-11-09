import { describe, expect, it } from 'vitest';
import { splitMeasureDefinition } from './definition';

function headerOf(source: string) {
  const { header, diagnostics } = splitMeasureDefinition(source);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  if (!header) throw new Error('expected a header');
  return header;
}

describe('splitMeasureDefinition: valid headers', () => {
  it('splits a simple definition', () => {
    const source = 'Total Sales = SUM(Sales[Amount])';
    const header = headerOf(source);
    expect(header).toEqual({
      name: 'Total Sales',
      nameSpan: { start: 0, end: 11 },
      operator: '=',
      operatorSpan: { start: 12, end: 13 },
      expressionStart: 13,
    });
    expect(source.slice(header.expressionStart)).toBe(' SUM(Sales[Amount])');
  });

  it.each([
    ['Sales | Plant = 1', 'Sales | Plant'],
    ['Sales (LY) % = 1', 'Sales (LY) %'],
    ["Customer's Sales = 1", "Customer's Sales"],
    ['Umsatz € / Größe = 1', 'Umsatz € / Größe'],
    ['Sales - Plant 01 # = 1', 'Sales - Plant 01 #'],
  ])('treats %j as a plain-text name', (source, name) => {
    expect(headerOf(source).name).toBe(name);
  });

  it('supports the := operator', () => {
    const header = headerOf('Total Sales := 1');
    expect(header).toMatchObject({ name: 'Total Sales', operator: ':=', operatorSpan: { start: 12, end: 14 }, expressionStart: 14 });
  });

  it('splits at the FIRST "=" so the expression may contain more', () => {
    const source = 'Is Zero = [Total Sales] = 0';
    const header = headerOf(source);
    expect(header.name).toBe('Is Zero');
    expect(source.slice(header.expressionStart)).toBe(' [Total Sales] = 0');
  });

  it('skips leading blank lines and trims the name, with spans in the original text', () => {
    const source = '\n   \r\n   Total Sales   =\n    SUM(Sales[Amount])';
    const header = headerOf(source);
    expect(header.name).toBe('Total Sales');
    expect(source.slice(header.nameSpan.start, header.nameSpan.end)).toBe('Total Sales');
    expect(source.slice(header.operatorSpan.start, header.operatorSpan.end)).toBe('=');
  });

  it('allows the expression to start on the next line', () => {
    const source = 'Total Sales =\nSUM(Sales[Amount])';
    expect(source.slice(headerOf(source).expressionStart)).toBe('\nSUM(Sales[Amount])');
  });
});

describe('splitMeasureDefinition: problems', () => {
  it('reports a missing header when the first line has no "="', () => {
    const { header, diagnostics } = splitMeasureDefinition('CALCULATE(\n  [Total Sales] = 1)');
    expect(header).toBeNull();
    expect(diagnostics).toMatchObject([{ severity: 'error', code: 'missing-measure-header', span: { start: 0, end: 10 } }]);
    expect(diagnostics[0].message).toContain('Expression only');
  });

  it('reports empty input', () => {
    expect(splitMeasureDefinition('  \n ').diagnostics).toMatchObject([{ code: 'missing-measure-header' }]);
  });

  it('reports an empty name', () => {
    const { header, diagnostics } = splitMeasureDefinition('  = 1');
    expect(header).toBeNull();
    expect(diagnostics).toMatchObject([{ code: 'empty-measure-name', span: { start: 2, end: 3 } }]);
  });

  it.each(['[Total Sales] = 0', "'Sales'[Amount] = 1", '"x" = 1'])(
    'splits %j as requested but warns that it looks like an expression',
    (source) => {
      const { header, diagnostics } = splitMeasureDefinition(source);
      expect(header).not.toBeNull();
      expect(diagnostics).toMatchObject([{ severity: 'warning', code: 'suspicious-measure-name' }]);
    },
  );
});
