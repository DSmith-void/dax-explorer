import { describe, expect, it } from 'vitest';
import { analyze } from './analysis';
import type { ModelMetadata } from './helperClient';
import { measureDefinitionText, toModelSnapshot } from './modelConversion';

describe('model conversion', () => {
  const model: ModelMetadata = {
    databaseName: 'db',
    tables: [{ name: 'Sales', isHidden: false, expression: null }],
    columns: [{ table: 'Sales', name: 'Amount', dataType: 'Number', isHidden: false, kind: 'Data', expression: null }],
    measures: [
      { table: 'Sales', name: 'Total Sales', expression: '\n  SUM(Sales[Amount])  ', formatString: null, isHidden: false, displayFolder: null },
    ],
    relationships: [],
  };

  it("keeps only what the engine needs from the helper's model", () => {
    expect(toModelSnapshot(model)).toEqual({
      tables: ['Sales'],
      columns: [{ table: 'Sales', name: 'Amount' }],
      measures: [{ table: 'Sales', name: 'Total Sales', expression: '\n  SUM(Sales[Amount])  ' }],
      calendars: [],
    });
  });

  it('builds editor text that the measure-definition input reads back correctly', () => {
    const text = measureDefinitionText('Total Sales', model.measures[0].expression);
    expect(text).toBe('Total Sales =\nSUM(Sales[Amount])');
    const result = analyze(text, 'measure-definition');
    expect(result.diagnostics).toEqual([]);
    expect(result.header?.name).toBe('Total Sales');
  });

  it('keeps names with symbols as plain text', () => {
    expect(analyze(measureDefinitionText('Sales | Plant %', '1'), 'measure-definition').header?.name).toBe('Sales | Plant %');
  });
});
